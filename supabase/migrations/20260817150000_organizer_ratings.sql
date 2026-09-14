begin;

alter table public.valoraciones
    add column if not exists tipo text not null default 'persona';

alter table public.valoraciones
    drop constraint if exists valoraciones_tipo_check;

alter table public.valoraciones
    add constraint valoraciones_tipo_check
    check (tipo in ('persona', 'organizacion'));

alter table public.valoraciones drop constraint if exists valoraciones_aspectos_positivos_check;
alter table public.valoraciones drop constraint if exists valoraciones_aspectos_negativos_check;

alter table public.valoraciones
    add constraint valoraciones_aspectos_positivos_check
    check (
        cardinality(coalesce(aspectos_positivos, '{}'::text[])) <= 2
        and coalesce(aspectos_positivos, '{}'::text[]) <@ array[
            'agradable','puntual','respetuoso','cercano','divertido','social',
            'organizado','buen_ambiente','puntual_org','comunicacion','fiel_anuncio'
        ]::text[]
    );

alter table public.valoraciones
    add constraint valoraciones_aspectos_negativos_check
    check (
        cardinality(coalesce(aspectos_negativos, '{}'::text[])) <= 2
        and coalesce(aspectos_negativos, '{}'::text[]) <@ array[
            'impuntual','irrespetuoso','frio','poco_participativo','incomodo',
            'desorganizado','retraso','masificado','no_anunciado','mal_ambiente'
        ]::text[]
    );

drop function if exists public.guardar_valoracion(uuid, uuid, boolean, integer, text, jsonb, jsonb);
drop function if exists public.guardar_valoracion(uuid, uuid, boolean, integer, text, jsonb, jsonb, text);

create function public.guardar_valoracion(
    p_plan_id uuid,
    p_evaluado_id uuid,
    p_asistencia boolean,
    p_puntuacion_general integer default null,
    p_repetiria_experiencia text default null,
    p_aspectos_positivos jsonb default '[]'::jsonb,
    p_aspectos_negativos jsonb default '[]'::jsonb,
    p_tipo text default 'persona'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid uuid := auth.uid();
    v_pos text[];
    v_neg text[];
    v_asistencia boolean;
    v_score integer;
    v_rep text;
    v_existing uuid;
    v_tipo text := case when p_tipo = 'organizacion' then 'organizacion' else 'persona' end;
    v_pos_allowed text[];
    v_neg_allowed text[];
begin
    if v_uid is null then
        return jsonb_build_object('ok', false, 'error', 'not_authenticated');
    end if;
    if p_plan_id is null or p_evaluado_id is null then
        return jsonb_build_object('ok', false, 'error', 'invalid_params');
    end if;
    if v_uid = p_evaluado_id then
        return jsonb_build_object('ok', false, 'error', 'self_rating');
    end if;
    if not exists (select 1 from public.planes where id = p_plan_id) then
        return jsonb_build_object('ok', false, 'error', 'plan_not_found');
    end if;
    if not exists (
        select 1 from public.participantes
        where plan_id = p_plan_id and usuario_id = v_uid and estado = 'aceptado'
    ) then
        return jsonb_build_object('ok', false, 'error', 'not_participant');
    end if;

    if v_tipo = 'organizacion' then
        if not exists (
            select 1
            from public.planes as pl
            join public.perfiles as pf on pf.id = pl.creador_id
            where pl.id = p_plan_id
              and pl.creador_id = p_evaluado_id
              and pf.es_organizador
        ) then
            return jsonb_build_object('ok', false, 'error', 'not_organizer_plan');
        end if;
        v_pos_allowed := array['organizado','buen_ambiente','puntual_org','comunicacion','fiel_anuncio'];
        v_neg_allowed := array['desorganizado','retraso','masificado','no_anunciado','mal_ambiente'];
    else
        v_pos_allowed := array['agradable','puntual','respetuoso','cercano','divertido','social'];
        v_neg_allowed := array['impuntual','irrespetuoso','frio','poco_participativo','incomodo'];
    end if;

    select coalesce(
        array(
            select distinct x
            from jsonb_array_elements_text(coalesce(p_aspectos_positivos, '[]'::jsonb)) as t(x)
            where x = any (v_pos_allowed)
            limit 2
        ),
        '{}'::text[]
    ) into v_pos;

    select coalesce(
        array(
            select distinct x
            from jsonb_array_elements_text(coalesce(p_aspectos_negativos, '[]'::jsonb)) as t(x)
            where x = any (v_neg_allowed)
            limit 2
        ),
        '{}'::text[]
    ) into v_neg;

    v_asistencia := coalesce(p_asistencia, true);

    if v_asistencia then
        v_score := p_puntuacion_general;
        v_rep := p_repetiria_experiencia;
        if v_score is null or v_score < 1 or v_score > 5 then
            return jsonb_build_object('ok', false, 'error', 'incomplete_rating');
        end if;
        if v_rep is null or v_rep not in ('si', 'no', 'indiferente') then
            return jsonb_build_object('ok', false, 'error', 'incomplete_rating');
        end if;
    else
        if v_tipo = 'organizacion' then
            return jsonb_build_object('ok', false, 'error', 'incomplete_rating');
        end if;
        v_score := null;
        v_rep := null;
        v_pos := '{}';
        v_neg := '{}';
    end if;

    select id into v_existing
    from public.valoraciones
    where plan_id = p_plan_id
      and evaluador_id = v_uid
      and evaluado_id = p_evaluado_id
    limit 1;

    begin
        if v_existing is not null then
            update public.valoraciones set
                asistencia = v_asistencia,
                puntuacion_general = v_score,
                repetiria_experiencia = v_rep,
                aspectos_positivos = v_pos,
                aspectos_negativos = v_neg,
                tipo = v_tipo,
                actualizado_en = now()
            where id = v_existing;
        else
            insert into public.valoraciones (
                plan_id,
                evaluador_id,
                evaluado_id,
                asistencia,
                puntuacion_general,
                repetiria_experiencia,
                aspectos_positivos,
                aspectos_negativos,
                motivos_seguridad,
                incidencia_seguridad,
                tipo
            ) values (
                p_plan_id,
                v_uid,
                p_evaluado_id,
                v_asistencia,
                v_score,
                v_rep,
                v_pos,
                v_neg,
                '{}'::text[],
                false,
                v_tipo
            );
        end if;
    exception when others then
        return jsonb_build_object('ok', false, 'error', SQLERRM);
    end;

    return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.guardar_valoracion(uuid, uuid, boolean, integer, text, jsonb, jsonb, text) from public;
grant execute on function public.guardar_valoracion(uuid, uuid, boolean, integer, text, jsonb, jsonb, text) to authenticated, service_role;

create or replace function public.recalcular_estadisticas_valoraciones(p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_media numeric;
    v_total integer;
    v_repetiria numeric;
    v_asistencias integer;
    v_asistencia_total integer;
    v_asistencia_pct numeric;
    v_evaluadores integer;
    v_pos text;
    v_pos_votos integer;
    v_neg text;
    v_neg_votos integer;
    v_con_negativo integer;
    v_es_org boolean := false;
    v_tipo text;
begin
    insert into public.estadisticas_usuario (usuario_id)
    values (p_usuario)
    on conflict (usuario_id) do nothing;

    select coalesce(es_organizador, false) into v_es_org
    from public.perfiles
    where id = p_usuario;
    v_tipo := case when v_es_org then 'organizacion' else 'persona' end;

    select coalesce(round(avg(puntuacion_general)::numeric, 2), 0),
           count(*) filter (where puntuacion_general is not null),
           coalesce(round(
               100.0 * count(*) filter (where repetiria_experiencia = 'si')
               / nullif(count(*) filter (where repetiria_experiencia in ('si', 'no')), 0)
           , 2), 0),
           count(*) filter (where asistencia = true),
           count(*) filter (where asistencia is not null),
           count(distinct evaluador_id),
           count(*) filter (
               where coalesce(cardinality(aspectos_negativos), 0) > 0
           )
      into v_media, v_total, v_repetiria, v_asistencias, v_asistencia_total, v_evaluadores, v_con_negativo
      from public.valoraciones
     where evaluado_id = p_usuario
       and coalesce(tipo, 'persona') = v_tipo;

    v_asistencia_pct := coalesce(round(
        100.0 * v_asistencias / nullif(v_asistencia_total, 0)
    , 2), 0);

    select a, c into v_pos, v_pos_votos from (
        select unnest(aspectos_positivos) as a, count(*) as c
          from public.valoraciones
         where evaluado_id = p_usuario
           and coalesce(tipo, 'persona') = v_tipo
         group by 1 order by 2 desc, 1 limit 1
    ) s;

    if v_total >= 5 and (100.0 * v_con_negativo / v_total) >= 20 then
        select a, c into v_neg, v_neg_votos from (
            select unnest(aspectos_negativos) as a, count(*) as c
              from public.valoraciones
             where evaluado_id = p_usuario
               and coalesce(tipo, 'persona') = v_tipo
               and coalesce(cardinality(aspectos_negativos), 0) > 0
             group by 1 order by 2 desc, 1 limit 1
        ) s;
    else
        v_neg := null;
        v_neg_votos := 0;
    end if;

    update public.estadisticas_usuario set
        valoracion_media               = least(5, greatest(0, v_media)),
        numero_valoraciones            = v_total,
        porcentaje_repetiria           = v_repetiria,
        numero_asistencias_confirmadas = v_asistencias,
        porcentaje_asistencia          = v_asistencia_pct,
        numero_evaluadores_distintos   = v_evaluadores,
        aspecto_positivo_mas_votado    = v_pos,
        votos_aspecto_positivo         = coalesce(v_pos_votos, 0),
        aspecto_negativo_mas_votado    = v_neg,
        votos_aspecto_negativo         = coalesce(v_neg_votos, 0),
        actualizado_en                 = now()
    where usuario_id = p_usuario;
end;
$$;

do $$
declare
    r record;
begin
    for r in select distinct evaluado_id as id from public.valoraciones
    loop
        perform public.recalcular_estadisticas_valoraciones(r.id);
    end loop;
end;
$$;

create unique index if not exists valoraciones_organizacion_unica
    on public.valoraciones (plan_id, evaluador_id)
    where tipo = 'organizacion';

notify pgrst, 'reload schema';

commit;

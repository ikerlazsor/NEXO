-- Torneo: plazas de afición + miembros pueden renombrar/emparejar (sin avanzar rondas).

begin;

alter table public.alineaciones drop constraint if exists alineaciones_posicion_check;
alter table public.alineaciones
    add constraint alineaciones_posicion_check
    check (posicion >= 0 and posicion < 48);

create or replace function public.set_plan_alineacion(p_plan_id uuid, p_alineacion jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_max integer;
    v_fmt text;
    v_n integer;
    v_bench integer;
    v_aficion integer;
    v_teams integer;
    v_modo text;
    v_need integer;
begin
    if auth.uid() is null then
        raise exception 'not_authenticated';
    end if;
    select maximo_participantes into v_max
    from public.planes
    where id = p_plan_id and creador_id = auth.uid();
    if v_max is null then
        raise exception 'not_creator';
    end if;

    if p_alineacion is null or p_alineacion = 'null'::jsonb then
        update public.planes
        set alineacion = null, actualizado_en = now()
        where id = p_plan_id;
        delete from public.alineaciones where plan_id = p_plan_id;
        return;
    end if;

    v_fmt := p_alineacion->>'formato';
    if v_fmt not in ('2v2', '5v5', '6v6', '7v7', '8v8', '9v9', '10v10', '11v11', 'sala') then
        raise exception 'bad_format';
    end if;
    if v_fmt = 'sala' then
        v_n := 5;
    else
        v_n := split_part(v_fmt, 'v', 1)::integer;
    end if;

    v_modo := coalesce(p_alineacion->>'modo', 'partido');
    v_teams := coalesce(jsonb_array_length(p_alineacion->'equipos'), 0);

    if v_modo = 'torneo' then
        if v_teams < 3 or v_teams > 16 then
            raise exception 'bad_teams';
        end if;
        v_bench := greatest(0, least(12, coalesce((p_alineacion->>'banquillo')::integer, 5)));
        v_aficion := greatest(0, least(40, coalesce((p_alineacion->>'aficion')::integer, 20)));
        v_need := v_teams * (v_n + v_bench) + v_aficion;
        if v_max < v_need then
            raise exception 'format_too_big';
        end if;
        p_alineacion := jsonb_set(p_alineacion, '{banquillo}', to_jsonb(v_bench), true);
        p_alineacion := jsonb_set(p_alineacion, '{aficion}', to_jsonb(v_aficion), true);
        p_alineacion := jsonb_set(p_alineacion, '{modo}', '"torneo"'::jsonb, true);

        update public.planes
        set alineacion = p_alineacion, actualizado_en = now()
        where id = p_plan_id;

        -- Equipos 0..v_teams-1: titulares+banquillo; equipo v_teams = afición.
        delete from public.alineaciones
        where plan_id = p_plan_id
          and (
              equipo > v_teams
              or (equipo < v_teams and posicion >= v_n + v_bench)
              or (equipo = v_teams and posicion >= v_aficion)
          );
        return;
    end if;

    if v_teams < 2 then
        raise exception 'bad_teams';
    end if;
    if v_max < v_n * 2 then
        raise exception 'format_too_big';
    end if;

    update public.planes
    set alineacion = p_alineacion, actualizado_en = now()
    where id = p_plan_id;

    delete from public.alineaciones
    where plan_id = p_plan_id
      and (posicion >= v_n or equipo > 1);
end;
$$;

create or replace function public.claim_alineacion_slot(
    p_plan_id uuid,
    p_equipo smallint,
    p_posicion smallint
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_cfg jsonb;
    v_fmt text;
    v_n integer;
    v_bench integer := 0;
    v_aficion integer := 0;
    v_teams integer;
    v_modo text;
    v_uid uuid := auth.uid();
    v_max_pos integer;
    v_is_aficion boolean := false;
begin
    if v_uid is null then
        raise exception 'not_authenticated';
    end if;
    if exists (
        select 1 from public.perfiles pe
        where pe.id = v_uid and pe.es_organizador is true
    ) then
        raise exception 'organizer_cannot_join';
    end if;
    if p_equipo < 0 or p_posicion < 0 then
        raise exception 'bad_slot';
    end if;

    select alineacion into v_cfg
    from public.planes
    where id = p_plan_id;
    if v_cfg is null then
        raise exception 'no_lineup';
    end if;

    v_fmt := v_cfg->>'formato';
    v_modo := coalesce(v_cfg->>'modo', 'partido');
    v_teams := coalesce(jsonb_array_length(v_cfg->'equipos'), 2);
    if v_fmt = 'sala' then
        v_n := 5;
    else
        v_n := split_part(v_fmt, 'v', 1)::integer;
    end if;

    if v_modo = 'torneo' then
        v_bench := greatest(0, least(12, coalesce((v_cfg->>'banquillo')::integer, 5)));
        v_aficion := greatest(0, least(40, coalesce((v_cfg->>'aficion')::integer, 20)));
        if p_equipo = v_teams then
            v_is_aficion := true;
            v_max_pos := v_aficion;
            if p_posicion >= v_max_pos then
                raise exception 'bad_slot';
            end if;
        elsif p_equipo < v_teams then
            v_max_pos := v_n + v_bench;
            if p_posicion >= v_max_pos then
                raise exception 'bad_slot';
            end if;
        else
            raise exception 'bad_slot';
        end if;
    else
        if p_equipo not in (0, 1) or p_posicion >= v_n then
            raise exception 'bad_slot';
        end if;
    end if;

    if not exists (
        select 1 from public.planes pl
        where pl.id = p_plan_id and pl.creador_id = v_uid
    ) and not exists (
        select 1 from public.participantes pa
        where pa.plan_id = p_plan_id
          and pa.usuario_id = v_uid
          and pa.estado = 'aceptado'
    ) then
        raise exception 'not_member';
    end if;

    delete from public.alineaciones
    where plan_id = p_plan_id and usuario_id = v_uid;

    insert into public.alineaciones (plan_id, equipo, posicion, usuario_id)
    values (p_plan_id, p_equipo, p_posicion, v_uid);

    -- Primer jugador del equipo = capitán (no aplica a afición).
    if v_modo = 'torneo' and not v_is_aficion then
        if coalesce(v_cfg->'equipos'->p_equipo->>'capitan_id', '') = '' then
            update public.planes
            set alineacion = jsonb_set(
                    alineacion,
                    array['equipos', p_equipo::text, 'capitan_id'],
                    to_jsonb(v_uid::text),
                    true
                ),
                actualizado_en = now()
            where id = p_plan_id;
        end if;
    end if;
end;
$$;

-- Miembros del plan pueden actualizar nombres/colores/bracket (sin crear el torneo).
create or replace function public.patch_tournament_alineacion(
    p_plan_id uuid,
    p_alineacion jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid uuid := auth.uid();
    v_old jsonb;
    v_modo text;
    v_teams integer;
    v_old_teams integer;
begin
    if v_uid is null then
        raise exception 'not_authenticated';
    end if;
    if p_alineacion is null then
        raise exception 'bad_config';
    end if;

    select alineacion into v_old
    from public.planes
    where id = p_plan_id;
    if v_old is null then
        raise exception 'no_lineup';
    end if;

    v_modo := coalesce(v_old->>'modo', 'partido');
    if v_modo <> 'torneo' or coalesce(p_alineacion->>'modo', '') <> 'torneo' then
        raise exception 'not_tournament';
    end if;

    if not exists (
        select 1 from public.planes pl
        where pl.id = p_plan_id and pl.creador_id = v_uid
    ) and not exists (
        select 1 from public.participantes pa
        where pa.plan_id = p_plan_id
          and pa.usuario_id = v_uid
          and pa.estado = 'aceptado'
    ) then
        raise exception 'not_member';
    end if;

    v_old_teams := coalesce(jsonb_array_length(v_old->'equipos'), 0);
    v_teams := coalesce(jsonb_array_length(p_alineacion->'equipos'), 0);
    if v_teams <> v_old_teams or v_teams < 3 then
        raise exception 'bad_teams';
    end if;

    -- Conservar formato/pista/banquillo/aficion del original; aceptar equipos+bracket nuevos.
    p_alineacion := jsonb_set(p_alineacion, '{formato}', v_old->'formato', true);
    if v_old ? 'pista' then
        p_alineacion := jsonb_set(p_alineacion, '{pista}', v_old->'pista', true);
    end if;
    p_alineacion := jsonb_set(p_alineacion, '{banquillo}', v_old->'banquillo', true);
    if v_old ? 'aficion' then
        p_alineacion := jsonb_set(p_alineacion, '{aficion}', v_old->'aficion', true);
    end if;
    p_alineacion := jsonb_set(p_alineacion, '{modo}', '"torneo"'::jsonb, true);

    -- No permitir que el patch borre capitanes existentes si vienen vacíos por error de cliente:
    -- se fusionan capitan_id del viejo cuando el nuevo es null/''.
    for i in 0 .. v_teams - 1 loop
        if coalesce(p_alineacion->'equipos'->i->>'capitan_id', '') = ''
           and coalesce(v_old->'equipos'->i->>'capitan_id', '') <> '' then
            p_alineacion := jsonb_set(
                p_alineacion,
                array['equipos', i::text, 'capitan_id'],
                v_old->'equipos'->i->'capitan_id',
                true
            );
        end if;
    end loop;

    update public.planes
    set alineacion = p_alineacion, actualizado_en = now()
    where id = p_plan_id;
end;
$$;

revoke all on function public.patch_tournament_alineacion(uuid, jsonb) from public;
grant execute on function public.patch_tournament_alineacion(uuid, jsonb) to authenticated, service_role;

commit;

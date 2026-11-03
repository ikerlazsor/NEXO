-- Torneo de fútbol: N equipos, banquillo, slots multi-equipo + kick por capitán/creador.

begin;

-- Slots: más de 2 equipos y posiciones de banquillo (hasta 23).
alter table public.alineaciones drop constraint if exists alineaciones_equipo_check;
alter table public.alineaciones drop constraint if exists alineaciones_posicion_check;

alter table public.alineaciones
    add constraint alineaciones_equipo_check
    check (equipo >= 0 and equipo < 32);

alter table public.alineaciones
    add constraint alineaciones_posicion_check
    check (posicion >= 0 and posicion < 24);

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
        v_need := v_teams * (v_n + v_bench);
        if v_max < v_need then
            raise exception 'format_too_big';
        end if;
        -- Normalizar banquillo en el JSON persistido.
        p_alineacion := jsonb_set(p_alineacion, '{banquillo}', to_jsonb(v_bench), true);
        p_alineacion := jsonb_set(p_alineacion, '{modo}', '"torneo"'::jsonb, true);

        update public.planes
        set alineacion = p_alineacion, actualizado_en = now()
        where id = p_plan_id;

        delete from public.alineaciones
        where plan_id = p_plan_id
          and (posicion >= v_n + v_bench or equipo >= v_teams);
        return;
    end if;

    -- Partido clásico 2 equipos (sin banquillo).
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
    v_teams integer;
    v_modo text;
    v_uid uuid := auth.uid();
    v_max_pos integer;
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
        v_max_pos := v_n + v_bench;
        if p_equipo >= v_teams or p_posicion >= v_max_pos then
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

    -- Primer jugador del equipo = capitán (si aún no hay).
    if v_modo = 'torneo' then
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

-- Creador o capitán del equipo pueden sacar a alguien del slot.
create or replace function public.kick_alineacion_slot(
    p_plan_id uuid,
    p_usuario_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid uuid := auth.uid();
    v_cfg jsonb;
    v_creador uuid;
    v_equipo smallint;
    v_capitan text;
begin
    if v_uid is null then
        raise exception 'not_authenticated';
    end if;
    if p_usuario_id is null then
        raise exception 'bad_user';
    end if;

    select alineacion, creador_id into v_cfg, v_creador
    from public.planes
    where id = p_plan_id;
    if v_cfg is null then
        raise exception 'no_lineup';
    end if;

    select equipo into v_equipo
    from public.alineaciones
    where plan_id = p_plan_id and usuario_id = p_usuario_id;
    if v_equipo is null then
        return;
    end if;

    v_capitan := v_cfg->'equipos'->v_equipo->>'capitan_id';
    if v_uid <> v_creador and v_uid::text <> coalesce(v_capitan, '') then
        raise exception 'not_allowed';
    end if;

    delete from public.alineaciones
    where plan_id = p_plan_id and usuario_id = p_usuario_id;
end;
$$;

revoke all on function public.kick_alineacion_slot(uuid, uuid) from public;
grant execute on function public.kick_alineacion_slot(uuid, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

begin;

create or replace function public.reject_organizer_friendships()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
    if exists (
        select 1 from public.perfiles
        where id in (new.usuario_origen_id, new.usuario_destino_id)
          and es_organizador
    ) then
        raise exception 'organizer_no_friends' using errcode = 'P0001';
    end if;
    return new;
end;
$$;

drop trigger if exists trg_reject_organizer_friendships on public.amistades;
create trigger trg_reject_organizer_friendships
before insert or update of usuario_origen_id, usuario_destino_id, estado
on public.amistades
for each row
when (new.estado is distinct from 'rechazado')
execute function public.reject_organizer_friendships();

create or replace function public.pause_organizer_series(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    uid uuid := auth.uid();
    src public.planes;
    sid uuid;
begin
    if uid is null then
        raise exception 'not_authenticated';
    end if;

    select * into src from public.planes where id = p_plan_id;
    if not found or src.creador_id is distinct from uid then
        raise exception 'not_authorized';
    end if;
    if not exists (
        select 1 from public.perfiles where id = uid and es_organizador and baneado is false
    ) then
        raise exception 'not_organizer';
    end if;

    sid := coalesce(src.serie_id, src.id);

    update public.planes
    set recurrencia = case
        when recurrencia is null then jsonb_build_object('freq', 'weekly', 'paused', true)
        else recurrencia || jsonb_build_object('paused', true)
    end
    where creador_id = uid
      and (id = p_plan_id or id = sid or serie_id = sid);

    update public.planes
    set estado = 'cancelado'
    where creador_id = uid
      and (id = sid or serie_id = sid)
      and id <> p_plan_id
      and fecha_evento > now()
      and estado not in ('cancelado', 'finalizado');
end;
$$;

create or replace function public.create_meetup_plan(p_payload jsonb)
returns planes
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid uuid := auth.uid();
    v_plan public.planes;
    v_max int;
    v_min int;
    v_limit int := 3;
    v_cap int := 25;
    v_images text[];
    v_rec jsonb;
    v_serie uuid;
    v_is_org boolean := false;
begin
    if v_uid is null then
        raise exception 'not_authenticated' using errcode = '42501';
    end if;

    select es_organizador into v_is_org from public.perfiles where id = v_uid;
    if v_is_org then
        v_limit := 10;
        v_cap := 800;
    end if;

    if to_regprocedure('public.count_user_active_plans(uuid)') is not null then
        if public.count_user_active_plans(v_uid) >= v_limit then
            raise exception 'active_plan_limit_reached' using errcode = 'P0001';
        end if;
    end if;

    v_max := greatest(2, least(v_cap, coalesce((p_payload->>'maximo_participantes')::int, 4)));
    v_min := greatest(2, least(v_max, coalesce((p_payload->>'minimo_participantes')::int, 2)));
    v_images := coalesce(
        array(select jsonb_array_elements_text(p_payload->'imagenes_url')),
        '{}'::text[]
    );
    v_rec := case when p_payload ? 'recurrencia' then p_payload->'recurrencia' else null end;
    v_serie := case when v_rec is not null then gen_random_uuid() else null end;

    insert into public.planes (
        titulo, descripcion, categoria, tipo_deporte, creador_id, fecha_evento,
        maximo_participantes, minimo_participantes, imagen_url, imagenes_url,
        nombre_ubicacion, latitud, longitud, requiere_aprobacion, solo_chicas,
        solo_amigos, modo_privado, is_direct_chat, is_group_chat, recurrencia, serie_id
    ) values (
        nullif(trim(coalesce(p_payload->>'titulo', '')), ''),
        nullif(trim(coalesce(p_payload->>'descripcion', '')), ''),
        nullif(trim(coalesce(p_payload->>'categoria', '')), ''),
        nullif(trim(coalesce(p_payload->>'tipo_deporte', '')), ''),
        v_uid,
        nullif(p_payload->>'fecha_evento', '')::timestamptz,
        v_max, v_min,
        nullif(trim(coalesce(p_payload->>'imagen_url', '')), ''),
        v_images,
        nullif(trim(coalesce(p_payload->>'nombre_ubicacion', '')), ''),
        nullif(p_payload->>'latitud', '')::float8,
        nullif(p_payload->>'longitud', '')::float8,
        coalesce((p_payload->>'requiere_aprobacion')::boolean, false),
        coalesce((p_payload->>'solo_chicas')::boolean, false),
        coalesce((p_payload->>'solo_amigos')::boolean, false),
        coalesce((p_payload->>'modo_privado')::boolean, false),
        false, false, v_rec, v_serie
    )
    returning * into v_plan;

    insert into public.participantes (plan_id, usuario_id, estado)
    values (v_plan.id, v_uid, 'aceptado')
    on conflict do nothing;

    return v_plan;
end;
$$;

revoke all on function public.pause_organizer_series(uuid) from public;
grant execute on function public.pause_organizer_series(uuid) to authenticated, service_role;

commit;

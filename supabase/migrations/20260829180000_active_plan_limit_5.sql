-- Sube el límite de planes activos de usuario de 3 a 5.

begin;

create or replace function public.enforce_active_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_max int := 5;
    v_is_creator boolean;
    v_is_chat boolean;
    v_count int;
begin
    if new.estado is distinct from 'aceptado' then
        return new;
    end if;

    if tg_op = 'UPDATE' and old.estado is not distinct from 'aceptado' then
        return new;
    end if;

    select
        (pl.creador_id = new.usuario_id),
        (
            coalesce(pl.is_group_chat, false)
            or coalesce(pl.is_direct_chat, false)
            or coalesce(pl.categoria, '') in ('Grupo', 'Chat')
        )
    into v_is_creator, v_is_chat
    from public.planes pl
    where pl.id = new.plan_id;

    if coalesce(v_is_creator, false) or coalesce(v_is_chat, false) then
        return new;
    end if;

    v_count := public.count_user_active_plans(new.usuario_id);
    if v_count >= v_max then
        raise exception 'active_plan_limit_reached'
            using errcode = 'P0001',
                  detail = format('user %s already has %s active plans', new.usuario_id, v_count);
    end if;

    return new;
end;
$$;

create or replace function public.promote_waitlist(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_max_spots int;
    v_count int;
    v_next_id uuid;
    v_next_user uuid;
    v_tried uuid[] := array[]::uuid[];
    v_user_active int;
    v_max_active int := 5;
begin
    select maximo_participantes into v_max_spots from public.planes where id = p_plan_id;
    if v_max_spots is null then
        return;
    end if;

    select count(*)::int into v_count
    from public.participantes
    where plan_id = p_plan_id and estado = 'aceptado';

    if v_count >= v_max_spots then
        return;
    end if;

    loop
        select p.id, p.usuario_id
        into v_next_id, v_next_user
        from public.participantes p
        where p.plan_id = p_plan_id
          and p.estado = 'lista_espera'
          and not (p.id = any (v_tried))
        order by coalesce(p.creado_en, p.created_at) asc nulls last
        limit 1;

        exit when v_next_id is null;

        v_user_active := public.count_user_active_plans(v_next_user);
        if v_user_active >= v_max_active then
            v_tried := array_append(v_tried, v_next_id);
            continue;
        end if;

        update public.participantes
        set estado = 'aceptado'
        where id = v_next_id;

        exit;
    end loop;
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
    v_limit int := 5;
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

    if not coalesce(v_is_org, false) then
        insert into public.participantes (plan_id, usuario_id, estado)
        values (v_plan.id, v_uid, 'aceptado')
        on conflict do nothing;
    end if;

    return v_plan;
end;
$$;

notify pgrst, 'reload schema';

commit;

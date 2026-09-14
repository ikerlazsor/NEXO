begin;

-- El organizador no ocupa plaza ni aparece como integrante.
delete from public.participantes p
using public.planes pl
join public.perfiles pf on pf.id = pl.creador_id
where p.plan_id = pl.id
  and p.usuario_id = pl.creador_id
  and pf.es_organizador;

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

    if not coalesce(v_is_org, false) then
        insert into public.participantes (plan_id, usuario_id, estado)
        values (v_plan.id, v_uid, 'aceptado')
        on conflict do nothing;
    end if;

    return v_plan;
end;
$$;

create or replace function public.get_guest_feed()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    result jsonb;
begin
    select coalesce(jsonb_agg(feed.plan_json order by feed.fecha_evento_sort asc nulls last), '[]'::jsonb)
    into result
    from (
        select
            pl.fecha_evento as fecha_evento_sort,
            jsonb_build_object(
                'id', pl.id,
                'titulo', pl.titulo,
                'imagen_url', pl.imagen_url,
                'imagenes_url', coalesce(pl.imagenes_url, '{}'::text[]),
                'recurrencia', pl.recurrencia,
                'es_organizador', coalesce(creator.es_organizador, false),
                'host', jsonb_build_object(
                    'id', creator.id,
                    'nombre', creator.nombre,
                    'nombre_usuario', creator.nombre_usuario,
                    'avatar_url', creator.avatar_url,
                    'es_organizador', creator.es_organizador,
                    'isCreator', true
                ),
                'categoria', pl.categoria,
                'tipo_deporte', pl.tipo_deporte,
                'solo_chicas', pl.solo_chicas,
                'solo_amigos', pl.solo_amigos,
                'modo_privado', pl.modo_privado,
                'fecha_evento', pl.fecha_evento,
                'nombre_ubicacion', pl.nombre_ubicacion,
                'latitud', pl.latitud,
                'longitud', pl.longitud,
                'maximo_participantes', pl.maximo_participantes,
                'creador_id', pl.creador_id,
                'requiere_aprobacion', pl.requiere_aprobacion,
                'descripcion', pl.descripcion,
                'estado', pl.estado,
                'joinedCount', (
                    select count(*)::integer
                    from public.participantes as part
                    where part.plan_id = pl.id
                      and part.estado = 'aceptado'
                      and (
                          coalesce(creator.es_organizador, false) = false
                          or part.usuario_id <> pl.creador_id
                      )
                ),
                'participantsList', (
                    select coalesce(jsonb_agg(cards.card order by cards.ord, cards.nombre), '[]'::jsonb)
                    from (
                        select
                            0 as ord,
                            c.nombre,
                            jsonb_build_object(
                                'id', c.id,
                                'nombre', c.nombre,
                                'nombre_usuario', c.nombre_usuario,
                                'avatar_url', c.avatar_url,
                                'es_organizador', c.es_organizador,
                                'isCreator', true
                            ) as card
                        from public.perfiles as c
                        where c.id = pl.creador_id
                          and coalesce(c.baneado, false) = false
                          and coalesce(c.es_organizador, false) = false
                        union all
                        select
                            1,
                            p.nombre,
                            jsonb_build_object(
                                'id', p.id,
                                'nombre', p.nombre,
                                'nombre_usuario', p.nombre_usuario,
                                'avatar_url', p.avatar_url,
                                'es_organizador', p.es_organizador,
                                'isCreator', false
                            )
                        from public.participantes as part
                        join public.perfiles as p on p.id = part.usuario_id
                        where part.plan_id = pl.id
                          and part.estado = 'aceptado'
                          and part.usuario_id <> pl.creador_id
                          and coalesce(p.baneado, false) = false
                    ) as cards
                )
            ) as plan_json
        from public.planes as pl
        join public.perfiles as creator on creator.id = pl.creador_id
        where coalesce(pl.modo_privado, false) = false
          and coalesce(pl.solo_amigos, false) = false
          and coalesce(pl.is_direct_chat, false) = false
          and coalesce(pl.is_group_chat, false) = false
          and pl.categoria not in ('Grupo', 'Chat')
          and pl.estado not in ('finalizado', 'cancelado')
          and (pl.fecha_evento is null or pl.fecha_evento >= now())
          and coalesce(creator.baneado, false) = false
        order by pl.fecha_evento asc nulls last
        limit 100
    ) as feed;

    return coalesce(result, '[]'::jsonb);
end;
$$;

create or replace function public.get_guest_plan(p_plan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    result jsonb;
begin
    if p_plan_id is null then
        return null;
    end if;

    select jsonb_build_object(
        'plan', jsonb_build_object(
            'id', pl.id,
            'titulo', pl.titulo,
            'imagen_url', pl.imagen_url,
            'imagenes_url', coalesce(pl.imagenes_url, '{}'::text[]),
            'recurrencia', pl.recurrencia,
            'es_organizador', coalesce(creator.es_organizador, false),
            'categoria', pl.categoria,
            'tipo_deporte', pl.tipo_deporte,
            'solo_chicas', pl.solo_chicas,
            'modo_privado', pl.modo_privado,
            'fecha_evento', pl.fecha_evento,
            'nombre_ubicacion', pl.nombre_ubicacion,
            'latitud', pl.latitud,
            'longitud', pl.longitud,
            'maximo_participantes', pl.maximo_participantes,
            'creador_id', pl.creador_id,
            'requiere_aprobacion', pl.requiere_aprobacion,
            'descripcion', pl.descripcion,
            'chat_eliminado_en', pl.chat_eliminado_en
        ),
        'creator', jsonb_build_object(
            'id', creator.id,
            'nombre', creator.nombre,
            'nombre_usuario', creator.nombre_usuario,
            'avatar_url', creator.avatar_url,
            'es_organizador', creator.es_organizador,
            'isCreator', true
        ),
        'joinedCount', (
            select count(*)::integer
            from public.participantes as part
            where part.plan_id = pl.id
              and part.estado = 'aceptado'
              and (
                  coalesce(creator.es_organizador, false) = false
                  or part.usuario_id <> pl.creador_id
              )
        ),
        'participants', (
            select coalesce(jsonb_agg(cards.card order by cards.ord, cards.nombre), '[]'::jsonb)
            from (
                select
                    0 as ord,
                    c.nombre,
                    jsonb_build_object(
                        'id', c.id,
                        'nombre', c.nombre,
                        'nombre_usuario', c.nombre_usuario,
                        'avatar_url', c.avatar_url,
                        'es_organizador', c.es_organizador,
                        'isCreator', true
                    ) as card
                from public.perfiles as c
                where c.id = pl.creador_id
                  and coalesce(c.baneado, false) = false
                  and coalesce(c.es_organizador, false) = false
                union all
                select
                    1,
                    p.nombre,
                    jsonb_build_object(
                        'id', p.id,
                        'nombre', p.nombre,
                        'nombre_usuario', p.nombre_usuario,
                        'avatar_url', p.avatar_url,
                        'es_organizador', p.es_organizador,
                        'isCreator', false
                    )
                from public.participantes as part
                join public.perfiles as p on p.id = part.usuario_id
                where part.plan_id = pl.id
                  and part.estado = 'aceptado'
                  and part.usuario_id <> pl.creador_id
                  and coalesce(p.baneado, false) = false
            ) as cards
        )
    )
    into result
    from public.planes as pl
    join public.perfiles as creator on creator.id = pl.creador_id
    where pl.id = p_plan_id
      and coalesce(pl.modo_privado, false) = false
      and coalesce(pl.solo_amigos, false) = false
      and coalesce(pl.is_direct_chat, false) = false
      and coalesce(pl.is_group_chat, false) = false
      and pl.categoria not in ('Grupo', 'Chat')
      and pl.estado <> 'cancelado'
      and coalesce(creator.baneado, false) = false;

    return result;
end;
$$;

revoke all on function public.create_meetup_plan(jsonb) from public;
revoke all on function public.get_guest_feed() from public;
revoke all on function public.get_guest_plan(uuid) from public;
grant execute on function public.create_meetup_plan(jsonb) to authenticated, service_role;
grant execute on function public.get_guest_feed() to anon, service_role;
grant execute on function public.get_guest_plan(uuid) to anon, service_role;

commit;

begin;

-- Lectura pública controlada para invitados: solo planes abiertos
-- (no privados, no solo amigos, no chats) y fichas mínimas de quien apunta.

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
                                'isCreator', true
                            ) as card
                        from public.perfiles as c
                        where c.id = pl.creador_id
                          and coalesce(c.baneado, false) = false
                        union all
                        select
                            1,
                            p.nombre,
                            jsonb_build_object(
                                'id', p.id,
                                'nombre', p.nombre,
                                'nombre_usuario', p.nombre_usuario,
                                'avatar_url', p.avatar_url,
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
        'joinedCount', (
            select count(*)::integer
            from public.participantes as part
            where part.plan_id = pl.id
              and part.estado = 'aceptado'
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
                        'isCreator', true
                    ) as card
                from public.perfiles as c
                where c.id = pl.creador_id
                  and coalesce(c.baneado, false) = false
                union all
                select
                    1,
                    p.nombre,
                    jsonb_build_object(
                        'id', p.id,
                        'nombre', p.nombre,
                        'nombre_usuario', p.nombre_usuario,
                        'avatar_url', p.avatar_url,
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

revoke all on function public.get_guest_feed() from public;
revoke all on function public.get_guest_plan(uuid) from public;
grant execute on function public.get_guest_feed() to anon, service_role;
grant execute on function public.get_guest_plan(uuid) to anon, service_role;

commit;

-- Feed invitado: más planes, zona si hay GPS, y creado_en para planes nuevos.

drop function if exists public.get_guest_feed();
drop function if exists public.get_guest_feed(double precision, double precision, integer);

create or replace function public.get_guest_feed(
    p_lat double precision default null,
    p_lng double precision default null,
    p_radius_km integer default 90
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    result jsonb;
    v_km numeric := greatest(20, least(coalesce(p_radius_km, 90), 250));
    v_dlat numeric := v_km / 111.0;
    v_dlng numeric := v_km / (111.0 * greatest(0.2, abs(cos(radians(coalesce(p_lat, 0))))));
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
                'creado_en', pl.creado_en,
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
          and (
              p_lat is null
              or p_lng is null
              or (
                  pl.latitud is not null
                  and pl.longitud is not null
                  and pl.latitud between p_lat - v_dlat and p_lat + v_dlat
                  and pl.longitud between p_lng - v_dlng and p_lng + v_dlng
              )
          )
        order by pl.fecha_evento asc nulls last
        limit 250
    ) as feed;

    return coalesce(result, '[]'::jsonb);
end;
$$;

revoke all on function public.get_guest_feed(double precision, double precision, integer) from public;
grant execute on function public.get_guest_feed(double precision, double precision, integer) to anon, authenticated, service_role;

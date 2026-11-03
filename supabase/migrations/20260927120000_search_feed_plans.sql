-- Búsqueda de planes del feed (título, sitio, categoría, anfitrión).
-- Respeta visibilidad: invitado = públicos; sesión = user_can_view_plan.

create or replace function public.search_feed_plans(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid uuid := auth.uid();
    v_q text := trim(both from coalesce(p_query, ''));
    v_plain text;
    result jsonb;
begin
    if char_length(v_q) < 2 or char_length(v_q) > 80 then
        return '[]'::jsonb;
    end if;

    v_plain := regexp_replace(
        translate(
            lower(v_q),
            'áàäâãåéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
            'aaaaaaeeeeiiiiooooouuuuncaaaaaaeeeeiiiiooooouuuunc'
        ),
        '[%_\\]',
        '',
        'g'
    );
    if char_length(v_plain) < 2 then
        return '[]'::jsonb;
    end if;

    select coalesce(jsonb_agg(feed.row_json order by feed.rank_n, feed.fecha_evento_sort asc nulls last), '[]'::jsonb)
    into result
    from (
        select
            case
                when translate(lower(coalesce(pl.titulo, '')), 'áàäâãåéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ', 'aaaaaaeeeeiiiiooooouuuuncaaaaaaeeeeiiiiooooouuuunc') = v_plain then 0
                when translate(lower(coalesce(pl.titulo, '')), 'áàäâãåéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ', 'aaaaaaeeeeiiiiooooouuuuncaaaaaaeeeeiiiiooooouuuunc') like v_plain || '%' then 1
                when translate(lower(coalesce(pl.titulo, '')), 'áàäâãåéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ', 'aaaaaaeeeeiiiiooooouuuuncaaaaaaeeeeiiiiooooouuuunc') like '%' || v_plain || '%' then 2
                when translate(lower(coalesce(pl.nombre_ubicacion, '')), 'áàäâãåéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ', 'aaaaaaeeeeiiiiooooouuuuncaaaaaaeeeeiiiiooooouuuunc') like '%' || v_plain || '%' then 3
                when translate(lower(coalesce(creator.nombre, '') || ' ' || coalesce(creator.nombre_usuario, '')), 'áàäâãåéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ', 'aaaaaaeeeeiiiiooooouuuuncaaaaaaeeeeiiiiooooouuuunc') like '%' || v_plain || '%' then 4
                else 5
            end as rank_n,
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
                    'genero', creator.genero,
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
                'joinedCount', 0,
                'participantsList', '[]'::jsonb
            ) as row_json
        from public.planes as pl
        join public.perfiles as creator on creator.id = pl.creador_id
        where coalesce(pl.is_direct_chat, false) = false
          and coalesce(pl.is_group_chat, false) = false
          and pl.categoria not in ('Grupo', 'Chat')
          and pl.estado not in ('finalizado', 'cancelado')
          and (pl.fecha_evento is null or pl.fecha_evento >= now())
          and coalesce(creator.baneado, false) = false
          and (
              (v_uid is not null and public.user_can_view_plan(pl.id, v_uid))
              or (
                  v_uid is null
                  and coalesce(pl.modo_privado, false) = false
                  and coalesce(pl.solo_amigos, false) = false
              )
          )
          and (
              translate(lower(coalesce(pl.titulo, '')), 'áàäâãåéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ', 'aaaaaaeeeeiiiiooooouuuuncaaaaaaeeeeiiiiooooouuuunc') like '%' || v_plain || '%'
              or translate(lower(coalesce(pl.nombre_ubicacion, '')), 'áàäâãåéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ', 'aaaaaaeeeeiiiiooooouuuuncaaaaaaeeeeiiiiooooouuuunc') like '%' || v_plain || '%'
              or translate(lower(coalesce(pl.categoria, '')), 'áàäâãåéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ', 'aaaaaaeeeeiiiiooooouuuuncaaaaaaeeeeiiiiooooouuuunc') like '%' || v_plain || '%'
              or translate(lower(coalesce(pl.tipo_deporte, '')), 'áàäâãåéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ', 'aaaaaaeeeeiiiiooooouuuuncaaaaaaeeeeiiiiooooouuuunc') like '%' || v_plain || '%'
              or translate(lower(coalesce(creator.nombre, '')), 'áàäâãåéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ', 'aaaaaaeeeeiiiiooooouuuuncaaaaaaeeeeiiiiooooouuuunc') like '%' || v_plain || '%'
              or translate(lower(coalesce(creator.nombre_usuario, '')), 'áàäâãåéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ', 'aaaaaaeeeeiiiiooooouuuuncaaaaaaeeeeiiiiooooouuuunc') like '%' || v_plain || '%'
          )
        order by 1, pl.fecha_evento asc nulls last
        limit 40
    ) as feed;

    return coalesce(result, '[]'::jsonb);
end;
$$;

revoke all on function public.search_feed_plans(text) from public;
grant execute on function public.search_feed_plans(text) to anon, authenticated, service_role;

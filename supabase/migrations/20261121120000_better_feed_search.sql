-- Búsqueda del feed, versión 2.
--
-- Qué cambia respecto a 20260927120000_search_feed_plans:
--   * Busca también en la descripción.
--   * Coincide por inicio de palabra («pad» → «pádel», pero «mar» ya no casa con «tomar»).
--   * Varias palabras («padel madrid») tienen que estar todas, en el campo que sea.
--   * Erratas en el título («pdel» → «Pádel») con pg_trgm.
--   * p_terms: sinónimos que manda la app (lib/feedSearch.ts → searchSynonymTerms),
--     comparados como palabra completa; así «bjj» encuentra «Open mat» aunque no esté cargado.
--   * p_lat / p_lng: a igual relevancia, primero lo que está cerca.
--   * Devuelve `search_score` en cada fila; la app lo usa para ordenar.
--
-- Compatibilidad: los parámetros nuevos son opcionales, así que la app que ya
-- está instalada (llama solo con p_query) sigue funcionando igual.
--
-- Sin índice a propósito: el filtro mezcla planes y perfiles (anfitrión) con OR
-- y no lo usaría; con el volumen actual el recorrido completo es inmediato.

create extension if not exists pg_trgm with schema extensions;

-- Texto normalizado como lista de palabras con espacios a los lados:
-- 'Pádel en Madrid-Río' → ' padel en madrid rio '.
create or replace function public.search_norm(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
    select ' ' || btrim(regexp_replace(
        translate(
            lower(coalesce(p_text, '')),
            'áàäâãåéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
            'aaaaaaeeeeiiiiooooouuuuncaaaaaaeeeeiiiiooooouuuunc'
        ),
        '[^a-z0-9]+', ' ', 'g'
    )) || ' ';
$$;

-- Solo para uso interno de la búsqueda: no es una API para la app.
revoke all on function public.search_norm(text) from public, anon, authenticated;

drop function if exists public.search_feed_plans(text);

create or replace function public.search_feed_plans(
    p_query text,
    p_terms text[] default null,
    p_lat double precision default null,
    p_lng double precision default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_uid uuid := auth.uid();
    v_raw text := btrim(coalesce(p_query, ''));
    v_q text;
    v_tokens text[];
    v_terms text[];
    v_has_coords boolean := p_lat is not null and p_lng is not null
        and p_lat between -90 and 90 and p_lng between -180 and 180;
    result jsonb;
begin
    if char_length(v_raw) < 2 or char_length(v_raw) > 80 then
        return '[]'::jsonb;
    end if;

    v_q := btrim(public.search_norm(v_raw));
    if char_length(v_q) < 2 then
        return '[]'::jsonb;
    end if;

    -- Palabras que cuentan (sin «de», «con», «plan»…), como en la app.
    select coalesce(array_agg(w), '{}')
    into v_tokens
    from unnest(string_to_array(v_q, ' ')) as w
    where char_length(w) >= 2
      and w <> all (array['plan','planes','the','and','con','para','una','uno','del','las','los','por','que','de','el','la','en','al','un']);

    -- Sinónimos: normalizados, sin repetir, como mucho 40.
    select coalesce(array_agg(distinct t), '{}')
    into v_terms
    from (
        select btrim(public.search_norm(x)) as t
        from unnest(coalesce(p_terms, '{}')) with ordinality as u(x, n)
        where n <= 40
    ) as s
    where char_length(t) >= 3 and t <> v_q;

    select coalesce(
        jsonb_agg(
            ranked.row_json || jsonb_build_object('search_score', ranked.score)
            order by ranked.score desc, ranked.dist_km asc nulls last, ranked.fecha_evento asc nulls last
        ),
        '[]'::jsonb
    )
    into result
    from (
        select *
        from (
            select
                f.row_json,
                f.fecha_evento,
                f.dist_km,
                greatest(
                    case
                        when f.title_n = ' ' || v_q || ' ' then 100
                        when f.title_n like ' ' || v_q || '%' then 80
                        when f.title_n like '% ' || v_q || '%' then 60
                        when cardinality(v_tokens) >= 2
                             and (select bool_and(f.title_n like '% ' || tok || '%') from unnest(v_tokens) tok) then 55
                        when f.loc_n like '% ' || v_q || '%' then 45
                        when f.host_n like '% ' || v_q || '%' then 40
                        when cardinality(v_tokens) >= 2
                             and (select bool_and(f.all_n like '% ' || tok || '%') from unnest(v_tokens) tok) then 30
                        when f.cat_n like '% ' || v_q || '%' then 25
                        when f.desc_n like '% ' || v_q || '%' then 20
                        when char_length(v_q) >= 4
                             and extensions.word_similarity(v_q, f.title_n) >= 0.5 then 15
                        when cardinality(v_terms) > 0
                             and exists (
                                 select 1 from unnest(v_terms) term
                                 where f.sem_n like '% ' || term || ' %'
                                    or f.sem_n like '% ' || term || 's %'
                                    or f.sem_n like '% ' || term || 'es %'
                             ) then 10
                        else 0
                    end
                    -- A igual relevancia, lo cercano antes (hasta +5 a menos de 1 km, 0 a 30 km).
                    + case
                        when f.dist_km is null then 0
                        else greatest(0, 5 - 5 * (greatest(f.dist_km, 1) - 1) / 29)
                    end,
                    0
                ) as score,
                -- Sin coincidencia de verdad no entra, aunque esté cerca.
                (
                    f.title_n like '% ' || v_q || '%'
                    or f.loc_n like '% ' || v_q || '%'
                    or f.host_n like '% ' || v_q || '%'
                    or f.cat_n like '% ' || v_q || '%'
                    or f.desc_n like '% ' || v_q || '%'
                    or (cardinality(v_tokens) >= 2
                        and (select bool_and(f.all_n like '% ' || tok || '%') from unnest(v_tokens) tok))
                    or (char_length(v_q) >= 4 and extensions.word_similarity(v_q, f.title_n) >= 0.5)
                    or (cardinality(v_terms) > 0 and exists (
                        select 1 from unnest(v_terms) term
                        where f.sem_n like '% ' || term || ' %'
                           or f.sem_n like '% ' || term || 's %'
                           or f.sem_n like '% ' || term || 'es %'
                    ))
                ) as matched
            from (
                select
                    pl.fecha_evento,
                    public.search_norm(pl.titulo) as title_n,
                    public.search_norm(pl.descripcion) as desc_n,
                    public.search_norm(pl.nombre_ubicacion) as loc_n,
                    public.search_norm(concat_ws(' ', creator.nombre, creator.nombre_usuario)) as host_n,
                    public.search_norm(concat_ws(' ', pl.categoria, pl.tipo_deporte, replace(pl.categoria, '_', ' '))) as cat_n,
                    public.search_norm(concat_ws(' ', pl.titulo, pl.descripcion, pl.categoria, pl.tipo_deporte, replace(pl.categoria, '_', ' '))) as sem_n,
                    public.search_norm(concat_ws(' ', pl.titulo, pl.descripcion, pl.nombre_ubicacion,
                        creator.nombre, creator.nombre_usuario, pl.categoria, pl.tipo_deporte, replace(pl.categoria, '_', ' '))) as all_n,
                    case
                        when v_has_coords and pl.latitud is not null and pl.longitud is not null then
                            6371 * 2 * asin(least(1, sqrt(
                                power(sin(radians(pl.latitud - p_lat) / 2), 2)
                                + cos(radians(p_lat)) * cos(radians(pl.latitud))
                                  * power(sin(radians(pl.longitud - p_lng) / 2), 2)
                            )))
                    end as dist_km,
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
            ) as f
        ) as scored
        where scored.matched
        order by scored.score desc, scored.dist_km asc nulls last, scored.fecha_evento asc nulls last
        limit 60
    ) as ranked;

    return coalesce(result, '[]'::jsonb);
end;
$$;

revoke all on function public.search_feed_plans(text, text[], double precision, double precision) from public;
grant execute on function public.search_feed_plans(text, text[], double precision, double precision)
    to anon, authenticated, service_role;

-- Ranking del feed en el servidor.
--
-- La app pide las puntuaciones a get_feed_scores y ordena con ellas; si la
-- llamada falla, usa su ranking local (features/events/ranking.ts) como respaldo.
-- Los pesos viven en feed_ranking_weights: se ajustan con un UPDATE, sin
-- publicar una versión nueva de la app.
--
-- Cambios de criterio respecto al ranking que había en la app:
--  * Plan creado por un usuario: +70 (antes +24).
--  * Distancia: curva más plana a partir de 2-3 km (0,5 km ≈ 118, 3 km ≈ 90).
--  * Gente de Nexo apuntada a un evento cuenta igual que en un plan, y si va un
--    amigo el evento sube al grupo de amigos (tier 1).
--  * attendance_hint (gente de fuera de Nexo) pesa poco (máx. 8).
--
-- También añade external_events.cover_url: portada propia por evento.

alter table public.external_events
  add column if not exists cover_url text
  check (cover_url is null or cover_url ~ '^https://');

create table if not exists public.feed_ranking_weights (
  key text primary key,
  value double precision not null,
  note text,
  updated_at timestamptz not null default now()
);
alter table public.feed_ranking_weights enable row level security;
revoke all on public.feed_ranking_weights from anon, authenticated;

insert into public.feed_ranking_weights (key, value, note) values
  ('user_plan_bonus', 70, 'Extra por ser un plan creado por un usuario de Nexo'),
  ('distance_max', 120, 'Puntos por distancia cuando está al lado'),
  ('distance_half_km', 6, 'A cuántos km la distancia da la mitad de puntos'),
  ('distance_shape', 1.6, 'Forma de la curva de distancia (más alto = más plana cerca)'),
  ('distance_far_km', 20, 'A partir de aquí resta por cada km'),
  ('distance_far_penalty_per_km', 4, 'Puntos que resta cada km más allá de distance_far_km'),
  ('distance_unknown', -30, 'Puntos si no se sabe la distancia'),
  ('people', 70, 'Gente de Nexo apuntada (curva logarítmica, 16 personas = valor completo)'),
  ('people_cap', 80, 'Máximo por gente apuntada'),
  ('almost_full_1', 14, 'Queda 1 plaza'),
  ('almost_full_2', 8, 'Quedan 2 plazas'),
  ('friend_creator', 72, 'Lo crea un amigo'),
  ('friend_joined', 42, 'Primer amigo apuntado (los siguientes valen 0,7x)'),
  ('friend_joined_cap', 120, 'Máximo por amigos apuntados'),
  ('coincided_creator', 30, 'Lo crea alguien con quien has coincidido'),
  ('coincided_joined', 24, 'Primera persona con quien has coincidido apuntada'),
  ('coincided_joined_cap', 55, 'Máximo por gente con la que has coincidido'),
  ('history_category', 40, 'Categoría que sueles hacer'),
  ('history_subcategory', 16, 'Subcategoría que sueles hacer'),
  ('personality_category', 76, 'Categoría afín a tu personalidad'),
  ('personality_time', 18, 'Encaja con si eres más de día o de noche'),
  ('soon', 10, 'Es pronto (hoy/mañana)'),
  ('peer_age', 40, 'La gente apuntada tiene una edad parecida a la tuya'),
  ('newness', 18, 'Plan recién creado (menos de 6 h)'),
  ('organizer', 8, 'Lo crea una cuenta de organizador'),
  ('now_slot', 8, 'Es para esta tarde/noche o esta mañana'),
  ('jitter', 3, 'Variación diaria para que el feed no sea siempre igual'),
  ('event_interactions', 16, 'Categoría de eventos que abres o guardas'),
  ('participatory', 18, 'Actividad participativa (yoga, idiomas, rutas...)'),
  ('attendance_hint', 8, 'Máximo por asistentes fuera de Nexo')
on conflict (key) do nothing;

-- Distancia en km (haversine); null si falta alguna coordenada.
create or replace function public.feed_distance_km(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select case when lat1 is null or lon1 is null or lat2 is null or lon2 is null then null
  else 12742 * asin(least(1, sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2
    + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lon2 - lon1) / 2) ^ 2))) end;
$$;

create or replace function public.feed_main_category(value text)
returns text
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select case
    when value in ('DEPORTES','VIBES','AIRE_LIBRE','FOODIES','DESCUBRIR','SHOWTIME') then value
    when value = 'Tapas' or value = 'Café' then 'FOODIES'
    when value = 'Deporte' then 'DEPORTES'
    when value in ('Fiesta','Solo chicas','Ocio') then 'VIBES'
    when value = 'Estudio' then 'DESCUBRIR'
    else null end;
$$;

/**
 * Puntuación y grupo (tier) de cada plan y evento del feed para quien llama.
 * tier 0 = míos/apuntado, 1 = de amigos, 2 = resto. Orden: tier asc, score desc.
 * Planes: solo puntúa los ids que manda la app (los que ya puede ver).
 * Eventos: todos los publicables.
 */
create or replace function public.get_feed_scores(
  p_lat double precision default null,
  p_lon double precision default null,
  p_plan_ids uuid[] default '{}'
)
returns table (kind text, id uuid, score double precision, tier integer)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  w jsonb;
  v_tags text[] := '{}';
  v_friends uuid[] := '{}';
  v_coincided uuid[] := '{}';
  v_hist_cats text[] := '{}';
  v_hist_subs text[] := '{}';
  v_ev_hist jsonb := '{}';
  v_cat_tags text[] := '{}';
  v_age double precision;
  v_time_pref text;
  v_friend_count int := 0;
  v_hist_total int := 0;
  v_sub_total int := 0;
  m_personality double precision;
  m_history double precision;
  m_friends double precision;
  m_soon double precision;
  v_now timestamptz := now();
  v_hour_now int := extract(hour from now() at time zone 'Europe/Madrid');
  v_today date := (now() at time zone 'Europe/Madrid')::date;
  v_ev_max double precision := 1;
begin
  if p_plan_ids is not null and cardinality(p_plan_ids) > 400 then
    raise exception 'too many plans';
  end if;
  if (p_lat is not null and (p_lat < -90 or p_lat > 90)) or (p_lon is not null and (p_lon < -180 or p_lon > 180)) then
    p_lat := null; p_lon := null;
  end if;

  select coalesce(jsonb_object_agg(f.key, f.value), '{}') into w from public.feed_ranking_weights f;

  -- Señales de quien mira.
  if v_uid is not null then
    select coalesce(nullif(p.ambientes_preferidos, '{}'), p.etiquetas, '{}'),
           case when p.fecha_nacimiento is null then null
                else extract(year from age(p.fecha_nacimiento))::double precision end
      into v_tags, v_age
      from public.perfiles p where p.id = v_uid;
    v_tags := coalesce(v_tags, '{}');

    select coalesce(array_agg(distinct f.uid), '{}') into v_friends from (
      select case when a.usuario_origen_id = v_uid then a.usuario_destino_id else a.usuario_origen_id end as uid
      from public.amistades a
      where a.estado = 'aceptado' and (a.usuario_origen_id = v_uid or a.usuario_destino_id = v_uid)) f
      where f.uid is not null and f.uid <> v_uid;
    v_friend_count := cardinality(v_friends);

    select coalesce(array_agg(distinct c.uid), '{}') into v_coincided from (
      select case when va.evaluador_id = v_uid then va.evaluado_id else va.evaluador_id end as uid
      from public.valoraciones va
      join public.historial_planes h on h.plan_id = va.plan_id and h.usuario_id = v_uid
      where va.asistencia = true and (va.evaluador_id = v_uid or va.evaluado_id = v_uid)) c
      where c.uid is not null and c.uid <> v_uid and not (c.uid = any(v_friends));

    select coalesce(array_agg(x.cat), '{}'), coalesce(array_agg(x.sub), '{}') into v_hist_cats, v_hist_subs from (
      select * from (
        select public.feed_main_category(pl.categoria), lower(trim(coalesce(pl.tipo_deporte, '')))
        from public.planes pl where pl.creador_id = v_uid
        order by pl.fecha_evento desc nulls last limit 40) c
      union all
      select * from (
        select public.feed_main_category(pl.categoria), lower(trim(coalesce(pl.tipo_deporte, '')))
        from public.participantes pa join public.planes pl on pl.id = pa.plan_id
        where pa.usuario_id = v_uid and pa.estado = 'aceptado' and pl.creador_id <> v_uid
        order by pa.creado_en desc limit 40) j
    ) x(cat, sub) where x.cat is not null;
    v_hist_total := cardinality(v_hist_cats);
    select count(*) into v_sub_total from unnest(v_hist_subs) s where s not in ('', 'otro');

    select coalesce(jsonb_object_agg(c.category, c.n), '{}'), greatest(1, coalesce(max(c.n), 1))
      into v_ev_hist, v_ev_max from (
      select e.category, count(*)::int as n
      from public.external_event_interactions i join public.external_events e on e.id = i.event_id
      where i.user_id = v_uid group by e.category) c;
  end if;

  v_cat_tags := array(select t from unnest(v_tags) t
    where t in ('Deportista','Viajero','Aventurero','Tranquilo','Yoga','Foodie','Fiestero','Lectura','De terraceo'));
  v_time_pref := case when 'Más de noche' = any(v_tags) then 'night'
                      when 'Más de día' = any(v_tags) then 'day' end;

  -- Mezcla según madurez (igual que getAffinityBlend en lib/feedAffinity.ts).
  declare
    hm double precision := least(1, v_hist_total / 8.0);
    fm double precision := least(1, v_friend_count / 5.0);
    other double precision := least(1, hm * 0.55 + fm * 0.45);
  begin
    m_personality := case when cardinality(v_tags) > 0 then 1 - other * 0.45 else 0 end;
    m_history := hm;
    m_friends := case when v_friend_count > 0 then 0.9 + 0.1 * fm else 0 end;
    m_soon := 0.55 + 0.45 * (1 - other);
  end;

  return query
  with items as (
    select 'plan'::text as kind, pl.id, public.feed_main_category(pl.categoria) as cat,
           lower(trim(coalesce(pl.tipo_deporte, ''))) as sub, pl.fecha_evento as starts,
           pl.latitud as lat, pl.longitud as lon, pl.creador_id as creator, pl.creado_en as created,
           pl.maximo_participantes as max_people, pl.titulo as title, null::text as provider,
           null::int as hint
    from public.planes pl
    where pl.id = any(coalesce(p_plan_ids, '{}'))
      and coalesce(pl.is_direct_chat, false) = false and coalesce(pl.is_group_chat, false) = false
    union all
    select 'event', e.id, e.category, lower(coalesce(e.subcategory, 'otro')), e.starts_at,
           e.latitude, e.longitude, null, null, null, e.title, e.provider_id, e.attendance_hint
    from public.external_events e
    where public.external_event_is_publishable(e)
  ),
  people as (
    select i.kind, i.id,
      coalesce(case when i.kind = 'plan' then
        (select array_agg(pa.usuario_id) from public.participantes pa where pa.plan_id = i.id and pa.estado = 'aceptado')
      else
        (select array_agg(ep.user_id) from public.external_event_participants ep where ep.event_id = i.id)
      end, '{}') as ids
    from items i
  ),
  enriched as (
    select i.*, pe.ids,
      cardinality(pe.ids) + case when i.kind = 'plan' and i.creator is not null and not (i.creator = any(pe.ids)) then 1 else 0 end as joined,
      (select count(*) from unnest(pe.ids) u where u = any(v_friends) and u is distinct from i.creator) as friends_in,
      (select count(*) from unnest(pe.ids) u where u = any(v_coincided)
         and not (u = any(v_friends)) and u is distinct from i.creator) as coincided_in,
      (select avg(case when abs(v_age - extract(year from age(pf.fecha_nacimiento))) <= 2 then 1
                       when abs(v_age - extract(year from age(pf.fecha_nacimiento))) >= 14 then 0
                       else 1 - (abs(v_age - extract(year from age(pf.fecha_nacimiento))) - 2) / 12 end)
         from public.perfiles pf where pf.id = any(pe.ids) and pf.id is distinct from v_uid and pf.fecha_nacimiento is not null) as age_fit,
      public.feed_distance_km(p_lat, p_lon, i.lat, i.lon) as km,
      coalesce(v_uid is not null and (i.creator = v_uid or v_uid = any(pe.ids)), false) as mine,
      extract(hour from i.starts at time zone 'Europe/Madrid')::int as ev_hour,
      extract(epoch from (i.starts - v_now)) / 86400.0 as days_left,
      ((i.starts at time zone 'Europe/Madrid')::date - v_today) as day_diff
    from items i join people pe on pe.kind = i.kind and pe.id = i.id
  ),
  scored as (
    select e.kind, e.id, e.mine,
      coalesce(e.creator = any(v_friends), false) or e.friends_in > 0 as with_friends,
      -- Amigos y coincidencias.
      m_friends * (
        case when e.creator = any(v_friends) then (w->>'friend_creator')::float8 else 0 end
        + least((w->>'friend_joined_cap')::float8, (w->>'friend_joined')::float8 * (1 - 0.7 ^ e.friends_in) / 0.3))
      + case when e.creator = any(v_coincided) and not coalesce(e.creator = any(v_friends), false)
             then (w->>'coincided_creator')::float8 else 0 end
      + least((w->>'coincided_joined_cap')::float8, (w->>'coincided_joined')::float8 * (1 - 0.7 ^ e.coincided_in) / 0.3)
      -- Historial.
      + case when v_hist_total > 0 and e.cat is not null then
          m_history * (w->>'history_category')::float8
            * (select count(*) from unnest(v_hist_cats) h where h = e.cat)::float8 / v_hist_total
          + case when v_sub_total > 0 then m_history * (w->>'history_subcategory')::float8
            * (select count(*) from unnest(v_hist_subs) h where h = e.sub and h not in ('', 'otro'))::float8 / v_sub_total else 0 end
        else 0 end
      -- Personalidad.
      + case when cardinality(v_cat_tags) > 0 and e.cat is not null then
          (w->>'personality_category')::float8 * m_personality * least(1, (
            select count(*) from unnest(v_cat_tags) t where e.cat = any(case t
              when 'Deportista' then array['DEPORTES','AIRE_LIBRE'] when 'Viajero' then array['DESCUBRIR','AIRE_LIBRE']
              when 'Aventurero' then array['AIRE_LIBRE','DEPORTES'] when 'Tranquilo' then array['DESCUBRIR','FOODIES','AIRE_LIBRE']
              when 'Yoga' then array['DEPORTES','AIRE_LIBRE'] when 'Foodie' then array['FOODIES'] when 'Fiestero' then array['VIBES']
              when 'Lectura' then array['DESCUBRIR'] when 'De terraceo' then array['FOODIES','VIBES'] end)
          )::float8 / cardinality(v_cat_tags))
        else 0 end
      + case when e.starts is not null and (
              (v_time_pref = 'night' and (e.ev_hour >= 18 or e.ev_hour < 5))
           or (v_time_pref = 'day' and e.ev_hour >= 7 and e.ev_hour < 18))
          then (w->>'personality_time')::float8 * m_personality else 0 end
      -- Pronto.
      + case when e.days_left is null or e.days_left < 0 then 0
             when e.days_left <= 1 then 1 when e.days_left <= 3 then 0.75
             when e.days_left <= 7 then 0.45 when e.days_left <= 14 then 0.2 else 0 end
        * (w->>'soon')::float8 * m_soon
      -- Gente de Nexo apuntada (planes y eventos, mismo peso).
      + case when e.joined > 0 then least((w->>'people_cap')::float8,
          (w->>'people')::float8 * ln(1 + e.joined) / ln(17)) else 0 end
      + case when e.kind = 'plan' and e.max_people >= 2 and e.joined > 0 then
          case e.max_people - e.joined when 1 then (w->>'almost_full_1')::float8
                                       when 2 then (w->>'almost_full_2')::float8 else 0 end
        else 0 end
      + case when v_age is not null and e.age_fit is not null then (w->>'peer_age')::float8 * e.age_fit else 0 end
      -- Distancia.
      + case when e.km is null then (w->>'distance_unknown')::float8
             when e.km <= (w->>'distance_far_km')::float8 then
               (w->>'distance_max')::float8 / (1 + (e.km / (w->>'distance_half_km')::float8) ^ (w->>'distance_shape')::float8)
             else greatest(-180,
               (w->>'distance_max')::float8 / (1 + (e.km / (w->>'distance_half_km')::float8) ^ (w->>'distance_shape')::float8)
               - (e.km - (w->>'distance_far_km')::float8) * (w->>'distance_far_penalty_per_km')::float8) end
      -- Esta tarde / esta mañana.
      + case when e.day_diff between 0 and 1 and (
               (v_hour_now >= 17 and (e.ev_hour >= 18 or e.ev_hour < 5))) then (w->>'now_slot')::float8
             when e.day_diff = 0 and v_hour_now < 12 and e.ev_hour >= 7 and e.ev_hour < 18 then (w->>'now_slot')::float8 * 0.7
             else 0 end
      -- Variación diaria estable.
      + (w->>'jitter')::float8 * (abs(hashtext(e.id::text || v_today::text)) % 1000) / 1000.0
      -- Eventos que sueles abrir.
      + (w->>'event_interactions')::float8 * coalesce((v_ev_hist->>e.cat)::float8, 0) / v_ev_max
      -- Solo planes de usuarios.
      + case when e.kind = 'plan' then
          (w->>'user_plan_bonus')::float8
          + case when e.created is null then 0
                 when v_now - e.created <= interval '6 hours' then (w->>'newness')::float8
                 when v_now - e.created <= interval '24 hours' then (w->>'newness')::float8 * 0.7
                 when v_now - e.created <= interval '48 hours' then (w->>'newness')::float8 * 0.35 else 0 end
          + case when exists (select 1 from public.perfiles o where o.id = e.creator and o.es_organizador) then (w->>'organizer')::float8 else 0 end
        else 0 end
      -- Solo eventos.
      + case when e.kind = 'event' then
          case when (e.provider = 'nexo_curated' or e.sub in ('senderismo','yoga','baile','running','idiomas','juegos'))
                and not (translate(lower(e.title), 'áéíóúñ', 'aeioun') ~ '\m(concierto|concert|festival|opera|musical|espectaculo|cine|monologo|exposicion|teatro|circo|conferencia|infantil|ninos|online|virtual|webinar)')
               then (w->>'participatory')::float8 else 0 end
          + case when coalesce(e.hint, 0) > 0 then least((w->>'attendance_hint')::float8, 2.5 * ln(1 + e.hint) / ln(2)) else 0 end
        else 0 end
      as score
    from enriched e
  )
  select s.kind, s.id, round(s.score::numeric, 3)::float8,
         case when s.mine then 0 when s.with_friends then 1 else 2 end
  from scored s;
end;
$$;

revoke all on function public.get_feed_scores(double precision, double precision, uuid[]) from public;
grant execute on function public.get_feed_scores(double precision, double precision, uuid[]) to anon, authenticated;

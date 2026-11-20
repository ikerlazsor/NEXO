-- Quedadas que se repiten (cada viernes, cada lunes...): en el listado solo sale
-- la próxima fecha de cada serie, para que una misma quedada no llene el feed.
-- Las demás fechas siguen existiendo (enlaces, chat, quien ya se apuntó) y van
-- apareciendo según pasan las anteriores.

alter table public.external_events add column if not exists series_key text;
create index if not exists external_events_series_idx
  on public.external_events (series_key, starts_at) where series_key is not null;

/** True si es la próxima fecha publicable de su serie (o no pertenece a ninguna). */
create or replace function public.external_event_is_next_in_series(e public.external_events)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select e.series_key is null
    or not exists (
      select 1 from public.external_events o
      where o.series_key = e.series_key and o.id <> e.id
        and (o.starts_at, o.id) < (e.starts_at, e.id)
        and public.external_event_is_publishable(o))
    or exists (
      select 1 from public.external_event_participants p
      where p.event_id = e.id and p.user_id = auth.uid());
$$;

create or replace function public.get_external_events_page_filtered(p_after_date date DEFAULT NULL::date, p_after_id uuid DEFAULT NULL::uuid, p_categories text[] DEFAULT NULL::text[], p_query text DEFAULT NULL::text, p_lat double precision DEFAULT NULL::double precision, p_lon double precision DEFAULT NULL::double precision, p_radius double precision DEFAULT NULL::double precision, p_from date DEFAULT NULL::date, p_until date DEFAULT NULL::date, p_subcategories text[] DEFAULT NULL::text[])
 RETURNS SETOF external_events
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 select e.* from public.external_events e where public.external_event_is_publishable(e) and public.event_provider_available(e.id)
 and public.external_event_is_next_in_series(e)
 and (p_after_date is null or (e.start_date,e.id)>(p_after_date,p_after_id))
 and (coalesce(cardinality(p_categories),0)=0 or e.category=any(p_categories))
 and (coalesce(cardinality(p_subcategories),0)=0 or e.subcategory=any(p_subcategories))
 and (nullif(trim(p_query),'') is null or e.title ilike '%'||left(p_query,100)||'%' or e.venue ilike '%'||left(p_query,100)||'%')
 and (p_from is null or e.start_date>=p_from) and (p_until is null or e.start_date<=p_until)
 and (p_radius is null or (p_lat between -90 and 90 and p_lon between -180 and 180 and
  6371*2*asin(sqrt(least(1.0,power(sin(radians(e.latitude-p_lat)/2),2)+cos(radians(p_lat))*cos(radians(e.latitude))*power(sin(radians(e.longitude-p_lon)/2),2))))<=least(greatest(p_radius,0),200)))
 order by e.start_date,e.id limit 30;
$function$;

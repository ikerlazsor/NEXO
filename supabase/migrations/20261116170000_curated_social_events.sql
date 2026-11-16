-- Quedadas sociales cargadas por Nexo + arreglo del filtro del feed.
--
-- 1) external_event_is_publishable volvía a aplicar en SQL la regla social
--    ANTIGUA (social_activity_is_eligible) aunque el importador ya calcula
--    social_eligible con la política actual y probada (lib/externalEventPolicy.cjs).
--    Resultado: de 69 eventos sociales en 30 días, el feed solo mostraba 7.
--    Para proveedores cuyo social_eligible lo decide esa política (madrid) o el
--    equipo (nexo_curated), se confía en social_eligible.
-- 2) attendance_hint: asistentes conocidos del evento original («+40 asistentes»).
-- 3) Proveedor nexo_curated.

alter table public.external_events
  add column if not exists attendance_hint integer
  check (attendance_hint is null or attendance_hint between 0 and 100000);

insert into public.event_providers (id, name, dataset_url, license_url, license_verified_at, format_verified_at, enabled, last_raw_count)
values ('nexo_curated', 'Nexo', 'https://appnexo.es', null, now(), now(), true, 0)
on conflict (id) do nothing;

create or replace function public.external_event_is_publishable(e public.external_events)
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
 select (e.provider_id in ('madrid', 'nexo_curated') or public.social_activity_is_eligible(e.title, e.description))
 and e.status = 'active' and e.social_eligible and e.location_verified
 and e.starts_at > now() and e.starts_at <= now() + interval '3 months'
 and nullif(trim(e.venue), '') is not null
 and trim(e.venue) !~* '^(madrid|comunidad de madrid|varios( espacios| lugares)?|por confirmar|por determinar|ubicación pendiente|online|virtual|internet|sin confirmar)$'
 and e.latitude between 39.7 and 41.3 and e.longitude between -4.7 and -2.6;
$$;

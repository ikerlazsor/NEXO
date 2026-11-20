begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

-- Serie semanal: tres fechas de la misma quedada y un evento suelto.
insert into public.external_events (provider_id, source_id, source_url, title, category, subcategory,
  start_date, end_date, starts_at, venue, latitude, longitude, status, social_eligible, location_verified, series_key)
values
  ('nexo_curated','t-series-1','https://example.com/1','Language exchange test','DESCUBRIR','idiomas',
   current_date + 2, current_date + 2, now() + interval '2 days','Bar Test',40.42,-3.70,'active',true,true,'test serie'),
  ('nexo_curated','t-series-2','https://example.com/2','Language exchange test','DESCUBRIR','idiomas',
   current_date + 9, current_date + 9, now() + interval '9 days','Bar Test',40.42,-3.70,'active',true,true,'test serie'),
  ('nexo_curated','t-series-3','https://example.com/3','Language exchange test','DESCUBRIR','idiomas',
   current_date + 16, current_date + 16, now() + interval '16 days','Bar Test',40.42,-3.70,'active',true,true,'test serie'),
  ('nexo_curated','t-single','https://example.com/4','Senderismo test','AIRE_LIBRE','senderismo',
   current_date + 3, current_date + 3, now() + interval '3 days','Sierra Test',40.80,-4.00,'active',true,true,null);

select ok(public.external_event_is_next_in_series(e), 'the next date of a series is listed')
  from public.external_events e where source_id = 't-series-1';
select ok(not public.external_event_is_next_in_series(e), 'later dates of the same series stay hidden')
  from public.external_events e where source_id = 't-series-2';
select ok(public.external_event_is_next_in_series(e), 'events outside any series are always listed')
  from public.external_events e where source_id = 't-single';

update public.external_events set status = 'stale' where source_id = 't-series-1';
select ok(public.external_event_is_next_in_series(e), 'when the first date goes away the next one shows up')
  from public.external_events e where source_id = 't-series-2';

select ok(exists (
  select 1 from public.get_feed_scores(40.42, -3.70, array[]::uuid[]) s
  join public.external_events e on e.id = s.id
  where s.kind = 'event' and e.source_id = 't-single'), 'publishable events get a server score');

select ok(
  (select s.score from public.get_feed_scores(40.42, -3.70, array[]::uuid[]) s
     join public.external_events e on e.id = s.id where e.source_id = 't-series-2')
  > (select s.score from public.get_feed_scores(40.42, -3.70, array[]::uuid[]) s
     join public.external_events e on e.id = s.id where e.source_id = 't-single'),
  'a nearby event outranks a far one with the same signals');

select is(
  (select count(*)::int from public.feed_ranking_weights where key = 'user_plan_bonus'), 1,
  'ranking weights live in the database');

select * from finish();
rollback;

begin;

-- Existing source aliases predate occurrence matching. Consolidate these once,
-- moving social data before removing a redundant occurrence.
create function public.consolidate_legacy_event_groups() returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare candidate record; keeper uuid; total integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended('all-external-events',11));
 -- Membership/chat transactions read this table first. Taking this lock before
 -- touching dependent rows gives the migration one atomic cutover.
 lock table public.external_events in access exclusive mode;
 insert into public.external_event_sources(provider_id,source_id,event_id,source_url,status)
 select provider_id,source_id,id,source_url,status from public.external_events
 on conflict(provider_id,source_id) do nothing;
 for candidate in select e.* from public.external_events e where public.external_event_is_publishable(e) order by e.id loop
  select e.id into keeper from public.external_events e
  where e.id<candidate.id and public.external_event_is_publishable(e)
   and e.title_key=candidate.title_key
   and e.starts_at between candidate.starts_at-interval '5 minutes' and candidate.starts_at+interval '5 minutes'
   and 6371000*2*asin(sqrt(least(1.0,power(sin(radians(e.latitude-candidate.latitude)/2),2)+cos(radians(e.latitude))*cos(radians(candidate.latitude))*power(sin(radians(e.longitude-candidate.longitude)/2),2))))<150
  order by e.id limit 1;
  if keeper is null then continue; end if;
  insert into public.external_event_participants(event_id,user_id,joined_at)
  select keeper,user_id,joined_at from public.external_event_participants where event_id=candidate.id
  on conflict(event_id,user_id) do update set joined_at=least(external_event_participants.joined_at,excluded.joined_at);
  update public.external_event_messages set event_id=keeper where event_id=candidate.id;
  insert into public.external_event_interactions(user_id,event_id,kind,created_at)
  select user_id,keeper,kind,created_at from public.external_event_interactions where event_id=candidate.id
  on conflict(user_id,event_id,kind) do update set created_at=greatest(external_event_interactions.created_at,excluded.created_at);
  update public.external_event_sources set event_id=keeper where event_id=candidate.id;
  delete from public.external_events where id=candidate.id;
  total:=total+1;
 end loop;
 return total;
end;
$$;
revoke all on function public.consolidate_legacy_event_groups() from public,anon,authenticated;
grant execute on function public.consolidate_legacy_event_groups() to service_role;
select public.consolidate_legacy_event_groups();

commit;

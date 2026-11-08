begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('98000000-0000-0000-0000-000000000001','authenticated','authenticated','social-a@nexo.test','unused',now(),'{"provider":"email","providers":["email"]}','{"nombre":"Synthetic A"}',now(),now()),
('98000000-0000-0000-0000-000000000002','authenticated','authenticated','social-b@nexo.test','unused',now(),'{"provider":"email","providers":["email"]}','{"nombre":"Synthetic B"}',now(),now());
update public.perfiles set baneado=false where id::text like '98000000-%';
update public.event_providers set enabled=true,license_verified_at=now(),format_verified_at=now() where id in ('madrid','ticketmaster');
create function pg_temp.snapshot(p_id text,p_patch jsonb default '{}') returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('source_id',p_id,'source_url','https://www.madrid.es/synthetic','title',case when p_id in ('confirmed','ticket-1') then 'Concierto social Madrid' else 'Concierto social Madrid '||p_id end,'category','SHOWTIME','subcategory','concierto','start_date',current_date+1,'end_date',current_date+1,'starts_at',now()+interval '1 day','venue','Sala sintética','latitude',40.42,'longitude',-3.70,'social_eligible',true,'location_verified',true,'location_source','publisher','status','active')||p_patch);
$$;
select is(public.sync_external_events('madrid',
 pg_temp.snapshot('confirmed')||
 pg_temp.snapshot('no-clock','{"starts_at":null}')||
 pg_temp.snapshot('no-geo','{"latitude":null}')||
 pg_temp.snapshot('unverified-geo','{"location_verified":false}')||
 pg_temp.snapshot('not-social','{"social_eligible":false}')||
 pg_temp.snapshot('too-far',jsonb_build_object('starts_at',now()+interval '3 months 1 hour'))||
 pg_temp.snapshot('already-started',jsonb_build_object('starts_at',now()-interval '1 hour'))||
 pg_temp.snapshot('generic-place','{"venue":"Madrid"}'),8),8,'storage preserves source records but publication applies a strict contract');
create function pg_temp.canonical() returns uuid language sql security definer set search_path=public,pg_temp as $$select event_id from public.external_event_sources where provider_id='madrid' and source_id='confirmed';$$;
grant execute on function pg_temp.canonical() to anon,authenticated;

set local role anon;
select set_config('request.jwt.claim.sub','',true);
select is((select count(*)::int from public.get_external_events_page()),1,'only confirmed future social events with verified venue are published');
select is((public.get_event_social_summaries(array[pg_temp.canonical()])->pg_temp.canonical()::text->>'count')::int,0,'guest sees a bounded participation count');
select is(public.get_event_social_summaries(array[pg_temp.canonical()])->pg_temp.canonical()::text->'people','[]'::jsonb,'guest never receives identities');
select ok(not has_function_privilege('anon','public.claim_event_import()','execute'),'guests cannot claim import leases');
select ok(not has_function_privilege('anon','public.get_event_geocodes(text[])','execute'),'guests cannot read the internal place cache');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.set_event_membership(pg_temp.canonical(),true)$$,'confirmed event can be joined');
select lives_ok($$select public.set_event_membership(pg_temp.canonical(),true)$$,'repeat membership is idempotent');
select public.send_event_message(pg_temp.canonical(),'99000000-0000-0000-0000-000000000001','Synthetic chat');
select set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000002',true);
select public.set_event_membership(pg_temp.canonical(),true);
select is((public.get_event_social_summaries(array[pg_temp.canonical()])->pg_temp.canonical()::text->>'count')::int,2,'feed count reflects both memberships');
select is(public.get_event_social_summaries(array[pg_temp.canonical()])->pg_temp.canonical()::text->'joined','true'::jsonb,'summary includes the current membership');
select is(jsonb_array_length(public.get_event_social_summaries(array[pg_temp.canonical()])->pg_temp.canonical()::text->'people'),2,'signed in feed receives public avatar samples');
select ok(not has_function_privilege('authenticated','public.cache_event_geocodes(jsonb)','execute'),'members cannot inject geocoding results');
reset role;

select is(public.sync_external_events('ticketmaster',pg_temp.snapshot('ticket-1',jsonb_build_object('title','Conciérto social Madrid','source_url','https://www.ticketmaster.es/synthetic','starts_at',now()+interval '1 day 2 minutes','latitude',40.4201)),1),1,'second provider imports the same occurrence');
select is((select count(*)::int from public.external_events where title_key='concierto social madrid' and starts_at=now()+interval '1 day'),1,'cross-provider normalization keeps one canonical occurrence');
select is((select event_id from public.external_event_sources where provider_id='ticketmaster' and source_id='ticket-1'),pg_temp.canonical(),'source aliases share the social group');
select is((select count(*)::int from public.external_event_participants where event_id=pg_temp.canonical()),2,'deduplication preserves all participants');
select is((select count(*)::int from public.external_event_messages where event_id=pg_temp.canonical()),1,'deduplication preserves chat history');
select public.sync_external_events('ticketmaster',pg_temp.snapshot('ticket-1','{"status":"cancelled"}'),1);
select is((select status from public.external_events where id=pg_temp.canonical()),'cancelled','a verified secondary cancellation wins over a cached active primary listing');
select public.sync_external_events('ticketmaster',pg_temp.snapshot('ticket-1'),1);
select is((select status from public.external_events where id=pg_temp.canonical()),'active','explicit reinstatement restores the same social group');

select public.sync_external_events('ticketmaster',pg_temp.snapshot('ticket-1','{"status":"stale","starts_at":null}'),1);
select is((select status from public.external_events where id=pg_temp.canonical()),'stale','explicit postponement withholds an old listing from another source');
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select is((select count(*)::int from public.get_external_event(pg_temp.canonical())),0,'postponed activity is not a public plan');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.get_external_event(pg_temp.canonical())),1,'postponement preserves existing member access to their group');
reset role;
select public.sync_external_events('ticketmaster',pg_temp.snapshot('ticket-1'),1);

insert into public.bloqueos(bloqueador_id,bloqueado_id) values('98000000-0000-0000-0000-000000000001','98000000-0000-0000-0000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000001',true);
select is((public.get_event_social_summaries(array[pg_temp.canonical()])->pg_temp.canonical()::text->>'count')::int,1,'both-way blocks apply to feed counts');
select is(jsonb_array_length(public.get_event_social_summaries(array[pg_temp.canonical()])->pg_temp.canonical()::text->'people'),1,'blocked profile never appears in avatar samples');
reset role;

update public.event_providers set enabled=false where id='madrid';
select ok(public.event_provider_available(pg_temp.canonical()),'reviewed secondary source keeps the occurrence available');
select public.sync_external_events('ticketmaster',pg_temp.snapshot('ticket-1',jsonb_build_object('source_url','https://www.ticketmaster.es/synthetic')),1);
select is((select provider_id from public.external_events where id=pg_temp.canonical()),'ticketmaster','disabled primary source yields to the active source with accurate provenance');
select is((select count(*)::int from public.external_event_participants where event_id=pg_temp.canonical()),2,'source takeover retains stable memberships');
select public.sync_external_events('ticketmaster',pg_temp.snapshot('ticket-1','{"status":"cancelled"}'),1);
set local role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.get_external_events_page()),0,'cancelled occurrences leave the feed');
select is((select count(*)::int from public.get_external_event(pg_temp.canonical())),1,'existing member retains the cancelled group details');
select lives_ok($$select public.set_event_membership(pg_temp.canonical(),false)$$,'member can leave a cancelled event');
select is((select count(*)::int from public.external_event_participants where event_id=pg_temp.canonical() and user_id=auth.uid()),0,'leaving revokes the membership');
select throws_ok($$select public.set_event_membership(pg_temp.canonical(),true)$$,'P0001','event_unavailable','cancelled events cannot be joined again');
reset role;
select set_config('request.jwt.claim.sub','',true);

-- Past groups do not consume the limit for upcoming social activities.
insert into public.external_events(provider_id,source_id,source_url,title,category,start_date,end_date,starts_at,venue,latitude,longitude,social_eligible,location_verified,status)
select 'ticketmaster','history-'||n,'https://www.ticketmaster.es/synthetic','History '||n,'SHOWTIME',current_date-2,current_date-2,now()-interval '2 days','Synthetic venue',40.42,-3.7,true,true,'expired' from generate_series(1,101)n;
insert into public.external_event_participants(event_id,user_id) select id,'98000000-0000-0000-0000-000000000001' from public.external_events where source_id like 'history-%';
select public.sync_external_events('ticketmaster',pg_temp.snapshot('future',jsonb_build_object('title','Another concert')),1);
create function pg_temp.future() returns uuid language sql security definer set search_path=public,pg_temp as $$select event_id from public.external_event_sources where provider_id='ticketmaster' and source_id='future';$$;
grant execute on function pg_temp.future() to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.set_event_membership(pg_temp.future(),true)$$,'101 historical groups do not block a new confirmed plan');
reset role;
insert into public.external_events(provider_id,source_id,source_url,title,category,start_date,end_date,starts_at,venue,latitude,longitude,social_eligible,location_verified)
select 'ticketmaster','limit-'||n,'https://www.ticketmaster.es/synthetic','Limit '||n,'SHOWTIME',current_date+1,current_date+1,now()+interval '1 day','Synthetic venue',40.42,-3.7,true,true from generate_series(1,100)n;
insert into public.external_event_participants(event_id,user_id) select id,'98000000-0000-0000-0000-000000000001' from public.external_events where source_id like 'limit-%' and source_id<>'limit-100';
create function pg_temp.over_limit() returns uuid language sql security definer set search_path=public,pg_temp as $$ select id from public.external_events where source_id='limit-100'; $$;
grant execute on function pg_temp.over_limit() to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.set_event_membership(pg_temp.over_limit(),true)$$,'P0001','event_membership_limit','one hundred upcoming groups still enforce the abuse limit');
select lives_ok($$select public.set_event_membership(pg_temp.future(),true)$$,'retry of an existing membership remains idempotent at the limit');
reset role;

insert into public.external_events(provider_id,source_id,source_url,title,category,subcategory,start_date,end_date,starts_at,venue,latitude,longitude,social_eligible,location_verified)
select 'ticketmaster','filtered-'||n,'https://www.ticketmaster.es/synthetic','Filtered '||n,'SHOWTIME','teatro',current_date+2,current_date+2,now()+interval '2 days','Synthetic venue',40.42,-3.7,true,true from generate_series(1,31)n;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select is((select count(*)::int from public.get_external_events_page_filtered(p_subcategories=>array['teatro'])),30,'subcategory filters before the page limit, even after a hundred other activities');
select is((with first_page as(select * from public.get_external_events_page_filtered(p_subcategories=>array['teatro'])),last_row as(select * from first_page order by start_date desc,id desc limit 1)
 select count(*)::int from last_row l cross join lateral public.get_external_events_page_filtered(p_after_date=>l.start_date,p_after_id=>l.id,p_subcategories=>array['teatro']) p),1,'filtered keyset continues without duplicates or empty false negatives');
select is((select count(*)::int from public.get_external_events_page_filtered(p_categories=>array['FOODIES'],p_subcategories=>array['teatro'])),0,'category and subcategory filters combine on the server');
reset role;

create temporary table held_lease as select public.claim_event_import() token;
select ok((select token is not null from held_lease),'first import obtains a lease');
select is(public.claim_event_import(),null::uuid,'overlapping import cannot geocode concurrently');
select public.release_event_import(gen_random_uuid());
select is(public.claim_event_import(),null::uuid,'wrong token cannot unlock a job');
select public.release_event_import(token) from held_lease;
select ok(public.claim_event_import() is not null,'correct release allows the next import');
select public.cache_event_geocodes('[{"key":"known","result":{"latitude":40.42,"longitude":-3.7}},{"key":"unknown","result":null}]');
select is(public.get_event_geocodes(array['known','unknown'])->'known'->>'latitude','40.42','verified public places are reused');
select ok(public.get_event_geocodes(array['unknown']) ? 'unknown','negative lookup is cached to avoid repeated calls');
select ok((select expires_at<now()+interval '7 hours' from public.external_venue_geocodes where key='unknown'),'negative cache expires quickly');
select ok((select expires_at>now()+interval '89 days' from public.external_venue_geocodes where key='known'),'positive cache avoids repeated geocoding for months');
select * from finish();
rollback;

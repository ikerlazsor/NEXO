begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('97000000-0000-0000-0000-000000000001','authenticated','authenticated','merge-a@nexo.test','unused',now(),'{"provider":"email","providers":["email"]}','{"nombre":"Synthetic A"}',now(),now()),
('97000000-0000-0000-0000-000000000002','authenticated','authenticated','merge-b@nexo.test','unused',now(),'{"provider":"email","providers":["email"]}','{"nombre":"Synthetic B"}',now(),now());
update public.event_providers set enabled=true,license_verified_at=now(),format_verified_at=now() where id='madrid';
insert into public.external_events(id,provider_id,source_id,source_url,title,category,subcategory,start_date,end_date,starts_at,venue,latitude,longitude,social_eligible,location_verified) values
('97100000-0000-0000-0000-000000000001','madrid','old-one','https://www.madrid.es/synthetic','Concierto social','SHOWTIME','concierto',current_date+1,current_date+1,now()+interval '1 day','Synthetic venue',40.42,-3.7,true,true),
('97100000-0000-0000-0000-000000000002','madrid','old-two','https://www.madrid.es/synthetic','Conciérto social','SHOWTIME','concierto',current_date+1,current_date+1,now()+interval '1 day 2 minutes','Synthetic venue',40.4201,-3.7,true,true),
('97100000-0000-0000-0000-000000000003','madrid','different-session','https://www.madrid.es/synthetic','Concierto social','SHOWTIME','concierto',current_date+2,current_date+2,now()+interval '2 days','Synthetic venue',40.42,-3.7,true,true);
insert into public.external_event_participants(event_id,user_id,joined_at) values
('97100000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000001',now()),
('97100000-0000-0000-0000-000000000002','97000000-0000-0000-0000-000000000001',now()-interval '1 hour'),
('97100000-0000-0000-0000-000000000002','97000000-0000-0000-0000-000000000002',now());
insert into public.external_event_messages(id,event_id,sender_id,client_id,body) values
('97200000-0000-0000-0000-000000000001','97100000-0000-0000-0000-000000000002','97000000-0000-0000-0000-000000000002','97300000-0000-0000-0000-000000000001','Synthetic message');
insert into public.external_event_reports(message_id,reporter_id,reason) values('97200000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000001','Synthetic report');
insert into public.external_event_interactions(user_id,event_id,kind) values
('97000000-0000-0000-0000-000000000001','97100000-0000-0000-0000-000000000001','view'),
('97000000-0000-0000-0000-000000000001','97100000-0000-0000-0000-000000000002','view');
select is(public.consolidate_legacy_event_groups(),1,'one legacy duplicate is consolidated');
select is((select count(*)::int from public.external_events),2,'another occurrence on a different day remains separate');
select is((select count(*)::int from public.external_event_participants where event_id='97100000-0000-0000-0000-000000000001'),2,'memberships merge without duplication');
select is((select joined_at from public.external_event_participants where event_id='97100000-0000-0000-0000-000000000001' and user_id='97000000-0000-0000-0000-000000000001'),now()-interval '1 hour','earliest membership date survives');
select is((select event_id from public.external_event_messages where id='97200000-0000-0000-0000-000000000001'),'97100000-0000-0000-0000-000000000001'::uuid,'chat message keeps its identity in the shared group');
select is((select count(*)::int from public.external_event_reports),1,'moderation reports are retained');
select is((select count(*)::int from public.external_event_interactions),1,'taste history is preserved without double counting the same activity');
select is((select event_id from public.external_event_sources where source_id='old-two'),'97100000-0000-0000-0000-000000000001'::uuid,'both publisher identifiers address the canonical group');
select is(public.consolidate_legacy_event_groups(),0,'retry is idempotent');
select ok(not has_function_privilege('authenticated','public.consolidate_legacy_event_groups()','execute'),'clients cannot reorganize groups');
select * from finish();
rollback;

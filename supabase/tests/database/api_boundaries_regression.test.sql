begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

select is((select count(*)::integer from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind in ('r','v','m','f') and has_table_privilege('anon',c.oid,'select,insert,update,delete')),0,'no signed-out direct table grants');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and has_function_privilege('anon',p.oid,'execute') and p.proname not in
 ('is_username_taken_public','get_guest_feed','get_guest_plan','search_feed_plans','get_external_events_page','get_external_events_page_filtered','get_external_event','get_event_social_summaries')),0,'anonymous callable functions match reviewed public APIs only');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prorettype in ('trigger'::regtype,'event_trigger'::regtype) and has_function_privilege('authenticated',p.oid,'execute')),0,'triggers are not callable as authenticated RPCs');
select ok(not has_function_privilege('authenticated','public.service_delete_account(uuid,uuid,boolean)','execute'),'clients cannot spoof deletion actor');
select ok(not has_function_privilege('authenticated','public.admin_delete_user(uuid)','execute'),'obsolete admin user deletion stays retired');
select ok(not has_function_privilege('authenticated','public.admin_delete_plan(uuid)','execute'),'obsolete admin plan deletion stays retired');
select ok(not has_function_privilege('authenticated','public.get_login_email_by_username(text)','execute'),'email lookup is not a client API');
select ok(has_function_privilege('authenticated','public.create_meetup_plan(jsonb)','execute'),'normal plan creation remains available');
select ok(has_function_privilege('authenticated','public.get_my_profile()','execute'),'own-profile RPC stays available');
select ok(has_function_privilege('anon','public.get_guest_feed(double precision,double precision,integer)','execute'),'guest feed remains available');
select ok(has_function_privilege('anon','public.search_feed_plans(text)','execute'),'guest search remains available');
select ok(has_function_privilege('anon','public.get_guest_plan(uuid)','execute'),'shared guest plan read remains available');
select ok(not has_column_privilege('authenticated','public.perfiles','rol','update'),'role column cannot be updated directly');
select ok(not has_column_privilege('authenticated','public.perfiles','baneado','update'),'ban column cannot be updated directly');
select ok(not has_column_privilege('authenticated','public.perfiles','fecha_nacimiento','select'),'birth dates are not directly public to signed-in users');
select ok(has_column_privilege('authenticated','public.perfiles','registro_completado','select'),'directory completion filter remains usable');
select ok(has_column_privilege('authenticated','public.perfiles','organizador','select'),'organizer card remains usable');
select ok(has_column_privilege('authenticated','public.perfiles','idioma','update'),'own language setting remains writable');
select ok(not has_table_privilege('authenticated','public.reportes_mensajes','insert'),'report snapshots require the validated report RPC');

-- Probe new-object defaults and the former blanket-grant event trigger.
create table public.boundary_probe_fixture(id integer);
create function public.boundary_probe_fixture() returns boolean language sql as $$select true$$;
select ok(not has_table_privilege('anon','public.boundary_probe_fixture','select'),'future tables are not automatically public');
select ok(not has_table_privilege('authenticated','public.boundary_probe_fixture','truncate'),'future tables do not gain client maintenance powers');
select ok(not has_function_privilege('anon','public.boundary_probe_fixture()','execute'),'future functions require explicit anonymous review');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('94000000-0000-0000-0000-000000000001','authenticated','authenticated','boundary-a@nexo.test','unused',now(),'{"provider":"email","providers":["email"]}','{"nombre":"Synthetic A"}',now(),now()),
 ('94000000-0000-0000-0000-000000000002','authenticated','authenticated','boundary-b@nexo.test','unused',now(),'{"provider":"email","providers":["email"]}','{"nombre":"Synthetic B"}',now(),now());
update public.perfiles set registro_completado=true,es_organizador=false,etiquetas=array['Deportista'],fecha_nacimiento='1990-03-04',perfil_gustos='{"privacidad":{"mostrar_edad":true}}',baneado=false where id='94000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000001',true);
select is((select count(*)::integer from public.get_profile_interest_candidates(array['Deportista'])),1,'public interest discovery remains available without private column grants');
select ok(not has_function_privilege('anon','public.get_profile_interest_candidates(text[],integer)','execute'),'interest discovery requires authentication');
select is(public.get_profile_screen('94000000-0000-0000-0000-000000000002')#>>'{profile,fecha_nacimiento}',null,'public profile bundle hides raw birth date');
select is((public.get_profile_screen('94000000-0000-0000-0000-000000000002')#>>'{profile,edad}')::integer,extract(year from age(current_date,date '1990-03-04'))::integer,'public profile bundle keeps visible age');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.perfiles set perfil_gustos='{"privacidad":{"mostrar_edad":false,"mostrar_aficiones":false}}',etiquetas=array['Deportista'] where id='94000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000001',true);
select is((select count(*)::integer from public.get_profile_interest_candidates(array['Deportista'])),0,'hidden interests cannot be inferred from discovery');
select is(public.get_profile_screen('94000000-0000-0000-0000-000000000002')#>>'{profile,edad}',null,'public bundle respects hidden age');
select is(public.get_profile_screen('94000000-0000-0000-0000-000000000002')#>'{profile,etiquetas}','[]'::jsonb,'public bundle respects hidden interests');
select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000002',true);
select is(public.get_profile_screen('94000000-0000-0000-0000-000000000002')#>>'{profile,fecha_nacimiento}','1990-03-04','own profile retains birth date for editing');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.event_providers set enabled=true,license_verified_at=now(),format_verified_at=now() where id='madrid';
insert into public.external_events(id,provider_id,source_id,source_url,title,category,start_date,end_date) values
 ('95000000-0000-0000-0000-000000000001','madrid','boundary-event-1','https://www.madrid.es/synthetic','Synthetic event','DESCUBRIR',current_date+1,current_date+2),
 ('95000000-0000-0000-0000-000000000002','madrid','boundary-event-2','https://www.madrid.es/synthetic','Synthetic event two','DESCUBRIR',current_date+1,current_date+2);
update public.external_events set starts_at=now()+interval '1 day',venue='Synthetic venue',latitude=40.42,longitude=-3.7,social_eligible=true,location_verified=true where source_id like 'boundary-event-%';
set local role authenticated;
select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000001',true);
select public.set_event_membership('95000000-0000-0000-0000-000000000001',true);
select public.set_event_membership('95000000-0000-0000-0000-000000000002',true);
select public.send_event_message('95000000-0000-0000-0000-000000000001','96000000-0000-0000-0000-000000000001','Synthetic message');
select throws_ok($$select public.send_event_message('95000000-0000-0000-0000-000000000002','96000000-0000-0000-0000-000000000001','Synthetic message')$$,'23505','message_client_conflict','idempotency token cannot acknowledge the wrong conversation');
select throws_ok($$select public.send_event_message('95000000-0000-0000-0000-000000000001','96000000-0000-0000-0000-000000000001','Different body')$$,'23505','message_client_conflict','idempotency token cannot acknowledge different content');
select is((select count(*)::integer from public.external_event_messages),1,'valid member can read chat');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.event_providers set enabled=false where id='madrid';
set local role authenticated;
select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000001',true);
select is((select count(*)::integer from public.external_event_participants),0,'disabled provider hides participant identities');
select is((select count(*)::integer from public.external_event_messages),0,'disabled provider revokes chat reading');
select throws_ok($$select public.track_event_interaction('95000000-0000-0000-0000-000000000001','view')$$,'P0001','event_not_found','disabled provider denies new interactions');
select lives_ok($$select public.set_event_membership('95000000-0000-0000-0000-000000000001',false)$$,'member can still leave a disabled provider event');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.event_providers set enabled=true,license_verified_at=null where id='madrid';
set local role anon;
select is((select count(*)::integer from public.get_external_events_page()),0,'unverified provider cannot publish feed cards');
select is((select count(*)::integer from public.get_external_event('95000000-0000-0000-0000-000000000001')),0,'unverified provider cannot publish event details');
reset role;
select * from finish();
rollback;

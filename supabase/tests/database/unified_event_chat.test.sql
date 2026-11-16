begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('91000000-0000-4000-8000-000000000001','authenticated','authenticated','unified-a@nexo.test','unused',now(),'{"provider":"email","providers":["email"]}','{"nombre":"A"}',now(),now()),
('91000000-0000-4000-8000-000000000002','authenticated','authenticated','unified-b@nexo.test','unused',now(),'{"provider":"email","providers":["email"]}','{"nombre":"B"}',now(),now()),
('91000000-0000-4000-8000-000000000003','authenticated','authenticated','unified-c@nexo.test','unused',now(),'{"provider":"email","providers":["email"]}','{"nombre":"C"}',now(),now());
update public.perfiles set baneado=false where id::text like '91000000-%';
update public.event_providers set enabled=true,license_verified_at=now(),format_verified_at=now() where id='madrid';
insert into public.external_events(id,provider_id,source_id,source_url,title,category,start_date,end_date,starts_at,venue,latitude,longitude,social_eligible,location_verified,status) values
('92000000-0000-4000-8000-000000000001','madrid','unified-1','https://www.madrid.es/synthetic','Yoga en grupo','DEPORTES',current_date+1,current_date+1,now()+interval '1 day','Centro Madrid',40.42,-3.7,true,true,'active'),
('92000000-0000-4000-8000-000000000002','madrid','unified-2','https://www.madrid.es/synthetic','Language exchange','DESCUBRIR',current_date+1,current_date+1,now()+interval '1 day','Otro local',40.43,-3.71,true,true,'active');
insert into public.external_event_participants(event_id,user_id,joined_at) values
('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001',now()-interval '1 day'),
('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002',now()-interval '1 day');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.send_event_chat_message('92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','Hola')$$,'text uses shared chat model');
select is((select count(*)::int from public.external_event_messages),1,'one message');
select lives_ok($$select public.send_event_chat_message('92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','Hola')$$,'retry idempotent');
select is((select count(*)::int from public.external_event_messages),1,'retry does not duplicate');
select throws_ok($$select public.send_event_chat_message('92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','Otra cosa')$$,'23505','message_client_conflict','retry cannot replace content');
select lives_ok($$select public.send_event_message('92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000002','Mensaje desde cliente anterior')$$,'existing client remains compatible');
select ok(public.can_access_event_chat_file('event_92000000-0000-4000-8000-000000000001_100_1.jpg'),'member can access event attachment namespace');
select ok(not public.can_access_event_chat_file('event_92000000-0000-4000-8000-000000000002_100_1.jpg'),'another event attachment denied');
select ok(not public.can_access_event_chat_file('event_x_100_1.jpg'),'malformed file name denied');
select lives_ok($$insert into storage.objects(bucket_id,name,owner_id) values('chat-files','event_92000000-0000-4000-8000-000000000001_100_1.jpg',auth.uid()::text)$$,'member can upload privately');
select lives_ok($$select public.send_event_chat_message('92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000003','Foto','imagen','event_92000000-0000-4000-8000-000000000001_100_1.jpg')$$,'attachment shared through same private file bucket');
select throws_ok($$select public.send_event_chat_message('92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000004','Foto','imagen','event_92000000-0000-4000-8000-000000000002_100_1.jpg')$$,'P0001','invalid_attachment','cross-room attachment rejected');
select throws_ok($$select public.send_event_chat_message('92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000004','Foto','imagen','https://attacker.test/photo')$$,'P0001','invalid_attachment','arbitrary external attachment rejected');
select is(jsonb_array_length(public.get_event_chat_threads()),1,'event appears in common inbox');
select lives_ok($$select public.set_event_chat_preferences('92000000-0000-4000-8000-000000000001',false,false,true)$$,'mute preference stored');
select is((public.get_event_chat_threads()->0->>'muted')::boolean,true,'mute preference returned');
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((public.get_event_chat_threads()->0->>'unread')::integer,3,'another member has unread messages');
select lives_ok($$select public.set_event_chat_preferences('92000000-0000-4000-8000-000000000001',true)$$,'read marker stored');
select is((public.get_event_chat_threads()->0->>'unread')::integer,0,'unread clears');
select lives_ok($$select public.toggle_event_chat_reaction('92000000-0000-4000-8000-000000000001',(select id from public.external_event_messages where client_id='93000000-0000-4000-8000-000000000001'),'👍')$$,'member reacts');
select is((select count(*)::int from public.get_event_chat_reactions('92000000-0000-4000-8000-000000000001')),1,'reaction delivered');
select lives_ok($$select public.toggle_event_chat_reaction('92000000-0000-4000-8000-000000000001',(select id from public.external_event_messages where client_id='93000000-0000-4000-8000-000000000001'),'👍')$$,'second tap removes reaction');
select is((select count(*)::int from public.get_event_chat_reactions('92000000-0000-4000-8000-000000000001')),0,'reaction removed');
select throws_ok($$select public.delete_event_chat_message('92000000-0000-4000-8000-000000000001',(select id from public.external_event_messages where client_id='93000000-0000-4000-8000-000000000001'))$$,'42501','message_not_owned','cannot delete another member message');
select lives_ok($$select public.set_event_chat_preferences('92000000-0000-4000-8000-000000000001',false,true)$$,'chat can be hidden without leaving');
select is(jsonb_array_length(public.get_event_chat_threads()),0,'hidden chat absent');
select ok(public.event_is_member('92000000-0000-4000-8000-000000000001'),'hide preserves membership');
select lives_ok($$select public.set_event_chat_preferences('92000000-0000-4000-8000-000000000001',false,false)$$,'chat can be reopened');
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.delete_event_chat_message('92000000-0000-4000-8000-000000000001',(select id from public.external_event_messages where client_id='93000000-0000-4000-8000-000000000003'))$$,'sender can delete own photo');
select ok((select archivo_url is null and body='@@nexo_deleted@@' and eliminado_en is not null from public.external_event_messages where client_id='93000000-0000-4000-8000-000000000003'),'deletion clears attachment and content');
select lives_ok($$select public.set_event_membership('92000000-0000-4000-8000-000000000001',false)$$,'leave works');
select ok(not public.can_access_event_chat_file('event_92000000-0000-4000-8000-000000000001_100_1.jpg'),'leave revokes file access');
select is((select count(*)::int from public.external_event_messages),0,'leave revokes history');
select is(jsonb_array_length(public.get_event_chat_threads()),0,'leave removes inbox thread');
select throws_ok($$select public.send_event_chat_message('92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000005','No permitido')$$,'42501','membership_required','leave revokes send');
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select throws_ok($$select public.set_event_chat_preferences('92000000-0000-4000-8000-000000000001',true)$$,'42501','membership_required','nonmember cannot change preferences');
select is((select count(*)::int from public.get_event_chat_reactions('92000000-0000-4000-8000-000000000001')),0,'nonmember cannot read reactions');
reset role;
select ok(not has_function_privilege('anon','public.get_event_chat_threads()','EXECUTE'),'guest cannot read inbox');
select * from finish();
rollback;

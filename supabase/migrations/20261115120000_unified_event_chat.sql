begin;
alter table public.external_event_messages
 add column message_type text not null default 'texto' check(message_type in ('texto','imagen','video','audio')),
 add column archivo_url text,
 add column eliminado_en timestamptz,
 add column chat_updated_at timestamptz not null default now();
alter table public.external_event_messages drop constraint external_event_messages_body_check;
alter table public.external_event_messages add constraint external_event_messages_body_check check(length(trim(body)) between 1 and 16000);

create table public.external_event_reactions (
 message_id uuid not null references public.external_event_messages(id) on delete cascade,
 user_id uuid not null references public.perfiles(id) on delete cascade,
 emoji text not null check(length(emoji) between 1 and 32),
 primary key(message_id,user_id)
);
alter table public.external_event_reactions enable row level security;
revoke all on public.external_event_reactions from public,anon,authenticated;
grant all on public.external_event_reactions to service_role;

-- Event files share the private chat bucket, but use a separate room namespace.
create function public.can_access_event_chat_file(p_name text) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare room uuid;
begin
 if p_name !~ '^event_[0-9a-fA-F-]{36}_[0-9]+_[0-9]+\.(jpg|mp4|m4a)$' then return false; end if;
 begin room:=substring(p_name from 7 for 36)::uuid; exception when invalid_text_representation then return false; end;
 return public.event_is_member(room);
end;
$$;
revoke all on function public.can_access_event_chat_file(text) from public,anon;
grant execute on function public.can_access_event_chat_file(text) to authenticated;
create policy event_chat_files_read on storage.objects for select to authenticated
 using(bucket_id='chat-files' and public.can_access_event_chat_file(name));
create policy event_chat_files_insert on storage.objects for insert to authenticated
 with check(bucket_id='chat-files' and owner_id=auth.uid()::text and public.can_access_event_chat_file(name));

create function public.send_event_chat_message(p_event uuid,p_client uuid,p_body text,p_type text default 'texto',p_file text default null) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid; previous public.external_event_messages;
begin
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,12));
 if not public.event_is_member(p_event) then raise exception 'membership_required' using errcode='42501'; end if;
 if p_type not in ('texto','imagen','video','audio') or p_type is null or nullif(trim(p_body),'') is null then raise exception 'invalid_message'; end if;
 if p_type='texto' and p_file is not null then raise exception 'invalid_attachment'; end if;
 if p_type<>'texto' and (p_file is null or p_file !~ ('^event_'||p_event::text||'_[0-9]+_[0-9]+\.(jpg|mp4|m4a)$')
   or not exists(select 1 from storage.objects where bucket_id='chat-files' and name=p_file)) then raise exception 'invalid_attachment'; end if;
 select * into previous from public.external_event_messages where sender_id=auth.uid() and client_id=p_client;
 if found then
  if previous.event_id<>p_event or previous.body<>trim(p_body) or previous.message_type<>p_type or previous.archivo_url is distinct from p_file then raise exception 'message_client_conflict' using errcode='23505'; end if;
  return previous.id;
 end if;
 result:=public.send_event_message(p_event,p_client,p_body);
 update public.external_event_messages set message_type=p_type,archivo_url=p_file where id=result;
 return result;
end;
$$;
create function public.get_event_chat_reactions(p_event uuid) returns table(mensaje_id uuid,usuario_id uuid,emoji text)
language sql stable security definer set search_path=public,pg_temp as $$
 select r.message_id,r.user_id,r.emoji from public.external_event_reactions r join public.external_event_messages m on m.id=r.message_id
 where m.event_id=p_event and m.eliminado_en is null and public.event_is_member(p_event) and public.event_users_visible(r.user_id)
 order by m.created_at desc limit 5000;
$$;
create function public.toggle_event_chat_reaction(p_event uuid,p_message uuid,p_emoji text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,12));
 if not public.event_is_member(p_event) then raise exception 'membership_required' using errcode='42501'; end if;
 if not exists(select 1 from public.external_event_messages where id=p_message and event_id=p_event and eliminado_en is null) then raise exception 'message_not_found'; end if;
 if p_emoji is null or length(trim(p_emoji)) not between 1 and 32 then raise exception 'invalid_emoji'; end if;
 if exists(select 1 from public.external_event_reactions where message_id=p_message and user_id=auth.uid() and emoji=p_emoji) then
  delete from public.external_event_reactions where message_id=p_message and user_id=auth.uid();
 else insert into public.external_event_reactions(message_id,user_id,emoji) values(p_message,auth.uid(),p_emoji)
  on conflict(message_id,user_id) do update set emoji=excluded.emoji; end if;
 update public.external_event_messages set chat_updated_at=now() where id=p_message;
end;
$$;
create function public.delete_event_chat_message(p_event uuid,p_message uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,12));
 if not public.event_is_member(p_event) then raise exception 'membership_required' using errcode='42501'; end if;
 update public.external_event_messages set body='@@nexo_deleted@@',archivo_url=null,eliminado_en=coalesce(eliminado_en,now())
 where id=p_message and event_id=p_event and sender_id=auth.uid();
 if not found then raise exception 'message_not_owned' using errcode='42501'; end if;
 delete from public.external_event_reactions where message_id=p_message;
end;
$$;
revoke all on function public.send_event_chat_message(uuid,uuid,text,text,text), public.get_event_chat_reactions(uuid), public.toggle_event_chat_reaction(uuid,uuid,text), public.delete_event_chat_message(uuid,uuid) from public,anon;
grant execute on function public.send_event_chat_message(uuid,uuid,text,text,text), public.get_event_chat_reactions(uuid), public.toggle_event_chat_reaction(uuid,uuid,text), public.delete_event_chat_message(uuid,uuid) to authenticated;
create table public.external_event_chat_preferences (
 event_id uuid not null references public.external_events(id) on delete cascade,
 user_id uuid not null references public.perfiles(id) on delete cascade,
 last_read_at timestamptz, hidden_at timestamptz, muted boolean not null default false,
 primary key(event_id,user_id)
);
alter table public.external_event_chat_preferences enable row level security;
revoke all on public.external_event_chat_preferences from public,anon,authenticated;
grant all on public.external_event_chat_preferences to service_role;
create function public.set_event_chat_preferences(p_event uuid,p_read boolean default false,p_hidden boolean default null,p_muted boolean default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,12));
 if not public.event_is_member(p_event) then raise exception 'membership_required' using errcode='42501'; end if;
 insert into public.external_event_chat_preferences(event_id,user_id) values(p_event,auth.uid()) on conflict do nothing;
 update public.external_event_chat_preferences set last_read_at=case when p_read then now() else last_read_at end,
  hidden_at=case when p_hidden is null then hidden_at when p_hidden then now() else null end,
  muted=coalesce(p_muted,muted) where event_id=p_event and user_id=auth.uid();
end;
$$;
create function public.get_event_chat_threads() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(row_data order by last_at desc),'[]'::jsonb) from (
 select jsonb_build_object('event',to_jsonb(e),'last_message',to_jsonb(m),'muted',coalesce(pref.muted,false),
 'unread',(select count(*) from public.external_event_messages unread where unread.event_id=e.id and unread.sender_id<>auth.uid()
  and unread.eliminado_en is null and public.event_users_visible(unread.sender_id) and unread.created_at>greatest(membership.joined_at,coalesce(pref.last_read_at,'-infinity')))) as row_data,
 coalesce(m.created_at,membership.joined_at) as last_at
 from public.external_event_participants membership join public.external_events e on e.id=membership.event_id
 left join public.external_event_chat_preferences pref on pref.event_id=e.id and pref.user_id=auth.uid()
 left join lateral(select * from public.external_event_messages message where message.event_id=e.id and public.event_users_visible(message.sender_id)
  order by message.created_at desc,message.id desc limit 1) m on true
 where membership.user_id=auth.uid() and public.event_viewer_allowed() and (pref.hidden_at is null or m.created_at>pref.hidden_at)
 order by last_at desc limit 100) threads;
$$;
revoke all on function public.set_event_chat_preferences(uuid,boolean,boolean,boolean), public.get_event_chat_threads() from public,anon;
grant execute on function public.set_event_chat_preferences(uuid,boolean,boolean,boolean), public.get_event_chat_threads() to authenticated;

do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(
 select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='external_event_messages') then
  alter publication supabase_realtime add table public.external_event_messages;
 end if;
end $$;
commit;

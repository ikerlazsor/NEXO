begin;

-- Events never inherit plan approval, capacity, creator or rating semantics.
create table public.event_providers (
  id text primary key,
  name text not null,
  dataset_url text not null check (dataset_url like 'https://%'),
  license_url text,
  license_verified_at timestamptz,
  format_verified_at timestamptz,
  enabled boolean not null default false,
  last_success_at timestamptz,
  last_raw_count integer not null default 0
);
insert into public.event_providers(id,name,dataset_url) values
('madrid','Ayuntamiento de Madrid','https://datos.madrid.es/dataset/206974-0-agenda-eventos-culturales-100');

create table public.external_events (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null references public.event_providers(id),
  source_id text not null check (length(source_id) between 1 and 500),
  source_url text not null check (source_url like 'https://%'),
  title text not null check (length(title) between 1 and 300),
  description text,
  category text not null check (category in ('DEPORTES','VIBES','AIRE_LIBRE','FOODIES','DESCUBRIR','SHOWTIME')),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  starts_at timestamptz,
  schedule text,
  venue text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  price_text text,
  status text not null default 'active' check (status in ('active','cancelled','expired','stale')),
  -- Images are deliberately absent until a provider can prove image-specific rights.
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  missing_runs integer not null default 0,
  unique(provider_id, source_id)
);
create index external_events_feed_idx on public.external_events(start_date,id) where status='active';
create index external_events_geo_idx on public.external_events(latitude,longitude) where status='active';
create table public.external_event_participants (
  event_id uuid not null references public.external_events(id) on delete cascade,
  user_id uuid not null references public.perfiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key(event_id,user_id)
);
create index external_event_participant_user_idx on public.external_event_participants(user_id,event_id);
create table public.external_event_messages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.external_events(id) on delete cascade,
  sender_id uuid not null references public.perfiles(id) on delete cascade,
  client_id uuid not null,
  body text not null check(length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  unique(sender_id,client_id)
);
create index external_event_messages_page_idx on public.external_event_messages(event_id,created_at desc,id desc);
create table public.external_event_interactions (
  user_id uuid not null references public.perfiles(id) on delete cascade,
  event_id uuid not null references public.external_events(id) on delete cascade,
  kind text not null check(kind in ('view','official','join')),
  created_at timestamptz not null default now(),
  primary key(user_id,event_id,kind)
);
create table public.external_event_reports (
  message_id uuid not null references public.external_event_messages(id) on delete cascade,
  reporter_id uuid not null references public.perfiles(id) on delete cascade,
  reason text not null check(length(trim(reason)) between 1 and 500),
  created_at timestamptz not null default now(),
  primary key(message_id,reporter_id)
);

-- Helpers bypass recursive participant RLS but never expose arbitrary user data.
create function public.event_viewer_allowed() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.perfiles where id=auth.uid() and not coalesce(baneado,false));
$$;
create function public.event_is_member(p_event uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select public.event_viewer_allowed() and exists(
    select 1 from public.external_event_participants where event_id=p_event and user_id=auth.uid());
$$;
create function public.event_users_visible(p_other uuid) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare blocked boolean;
begin
  if not public.event_viewer_allowed() or not exists(select 1 from public.perfiles p where p.id=p_other and not coalesce(p.baneado,false)) then return false; end if;
  -- Respect both supported legacy column layouts, including blocks made by the other person.
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='bloqueos' and column_name='usuario_origen_id') then
    execute 'select exists(select 1 from public.bloqueos where (usuario_origen_id=$1 and usuario_destino_id=$2) or (usuario_origen_id=$2 and usuario_destino_id=$1))' into blocked using auth.uid(),p_other;
  else
    select exists(select 1 from public.bloqueos where (bloqueador_id=auth.uid() and bloqueado_id=p_other) or (bloqueador_id=p_other and bloqueado_id=auth.uid())) into blocked;
  end if;
  return not blocked;
end;
$$;

alter table public.event_providers enable row level security;
alter table public.external_events enable row level security;
alter table public.external_event_participants enable row level security;
alter table public.external_event_messages enable row level security;
alter table public.external_event_interactions enable row level security;
alter table public.external_event_reports enable row level security;
create policy provider_read on public.event_providers for select to anon,authenticated using(enabled);
create policy event_read on public.external_events for select to anon,authenticated using(
  exists(select 1 from public.event_providers p where p.id=provider_id and p.enabled));
create policy participant_read on public.external_event_participants for select to authenticated using(
  public.event_users_visible(user_id));
-- All membership writes go through a serialized RPC, never client-supplied user IDs.
create policy message_read on public.external_event_messages for select to authenticated using(
  public.event_is_member(event_id) and public.event_users_visible(sender_id));
create policy interaction_read on public.external_event_interactions for select to authenticated using(user_id=auth.uid());
create policy report_insert on public.external_event_reports for insert to authenticated with check(
  reporter_id=auth.uid() and public.event_viewer_allowed() and exists(
    select 1 from public.external_event_messages m where m.id=message_id and public.event_is_member(m.event_id)));

revoke all on public.event_providers,public.external_events,public.external_event_participants,
 public.external_event_messages,public.external_event_interactions,public.external_event_reports from anon,authenticated;
grant select on public.event_providers,public.external_events to authenticated;
grant select on public.external_event_participants,public.external_event_messages,public.external_event_interactions to authenticated;
grant insert on public.external_event_reports to authenticated;
grant all on public.event_providers,public.external_events,public.external_event_participants,
 public.external_event_messages,public.external_event_interactions,public.external_event_reports to service_role;

create function public.set_event_membership(p_event uuid,p_join boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.external_events;
begin
  if not public.event_viewer_allowed() then raise exception 'account_required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,12));
  select * into e from public.external_events where id=p_event for update;
  if not found then raise exception 'event_not_found'; end if;
  if not p_join then
    delete from public.external_event_participants where event_id=p_event and user_id=auth.uid();
    return;
  end if;
  if e.status <> 'active' or e.end_date < (now() at time zone 'Europe/Madrid')::date
    or not exists(select 1 from public.event_providers where id=e.provider_id and enabled) then
    raise exception 'event_unavailable';
  end if;
  if (select count(*) from public.external_event_participants where user_id=auth.uid()) >= 100
    and not public.event_is_member(p_event) then raise exception 'event_membership_limit'; end if;
  insert into public.external_event_participants(event_id,user_id) values(p_event,auth.uid()) on conflict do nothing;
  insert into public.external_event_interactions(user_id,event_id,kind) values(auth.uid(),p_event,'join') on conflict do nothing;
end;
$$;

create function public.track_event_interaction(p_event uuid,p_kind text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.event_viewer_allowed() then raise exception 'account_required' using errcode='42501'; end if;
  if p_kind not in ('view','official') then raise exception 'invalid_interaction'; end if;
  if not exists(select 1 from public.external_events e join public.event_providers p on p.id=e.provider_id where e.id=p_event and p.enabled) then raise exception 'event_not_found'; end if;
  insert into public.external_event_interactions(user_id,event_id,kind) values(auth.uid(),p_event,p_kind) on conflict do nothing;
end;
$$;

create function public.send_event_message(p_event uuid,p_client uuid,p_body text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid;
begin
  -- Same lock as leave: once leaving completes, sending is denied.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,12));
  if not public.event_is_member(p_event) then raise exception 'membership_required' using errcode='42501'; end if;
  if not exists(select 1 from public.external_events e join public.event_providers p on p.id=e.provider_id
    where e.id=p_event and e.status='active' and e.end_date >= (now() at time zone 'Europe/Madrid')::date and p.enabled) then raise exception 'event_unavailable'; end if;
  select id into result from public.external_event_messages where sender_id=auth.uid() and client_id=p_client;
  if found then return result; end if;
  if (select count(*) from public.external_event_messages where sender_id=auth.uid() and created_at>now()-interval '1 minute') >= 20 then raise exception 'message_rate_limit'; end if;
  insert into public.external_event_messages(event_id,sender_id,client_id,body) values(p_event,auth.uid(),p_client,trim(p_body)) returning id into result;
  return result;
end;
$$;

-- A bounded keyset query: filters apply on the server before the page limit.
create function public.get_external_events_page(
  p_after_date date default null,p_after_id uuid default null,p_categories text[] default null,
  p_query text default null,p_lat double precision default null,p_lon double precision default null,
  p_radius double precision default null,p_from date default null,p_until date default null
) returns setof public.external_events language sql stable security definer set search_path=public,pg_temp as $$
  select e.* from public.external_events e where e.status='active' and exists(select 1 from public.event_providers p where p.id=e.provider_id and p.enabled)
    and e.end_date >= (now() at time zone 'Europe/Madrid')::date
    and (p_after_date is null or (e.start_date,e.id)>(p_after_date,p_after_id))
    and (coalesce(cardinality(p_categories),0)=0 or e.category=any(p_categories))
    and (nullif(trim(p_query),'') is null or e.title ilike '%'||left(p_query,100)||'%' or e.venue ilike '%'||left(p_query,100)||'%')
    and (p_from is null or e.end_date>=p_from) and (p_until is null or e.start_date<=p_until)
    and (p_radius is null or (p_lat between -90 and 90 and p_lon between -180 and 180 and
      e.latitude between p_lat-least(greatest(p_radius,0),200)/111.0 and p_lat+least(greatest(p_radius,0),200)/111.0 and
      6371*2*asin(sqrt(least(1.0,power(sin(radians(e.latitude-p_lat)/2),2)+cos(radians(p_lat))*cos(radians(e.latitude))*power(sin(radians(e.longitude-p_lon)/2),2))))<=least(greatest(p_radius,0),200)))
  order by e.start_date,e.id limit 30;
$$;

create function public.get_external_event(p_event uuid) returns setof public.external_events
language sql stable security definer set search_path=public,pg_temp as $$
  select e.* from public.external_events e join public.event_providers p on p.id=e.provider_id where e.id=p_event and p.enabled;
$$;
revoke execute on function public.get_external_event(uuid) from public;
grant execute on function public.get_external_event(uuid) to anon,authenticated;

-- A complete validated snapshot is committed atomically; a failed/truncated run
-- never increments missing counters. Two successful absences mark stale, not cancelled.
create function public.sync_external_events(p_provider text,p_items jsonb,p_raw_count integer) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.event_providers; n integer; today date := (now() at time zone 'Europe/Madrid')::date;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_provider,11));
  select * into cfg from public.event_providers where id=p_provider for update;
  if not found or not cfg.enabled or cfg.license_verified_at is null or cfg.format_verified_at is null then raise exception 'provider_not_verified'; end if;
  n := jsonb_array_length(p_items);
  if n<1 or n>20000 or p_raw_count<n or (cfg.last_raw_count>20 and p_raw_count<cfg.last_raw_count*0.5) then raise exception 'suspicious_snapshot'; end if;
  if (select count(distinct x->>'source_id') from jsonb_array_elements(p_items) x) <> n then raise exception 'duplicate_source_ids'; end if;
  insert into public.external_events(provider_id,source_id,source_url,title,description,category,start_date,end_date,starts_at,schedule,venue,latitude,longitude,price_text,status)
    select p_provider,x.source_id,x.source_url,x.title,x.description,x.category,x.start_date,x.end_date,x.starts_at,x.schedule,x.venue,x.latitude,x.longitude,x.price_text,x.status
    from jsonb_to_recordset(p_items) as x(source_id text,source_url text,title text,description text,category text,start_date date,end_date date,starts_at timestamptz,schedule text,venue text,latitude double precision,longitude double precision,price_text text,status text)
  on conflict(provider_id,source_id) do update set source_url=excluded.source_url,title=excluded.title,description=excluded.description,category=excluded.category,
    start_date=excluded.start_date,end_date=excluded.end_date,starts_at=excluded.starts_at,schedule=excluded.schedule,venue=excluded.venue,
    latitude=excluded.latitude,longitude=excluded.longitude,price_text=excluded.price_text,status=excluded.status,last_seen_at=now(),missing_runs=0;
  update public.external_events e set missing_runs=e.missing_runs+1,status=case when e.status='cancelled' then 'cancelled' when e.missing_runs>=1 then 'stale' else e.status end
    where e.provider_id=p_provider and not exists(select 1 from jsonb_array_elements(p_items) x where x->>'source_id'=e.source_id);
  update public.external_events set status='expired' where provider_id=p_provider and end_date<today and status<>'cancelled';
  update public.event_providers set last_success_at=now(),last_raw_count=p_raw_count where id=p_provider;
  return n;
end;
$$;

revoke execute on function public.sync_external_events(text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.sync_external_events(text,jsonb,integer) to service_role;
revoke execute on function public.set_event_membership(uuid,boolean),public.send_event_message(uuid,uuid,text),public.track_event_interaction(uuid,text),public.event_viewer_allowed(),public.event_is_member(uuid),public.event_users_visible(uuid) from public,anon;
grant execute on function public.set_event_membership(uuid,boolean),public.send_event_message(uuid,uuid,text),public.track_event_interaction(uuid,text),public.event_viewer_allowed(),public.event_is_member(uuid),public.event_users_visible(uuid) to authenticated;
revoke execute on function public.get_external_events_page(date,uuid,text[],text,double precision,double precision,double precision,date,date) from public;
grant execute on function public.get_external_events_page(date,uuid,text[],text,double precision,double precision,double precision,date,date) to anon,authenticated;
commit;

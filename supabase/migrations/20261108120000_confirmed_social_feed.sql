begin;

alter table public.external_events
  add column address text,
  add column social_eligible boolean not null default false,
  add column location_verified boolean not null default false,
  add column location_source text,
  add column title_key text generated always as (trim(regexp_replace(translate(lower(title),'áàäâéèëêíìïîóòöôúùüûñ','aaaaeeeeiiiioooouuuun'),'[^a-z0-9]+',' ','g'))) stored;
create index external_event_occurrence_identity on public.external_events(title_key,starts_at);
create index external_event_confirmed_start on public.external_events(starts_at,id) where status='active' and social_eligible and location_verified;

insert into public.event_providers(id,name,dataset_url,license_url,enabled)
values ('ticketmaster','Ticketmaster','https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/','https://developer.ticketmaster.com/support/terms-of-use/',false)
on conflict(id) do nothing;

-- Alternate publishers point at the same social group; memberships/chat never
-- move or disappear when an event is discovered on another website.
create table public.external_event_sources (
  provider_id text not null references public.event_providers(id),
  source_id text not null,
  event_id uuid not null references public.external_events(id) on delete cascade,
  source_url text not null check(source_url like 'https://%'),
  last_seen_at timestamptz not null default now(),
  missing_runs integer not null default 0,
  status text not null check(status in ('active','cancelled','stale','expired')),
  primary key(provider_id,source_id)
);
create index external_event_sources_canonical on public.external_event_sources(event_id);
alter table public.external_event_sources enable row level security;
revoke all on public.external_event_sources from public,anon,authenticated;
grant all on public.external_event_sources to service_role;
insert into public.external_event_sources(provider_id,source_id,event_id,source_url,last_seen_at,missing_runs,status)
select provider_id,source_id,id,source_url,last_seen_at,missing_runs,status from public.external_events;

create or replace function public.event_provider_available(p_event uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.external_event_sources s join public.event_providers p on p.id=s.provider_id
 where s.event_id=p_event and p.enabled and p.license_verified_at is not null and p.format_verified_at is not null) or exists(select 1 from public.external_events e join public.event_providers p on p.id=e.provider_id where e.id=p_event and p.enabled and p.license_verified_at is not null and p.format_verified_at is not null and not exists(select 1 from public.external_event_sources s where s.event_id=e.id));
$$;
create function public.external_event_is_publishable(e public.external_events) returns boolean
language sql stable set search_path=public,pg_temp as $$
 select e.status='active' and e.social_eligible and e.location_verified
 and e.starts_at>now() and e.starts_at<=now()+interval '3 months'
 and nullif(trim(e.venue),'') is not null
 and trim(e.venue) !~* '^(madrid|comunidad de madrid|varios( espacios| lugares)?|por confirmar|por determinar|ubicación pendiente|online|virtual|internet|sin confirmar)$'
 and e.latitude between 39.7 and 41.3 and e.longitude between -4.7 and -2.6;
$$;
revoke all on function public.external_event_is_publishable(public.external_events) from public,anon;
grant execute on function public.external_event_is_publishable(public.external_events) to authenticated,service_role;

create function public.get_external_events_page_filtered(
 p_after_date date default null,p_after_id uuid default null,p_categories text[] default null,p_query text default null,
 p_lat double precision default null,p_lon double precision default null,p_radius double precision default null,p_from date default null,p_until date default null,p_subcategories text[] default null
) returns setof public.external_events language sql stable security definer set search_path=public,pg_temp as $$
 select e.* from public.external_events e where public.external_event_is_publishable(e) and public.event_provider_available(e.id)
 and (p_after_date is null or (e.start_date,e.id)>(p_after_date,p_after_id))
 and (coalesce(cardinality(p_categories),0)=0 or e.category=any(p_categories))
 and (coalesce(cardinality(p_subcategories),0)=0 or e.subcategory=any(p_subcategories))
 and (nullif(trim(p_query),'') is null or e.title ilike '%'||left(p_query,100)||'%' or e.venue ilike '%'||left(p_query,100)||'%')
 and (p_from is null or e.start_date>=p_from) and (p_until is null or e.start_date<=p_until)
 and (p_radius is null or (p_lat between -90 and 90 and p_lon between -180 and 180 and
  6371*2*asin(sqrt(least(1.0,power(sin(radians(e.latitude-p_lat)/2),2)+cos(radians(p_lat))*cos(radians(e.latitude))*power(sin(radians(e.longitude-p_lon)/2),2))))<=least(greatest(p_radius,0),200)))
 order by e.start_date,e.id limit 30;
$$;
revoke all on function public.get_external_events_page_filtered(date,uuid,text[],text,double precision,double precision,double precision,date,date,text[]) from public,anon,authenticated;
grant execute on function public.get_external_events_page_filtered(date,uuid,text[],text,double precision,double precision,double precision,date,date,text[]) to anon,authenticated,service_role;
create or replace function public.get_external_events_page(
 p_after_date date default null,p_after_id uuid default null,p_categories text[] default null,p_query text default null,
 p_lat double precision default null,p_lon double precision default null,p_radius double precision default null,p_from date default null,p_until date default null
) returns setof public.external_events language sql stable security definer set search_path=public,pg_temp as $$
 select * from public.get_external_events_page_filtered(p_after_date,p_after_id,p_categories,p_query,p_lat,p_lon,p_radius,p_from,p_until,null);
$$;
create or replace function public.get_external_event(p_event uuid) returns setof public.external_events
language sql stable security definer set search_path=public,pg_temp as $$
 select e.* from public.external_events e where e.id=p_event and public.event_provider_available(e.id)
 and (public.external_event_is_publishable(e) or exists(select 1 from public.external_event_participants m where m.event_id=e.id and m.user_id=auth.uid()));
$$;
alter policy event_read on public.external_events using(public.event_provider_available(id) and
 (public.external_event_is_publishable(external_events) or public.event_is_member(id)));

create or replace function public.set_event_membership(p_event uuid,p_join boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.external_events;
begin
 if not public.event_viewer_allowed() then raise exception 'account_required' using errcode='42501'; end if;
 if p_join is null then raise exception 'invalid_membership'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,12));
 if not p_join then
  delete from public.external_event_participants where event_id=p_event and user_id=auth.uid(); return;
 end if;
 select * into e from public.external_events where id=p_event for update;
 if not found or not public.event_provider_available(p_event) or not public.external_event_is_publishable(e) then raise exception 'event_unavailable'; end if;
 if exists(select 1 from public.external_event_participants where event_id=p_event and user_id=auth.uid()) then return; end if;
 if (select count(*) from public.external_event_participants m join public.external_events x on x.id=m.event_id where m.user_id=auth.uid() and x.status='active' and x.starts_at>now()) >=100 then raise exception 'event_membership_limit'; end if;
 insert into public.external_event_participants(event_id,user_id) values(p_event,auth.uid()) on conflict(event_id,user_id) do nothing;
 insert into public.external_event_interactions(user_id,event_id,kind) values(auth.uid(),p_event,'join') on conflict(user_id,event_id,kind) do nothing;
end;
$$;

create function public.get_event_social_summaries(p_events uuid[]) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if auth.uid() is null then
  select coalesce(jsonb_object_agg(e.id,jsonb_build_object('count',(select count(*) from public.external_event_participants m join public.perfiles p on p.id=m.user_id where m.event_id=e.id and not coalesce(p.baneado,false)),'joined',false,'people','[]'::jsonb)),'{}'::jsonb) into result
   from public.external_events e where e.id=any(p_events[1:100]) and public.external_event_is_publishable(e) and public.event_provider_available(e.id);
  return result;
 end if;
 if not public.event_viewer_allowed() then return '{}'::jsonb; end if;
 with selected as (
  select e.id from public.external_events e where e.id=any(p_events[1:100]) and public.event_provider_available(e.id) and (public.external_event_is_publishable(e) or public.event_is_member(e.id))
 ), visible as (
  select m.* from public.external_event_participants m join selected e on e.id=m.event_id where public.event_users_visible(m.user_id)
 ), samples as (
  select v.*,row_number() over(partition by event_id order by joined_at,user_id) as position from visible v
 ), profiles as (
  select p.id,p.nombre,p.avatar_url from public.get_public_profiles(coalesce((select array_agg(distinct user_id) from samples where position<=3),'{}'::uuid[])) p
 )
 select coalesce(jsonb_object_agg(e.id,jsonb_build_object(
  'count',(select count(*) from visible v where v.event_id=e.id),
  'joined',exists(select 1 from visible v where v.event_id=e.id and v.user_id=auth.uid()),
  'people',coalesce((select jsonb_agg(jsonb_build_object('user_id',s.user_id,'joined_at',s.joined_at,'nombre',p.nombre,'avatar_url',p.avatar_url) order by s.joined_at,s.user_id) from samples s join profiles p on p.id=s.user_id where s.event_id=e.id and s.position<=3),'[]'::jsonb)
 )),'{}'::jsonb) into result from selected e;
 return result;
end;
$$;
revoke all on function public.get_event_social_summaries(uuid[]) from public;
grant execute on function public.get_event_social_summaries(uuid[]) to anon,authenticated,service_role;

create or replace function public.sync_external_events(p_provider text,p_items jsonb,p_raw_count integer) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.event_providers; n integer; item jsonb; x public.external_events; canonical uuid; matches integer; key text;
begin
 perform pg_advisory_xact_lock(hashtextextended('all-external-events',11));
 select * into cfg from public.event_providers where id=p_provider for update;
 if not found or not cfg.enabled or cfg.license_verified_at is null or cfg.format_verified_at is null then raise exception 'provider_not_verified'; end if;
 n:=jsonb_array_length(p_items);
 if n>20000 or p_raw_count<n or p_raw_count<0 or (p_raw_count=0 and cfg.last_raw_count>0) or (cfg.last_raw_count>20 and p_raw_count<cfg.last_raw_count*0.5) then raise exception 'suspicious_snapshot'; end if;
 if (select count(distinct v->>'source_id') from jsonb_array_elements(p_items) v)<>n then raise exception 'duplicate_source_ids'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  x:=jsonb_populate_record(null::public.external_events,item);
  key:=trim(regexp_replace(translate(lower(x.title),'áàäâéèëêíìïîóòöôúùüûñ','aaaaeeeeiiiioooouuuun'),'[^a-z0-9]+',' ','g'));
  select s.event_id into canonical from public.external_event_sources s where s.provider_id=p_provider and s.source_id=x.source_id;
  if canonical is null then
   select count(*),min(e.id::text)::uuid into matches,canonical from public.external_events e where e.title_key=key
    and e.starts_at between x.starts_at-interval '5 minutes' and x.starts_at+interval '5 minutes'
    and 6371000*2*asin(sqrt(least(1.0,power(sin(radians(e.latitude-x.latitude)/2),2)+cos(radians(e.latitude))*cos(radians(x.latitude))*power(sin(radians(e.longitude-x.longitude)/2),2))))<150;
   if matches<>1 then canonical:=null; end if;
  end if;
  if canonical is null then
   insert into public.external_events(provider_id,source_id,source_url,title,description,category,subcategory,start_date,end_date,starts_at,schedule,venue,address,latitude,longitude,price_text,status,social_eligible,location_verified,location_source)
    values(p_provider,x.source_id,x.source_url,x.title,x.description,x.category,coalesce(x.subcategory,'otro'),x.start_date,x.end_date,x.starts_at,x.schedule,x.venue,x.address,x.latitude,x.longitude,x.price_text,coalesce(x.status,'active'),coalesce(x.social_eligible,false),coalesce(x.location_verified,false),x.location_source) returning id into canonical;
  else
   update public.external_events e set provider_id=p_provider,source_id=x.source_id,source_url=x.source_url,title=x.title,description=x.description,category=x.category,subcategory=coalesce(x.subcategory,'otro'),start_date=x.start_date,end_date=x.end_date,starts_at=x.starts_at,schedule=x.schedule,venue=x.venue,address=x.address,latitude=x.latitude,longitude=x.longitude,price_text=x.price_text,status=coalesce(x.status,'active'),social_eligible=coalesce(x.social_eligible,false),location_verified=coalesce(x.location_verified,false),location_source=x.location_source,last_seen_at=now(),missing_runs=0
    where e.id=canonical and (e.provider_id=p_provider or not exists(select 1 from public.external_event_sources s join public.event_providers p on p.id=s.provider_id where s.event_id=e.id and s.provider_id=e.provider_id and s.status='active' and p.enabled and p.license_verified_at is not null and p.format_verified_at is not null));
  end if;
  insert into public.external_event_sources(provider_id,source_id,event_id,source_url,status) values(p_provider,x.source_id,canonical,x.source_url,coalesce(x.status,'active'))
   on conflict(provider_id,source_id) do update set event_id=excluded.event_id,source_url=excluded.source_url,status=excluded.status,last_seen_at=now(),missing_runs=0;
 end loop;
 update public.external_event_sources s set missing_runs=missing_runs+1,status=case when s.status='cancelled' then 'cancelled' when s.missing_runs>=1 then 'stale' else s.status end
  where s.provider_id=p_provider and not exists(select 1 from jsonb_array_elements(p_items) v where v->>'source_id'=s.source_id);
 -- A confirmed cancellation from any reviewed source wins over another
 -- publisher's cached active listing. A reinstatement must clear that alias.
 update public.external_events e set status=case
  when exists(select 1 from public.external_event_sources s join public.event_providers p on p.id=s.provider_id where s.event_id=e.id and s.status='cancelled' and p.enabled and p.license_verified_at is not null and p.format_verified_at is not null) then 'cancelled'
  when exists(select 1 from public.external_event_sources s join public.event_providers p on p.id=s.provider_id where s.event_id=e.id and s.status='stale' and s.missing_runs=0 and p.enabled and p.license_verified_at is not null and p.format_verified_at is not null) then 'stale'
  when exists(select 1 from public.external_event_sources s join public.event_providers p on p.id=s.provider_id where s.event_id=e.id and s.status='active' and p.enabled and p.license_verified_at is not null and p.format_verified_at is not null) then 'active'
  else 'stale' end
  where exists(select 1 from public.external_event_sources s where s.event_id=e.id);
 update public.external_events set status='expired' where end_date<(now() at time zone 'Europe/Madrid')::date and status='active';
 update public.event_providers set last_success_at=now(),last_raw_count=p_raw_count where id=p_provider;
 return n;
end;
$$;

create table public.external_venue_geocodes (
 key text primary key, result jsonb, expires_at timestamptz not null
);
alter table public.external_venue_geocodes enable row level security;
revoke all on public.external_venue_geocodes from public,anon,authenticated;
grant all on public.external_venue_geocodes to service_role;
create function public.get_event_geocodes(p_keys text[]) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_object_agg(key,result),'{}'::jsonb) from public.external_venue_geocodes where key=any(p_keys[1:200]) and expires_at>now();
$$;
create function public.cache_event_geocodes(p_items jsonb) returns void language sql security definer set search_path=public,pg_temp as $$
 insert into public.external_venue_geocodes(key,result,expires_at) select x->>'key',nullif(x->'result','null'::jsonb),now()+case when x->'result'='null'::jsonb then interval '6 hours' else interval '90 days' end from jsonb_array_elements(p_items) x
 on conflict(key) do update set result=excluded.result,expires_at=excluded.expires_at;
$$;
create table public.external_event_import_lease (id integer primary key check(id=1), token uuid not null, expires_at timestamptz not null);
alter table public.external_event_import_lease enable row level security;
revoke all on public.external_event_import_lease from public,anon,authenticated;
grant all on public.external_event_import_lease to service_role;
create function public.claim_event_import() returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid;
begin
 insert into public.external_event_import_lease values(1,gen_random_uuid(),now()+interval '3 minutes') on conflict(id) do update set token=excluded.token,expires_at=excluded.expires_at where external_event_import_lease.expires_at<now() returning token into result;
 return result;
end;
$$;
create function public.release_event_import(p_token uuid) returns void language sql security definer set search_path=public,pg_temp as $$
 delete from public.external_event_import_lease where token=p_token;
$$;
revoke all on function public.get_event_geocodes(text[]),public.cache_event_geocodes(jsonb),public.claim_event_import(),public.release_event_import(uuid) from public,anon,authenticated;
grant execute on function public.get_event_geocodes(text[]),public.cache_event_geocodes(jsonb),public.claim_event_import(),public.release_event_import(uuid) to service_role;

create function public.request_external_event_sync(p_provider text) returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare endpoint text; secret text; anon_key text;
begin
 if p_provider not in ('madrid','ticketmaster') or not exists(select 1 from public.event_providers where id=p_provider and enabled and license_verified_at is not null and format_verified_at is not null) then return null; end if;
 select decrypted_secret into endpoint from vault.decrypted_secrets where name='nexo_madrid_sync_url' limit 1;
 select decrypted_secret into secret from vault.decrypted_secrets where name='nexo_madrid_sync_secret' limit 1;
 select decrypted_secret into anon_key from vault.decrypted_secrets where name='nexo_madrid_anon_key' limit 1;
 if endpoint !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/sync-madrid-events$' or endpoint is null or nullif(secret,'') is null or anon_key is null then raise exception 'event_scheduler_configuration_missing'; end if;
 return net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||anon_key,'apikey',anon_key,'x-nexo-madrid-secret',secret),body:=jsonb_build_object('provider',p_provider),timeout_milliseconds:=60000);
end;
$$;
revoke all on function public.request_external_event_sync(text) from public,anon,authenticated;
grant execute on function public.request_external_event_sync(text) to service_role;
create or replace function public.request_madrid_event_sync() returns bigint language sql security definer set search_path=public,pg_temp as $$ select public.request_external_event_sync('madrid'); $$;
select cron.schedule('nexo-ticketmaster-events-daily','25 5 * * *',$job$select public.request_external_event_sync('ticketmaster');$job$);

commit;

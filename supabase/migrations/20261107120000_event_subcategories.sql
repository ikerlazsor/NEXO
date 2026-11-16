begin;

-- Subcategories reuse Nexo's existing plan taxonomy and bundled cover catalog.
-- "otro" is conservative for previously imported rows; re-sync updates them.
alter table public.external_events add column subcategory text not null default 'otro';
alter table public.external_events add constraint external_events_subcategory_check check (
    (category='DEPORTES' and subcategory in ('futbol','baloncesto','padel','running','otro'))
    or (category='VIBES' and subcategory in ('fiesta','compras','gaming','juegos_mesa','otro'))
    or (category='AIRE_LIBRE' and subcategory in ('senderismo','playa','mirador','picnic','otro'))
    or (category='FOODIES' and subcategory in ('cafe','comer','cenar','tapas','otro'))
    or (category='DESCUBRIR' and subcategory in ('museo','estudio','idiomas','viajes','otro'))
    or (category='SHOWTIME' and subcategory in ('cine','teatro','concierto','espectaculo','otro'))
);

create or replace function public.sync_external_events(p_provider text,p_items jsonb,p_raw_count integer) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.event_providers; n integer; today date := (now() at time zone 'Europe/Madrid')::date;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_provider,11));
  select * into cfg from public.event_providers where id=p_provider for update;
  if not found or not cfg.enabled or cfg.license_verified_at is null or cfg.format_verified_at is null then raise exception 'provider_not_verified'; end if;
  n := jsonb_array_length(p_items);
  if n<1 or n>20000 or p_raw_count<n or (cfg.last_raw_count>20 and p_raw_count<cfg.last_raw_count*0.5) then raise exception 'suspicious_snapshot'; end if;
  if (select count(distinct x->>'source_id') from jsonb_array_elements(p_items) x) <> n then raise exception 'duplicate_source_ids'; end if;
  insert into public.external_events(provider_id,source_id,source_url,title,description,category,subcategory,start_date,end_date,starts_at,schedule,venue,latitude,longitude,price_text,status)
    select p_provider,x.source_id,x.source_url,x.title,x.description,x.category,coalesce(x.subcategory,'otro'),x.start_date,x.end_date,x.starts_at,x.schedule,x.venue,x.latitude,x.longitude,x.price_text,x.status
    from jsonb_to_recordset(p_items) as x(source_id text,source_url text,title text,description text,category text,subcategory text,start_date date,end_date date,starts_at timestamptz,schedule text,venue text,latitude double precision,longitude double precision,price_text text,status text)
  on conflict(provider_id,source_id) do update set source_url=excluded.source_url,title=excluded.title,description=excluded.description,category=excluded.category,subcategory=excluded.subcategory,
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
commit;

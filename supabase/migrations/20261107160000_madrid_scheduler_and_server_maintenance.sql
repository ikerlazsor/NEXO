begin;

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- The scheduler stores an independent secret in Vault, never a service-role key.
-- An installed job does not enable the provider or approve a data source.
create or replace function public.request_madrid_event_sync()
returns bigint
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists(select 1 from public.event_providers where id = 'madrid'
    and enabled and license_verified_at is not null and format_verified_at is not null) then
    return null;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets
    where name = 'nexo_madrid_sync_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets
    where name = 'nexo_madrid_sync_secret' limit 1;
  if v_url is null or v_url !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/sync-madrid-events$'
    or nullif(v_secret, '') is null then
    raise exception 'Madrid scheduler configuration is missing';
  end if;
  return net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-nexo-madrid-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;
revoke all on function public.request_madrid_event_sync() from public, anon, authenticated;
grant execute on function public.request_madrid_event_sync() to service_role;

select cron.schedule('nexo-madrid-events-daily', '20 5 * * *',
  'select public.request_madrid_event_sync();');

-- Move global maintenance off mobile clients before revoking their access.
select cron.schedule('nexo-archive-ended-plans', '*/5 * * * *',
  'select public.archive_all_ended_plans();');
revoke all on function public.archive_all_ended_plans() from public, anon, authenticated;
grant execute on function public.archive_all_ended_plans() to service_role;

commit;

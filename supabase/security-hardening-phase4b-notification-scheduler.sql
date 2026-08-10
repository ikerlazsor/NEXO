-- NEXO notification hardening - phase 4B
-- Reemplaza la dependencia del Database Webhook del panel por un dispatcher
-- programado íntegramente en Supabase.
--
-- Requisitos previos:
-- 1. Haber ejecutado security-hardening-phase4-notification-outbox.sql.
-- 2. Haber guardado en Vault los secretos nexo_project_url y
--    nexo_service_role_key (consulta las instrucciones de despliegue de la PR).
-- 3. Haber desplegado dispatch-push-outbox.

begin;

create extension if not exists pg_net;
create extension if not exists pg_cron;

create or replace function public.get_due_push_outbox_event_ids(
    p_limit integer default 25
)
returns table (id uuid)
language sql
security definer
set search_path = public, pg_temp
as $$
    select o.id
      from public.push_notification_outbox o
     where o.available_at <= now()
       and o.attempts < 8
       and (
           o.status in ('pending', 'failed')
           or (
               o.status = 'processing'
               and o.processing_started_at < now() - interval '5 minutes'
           )
       )
     order by o.created_at asc
     limit least(greatest(coalesce(p_limit, 25), 1), 100);
$$;

revoke all on function public.get_due_push_outbox_event_ids(integer)
    from public, anon, authenticated;
grant execute on function public.get_due_push_outbox_event_ids(integer)
    to service_role;

create or replace function public.invoke_push_outbox_dispatcher()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_project_url text;
    v_service_role_key text;
begin
    select decrypted_secret
      into v_project_url
      from vault.decrypted_secrets
     where name = 'nexo_project_url'
     limit 1;

    select decrypted_secret
      into v_service_role_key
      from vault.decrypted_secrets
     where name = 'nexo_service_role_key'
     limit 1;

    if nullif(trim(v_project_url), '') is null
       or nullif(trim(v_service_role_key), '') is null then
        raise warning 'NEXO push dispatcher: faltan secretos en Vault';
        return;
    end if;

    perform net.http_post(
        url := rtrim(v_project_url, '/') || '/functions/v1/dispatch-push-outbox',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_service_role_key
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
    );
end;
$$;

revoke all on function public.invoke_push_outbox_dispatcher()
    from public, anon, authenticated;

do $$
declare
    v_job_id bigint;
begin
    for v_job_id in
        select jobid
          from cron.job
         where jobname = 'dispatch-push-outbox'
    loop
        perform cron.unschedule(v_job_id);
    end loop;
end;
$$;

select cron.schedule(
    'dispatch-push-outbox',
    '* * * * *',
    'select public.invoke_push_outbox_dispatcher();'
);

commit;

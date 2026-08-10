-- NEXO security hardening - phase 3
-- Ejecutar completo una sola vez en Supabase SQL Editor antes de desplegar send-push.

begin;

-- Cuota atómica para impedir que una cuenta autenticada abuse de la función
-- de notificaciones. La tabla no es accesible desde la app.
create table if not exists public.push_dispatch_usage (
    user_id uuid primary key references auth.users(id) on delete cascade,
    window_started_at timestamptz not null default now(),
    request_count integer not null default 0 check (request_count >= 0),
    updated_at timestamptz not null default now()
);

alter table public.push_dispatch_usage enable row level security;
revoke all on table public.push_dispatch_usage from public, anon, authenticated;

create or replace function public.consume_push_dispatch_quota(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    accepted boolean := false;
begin
    if p_user_id is null then
        return false;
    end if;

    insert into public.push_dispatch_usage (
        user_id,
        window_started_at,
        request_count,
        updated_at
    )
    values (p_user_id, now(), 1, now())
    on conflict (user_id) do update
    set
        window_started_at = case
            when push_dispatch_usage.window_started_at <= now() - interval '1 minute'
                then now()
            else push_dispatch_usage.window_started_at
        end,
        request_count = case
            when push_dispatch_usage.window_started_at <= now() - interval '1 minute'
                then 1
            else push_dispatch_usage.request_count + 1
        end,
        updated_at = now()
    where
        push_dispatch_usage.window_started_at <= now() - interval '1 minute'
        or push_dispatch_usage.request_count < 120
    returning true into accepted;

    return coalesce(accepted, false);
end;
$$;

revoke all on function public.consume_push_dispatch_quota(uuid) from public, anon, authenticated;
grant execute on function public.consume_push_dispatch_quota(uuid) to service_role;

-- Un mismo mensaje solo puede generar una notificación push una vez, incluso
-- si el cliente reintenta la petición o alguien intenta repetirla manualmente.
create table if not exists public.push_message_dispatches (
    message_id text primary key,
    sender_id uuid not null references auth.users(id) on delete cascade,
    dispatched_at timestamptz not null default now()
);

create index if not exists push_message_dispatches_sender_idx
    on public.push_message_dispatches (sender_id, dispatched_at desc);

alter table public.push_message_dispatches enable row level security;
revoke all on table public.push_message_dispatches from public, anon, authenticated;

create or replace function public.claim_push_message(
    p_message_id text,
    p_sender_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    inserted_count integer := 0;
begin
    if nullif(trim(p_message_id), '') is null or p_sender_id is null then
        return false;
    end if;

    delete from public.push_message_dispatches
    where sender_id = p_sender_id
      and dispatched_at < now() - interval '30 days';

    insert into public.push_message_dispatches (message_id, sender_id)
    values (p_message_id, p_sender_id)
    on conflict (message_id) do nothing;

    get diagnostics inserted_count = row_count;
    return inserted_count = 1;
end;
$$;

revoke all on function public.claim_push_message(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_push_message(text, uuid) to service_role;

commit;

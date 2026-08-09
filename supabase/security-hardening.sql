-- NEXO security hardening
-- Ejecutar completo una sola vez en Supabase SQL Editor.

begin;

create table if not exists public.ai_search_usage (
    user_id uuid primary key references auth.users(id) on delete cascade,
    window_started_at timestamptz not null default now(),
    request_count integer not null default 0 check (request_count >= 0),
    updated_at timestamptz not null default now()
);

alter table public.ai_search_usage enable row level security;
revoke all on table public.ai_search_usage from public, anon, authenticated;

create or replace function public.consume_ai_search_quota()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    caller_id uuid := auth.uid();
    accepted boolean := false;
begin
    if caller_id is null then
        return false;
    end if;

    insert into public.ai_search_usage (
        user_id,
        window_started_at,
        request_count,
        updated_at
    )
    values (caller_id, now(), 1, now())
    on conflict (user_id) do update
    set
        window_started_at = case
            when ai_search_usage.window_started_at <= now() - interval '1 hour'
                then now()
            else ai_search_usage.window_started_at
        end,
        request_count = case
            when ai_search_usage.window_started_at <= now() - interval '1 hour'
                then 1
            else ai_search_usage.request_count + 1
        end,
        updated_at = now()
    where
        ai_search_usage.window_started_at <= now() - interval '1 hour'
        or ai_search_usage.request_count < 30
    returning true into accepted;

    return coalesce(accepted, false);
end;
$$;

revoke all on function public.consume_ai_search_quota() from public, anon;
grant execute on function public.consume_ai_search_quota() to authenticated;

-- Impide que cualquier cliente convierta un nombre de usuario en un email.
do $$
declare
    fn regprocedure;
begin
    for fn in
        select p.oid::regprocedure
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'get_login_email_by_username'
    loop
        execute format('revoke all on function %s from public, anon, authenticated', fn);
    end loop;
end
$$;

-- El contenido deja de servirse mediante URL pública.
update storage.buckets
set public = false
where id = 'chat-files';

commit;

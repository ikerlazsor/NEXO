-- Embudo de producto (owner/admin leen; cualquiera autenticado inserta los suyos)
create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  user_id uuid null references auth.users(id) on delete set null,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_created_idx on public.analytics_events (created_at desc);
create index if not exists analytics_events_name_idx on public.analytics_events (event_name);

alter table public.analytics_events enable row level security;

drop policy if exists analytics_insert_own on public.analytics_events;
create policy analytics_insert_own on public.analytics_events
  for insert to authenticated
  with check (user_id is null or user_id = auth.uid());

drop policy if exists analytics_select_staff on public.analytics_events;
create policy analytics_select_staff on public.analytics_events
  for select to authenticated
  using (
    exists (
      select 1 from public.perfiles p
      where p.id = auth.uid()
        and p.rol in ('owner', 'admin')
        and coalesce(p.baneado, false) = false
    )
  );

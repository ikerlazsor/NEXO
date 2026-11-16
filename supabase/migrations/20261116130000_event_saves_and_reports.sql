-- Guardar y reportar eventos de la agenda (external_events), igual que los planes.
-- Aditiva: dos tablas nuevas y tres RPC. No toca tablas existentes.

create table if not exists public.external_event_saves (
  user_id uuid not null references public.perfiles(id) on delete cascade,
  event_id uuid not null references public.external_events(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);
alter table public.external_event_saves enable row level security;
drop policy if exists event_save_read on public.external_event_saves;
create policy event_save_read on public.external_event_saves
  for select to authenticated using (user_id = auth.uid());
-- Escritura solo vía set_event_saved.
revoke all on public.external_event_saves from anon, authenticated;
grant select on public.external_event_saves to authenticated;

-- Reportes del evento en sí (external_event_reports es para mensajes del chat).
create table if not exists public.external_event_flags (
  event_id uuid not null references public.external_events(id) on delete cascade,
  reporter_id uuid not null references public.perfiles(id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 60),
  details text check (details is null or char_length(details) <= 1000),
  created_at timestamptz not null default now(),
  primary key (event_id, reporter_id)
);
alter table public.external_event_flags enable row level security;
-- Sin políticas: solo service role (moderación) lee; se escribe vía RPC.
revoke all on public.external_event_flags from anon, authenticated;

create or replace function public.set_event_saved(p_event uuid, p_save boolean)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.event_viewer_allowed() then
    raise exception 'account_required' using errcode = '42501';
  end if;
  if p_save then
    if not exists (select 1 from public.get_external_event(p_event)) then
      raise exception 'event_not_found';
    end if;
    insert into public.external_event_saves(user_id, event_id)
      values (auth.uid(), p_event) on conflict do nothing;
  else
    delete from public.external_event_saves where user_id = auth.uid() and event_id = p_event;
  end if;
end;
$$;

create or replace function public.get_saved_events()
returns setof public.external_events
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select e.*
  from public.external_event_saves s
  join public.external_events e on e.id = s.event_id
  where s.user_id = auth.uid()
    and public.event_viewer_allowed()
    and public.event_provider_available(e.id)
    and e.status = 'active'
    and coalesce(e.starts_at, (e.end_date + 1)::timestamptz) > now()
  order by coalesce(e.starts_at, e.start_date::timestamptz), e.id
  limit 100;
$$;

create or replace function public.report_external_event(p_event uuid, p_reason text, p_details text default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.event_viewer_allowed() then
    raise exception 'account_required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.external_events where id = p_event) then
    raise exception 'event_not_found';
  end if;
  insert into public.external_event_flags(event_id, reporter_id, reason, details)
    values (p_event, auth.uid(), left(trim(p_reason), 60), nullif(left(trim(coalesce(p_details, '')), 1000), ''))
  on conflict (event_id, reporter_id) do update
    set reason = excluded.reason, details = excluded.details, created_at = now();
end;
$$;

revoke all on function public.set_event_saved(uuid, boolean) from public, anon;
revoke all on function public.get_saved_events() from public, anon;
revoke all on function public.report_external_event(uuid, text, text) from public, anon;
grant execute on function public.set_event_saved(uuid, boolean) to authenticated;
grant execute on function public.get_saved_events() to authenticated;
grant execute on function public.report_external_event(uuid, text, text) to authenticated;

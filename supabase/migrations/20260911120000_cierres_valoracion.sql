-- Cierre de valoración en servidor: sobrevive a logout / cambio de dispositivo.
create table if not exists public.cierres_valoracion (
  usuario_id uuid not null references public.perfiles(id) on delete cascade,
  plan_id uuid not null references public.planes(id) on delete cascade,
  skipped boolean not null default false,
  cerrado_en timestamptz not null default now(),
  primary key (usuario_id, plan_id)
);

create index if not exists idx_cierres_valoracion_usuario
  on public.cierres_valoracion (usuario_id);

alter table public.cierres_valoracion enable row level security;

drop policy if exists "cierres_select_own" on public.cierres_valoracion;
create policy "cierres_select_own" on public.cierres_valoracion
  for select to authenticated
  using (usuario_id = auth.uid());

drop policy if exists "cierres_insert_own" on public.cierres_valoracion;
create policy "cierres_insert_own" on public.cierres_valoracion
  for insert to authenticated
  with check (usuario_id = auth.uid());

drop policy if exists "cierres_update_own" on public.cierres_valoracion;
create policy "cierres_update_own" on public.cierres_valoracion
  for update to authenticated
  using (usuario_id = auth.uid())
  with check (usuario_id = auth.uid());

drop policy if exists "cierres_delete_own" on public.cierres_valoracion;
create policy "cierres_delete_own" on public.cierres_valoracion
  for delete to authenticated
  using (usuario_id = auth.uid());

grant select, insert, update, delete on table public.cierres_valoracion to authenticated;
grant all on table public.cierres_valoracion to service_role;

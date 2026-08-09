-- Push tokens + preferencia de notificaciones + mutes + categorías
-- Ejecutar en el SQL Editor de Supabase.

create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null,
  platform text,
  updated_at timestamptz not null default now(),
  unique (user_id, token)
);

create index if not exists push_tokens_user_id_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

drop policy if exists "push_tokens_select_own" on public.push_tokens;
create policy "push_tokens_select_own"
  on public.push_tokens for select
  using (auth.uid() = user_id);

drop policy if exists "push_tokens_insert_own" on public.push_tokens;
create policy "push_tokens_insert_own"
  on public.push_tokens for insert
  with check (auth.uid() = user_id);

drop policy if exists "push_tokens_update_own" on public.push_tokens;
create policy "push_tokens_update_own"
  on public.push_tokens for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "push_tokens_delete_own" on public.push_tokens;
create policy "push_tokens_delete_own"
  on public.push_tokens for delete
  using (auth.uid() = user_id);

-- Preferencia global (Ajustes → Notificaciones)
alter table public.perfiles
  add column if not exists notificaciones_push boolean not null default true;

alter table public.perfiles
  add column if not exists notif_messages boolean not null default true;

alter table public.perfiles
  add column if not exists notif_social boolean not null default true;

alter table public.perfiles
  add column if not exists notif_reminders boolean not null default true;

comment on column public.perfiles.notificaciones_push is
  'Si false, no se envían push a este usuario (el cliente también deja de registrar token).';

comment on column public.perfiles.notif_messages is
  'Chats de plan y DMs.';

comment on column public.perfiles.notif_social is
  'Amistades, uniones, invitaciones, valoraciones recibidas.';

comment on column public.perfiles.notif_reminders is
  'Recordatorios locales (cliente). Columna reservada / coherencia de prefs.';

-- Silenciar notificaciones de un chat de plan (funciona con la app cerrada)
create table if not exists public.push_chat_mutes (
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id uuid not null references public.planes (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, plan_id)
);

create index if not exists push_chat_mutes_plan_id_idx on public.push_chat_mutes (plan_id);

alter table public.push_chat_mutes enable row level security;

drop policy if exists "push_chat_mutes_select_own" on public.push_chat_mutes;
create policy "push_chat_mutes_select_own"
  on public.push_chat_mutes for select
  using (auth.uid() = user_id);

drop policy if exists "push_chat_mutes_insert_own" on public.push_chat_mutes;
create policy "push_chat_mutes_insert_own"
  on public.push_chat_mutes for insert
  with check (auth.uid() = user_id);

drop policy if exists "push_chat_mutes_delete_own" on public.push_chat_mutes;
create policy "push_chat_mutes_delete_own"
  on public.push_chat_mutes for delete
  using (auth.uid() = user_id);

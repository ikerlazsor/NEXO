-- Moderación de planes en servidor.
-- 1) Suelo inequívoco en la base de datos: siempre activo, sin servicios externos.
-- 2) Tras guardar, pg_net avisa a la función moderate-plan (OpenAI omni-moderation,
--    gratuita), que deja el veredicto en moderacion_planes y, si hace falta,
--    manda el plan a la cola del admin o lo retira.
begin;

create extension if not exists pg_net;

create table if not exists public.moderacion_planes (
  plan_id uuid primary key references public.planes(id) on delete cascade,
  content_hash text,
  veredicto text not null check (veredicto in ('ok', 'review', 'block', 'error')),
  motivo text,
  puntuaciones jsonb,
  revisado_en timestamptz not null default now()
);
alter table public.moderacion_planes enable row level security;
revoke all on public.moderacion_planes from anon, authenticated;

-- Solo lo que nunca es legítimo en un plan (insultos de odio y abuso sexual).
-- Corto a propósito: lo dudoso lo decide el modelo, no una lista.
create or replace function public.plan_text_is_blocked(p text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    translate(lower(p), 'áéíóúàèìòùäëïöüâêîôûñ013457@$', 'aeiouaeiouaeiouaeiounoieastas')
      ~ ('\m('
        || 'nigg(er|a)s?|negrat[ao]s?|sudacas?|panchit[oa]s|'
        || 'pedofil\w*|pa?edophil\w*|zoofil\w*|'
        || 'porno(grafia)?\s+infantil|child\s+porn\w*|sexo\s+con\s+(menores|nin[oa]s)|'
        || 'heil\s+hitler|sieg\s+heil'
        || ')\M'),
    false);
$$;

create or replace function public.enforce_plan_text_floor()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Importaciones y procesos de servidor (sin usuario) no pasan por aquí.
  if auth.uid() is null then
    return new;
  end if;
  if public.plan_text_is_blocked(new.titulo) or public.plan_text_is_blocked(new.descripcion) then
    raise exception 'content_blocked' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_plan_text_floor on public.planes;
create trigger trg_plan_text_floor
  before insert or update of titulo, descripcion on public.planes
  for each row
  execute function public.enforce_plan_text_floor();

create or replace function public.request_plan_moderation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret text;
begin
  if auth.uid() is null or coalesce(new.is_direct_chat, false) or coalesce(new.is_group_chat, false) then
    return new;
  end if;
  begin
    select decrypted_secret into v_secret from vault.decrypted_secrets
      where name = 'nexo_moderation_secret' limit 1;
    if v_secret is null then
      return new;
    end if;
    perform net.http_post(
      url := 'https://nixeproyzxvqzyrvsxcx.supabase.co/functions/v1/moderate-plan',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-nexo-moderation-secret', v_secret
      ),
      body := jsonb_build_object('plan_id', new.id),
      timeout_milliseconds := 20000
    );
  exception when others then
    -- Nunca bloquear una publicación porque falle el aviso.
    raise warning 'request_plan_moderation: %', sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.request_plan_moderation() from public, anon, authenticated;

drop trigger if exists trg_plan_moderation_insert on public.planes;
create trigger trg_plan_moderation_insert
  after insert on public.planes
  for each row
  execute function public.request_plan_moderation();

drop trigger if exists trg_plan_moderation_update on public.planes;
create trigger trg_plan_moderation_update
  after update of titulo, descripcion, imagen_url, imagenes_url on public.planes
  for each row
  when (
    old.titulo is distinct from new.titulo
    or old.descripcion is distinct from new.descripcion
    or old.imagen_url is distinct from new.imagen_url
    or old.imagenes_url is distinct from new.imagenes_url
  )
  execute function public.request_plan_moderation();

commit;

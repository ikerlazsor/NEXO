-- Alineación de fútbol: formato + nombres/colores de equipo + slots.

begin;

alter table public.planes
    add column if not exists alineacion jsonb;

alter table public.planes
    drop constraint if exists planes_futbol_formato_check;

create table if not exists public.alineaciones (
    id uuid primary key default gen_random_uuid(),
    plan_id uuid not null references public.planes(id) on delete cascade,
    equipo smallint not null check (equipo in (0, 1)),
    posicion smallint not null check (posicion >= 0 and posicion < 11),
    usuario_id uuid not null references public.perfiles(id) on delete cascade,
    created_at timestamptz not null default now(),
    constraint alineaciones_slot_unico unique (plan_id, equipo, posicion),
    constraint alineaciones_usuario_unico unique (plan_id, usuario_id)
);

create index if not exists idx_alineaciones_plan on public.alineaciones (plan_id);

alter table public.alineaciones enable row level security;

drop policy if exists "alineaciones_select" on public.alineaciones;
drop policy if exists "alineaciones_insert_own" on public.alineaciones;
drop policy if exists "alineaciones_delete_own" on public.alineaciones;
drop policy if exists alineaciones_select on public.alineaciones;
drop policy if exists alineaciones_insert_own on public.alineaciones;
drop policy if exists alineaciones_delete_own on public.alineaciones;

create policy alineaciones_select
on public.alineaciones
for select
to authenticated, anon
using (true);

create or replace function public.set_plan_alineacion(p_plan_id uuid, p_alineacion jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_fmt text;
    v_n integer;
    v_max integer;
begin
    if auth.uid() is null then
        raise exception 'not_authenticated';
    end if;
    select maximo_participantes into v_max
    from public.planes
    where id = p_plan_id and creador_id = auth.uid();
    if v_max is null then
        raise exception 'not_creator';
    end if;

    v_fmt := p_alineacion->>'formato';
    if v_fmt not in ('5v5', '6v6', '7v7', '8v8', '9v9', '10v10', '11v11') then
        raise exception 'bad_format';
    end if;
    v_n := split_part(v_fmt, 'v', 1)::integer;
    if v_max < v_n * 2 then
        raise exception 'format_too_big';
    end if;

    update public.planes
    set alineacion = p_alineacion, actualizado_en = now()
    where id = p_plan_id;

    delete from public.alineaciones
    where plan_id = p_plan_id
      and posicion >= v_n;
end;
$$;

create or replace function public.claim_alineacion_slot(
    p_plan_id uuid,
    p_equipo smallint,
    p_posicion smallint
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_fmt text;
    v_n integer;
    v_uid uuid := auth.uid();
begin
    if v_uid is null then
        raise exception 'not_authenticated';
    end if;
    if exists (
        select 1 from public.perfiles pe
        where pe.id = v_uid and pe.es_organizador is true
    ) then
        raise exception 'organizer_cannot_join';
    end if;
    if p_equipo not in (0, 1) or p_posicion < 0 then
        raise exception 'bad_slot';
    end if;

    select alineacion->>'formato' into v_fmt
    from public.planes
    where id = p_plan_id;
    if v_fmt is null then
        raise exception 'no_lineup';
    end if;
    v_n := split_part(v_fmt, 'v', 1)::integer;
    if p_posicion >= v_n then
        raise exception 'bad_slot';
    end if;

    if not exists (
        select 1 from public.planes pl
        where pl.id = p_plan_id and pl.creador_id = v_uid
    ) and not exists (
        select 1 from public.participantes pa
        where pa.plan_id = p_plan_id
          and pa.usuario_id = v_uid
          and pa.estado = 'aceptado'
    ) then
        raise exception 'not_member';
    end if;

    delete from public.alineaciones
    where plan_id = p_plan_id and usuario_id = v_uid;

    insert into public.alineaciones (plan_id, equipo, posicion, usuario_id)
    values (p_plan_id, p_equipo, p_posicion, v_uid);
end;
$$;

create or replace function public.release_alineacion_slot(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if auth.uid() is null then
        raise exception 'not_authenticated';
    end if;
    delete from public.alineaciones
    where plan_id = p_plan_id and usuario_id = auth.uid();
end;
$$;

create or replace function public.alineacion_on_participant_leave()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if tg_op = 'DELETE' or new.estado is distinct from 'aceptado' then
        delete from public.alineaciones
        where plan_id = coalesce(old.plan_id, new.plan_id)
          and usuario_id = coalesce(old.usuario_id, new.usuario_id);
    end if;
    return coalesce(new, old);
end;
$$;

drop trigger if exists trg_alineacion_on_leave on public.participantes;
create trigger trg_alineacion_on_leave
after delete or update of estado on public.participantes
for each row execute function public.alineacion_on_participant_leave();

revoke all on function public.set_plan_alineacion(uuid, jsonb) from public;
grant execute on function public.set_plan_alineacion(uuid, jsonb) to authenticated, service_role;

revoke all on function public.claim_alineacion_slot(uuid, smallint, smallint) from public;
grant execute on function public.claim_alineacion_slot(uuid, smallint, smallint) to authenticated, service_role;

revoke all on function public.release_alineacion_slot(uuid) from public;
grant execute on function public.release_alineacion_slot(uuid) to authenticated, service_role;

do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'alineaciones'
    ) then
        alter publication supabase_realtime add table public.alineaciones;
    end if;
end $$;

notify pgrst, 'reload schema';

commit;

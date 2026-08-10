-- NEXO notification hardening - phase 4
-- Ejecutar completo en Supabase SQL Editor antes de desplegar las funciones Edge.
--
-- Esta migración:
-- 1. genera en PostgreSQL los eventos de aceptación/rechazo de solicitudes;
-- 2. impide que el cliente invente destinatarios o resultados;
-- 3. usa leases recuperables para reintentar entregas fallidas;
-- 4. registra la aceptación de Expo por mensaje y dispositivo.

begin;

create extension if not exists pgcrypto;

create table if not exists public.push_notification_outbox (
    id uuid primary key default gen_random_uuid(),
    event_key text not null unique,
    event_type text not null check (
        event_type in ('plan_join_accepted', 'plan_join_rejected')
    ),
    recipient_id uuid not null references auth.users(id) on delete cascade,
    actor_id uuid not null references auth.users(id) on delete cascade,
    plan_id uuid not null,
    plan_title text not null,
    status text not null default 'pending' check (
        status in ('pending', 'processing', 'sent', 'failed')
    ),
    attempts integer not null default 0 check (attempts >= 0),
    available_at timestamptz not null default now(),
    processing_started_at timestamptz,
    sent_at timestamptz,
    expo_ticket_ids jsonb,
    last_error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists push_notification_outbox_pending_idx
    on public.push_notification_outbox (status, available_at, created_at);

alter table public.push_notification_outbox enable row level security;
revoke all on table public.push_notification_outbox from public, anon, authenticated;

create or replace function public.queue_plan_join_decision_push()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_actor_id uuid := auth.uid();
    v_creator_id uuid;
    v_plan_title text;
    v_event_type text;
    v_recipient_id uuid;
    v_participant_id text;
begin
    if old.estado is distinct from 'pendiente' then
        if tg_op = 'DELETE' then
            return old;
        end if;
        return new;
    end if;

    select p.creador_id, coalesce(nullif(trim(p.titulo), ''), 'el plan')
      into v_creator_id, v_plan_title
      from public.planes p
     where p.id = old.plan_id;

    -- Solo una decisión realizada por el creador puede generar este evento.
    if v_actor_id is null or v_creator_id is null or v_actor_id <> v_creator_id then
        if tg_op = 'DELETE' then
            return old;
        end if;
        return new;
    end if;

    if tg_op = 'DELETE' then
        v_event_type := 'plan_join_rejected';
    elsif new.estado = 'aceptado' then
        v_event_type := 'plan_join_accepted';
    elsif new.estado = 'rechazado' then
        v_event_type := 'plan_join_rejected';
    else
        return new;
    end if;

    v_recipient_id := old.usuario_id;
    v_participant_id := old.id::text;

    insert into public.push_notification_outbox (
        event_key,
        event_type,
        recipient_id,
        actor_id,
        plan_id,
        plan_title
    )
    values (
        'plan-join:' || v_participant_id || ':' || v_event_type,
        v_event_type,
        v_recipient_id,
        v_actor_id,
        old.plan_id,
        v_plan_title
    )
    on conflict (event_key) do nothing;

    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

revoke all on function public.queue_plan_join_decision_push() from public, anon, authenticated;

drop trigger if exists queue_plan_join_decision_push_update on public.participantes;
create trigger queue_plan_join_decision_push_update
after update of estado on public.participantes
for each row
when (old.estado is distinct from new.estado)
execute function public.queue_plan_join_decision_push();

drop trigger if exists queue_plan_join_decision_push_delete on public.participantes;
create trigger queue_plan_join_decision_push_delete
after delete on public.participantes
for each row
execute function public.queue_plan_join_decision_push();

create or replace function public.claim_push_outbox_event(p_event_id uuid)
returns public.push_notification_outbox
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    claimed public.push_notification_outbox;
begin
    update public.push_notification_outbox
       set status = 'processing',
           attempts = attempts + 1,
           processing_started_at = now(),
           updated_at = now(),
           last_error = null
     where id = p_event_id
       and available_at <= now()
       and (
           status in ('pending', 'failed')
           or (
               status = 'processing'
               and processing_started_at < now() - interval '5 minutes'
           )
       )
       and attempts < 8
    returning * into claimed;

    return claimed;
end;
$$;

revoke all on function public.claim_push_outbox_event(uuid) from public, anon, authenticated;
grant execute on function public.claim_push_outbox_event(uuid) to service_role;

create or replace function public.complete_push_outbox_event(
    p_event_id uuid,
    p_succeeded boolean,
    p_ticket_ids jsonb default null,
    p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    update public.push_notification_outbox
       set status = case when p_succeeded then 'sent' else 'failed' end,
           sent_at = case when p_succeeded then now() else null end,
           expo_ticket_ids = case when p_succeeded then p_ticket_ids else expo_ticket_ids end,
           last_error = case
               when p_succeeded then null
               else left(coalesce(p_error, 'expo_delivery_failed'), 500)
           end,
           available_at = case
               when p_succeeded then available_at
               else now() + make_interval(secs => least(900, (30 * power(2, greatest(attempts - 1, 0)))::integer))
           end,
           processing_started_at = null,
           updated_at = now()
     where id = p_event_id
       and status = 'processing';
end;
$$;

revoke all on function public.complete_push_outbox_event(uuid, boolean, jsonb, text)
    from public, anon, authenticated;
grant execute on function public.complete_push_outbox_event(uuid, boolean, jsonb, text)
    to service_role;

create table if not exists public.push_message_deliveries (
    message_id text not null,
    sender_id uuid not null references auth.users(id) on delete cascade,
    push_token text not null,
    status text not null default 'processing' check (
        status in ('processing', 'accepted', 'failed')
    ),
    attempts integer not null default 1 check (attempts >= 1),
    processing_started_at timestamptz,
    accepted_at timestamptz,
    expo_ticket_id text,
    last_error text,
    updated_at timestamptz not null default now(),
    primary key (message_id, push_token)
);

create index if not exists push_message_deliveries_sender_idx
    on public.push_message_deliveries (sender_id, updated_at desc);

alter table public.push_message_deliveries enable row level security;
revoke all on table public.push_message_deliveries from public, anon, authenticated;

create or replace function public.claim_push_message_delivery(
    p_message_id text,
    p_sender_id uuid,
    p_push_token text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    claimed boolean := false;
begin
    if nullif(trim(p_message_id), '') is null
       or p_sender_id is null
       or nullif(trim(p_push_token), '') is null then
        return false;
    end if;

    insert into public.push_message_deliveries (
        message_id,
        sender_id,
        push_token,
        status,
        attempts,
        processing_started_at,
        updated_at
    )
    values (
        p_message_id,
        p_sender_id,
        p_push_token,
        'processing',
        1,
        now(),
        now()
    )
    on conflict (message_id, push_token) do update
       set status = 'processing',
           attempts = push_message_deliveries.attempts + 1,
           processing_started_at = now(),
           last_error = null,
           updated_at = now()
     where push_message_deliveries.sender_id = excluded.sender_id
       and push_message_deliveries.attempts < 8
       and (
           push_message_deliveries.status = 'failed'
           or (
               push_message_deliveries.status = 'processing'
               and push_message_deliveries.processing_started_at < now() - interval '5 minutes'
           )
       )
    returning true into claimed;

    return coalesce(claimed, false);
end;
$$;

revoke all on function public.claim_push_message_delivery(text, uuid, text)
    from public, anon, authenticated;
grant execute on function public.claim_push_message_delivery(text, uuid, text)
    to service_role;

create or replace function public.complete_push_message_delivery(
    p_message_id text,
    p_sender_id uuid,
    p_push_token text,
    p_succeeded boolean,
    p_ticket_id text default null,
    p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    update public.push_message_deliveries
       set status = case when p_succeeded then 'accepted' else 'failed' end,
           accepted_at = case when p_succeeded then now() else null end,
           expo_ticket_id = case when p_succeeded then p_ticket_id else expo_ticket_id end,
           last_error = case
               when p_succeeded then null
               else left(coalesce(p_error, 'expo_delivery_failed'), 500)
           end,
           processing_started_at = null,
           updated_at = now()
     where message_id = p_message_id
       and sender_id = p_sender_id
       and push_token = p_push_token
       and status = 'processing';
end;
$$;

revoke all on function public.complete_push_message_delivery(text, uuid, text, boolean, text, text)
    from public, anon, authenticated;
grant execute on function public.complete_push_message_delivery(text, uuid, text, boolean, text, text)
    to service_role;

commit;

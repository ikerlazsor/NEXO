-- Idioma del destinatario para push remotas.
-- Deja de encolar notificaciones cuando se rechaza una solicitud de unirse.

alter table public.perfiles
  add column if not exists idioma text not null default 'es';

alter table public.perfiles
  drop constraint if exists perfiles_idioma_check;

alter table public.perfiles
  add constraint perfiles_idioma_check check (idioma in ('es', 'en'));

comment on column public.perfiles.idioma is
  'Idioma de la app (es/en). Las notificaciones push remotas se redactan en este idioma.';

create or replace function public.queue_plan_join_decision_push()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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

    if v_actor_id is null or v_creator_id is null or v_actor_id <> v_creator_id then
        if tg_op = 'DELETE' then
            return old;
        end if;
        return new;
    end if;

    -- Solo avisar cuando te aceptan. Rechazar es silencioso a propósito.
    if tg_op = 'DELETE' then
        return old;
    elsif new.estado = 'aceptado' then
        v_event_type := 'plan_join_accepted';
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

    return new;
end;
$function$;

update public.push_notification_outbox
   set status = 'sent',
       last_error = 'disabled_rejected',
       updated_at = now()
 where event_type = 'plan_join_rejected'
   and status in ('pending', 'processing');

-- Avisos en chat cuando alguien entra como aceptado (plan o grupo creado).
-- No aplica a chats 1:1. El creador del plan/grupo no genera aviso al crearlo.

create or replace function public.notify_chat_member_joined()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_is_direct boolean;
    v_is_group boolean;
    v_creador uuid;
    v_kind text;
begin
    if tg_op = 'UPDATE' then
        if old.estado is not distinct from 'aceptado' then
            return new;
        end if;
    end if;

    if new.estado is distinct from 'aceptado' then
        return new;
    end if;

    select
        coalesce(pl.is_direct_chat, false),
        coalesce(pl.is_group_chat, false),
        pl.creador_id
    into v_is_direct, v_is_group, v_creador
    from public.planes pl
    where pl.id = new.plan_id;

    if not found then
        return new;
    end if;

    -- Solo chats de plan o de grupo; nunca 1:1
    if v_is_direct then
        return new;
    end if;

    -- El creador no “se une”: ya está al crear el plan/grupo
    if v_creador is not null and new.usuario_id = v_creador then
        return new;
    end if;

    if v_is_group then
        v_kind := 'join_group';
    else
        v_kind := 'join_plan';
    end if;

    insert into public.mensajes (plan_id, emisor_id, contenido, tipo)
    values (
        new.plan_id,
        new.usuario_id,
        '@@nexo_system:' || v_kind,
        'texto'
    );

    return new;
end;
$$;

drop trigger if exists trg_notify_chat_member_joined on public.participantes;
create trigger trg_notify_chat_member_joined
    after insert or update of estado on public.participantes
    for each row
    execute function public.notify_chat_member_joined();

revoke all on function public.notify_chat_member_joined() from public;
revoke all on function public.notify_chat_member_joined() from anon, authenticated;

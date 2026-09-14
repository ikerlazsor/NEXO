begin;

-- Los chats de grupo (categoria Grupo/Chat o is_group_chat) no deben
-- consumir el límite de planes activos del feed.

create or replace function public.count_user_active_plans(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
    select
        (
            select count(*)::int
            from public.planes
            where creador_id = p_user_id
              and coalesce(is_group_chat, false) = false
              and coalesce(is_direct_chat, false) = false
              and coalesce(categoria, '') not in ('Grupo', 'Chat')
              and (fecha_evento is null or fecha_evento >= now())
        )
        +
        (
            select count(*)::int
            from public.participantes p
            join public.planes pl on pl.id = p.plan_id
            where p.usuario_id = p_user_id
              and p.estado = 'aceptado'
              and pl.creador_id is distinct from p_user_id
              and coalesce(pl.is_group_chat, false) = false
              and coalesce(pl.is_direct_chat, false) = false
              and coalesce(pl.categoria, '') not in ('Grupo', 'Chat')
              and (pl.fecha_evento is null or pl.fecha_evento >= now())
        );
$$;

create or replace function public.enforce_active_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_max int := 3;
    v_is_creator boolean;
    v_is_chat boolean;
    v_count int;
begin
    if new.estado is distinct from 'aceptado' then
        return new;
    end if;

    if tg_op = 'UPDATE' and old.estado is not distinct from 'aceptado' then
        return new;
    end if;

    select
        (pl.creador_id = new.usuario_id),
        (
            coalesce(pl.is_group_chat, false)
            or coalesce(pl.is_direct_chat, false)
            or coalesce(pl.categoria, '') in ('Grupo', 'Chat')
        )
    into v_is_creator, v_is_chat
    from public.planes pl
    where pl.id = new.plan_id;

    if coalesce(v_is_creator, false) or coalesce(v_is_chat, false) then
        return new;
    end if;

    v_count := public.count_user_active_plans(new.usuario_id);
    if v_count >= v_max then
        raise exception 'active_plan_limit_reached'
            using errcode = 'P0001',
                  detail = format('user %s already has %s active plans', new.usuario_id, v_count);
    end if;

    return new;
end;
$$;

notify pgrst, 'reload schema';

commit;

-- Al llegar fecha_evento: limpiar invitaciones (recibidas/enviadas) y solicitudes
-- pendientes. Índices y bloqueo de joins/invites en planes ya terminados para
-- tráfico concurrente de chat / invitaciones.

begin;

-- ---------------------------------------------------------------------------
-- Índices para listados concurrentes de invites y solicitudes
-- ---------------------------------------------------------------------------
create index if not exists idx_invitaciones_planes_invitado_pendiente
    on public.invitaciones_planes (invitado_id, creado_en desc)
    where estado = 'pendiente';

create index if not exists idx_invitaciones_planes_invitador_pendiente
    on public.invitaciones_planes (invitador_id, creado_en desc)
    where estado = 'pendiente';

create index if not exists idx_invitaciones_planes_plan_estado
    on public.invitaciones_planes (plan_id, estado);

create index if not exists idx_participantes_usuario_pendiente
    on public.participantes (usuario_id, plan_id)
    where estado = 'pendiente';

-- ---------------------------------------------------------------------------
-- Purge de invites / solicitudes pendientes de un plan terminado
-- ---------------------------------------------------------------------------
create or replace function public.purge_pending_for_ended_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from public.invitaciones_planes
    where plan_id = p_plan_id
      and estado = 'pendiente';

    delete from public.participantes
    where plan_id = p_plan_id
      and estado in ('pendiente', 'lista_espera');
end;
$$;

revoke all on function public.purge_pending_for_ended_plan(uuid) from public;
grant execute on function public.purge_pending_for_ended_plan(uuid) to service_role;

-- Archivar plan terminado + limpiar invites/solicitudes en el mismo momento
-- en que el plan sale del feed (fecha_evento <= now).
create or replace function public.archive_ended_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_fecha timestamptz;
    v_cat text;
begin
    select fecha_evento, categoria into v_fecha, v_cat
    from public.planes where id = p_plan_id;

    if v_fecha is null or v_cat in ('Grupo', 'Chat') then
        return;
    end if;

    if v_fecha > now() then
        return;
    end if;

    update public.planes
    set finalizado_en = coalesce(finalizado_en, now())
    where id = p_plan_id and finalizado_en is null;

    perform public.purge_pending_for_ended_plan(p_plan_id);
end;
$$;

-- Barrido explícito (también limpia filas huérfanas si archive falló antes)
create or replace function public.purge_ended_plan_invites()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    r record;
    n integer := 0;
begin
    for r in
        select id
        from public.planes
        where fecha_evento is not null
          and fecha_evento <= now()
          and coalesce(categoria, '') not in ('Grupo', 'Chat')
          and (
              exists (
                  select 1 from public.invitaciones_planes i
                  where i.plan_id = planes.id and i.estado = 'pendiente'
              )
              or exists (
                  select 1 from public.participantes p
                  where p.plan_id = planes.id
                    and p.estado in ('pendiente', 'lista_espera')
              )
          )
    loop
        perform public.purge_pending_for_ended_plan(r.id);
        n := n + 1;
    end loop;
    return n;
end;
$$;

revoke all on function public.purge_ended_plan_invites() from public;
grant execute on function public.purge_ended_plan_invites() to authenticated;
grant execute on function public.purge_ended_plan_invites() to service_role;
grant execute on function public.purge_ended_plan_invites() to anon;

-- Incluir purge en el maintenance que ya llama el cliente
create or replace function public.purge_expired_plan_chats()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    r record;
    n integer := 0;
begin
    perform public.archive_all_ended_plans();
    perform public.purge_ended_plan_invites();
    perform public.purge_past_saved_plans();

    for r in
        select id from public.planes
        where fecha_evento is not null
          and fecha_evento + interval '48 hours' <= now()
          and chat_eliminado_en is null
          and coalesce(categoria, '') not in ('Grupo', 'Chat')
    loop
        delete from public.mensajes where plan_id = r.id;
        delete from public.invitaciones_planes where plan_id = r.id;
        delete from public.planes_guardados where plan_id = r.id;
        update public.planes
        set chat_eliminado_en = now(),
            finalizado_en = coalesce(finalizado_en, now())
        where id = r.id;
        n := n + 1;
    end loop;
    return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- No aceptar / unirse / invitar a planes ya terminados
-- ---------------------------------------------------------------------------
create or replace function public.enforce_plan_not_ended()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_fecha timestamptz;
    v_cat text;
begin
    -- Permitir rechazos / cancelaciones aunque el plan ya haya terminado
    if tg_op = 'UPDATE'
       and new.estado is distinct from 'pendiente'
       and new.estado is distinct from 'aceptado'
       and new.estado is distinct from 'lista_espera' then
        return new;
    end if;

    select fecha_evento, categoria into v_fecha, v_cat
    from public.planes
    where id = new.plan_id;

    if v_cat in ('Grupo', 'Chat') then
        return new;
    end if;

    if v_fecha is not null and v_fecha <= now() then
        raise exception 'plan_ended'
            using errcode = 'P0001',
                  detail = format('plan %s already ended at %s', new.plan_id, v_fecha);
    end if;

    return new;
end;
$$;

drop trigger if exists trg_enforce_plan_not_ended_participantes on public.participantes;
create trigger trg_enforce_plan_not_ended_participantes
    before insert or update of estado on public.participantes
    for each row
    execute function public.enforce_plan_not_ended();

drop trigger if exists trg_enforce_plan_not_ended_invites on public.invitaciones_planes;
create trigger trg_enforce_plan_not_ended_invites
    before insert or update of estado on public.invitaciones_planes
    for each row
    execute function public.enforce_plan_not_ended();

-- Limpieza inmediata de filas ya caducadas
select public.purge_ended_plan_invites();

commit;

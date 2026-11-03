-- Al borrar un plan: quitar tarjetas @@nexo_plan_invite en otros chats
-- (las invitaciones_planes ya caen por FK ON DELETE CASCADE).

create or replace function public.service_delete_plan(p_plan_id uuid, p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    plan_title text;
    plan_creator uuid;
    actor_role text;
    plan_needle text;
begin
    if p_plan_id is null or p_actor_id is null then
        raise exception 'invalid_target';
    end if;

    select p.titulo, p.creador_id
      into plan_title, plan_creator
      from public.planes as p
     where p.id = p_plan_id
     for update;

    if not found then
        raise exception 'plan_not_found';
    end if;

    select p.rol into actor_role
      from public.perfiles as p
     where p.id = p_actor_id and p.baneado is false;

    if plan_creator <> p_actor_id and actor_role <> 'owner' then
        raise exception 'not_authorized';
    end if;

    -- Tarjetas embebidas en chats de grupo que apuntan a este plan.
    plan_needle := '@@nexo_plan_invite:%"planId":"' || p_plan_id::text || '"%';
    delete from public.mensajes
     where contenido like plan_needle;

    update public.reportes_planes
       set plan_titulo = coalesce(nullif(btrim(plan_title), ''), plan_title, 'Plan'),
           plan_eliminado = true,
           plan_eliminado_en = now(),
           estado = case when estado in ('abierto', 'en_revision') then 'resuelto' else estado end,
           revisado_en = coalesce(revisado_en, now()),
           revisado_por = coalesce(revisado_por, p_actor_id)
     where plan_id = p_plan_id;

    -- invitaciones_planes se borran por FK ON DELETE CASCADE
    delete from public.planes where id = p_plan_id;
end;
$$;

revoke all on function public.service_delete_plan(uuid, uuid) from public, anon, authenticated;
grant execute on function public.service_delete_plan(uuid, uuid) to service_role;

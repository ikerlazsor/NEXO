begin;

-- Borrado de cuenta usable por service_role (edge function).
-- Más robusto que confiar solo en auth.admin.deleteUser + cascades.
create or replace function public.service_delete_account(
    p_user_id uuid,
    p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
    v_actor_rol text;
    v_actor_banned boolean;
    v_target_rol text;
    v_plan_id uuid;
begin
    if p_user_id is null or p_actor_id is null then
        raise exception 'invalid_target';
    end if;

    if p_user_id is distinct from p_actor_id then
        select p.rol, p.baneado
          into v_actor_rol, v_actor_banned
          from public.perfiles as p
         where p.id = p_actor_id;

        if v_actor_rol is distinct from 'owner' or coalesce(v_actor_banned, false) then
            raise exception 'not_authorized';
        end if;

        select p.rol into v_target_rol
          from public.perfiles as p
         where p.id = p_user_id;

        if v_target_rol in ('owner', 'admin') then
            raise exception 'cannot_moderate_staff';
        end if;
    end if;

    -- Conservar título en reportes de planes propios antes de borrar.
    update public.reportes_planes as rp
       set plan_titulo = coalesce(nullif(btrim(rp.plan_titulo), ''), pl.titulo, 'Plan'),
           plan_eliminado = true,
           plan_eliminado_en = coalesce(rp.plan_eliminado_en, now())
      from public.planes as pl
     where pl.creador_id = p_user_id
       and rp.plan_id = pl.id;

    -- Planes creados por el usuario (mensajes/participantes cascaden).
    for v_plan_id in
        select id from public.planes where creador_id = p_user_id
    loop
        delete from public.planes where id = v_plan_id;
    end loop;

    -- Limpieza explícita de filas ligadas al usuario (por si alguna FK no cascada).
    delete from public.participantes where usuario_id = p_user_id;
    delete from public.planes_guardados where usuario_id = p_user_id;
    delete from public.historial_planes where usuario_id = p_user_id;

    if to_regclass('public.valoraciones') is not null then
        delete from public.valoraciones
         where evaluador_id = p_user_id or evaluado_id = p_user_id;
    end if;

    if to_regclass('public.amistades') is not null then
        delete from public.amistades
         where usuario_origen_id = p_user_id or usuario_destino_id = p_user_id;
    end if;

    if to_regclass('public.bloqueos') is not null then
        delete from public.bloqueos
         where bloqueador_id = p_user_id or bloqueado_id = p_user_id;
    end if;

    if to_regclass('public.invitaciones_planes') is not null then
        delete from public.invitaciones_planes
         where invitador_id = p_user_id or invitado_id = p_user_id;
    end if;

    if to_regclass('public.mensajes') is not null then
        delete from public.mensajes
         where emisor_id = p_user_id or receptor_id = p_user_id;
    end if;

    if to_regclass('public.mensajes_soporte') is not null then
        delete from public.mensajes_soporte where usuario_id = p_user_id;
    end if;

    if to_regclass('public.reportes_planes') is not null then
        delete from public.reportes_planes where reportador_id = p_user_id;
        update public.reportes_planes set revisado_por = null where revisado_por = p_user_id;
    end if;

    if to_regclass('public.reportes_usuarios') is not null then
        delete from public.reportes_usuarios
         where reportador_id = p_user_id or denunciado_id = p_user_id;
        update public.reportes_usuarios set revisado_por = null where revisado_por = p_user_id;
    end if;

    if to_regclass('public.reportes_mensajes') is not null then
        delete from public.reportes_mensajes
         where reportador_id = p_user_id or denunciado_id = p_user_id;
        update public.reportes_mensajes set revisado_por = null where revisado_por = p_user_id;
    end if;

    if to_regclass('public.chats_directos_ocultos') is not null then
        delete from public.chats_directos_ocultos
         where usuario_id = p_user_id or peer_id = p_user_id;
    end if;

    if to_regclass('public.estadisticas_usuario') is not null then
        delete from public.estadisticas_usuario where usuario_id = p_user_id;
    end if;

    if to_regclass('public.solicitudes_organizador') is not null then
        delete from public.solicitudes_organizador where usuario_id = p_user_id;
        update public.solicitudes_organizador set revisado_por = null where revisado_por = p_user_id;
    end if;

    if to_regclass('public.seguidores') is not null then
        delete from public.seguidores
         where seguidor_id = p_user_id or organizador_id = p_user_id;
    end if;

    if to_regclass('public.alineaciones') is not null then
        delete from public.alineaciones where usuario_id = p_user_id;
    end if;

    if to_regclass('public.push_tokens') is not null then
        delete from public.push_tokens where user_id = p_user_id;
    end if;

    delete from public.perfiles where id = p_user_id;
    delete from auth.users where id = p_user_id;
end;
$$;

revoke all on function public.service_delete_account(uuid, uuid) from public, anon, authenticated;
grant execute on function public.service_delete_account(uuid, uuid) to service_role;

notify pgrst, 'reload schema';

commit;

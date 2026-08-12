begin;

-- The client already supports video messages; production's enum only allowed
-- text, audio and images, so video uploads failed at insert time.
alter type public.tipo_mensaje add value if not exists 'video';

-- ---------------------------------------------------------------------------
-- Registration: expose one narrowly-scoped availability check to signed-out
-- clients. Usernames are public handles; no profile data is returned.
-- ---------------------------------------------------------------------------

create or replace function public.is_username_taken_public(check_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select case
        when check_name is null
          or length(btrim(check_name)) < 3
          or length(btrim(check_name)) > 20
          or lower(btrim(check_name)) !~ '^[a-z0-9._]+$'
          or btrim(check_name) ~ '\.{2,}'
          or btrim(check_name) like '.%'
          or btrim(check_name) like '%.'
        then true
        else exists (
            select 1
            from public.perfiles as p
            where lower(p.nombre_usuario) = lower(btrim(check_name))
        )
    end;
$$;

revoke all on function public.is_username_taken_public(text) from public;
grant execute on function public.is_username_taken_public(text) to anon, authenticated, service_role;

-- Reserve the requested handle in the Auth trigger whenever possible. This
-- closes the time window between the signed-out availability check and email
-- verification while still never blocking creation of the Auth identity.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    display_name text;
    requested_username text;
begin
    display_name := coalesce(
        nullif(btrim(new.raw_user_meta_data->>'nombre'), ''),
        nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
        nullif(btrim(new.raw_user_meta_data->>'name'), ''),
        nullif(btrim(split_part(new.email, '@', 1)), ''),
        'Usuario'
    );
    requested_username := lower(btrim(new.raw_user_meta_data->>'nombre_usuario'));
    if requested_username is null
       or length(requested_username) < 3
       or length(requested_username) > 20
       or requested_username !~ '^[a-z0-9._]+$'
       or requested_username ~ '\.{2,}'
       or requested_username like '.%'
       or requested_username like '%.' then
        requested_username := null;
    end if;

    begin
        insert into public.perfiles (id, nombre, nombre_usuario, registro_completado)
        values (new.id, display_name, requested_username, false)
        on conflict (id) do update
            set nombre = case
                    when public.perfiles.nombre is null
                      or btrim(public.perfiles.nombre) = ''
                      or public.perfiles.nombre = 'Usuario'
                        then excluded.nombre
                    else public.perfiles.nombre
                end,
                nombre_usuario = coalesce(public.perfiles.nombre_usuario, excluded.nombre_usuario);
    exception
        when unique_violation then
            -- Another concurrent signup reserved the same handle. Preserve the
            -- account/profile; onboarding will require a different handle.
            insert into public.perfiles (id, nombre, registro_completado)
            values (new.id, display_name, false)
            on conflict (id) do update
                set nombre = case
                        when public.perfiles.nombre is null
                          or btrim(public.perfiles.nombre) = ''
                          or public.perfiles.nombre = 'Usuario'
                            then excluded.nombre
                        else public.perfiles.nombre
                    end;
    end;

    insert into public.estadisticas_usuario (usuario_id)
    values (new.id)
    on conflict (usuario_id) do nothing;

    return new;
exception
    when others then
        raise log 'handle_new_user error for %: %', new.id, sqlerrm;
        return new;
end;
$$;

-- The old trigger function is unused and refers to a removed column (`tags`).
drop function if exists public.handle_nuevo_usuario();

-- ---------------------------------------------------------------------------
-- Profile privacy: direct table reads expose only identity-card fields. Own
-- private data and redacted public data are served through reviewed RPCs.
-- ---------------------------------------------------------------------------

create or replace function public.get_my_profile()
returns setof public.perfiles
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select p.*
    from public.perfiles as p
    where p.id = auth.uid();
$$;

revoke all on function public.get_my_profile() from public;
grant execute on function public.get_my_profile() to authenticated, service_role;

create or replace function public.get_my_account_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    requester uuid := auth.uid();
    row_data record;
begin
    if requester is null then
        raise exception 'not_authenticated';
    end if;

    select p.rol, p.baneado, p.baneado_motivo
      into row_data
      from public.perfiles as p
     where p.id = requester;

    if not found then
        raise exception 'profile_not_found';
    end if;

    return jsonb_build_object(
        'rol', row_data.rol,
        'baneado', row_data.baneado,
        'baneado_motivo', row_data.baneado_motivo
    );
end;
$$;

revoke all on function public.get_my_account_access() from public;
grant execute on function public.get_my_account_access() to authenticated, service_role;

create or replace function public.can_view_profile_identity(target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select case
        when auth.uid() is null or target_id is null then false
        when target_id = auth.uid() or public.is_staff() then true
        else exists (
            select 1
            from public.perfiles as target
            where target.id = target_id
              and target.baneado is false
              and not exists (
                  select 1
                  from public.bloqueos as b
                  where (b.bloqueador_id = auth.uid() and b.bloqueado_id = target_id)
                     or (b.bloqueador_id = target_id and b.bloqueado_id = auth.uid())
              )
        )
    end;
$$;

revoke all on function public.can_view_profile_identity(uuid) from public, anon;
grant execute on function public.can_view_profile_identity(uuid) to authenticated, service_role;

create or replace function public.get_public_profiles(p_user_ids uuid[])
returns table (
    id uuid,
    nombre text,
    nombre_usuario text,
    avatar_url text,
    descripcion text,
    etiquetas text[],
    edad integer,
    genero public.tipo_genero,
    habitos_consumo jsonb,
    ambientes_preferidos text[],
    perfil_gustos jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    requester uuid := auth.uid();
begin
    if requester is null then
        raise exception 'not_authenticated';
    end if;
    if not public.is_requesting_user_active() then
        raise exception 'account_banned';
    end if;
    if p_user_ids is null or cardinality(p_user_ids) = 0 then
        return;
    end if;
    if cardinality(p_user_ids) > 200 then
        raise exception 'too_many_profiles';
    end if;

    return query
    select
        p.id,
        p.nombre,
        p.nombre_usuario,
        p.avatar_url,
        p.descripcion,
        case
            when coalesce((p.perfil_gustos #>> '{privacidad,mostrar_aficiones}')::boolean, true)
                then coalesce(p.etiquetas, '{}'::text[])
            else '{}'::text[]
        end as etiquetas,
        case
            when coalesce((p.perfil_gustos #>> '{privacidad,mostrar_edad}')::boolean, true)
                 and p.fecha_nacimiento is not null
                then extract(year from age(current_date, p.fecha_nacimiento))::integer
            else null
        end as edad,
        case
            when coalesce((p.perfil_gustos #>> '{privacidad,mostrar_genero}')::boolean, true)
                then p.genero
            else null
        end as genero,
        jsonb_build_object(
            'bebida', case
                when coalesce((p.perfil_gustos #>> '{privacidad,mostrar_bebida}')::boolean, true)
                    then coalesce(p.habitos_consumo->'bebida', '"no_especificado"'::jsonb)
                else '"no_especificado"'::jsonb
            end,
            'tabaco', case
                when coalesce((p.perfil_gustos #>> '{privacidad,mostrar_tabaco}')::boolean, true)
                    then coalesce(p.habitos_consumo->'tabaco', '"no_especificado"'::jsonb)
                else '"no_especificado"'::jsonb
            end
        ) as habitos_consumo,
        case
            when coalesce((p.perfil_gustos #>> '{privacidad,mostrar_aficiones}')::boolean, true)
                then coalesce(p.ambientes_preferidos, '{}'::text[])
            else '{}'::text[]
        end as ambientes_preferidos,
        jsonb_build_object(
            'privacidad', jsonb_build_object(
                'mostrar_edad', coalesce((p.perfil_gustos #>> '{privacidad,mostrar_edad}')::boolean, true),
                'mostrar_genero', coalesce((p.perfil_gustos #>> '{privacidad,mostrar_genero}')::boolean, true),
                'mostrar_bebida', coalesce((p.perfil_gustos #>> '{privacidad,mostrar_bebida}')::boolean, true),
                'mostrar_tabaco', coalesce((p.perfil_gustos #>> '{privacidad,mostrar_tabaco}')::boolean, true),
                'mostrar_aficiones', coalesce((p.perfil_gustos #>> '{privacidad,mostrar_aficiones}')::boolean, true)
            )
        ) as perfil_gustos
    from public.perfiles as p
    where p.id = any(p_user_ids)
      and public.can_view_profile_identity(p.id);
end;
$$;

revoke all on function public.get_public_profiles(uuid[]) from public;
grant execute on function public.get_public_profiles(uuid[]) to authenticated, service_role;

create or replace function public.admin_get_profile_access(target_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    row_data record;
begin
    if not public.is_owner() then
        raise exception 'not_authorized';
    end if;

    select p.rol, p.baneado, p.baneado_motivo
      into row_data
      from public.perfiles as p
     where p.id = target_id;

    if not found then
        raise exception 'user_not_found';
    end if;

    return jsonb_build_object(
        'rol', row_data.rol,
        'baneado', row_data.baneado,
        'baneado_motivo', row_data.baneado_motivo
    );
end;
$$;

revoke all on function public.admin_get_profile_access(uuid) from public;
grant execute on function public.admin_get_profile_access(uuid) to authenticated, service_role;

revoke all privileges on table public.perfiles from anon;
revoke select, insert, update, delete on table public.perfiles from authenticated;

grant select (
    id, nombre, nombre_usuario, avatar_url, descripcion, creado_en
) on table public.perfiles to authenticated;

grant insert (
    id, nombre, nombre_usuario, avatar_url, descripcion, fecha_nacimiento,
    genero, ambientes_preferidos, etiquetas, habitos_consumo, perfil_gustos,
    registro_completado, notificaciones_push, notif_messages, notif_social,
    notif_reminders
) on table public.perfiles to authenticated;

grant update (
    nombre, nombre_usuario, avatar_url, descripcion, fecha_nacimiento,
    genero, ambientes_preferidos, etiquetas, habitos_consumo, perfil_gustos,
    registro_completado, notificaciones_push, notif_messages, notif_social,
    notif_reminders
) on table public.perfiles to authenticated;

drop policy if exists perfiles_select on public.perfiles;
create policy perfiles_select
on public.perfiles
for select
to authenticated
using (
    public.can_view_profile_identity(id)
);

-- Account deletion now goes through the Edge Function so physical Storage
-- objects are removed before the Auth row and relational data disappear.
revoke execute on function public.delete_own_account() from authenticated, anon;
revoke execute on function public.borrar_propia_cuenta() from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Physical Storage cleanup support. Only service_role can enumerate paths.
-- ---------------------------------------------------------------------------

create or replace function public.get_user_storage_cleanup_paths(p_user_id uuid)
returns table (bucket_id text, object_name text)
language sql
stable
security definer
set search_path = public, storage, pg_temp
as $$
    select distinct o.bucket_id, o.name
    from storage.objects as o
    where p_user_id is not null
      and (
          o.owner_id = p_user_id::text
          or (o.bucket_id = 'avatars' and o.name like p_user_id::text || '/%')
          or (
              o.bucket_id = 'avatars'
              and exists (
                  select 1
                  from public.planes as p
                  where p.creador_id = p_user_id
                    and o.name like 'groups/' || p.id::text || '.%'
              )
          )
          or exists (
              select 1
              from public.planes as p
              where p.creador_id = p_user_id
                and p.imagen_url is not null
                and position('/' || o.bucket_id || '/' || o.name in split_part(p.imagen_url, '?', 1)) > 0
          )
          or (
              o.bucket_id = 'chat-files'
              and (
                  exists (
                      select 1
                      from public.planes as p
                      where p.creador_id = p_user_id
                        and o.name like 'chat_' || p.id::text || '_%'
                  )
                  or o.name like 'chat_direct-' || p_user_id::text || '-%'
                  or o.name like 'chat_direct-%-' || p_user_id::text || '_%'
              )
          )
      );
$$;

create or replace function public.get_plan_storage_cleanup_paths(p_plan_id uuid)
returns table (bucket_id text, object_name text)
language sql
stable
security definer
set search_path = public, storage, pg_temp
as $$
    select o.bucket_id, o.name
    from storage.objects as o
    where p_plan_id is not null
      and (
          (o.bucket_id = 'avatars' and o.name like 'groups/' || p_plan_id::text || '.%')
          or (o.bucket_id = 'chat-files' and o.name like 'chat_' || p_plan_id::text || '_%')
          or exists (
              select 1
              from public.planes as p
              where p.id = p_plan_id
                and p.imagen_url is not null
                and position('/' || o.bucket_id || '/' || o.name in split_part(p.imagen_url, '?', 1)) > 0
          )
      );
$$;

revoke all on function public.get_user_storage_cleanup_paths(uuid) from public, anon, authenticated;
revoke all on function public.get_plan_storage_cleanup_paths(uuid) from public, anon, authenticated;
grant execute on function public.get_user_storage_cleanup_paths(uuid) to service_role;
grant execute on function public.get_plan_storage_cleanup_paths(uuid) to service_role;

create or replace function public.prepare_account_deletion(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if p_user_id is null then
        raise exception 'invalid_target';
    end if;

    update public.reportes_planes as rp
       set plan_titulo = coalesce(nullif(btrim(rp.plan_titulo), ''), p.titulo, 'Plan'),
           plan_eliminado = true,
           plan_eliminado_en = coalesce(rp.plan_eliminado_en, now())
      from public.planes as p
     where p.creador_id = p_user_id
       and rp.plan_id = p.id;
end;
$$;

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

    update public.reportes_planes
       set plan_titulo = coalesce(nullif(btrim(plan_titulo), ''), plan_title, 'Plan'),
           plan_eliminado = true,
           plan_eliminado_en = now(),
           estado = case when estado in ('abierto', 'en_revision') then 'resuelto' else estado end,
           revisado_en = coalesce(revisado_en, now()),
           revisado_por = coalesce(revisado_por, p_actor_id)
     where plan_id = p_plan_id;

    delete from public.planes where id = p_plan_id;
end;
$$;

revoke all on function public.prepare_account_deletion(uuid) from public, anon, authenticated;
revoke all on function public.service_delete_plan(uuid, uuid) from public, anon, authenticated;
grant execute on function public.prepare_account_deletion(uuid) to service_role;
grant execute on function public.service_delete_plan(uuid, uuid) to service_role;

drop policy if exists avatars_delete_owner on storage.objects;
create policy avatars_delete_owner
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'avatars'
    and owner_id = (select auth.uid())::text
    and public.can_manage_avatar_object(name)
);

drop policy if exists chat_files_delete_owner on storage.objects;
create policy chat_files_delete_owner
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'chat-files'
    and owner_id = (select auth.uid())::text
    and public.can_access_chat_file(name)
);

drop policy if exists plan_images_delete_owner on storage.objects;
create policy plan_images_delete_owner
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'imagenes-planes'
    and owner_id = (select auth.uid())::text
);

-- ---------------------------------------------------------------------------
-- Per-message reporting with immutable moderation snapshots.
-- ---------------------------------------------------------------------------

-- Reporters do not need to read moderation queues. Keeping these rows
-- staff-only also prevents disclosure of internal notes and reviewer IDs.
drop policy if exists reportes_select_own on public.reportes_planes;
drop policy if exists reportes_usuarios_select_own on public.reportes_usuarios;

create table if not exists public.reportes_mensajes (
    id uuid primary key default gen_random_uuid(),
    mensaje_id uuid references public.mensajes(id) on delete set null,
    reportador_id uuid not null references public.perfiles(id) on delete cascade,
    denunciado_id uuid references public.perfiles(id) on delete set null,
    motivo text not null,
    mensaje text,
    contenido_snapshot text not null,
    tipo_snapshot text not null,
    archivo_url_snapshot text,
    denunciado_nombre_snapshot text,
    denunciado_usuario_snapshot text,
    estado text not null default 'abierto'
        check (estado in ('abierto', 'en_revision', 'resuelto', 'descartado')),
    notas_internas text,
    creado_en timestamptz not null default now(),
    revisado_en timestamptz,
    revisado_por uuid references public.perfiles(id) on delete set null,
    constraint reportes_mensajes_motivo_check check (
        motivo in ('acoso', 'odio', 'sexual', 'violencia', 'spam', 'estafa', 'otro')
    ),
    constraint reportes_mensajes_detalle_length check (char_length(coalesce(mensaje, '')) <= 1000),
    constraint reportes_mensajes_unique unique (mensaje_id, reportador_id)
);

create index if not exists idx_reportes_mensajes_estado_creado
    on public.reportes_mensajes (estado, creado_en desc);
create index if not exists idx_reportes_mensajes_reportador_fecha
    on public.reportes_mensajes (reportador_id, creado_en desc);

alter table public.reportes_mensajes enable row level security;

drop policy if exists reportes_mensajes_active_users on public.reportes_mensajes;
create policy reportes_mensajes_active_users
on public.reportes_mensajes
as restrictive
for all
to authenticated
using (public.is_requesting_user_active())
with check (public.is_requesting_user_active());

drop policy if exists reportes_mensajes_select_own_or_staff on public.reportes_mensajes;
drop policy if exists reportes_mensajes_select_staff on public.reportes_mensajes;
create policy reportes_mensajes_select_staff
on public.reportes_mensajes
for select
to authenticated
using (public.is_staff());

drop policy if exists reportes_mensajes_update_staff on public.reportes_mensajes;
create policy reportes_mensajes_update_staff
on public.reportes_mensajes
for update
to authenticated
using (public.is_staff())
with check (public.is_staff());

drop policy if exists reportes_mensajes_delete_staff on public.reportes_mensajes;
create policy reportes_mensajes_delete_staff
on public.reportes_mensajes
for delete
to authenticated
using (public.is_staff());

revoke all privileges on table public.reportes_mensajes from anon;
revoke insert on table public.reportes_mensajes from authenticated;
grant select, update, delete on table public.reportes_mensajes to authenticated;
grant all privileges on table public.reportes_mensajes to service_role;

drop policy if exists chat_files_select_reported_staff on storage.objects;
create policy chat_files_select_reported_staff
on storage.objects
for select
to authenticated
using (
    bucket_id = 'chat-files'
    and public.is_staff()
    and exists (
        select 1
        from public.reportes_mensajes as r
        where r.archivo_url_snapshot is not null
          and position('/chat-files/' || storage.objects.name in split_part(r.archivo_url_snapshot, '?', 1)) > 0
    )
);

create or replace function public.report_message(
    p_message_id uuid,
    p_reason text,
    p_details text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    requester uuid := auth.uid();
    source_message public.mensajes%rowtype;
    sender_profile record;
    result_id uuid;
begin
    if requester is null then
        raise exception 'not_authenticated';
    end if;
    if not public.is_requesting_user_active() then
        raise exception 'account_banned';
    end if;
    if p_reason not in ('acoso', 'odio', 'sexual', 'violencia', 'spam', 'estafa', 'otro') then
        raise exception 'invalid_reason';
    end if;
    if char_length(coalesce(p_details, '')) > 1000 then
        raise exception 'details_too_long';
    end if;

    select m.*
      into source_message
      from public.mensajes as m
     where m.id = p_message_id
       and m.emisor_id <> requester
       and (
           (m.plan_id is null and m.receptor_id = requester)
           or (
               m.plan_id is not null
               and exists (
                   select 1
                   from public.planes as p
                   where p.id = m.plan_id
                     and (
                         p.creador_id = requester
                         or exists (
                             select 1
                             from public.participantes as pa
                             where pa.plan_id = p.id
                               and pa.usuario_id = requester
                               and pa.estado = 'aceptado'::public.tipo_estado_participante
                         )
                     )
               )
           )
       );

    if not found then
        raise exception 'message_not_found_or_forbidden';
    end if;

    if (
        select count(*)
        from public.reportes_mensajes as r
        where r.reportador_id = requester
          and r.creado_en >= now() - interval '24 hours'
    ) >= 10 then
        raise exception 'message_report_daily_limit';
    end if;

    select p.nombre, p.nombre_usuario
      into sender_profile
      from public.perfiles as p
     where p.id = source_message.emisor_id;

    insert into public.reportes_mensajes (
        mensaje_id,
        reportador_id,
        denunciado_id,
        motivo,
        mensaje,
        contenido_snapshot,
        tipo_snapshot,
        archivo_url_snapshot,
        denunciado_nombre_snapshot,
        denunciado_usuario_snapshot
    ) values (
        source_message.id,
        requester,
        source_message.emisor_id,
        p_reason,
        nullif(btrim(p_details), ''),
        left(coalesce(source_message.contenido, ''), 4000),
        source_message.tipo::text,
        left(source_message.archivo_url, 2048),
        sender_profile.nombre,
        sender_profile.nombre_usuario
    )
    returning id into result_id;

    return result_id;
exception
    when unique_violation then
        raise exception 'message_already_reported';
end;
$$;

revoke all on function public.report_message(uuid, text, text) from public, anon;
grant execute on function public.report_message(uuid, text, text) to authenticated, service_role;

create or replace function public.admin_moderation_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    c_soporte integer := 0;
    c_planes integer := 0;
    c_users integer := 0;
    c_messages integer := 0;
begin
    if not public.is_staff() then
        raise exception 'not_authorized';
    end if;

    select count(*)::integer into c_soporte
      from public.mensajes_soporte where estado in ('abierto', 'en_revision');
    select count(*)::integer into c_planes
      from public.reportes_planes where estado in ('abierto', 'en_revision');
    select count(*)::integer into c_users
      from public.reportes_usuarios where estado in ('abierto', 'en_revision');
    select count(*)::integer into c_messages
      from public.reportes_mensajes where estado in ('abierto', 'en_revision');

    return jsonb_build_object(
        'soporte', c_soporte,
        'reportes_planes', c_planes,
        'reportes_usuarios', c_users,
        'reportes_mensajes', c_messages,
        'total', c_soporte + c_planes + c_users + c_messages
    );
end;
$$;

create or replace function public.admin_set_report_estado(
    report_kind text,
    report_id uuid,
    nuevo_estado text,
    notas text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if not public.is_staff() then
        raise exception 'not_authorized';
    end if;
    if nuevo_estado not in ('abierto', 'en_revision', 'resuelto', 'descartado') then
        raise exception 'invalid_estado';
    end if;

    if report_kind = 'plan' then
        update public.reportes_planes
           set estado = nuevo_estado,
               notas_internas = coalesce(nullif(trim(notas), ''), notas_internas),
               revisado_en = now(),
               revisado_por = auth.uid()
         where id = report_id;
    elsif report_kind = 'user' then
        update public.reportes_usuarios
           set estado = nuevo_estado,
               notas_internas = coalesce(nullif(trim(notas), ''), notas_internas),
               revisado_en = now(),
               revisado_por = auth.uid()
         where id = report_id;
    elsif report_kind = 'message' then
        update public.reportes_mensajes
           set estado = nuevo_estado,
               notas_internas = coalesce(nullif(trim(notas), ''), notas_internas),
               revisado_en = now(),
               revisado_por = auth.uid()
         where id = report_id;
    else
        raise exception 'invalid_kind';
    end if;

    if not found then
        raise exception 'report_not_found';
    end if;
end;
$$;

create or replace function public.admin_delete_inbox_item(item_kind text, item_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if not public.is_staff() then
        raise exception 'not_authorized';
    end if;
    if item_id is null then
        raise exception 'invalid_target';
    end if;

    if item_kind = 'soporte' then
        delete from public.mensajes_soporte where id = item_id;
    elsif item_kind = 'plan' then
        delete from public.reportes_planes where id = item_id;
    elsif item_kind = 'user' then
        delete from public.reportes_usuarios where id = item_id;
    elsif item_kind = 'message' then
        delete from public.reportes_mensajes where id = item_id;
    else
        raise exception 'invalid_kind';
    end if;

    if not found then
        raise exception 'item_not_found';
    end if;
end;
$$;

revoke all on function public.admin_moderation_counts() from public, anon;
revoke all on function public.admin_set_report_estado(text, uuid, text, text) from public, anon;
revoke all on function public.admin_delete_inbox_item(text, uuid) from public, anon;
grant execute on function public.admin_moderation_counts() to authenticated, service_role;
grant execute on function public.admin_set_report_estado(text, uuid, text, text) to authenticated, service_role;
grant execute on function public.admin_delete_inbox_item(text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Advisor cleanup: deterministic search paths and one duplicate constraint.
-- ---------------------------------------------------------------------------

alter function public.actualizar_estadisticas_usuario() set search_path = public, pg_temp;
alter function public.actualizar_estadisticas_usuario(uuid) set search_path = public, pg_temp;
alter function public.actualizar_timestamp() set search_path = public, pg_temp;
alter function public.crear_estadisticas_iniciales() set search_path = public, pg_temp;
alter function public.day_start_madrid() set search_path = public, pg_temp;
alter function public.evaluar_insignias_usuario() set search_path = public, pg_temp;
alter function public.procesar_lista_espera() set search_path = public, pg_temp;
alter function public.touch_actualizado_en() set search_path = public, pg_temp;
alter function public.tr_amistades_estadisticas() set search_path = public, pg_temp;
alter function public.tr_participantes_estadisticas() set search_path = public, pg_temp;
alter function public.tr_planes_estadisticas() set search_path = public, pg_temp;
alter function public.tr_registrar_en_historial() set search_path = public, pg_temp;
alter function public.tr_valoraciones_estadisticas() set search_path = public, pg_temp;

alter table public.historial_planes
    drop constraint if exists historial_unicos;

commit;

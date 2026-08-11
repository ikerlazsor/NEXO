-- Remove unnecessary public entry points and tighten high-risk Storage access.
-- This migration is intentionally data-preserving.

set search_path = public, extensions, pg_catalog;

-- The mobile client never queries application tables before authentication.
-- Remove the legacy blanket anon grants and non-Data-API maintenance powers.
revoke all privileges on all tables in schema public from anon;
revoke truncate, references, trigger, maintain
  on all tables in schema public
  from authenticated;

alter default privileges in schema public
  revoke all privileges on tables from anon;
alter default privileges in schema public
  revoke truncate, references, trigger, maintain on tables from authenticated;

-- SECURITY DEFINER and trigger functions must not be direct public APIs.
-- Start closed, retain service-role access, then grant only reviewed client RPCs.
do $permissions$
declare
  fn record;
  signature text;
  reviewed_client_rpcs constant text[] := array[
    'public.admin_ban_user(uuid,text,boolean)',
    'public.admin_delete_inbox_item(text,uuid)',
    'public.admin_delete_plan(uuid)',
    'public.admin_delete_user(uuid)',
    'public.admin_moderation_counts()',
    'public.admin_set_report_estado(text,uuid,text,text)',
    'public.admin_set_ticket_estado(uuid,text,text)',
    'public.borrar_propia_cuenta()',
    'public.change_username(text)',
    'public.consume_ai_search_quota()',
    'public.count_user_active_plans(uuid)',
    'public.create_meetup_plan(jsonb)',
    'public.current_user_banned()',
    'public.delete_own_account()',
    'public.get_badge_stats(uuid)',
    'public.get_user_public_stats(uuid)',
    'public.guardar_valoracion(uuid,uuid,boolean,integer,text,jsonb,jsonb)',
    'public.is_owner()',
    'public.is_requesting_user_active()',
    'public.is_staff()',
    'public.is_username_taken(text,uuid)',
    'public.nombre_usuario_ya_tomado(text,uuid)',
    'public.not_banned()',
    'public.plan_is_feed_public(uuid)',
    'public.user_can_view_plan(uuid,uuid)',
    'public.user_has_plan_invite(uuid,uuid)',
    'public.users_are_friends(uuid,uuid)',
    'public.usuario_es_miembro_del_plan(uuid)',
    'public.usuario_pertenece_al_plan(uuid,uuid)'
  ];
begin
  for fn in
    select p.oid,
           format('%I.%I(%s)', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid)) as identity
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.prosecdef or p.prorettype = 'trigger'::regtype)
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      fn.identity
    );
    execute format(
      'grant execute on function %s to service_role',
      fn.identity
    );
  end loop;

  foreach signature in array reviewed_client_rpcs
  loop
    if to_regprocedure(signature) is null then
      raise exception 'Reviewed RPC is missing: %', signature;
    end if;
    execute format(
      'grant execute on function %s to authenticated',
      to_regprocedure(signature)
    );
  end loop;
end
$permissions$;

-- Storage file names encode their conversation. Keep parsing inside reviewed
-- functions so malformed object names fail closed instead of raising casts.
create or replace function public.can_access_chat_file(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  requester uuid := auth.uid();
  captures text[];
  plan_uuid uuid;
begin
  if requester is null or p_name is null then
    return false;
  end if;

  captures := regexp_match(
    p_name,
    '^chat_direct-([0-9a-fA-F-]{36})-([0-9a-fA-F-]{36})_'
  );
  if captures is not null then
    return requester = captures[1]::uuid or requester = captures[2]::uuid;
  end if;

  captures := regexp_match(p_name, '^chat_([0-9a-fA-F-]{36})_');
  if captures is null then
    return false;
  end if;

  plan_uuid := captures[1]::uuid;
  return exists (
    select 1
    from public.planes p
    where p.id = plan_uuid
      and (
        p.creador_id = requester
        or exists (
          select 1
          from public.participantes pa
          where pa.plan_id = p.id
            and pa.usuario_id = requester
            and pa.estado = 'aceptado'::public.tipo_estado_participante
        )
      )
  );
exception
  when invalid_text_representation then
    return false;
end
$function$;

create or replace function public.can_manage_avatar_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  requester uuid := auth.uid();
  folders text[];
  object_plan_id uuid;
begin
  if requester is null or p_name is null then
    return false;
  end if;

  folders := storage.foldername(p_name);
  if folders[1] = requester::text then
    return true;
  end if;

  if folders[1] not in ('groups', 'plan-covers') then
    return false;
  end if;

  object_plan_id := split_part(storage.filename(p_name), '.', 1)::uuid;
  return exists (
    select 1
    from public.planes p
    where p.id = object_plan_id
      and p.creador_id = requester
  );
exception
  when invalid_text_representation then
    return false;
end
$function$;

revoke execute on function public.can_access_chat_file(text)
  from public, anon;
revoke execute on function public.can_manage_avatar_object(text)
  from public, anon;
grant execute on function public.can_access_chat_file(text)
  to authenticated, service_role;
grant execute on function public.can_manage_avatar_object(text)
  to authenticated, service_role;

-- Chat files: only conversation participants may upload or read. Existing
-- filenames already follow the patterns checked by can_access_chat_file().
drop policy if exists "Authenticated users upload chat files" on storage.objects;
drop policy if exists "Authenticated users view chat files" on storage.objects;
drop policy if exists "chat_files_insert_authenticated" on storage.objects;
drop policy if exists "chat_files_select_public" on storage.objects;

create policy chat_files_insert_members
on storage.objects
as permissive
for insert
to authenticated
with check (
  bucket_id = 'chat-files'
  and owner_id = auth.uid()::text
  and public.can_access_chat_file(name)
);

create policy chat_files_select_members
on storage.objects
as permissive
for select
to authenticated
using (
  bucket_id = 'chat-files'
  and public.can_access_chat_file(name)
);

-- Avatars and group/plan covers remain publicly readable because their bucket
-- is public, but only the owner or plan creator may create/replace an object.
drop policy if exists "Permitir subida de avatares" on storage.objects;
drop policy if exists "Permitir actualizar avatares" on storage.objects;
drop policy if exists "authenticated see images 1oj01fe_0" on storage.objects;
drop policy if exists "avatars_groups_insert" on storage.objects;
drop policy if exists "avatars_groups_update" on storage.objects;
drop policy if exists "avatars_plan_covers_insert" on storage.objects;
drop policy if exists "avatars_plan_covers_update" on storage.objects;

create policy avatars_insert_owner
on storage.objects
as permissive
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and owner_id = auth.uid()::text
  and public.can_manage_avatar_object(name)
);

create policy avatars_update_owner
on storage.objects
as permissive
for update
to authenticated
using (
  bucket_id = 'avatars'
  and owner_id = auth.uid()::text
  and public.can_manage_avatar_object(name)
)
with check (
  bucket_id = 'avatars'
  and owner_id = auth.uid()::text
  and public.can_manage_avatar_object(name)
);

-- Plan images are public assets, but authenticated users may only replace
-- objects they own. Uploading a new object also records that ownership.
drop policy if exists "Subir uur343_0" on storage.objects;
drop policy if exists "Authenticated users update plan images" on storage.objects;

create policy plan_images_insert_owner
on storage.objects
as permissive
for insert
to authenticated
with check (
  bucket_id = 'imagenes-planes'
  and owner_id = auth.uid()::text
);

create policy plan_images_update_owner
on storage.objects
as permissive
for update
to authenticated
using (
  bucket_id = 'imagenes-planes'
  and owner_id = auth.uid()::text
)
with check (
  bucket_id = 'imagenes-planes'
  and owner_id = auth.uid()::text
);

-- Participation rows must not enumerate members of plans the requester cannot
-- see. Own rows, hosted plans, and otherwise visible plans remain available.
drop policy if exists participantes_select on public.participantes;

create policy participantes_select
on public.participantes
as permissive
for select
to authenticated
using (
  usuario_id = auth.uid()
  or exists (
    select 1
    from public.planes p
    where p.id = participantes.plan_id
      and (
        p.creador_id = auth.uid()
        or public.user_can_view_plan(p.id, auth.uid())
      )
  )
);

reset search_path;

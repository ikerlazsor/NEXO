begin;

create extension if not exists pgtap with schema extensions;

select plan(37);

select is(
  (
    select count(*)::bigint
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity
  ),
  0::bigint,
  'every public application table has RLS enabled'
);

select is(
  (
    select count(*)::bigint
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and (
        has_table_privilege('anon', c.oid, 'select')
        or has_table_privilege('anon', c.oid, 'insert')
        or has_table_privilege('anon', c.oid, 'update')
        or has_table_privilege('anon', c.oid, 'delete')
      )
  ),
  0::bigint,
  'anon has no CRUD privileges on application tables'
);

select is(
  (
    select count(*)::bigint
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'execute')
  ),
    6::bigint,
  'anon can execute only the reviewed registration, plan feed/search/share and external event RPCs'
);

select ok(
  has_function_privilege(
    'anon',
    'public.is_username_taken_public(text)',
    'execute'
  ),
  'signed-out registration can check a public username'
);

select ok(
  has_function_privilege('anon', 'public.get_guest_feed(double precision, double precision, integer)', 'execute'),
  'signed-out clients can load the public guest feed'
);

select ok(
  has_function_privilege('anon', 'public.get_guest_plan(uuid)', 'execute'),
  'signed-out clients can load a public guest plan'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.get_feed_plan_people(uuid[])',
    'execute'
  ),
  'authenticated users can load feed people in one round trip'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.get_feed_plan_people(uuid[])',
    'execute'
  ),
  'signed-out clients cannot call the authenticated feed people RPC'
);

select ok(
  has_function_privilege(
    'anon',
    'public.search_feed_plans(text)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.search_feed_plans(text)',
    'execute'
  ),
  'feed search RPC is callable from the app'
);

select is(
  (
    select count(*)::bigint
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not has_function_privilege('service_role', p.oid, 'execute')
  ),
  0::bigint,
  'service_role retains access to privileged functions'
);

select is(
  (
    select count(*)::bigint
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'trigger'::regtype
      and has_function_privilege('authenticated', p.oid, 'execute')
  ),
  0::bigint,
  'trigger functions are not client-callable'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_meetup_plan(jsonb)',
    'execute'
  ),
  'authenticated users can call create_meetup_plan'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.delete_own_account()',
    'execute'
  ),
  'relational-only account deletion is no longer client-callable'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.archive_all_ended_plans()',
    'execute'
  ),
  'maintenance functions are not client-callable'
);

select is(
  (
    select count(*)::bigint
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'chat_files_select_members'
      and roles = array['authenticated']::name[]
      and qual ilike '%can_access_chat_file%'
  ),
  1::bigint,
  'chat files are readable only through the membership predicate'
);

select is(
  (
    select count(*)::bigint
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname ilike '%chat%'
      and roles @> array['public']::name[]
  ),
  0::bigint,
  'chat files have no PUBLIC read policy'
);

select is(
  (
    select count(*)::bigint
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd in ('INSERT', 'UPDATE')
      and policyname in (
        'avatars_insert_owner',
        'avatars_update_owner',
        'plan_images_insert_owner',
        'plan_images_update_owner'
      )
      and regexp_replace(
        coalesce(qual, '') || coalesce(with_check, ''),
        '[[:space:]()]',
        '',
        'g'
      ) ilike '%owner_id=auth.uid::text%'
  ),
  4::bigint,
  'avatar and plan-image writes enforce object ownership'
);

select is(
  (
    select public.can_access_chat_file('not-a-valid-object-name')
  ),
  false,
  'malformed chat object names fail closed'
);

select is(
  (
    select public.can_manage_avatar_object('groups/not-a-uuid.jpg')
  ),
  false,
  'malformed avatar object names fail closed'
);

select is(
  (
    select count(*)::bigint
    from pg_policies
    where schemaname = 'public'
      and tablename = 'participantes'
      and policyname = 'participantes_select'
      and qual ilike '%user_can_view_plan%'
  ),
  1::bigint,
  'participant rows inherit plan visibility'
);

select is(
  (
    select public
    from storage.buckets
    where id = 'chat-files'
  ),
  false,
  'chat-files remains a private bucket'
);

select ok(
  has_function_privilege('authenticated', 'public.get_my_profile()', 'execute'),
  'authenticated users can retrieve their own complete profile through the reviewed RPC'
);

select ok(
  has_function_privilege('authenticated', 'public.get_public_profiles(uuid[])', 'execute'),
  'authenticated users can retrieve redacted public profiles'
);

select ok(
  has_function_privilege('authenticated', 'public.can_view_profile_identity(uuid)', 'execute'),
  'profile identity visibility uses the reviewed block-aware predicate'
);

select ok(
  has_function_privilege('authenticated', 'public.report_message(uuid,text,text)', 'execute'),
  'authenticated users can report an accessible message through the reviewed RPC'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.get_user_storage_cleanup_paths(uuid)',
    'execute'
  ),
  'clients cannot enumerate destructive Storage cleanup paths'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.get_user_storage_cleanup_paths(uuid)',
    'execute'
  ),
  'service role can enumerate Storage paths for the deletion Edge Function'
);

select ok(
  has_column_privilege('authenticated', 'public.perfiles', 'nombre_usuario', 'select'),
  'identity-card profile columns remain readable to authenticated users'
);

select ok(
  not has_column_privilege('authenticated', 'public.perfiles', 'fecha_nacimiento', 'select'),
  'date of birth is not directly readable from the profiles table'
);

select ok(
  not has_column_privilege('authenticated', 'public.perfiles', 'rol', 'update'),
  'clients cannot update their authorization role column'
);

select ok(
  (
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'reportes_mensajes'
  ),
  'message reports have RLS enabled'
);

select ok(
  not has_table_privilege('authenticated', 'public.reportes_mensajes', 'insert'),
  'message report snapshots cannot be inserted directly by clients'
);

select is(
  (
    select count(*)::bigint
    from pg_policies
    where schemaname = 'public'
      and tablename in ('reportes_planes', 'reportes_usuarios', 'reportes_mensajes')
      and policyname in (
        'reportes_select_own',
        'reportes_usuarios_select_own',
        'reportes_mensajes_select_own_or_staff'
      )
  ),
  0::bigint,
  'moderation queues and internal notes are readable only by staff'
);

select is(
  (
    select count(*)::bigint
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'chat_files_delete_owner'
      and cmd = 'DELETE'
      and roles = array['authenticated']::name[]
  ),
  1::bigint,
  'chat uploaders can remove only their own accessible objects'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.service_delete_plan(uuid,uuid)',
    'execute'
  ),
  'service-side plan deletion cannot be invoked directly by clients'
);

select ok(
  exists (
    select 1
    from unnest(enum_range(null::public.tipo_mensaje)) as valueset(enum_value)
    where enum_value::text = 'video'
  ),
  'video messages are accepted by the database enum'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.get_owner_analytics_dashboard(integer)',
    'execute'
  ),
  'owner analytics cannot be invoked by anonymous clients'
);

select * from finish();

rollback;

begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

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
  0::bigint,
  'anon cannot execute any public SECURITY DEFINER function'
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
  has_function_privilege(
    'authenticated',
    'public.delete_own_account()',
    'execute'
  ),
  'authenticated users can call delete_own_account'
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
      and coalesce(qual, '') || coalesce(with_check, '') ilike '%owner_id = auth.uid()%'
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

select * from finish();

rollback;

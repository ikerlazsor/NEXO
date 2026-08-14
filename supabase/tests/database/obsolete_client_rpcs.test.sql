begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

select is(
  (
    select count(*)::bigint
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('admin_delete_user', 'admin_delete_plan', 'consume_ai_search_quota')
       and has_function_privilege('authenticated', p.oid, 'execute')
  ),
  0::bigint,
  'obsolete administrative and AI quota RPCs are not executable by authenticated clients'
);

select is(
  (
    select count(*)::bigint
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('admin_delete_user', 'admin_delete_plan', 'consume_ai_search_quota')
       and has_function_privilege('anon', p.oid, 'execute')
  ),
  0::bigint,
  'obsolete RPCs are not executable anonymously'
);

select is(
  (
    select count(*)::bigint
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('admin_delete_user', 'admin_delete_plan', 'consume_ai_search_quota')
       and has_function_privilege('service_role', p.oid, 'execute')
  ),
  (
    select count(*)::bigint
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('admin_delete_user', 'admin_delete_plan', 'consume_ai_search_quota')
  ),
  'service_role retains server-side access to every obsolete RPC'
);

select ok(
  not has_function_privilege('authenticated', 'public.admin_delete_user(uuid)', 'execute'),
  'admin_delete_user is not client-callable'
);

select ok(
  not has_function_privilege('authenticated', 'public.admin_delete_plan(uuid)', 'execute'),
  'admin_delete_plan is not client-callable'
);

select ok(
  not has_function_privilege('authenticated', 'public.consume_ai_search_quota(uuid)', 'execute'),
  'consume_ai_search_quota is not client-callable'
);

select * from finish();

rollback;

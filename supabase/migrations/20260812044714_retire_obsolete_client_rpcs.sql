-- Retire obsolete client-callable RPCs after removing their consumers.
-- Production was already changed; this migration records that state in GitHub.
-- Keep service_role access for controlled server-side maintenance only.

do $$
declare
  fn record;
begin
  for fn in
    select p.oid, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('admin_delete_user', 'admin_delete_plan', 'consume_ai_search_quota')
  loop
    execute format(
      'revoke execute on function %I.%I(%s) from public, anon, authenticated',
      fn.nspname, fn.proname, fn.args
    );
    execute format(
      'grant execute on function %I.%I(%s) to service_role',
      fn.nspname, fn.proname, fn.args
    );
  end loop;
end
$$;

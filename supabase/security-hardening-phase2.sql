-- NEXO security hardening - phase 2
-- Ejecutar completo una sola vez en Supabase SQL Editor.

begin;

-- Evita que clientes anónimos o autenticados puedan consultar si un email
-- concreto pertenece a una cuenta. El registro y el login siguen funcionando
-- a través de Supabase Auth.
do $$
declare
    fn regprocedure;
begin
    for fn in
        select p.oid::regprocedure
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'is_email_taken'
    loop
        execute format(
            'revoke all on function %s from public, anon, authenticated',
            fn
        );
    end loop;
end
$$;

commit;

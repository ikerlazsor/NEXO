-- NEXO security hardening - phase 5
-- Ejecutar completo una sola vez en Supabase SQL Editor.
-- Impone el bloqueo en PostgreSQL aunque el cliente falle o sea manipulado.

begin;

-- SECURITY DEFINER evita la recursión al consultar perfiles desde las políticas
-- aplicadas a la propia tabla perfiles.
create or replace function public.is_requesting_user_active()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select
        auth.uid() is not null
        and coalesce(
            (
                select p.baneado is not true
                from public.perfiles as p
                where p.id = auth.uid()
            ),
            true
        );
$$;

revoke all on function public.is_requesting_user_active() from public, anon;
grant execute on function public.is_requesting_user_active() to authenticated, service_role;

-- Un cliente autenticado nunca puede concederse permisos, quitarse un bloqueo
-- ni cambiar el motivo. Las RPC administrativas SECURITY DEFINER conservan
-- la capacidad de moderación.
create or replace function public.protect_account_control_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
    if current_user in ('authenticated', 'anon') then
        if tg_op = 'INSERT' then
            if new.rol is not null and new.rol <> 'user' then
                raise exception 'No está permitido asignar el rol de la cuenta'
                    using errcode = '42501';
            end if;
            if new.baneado is true or new.baneado_motivo is not null then
                raise exception 'No está permitido modificar el bloqueo de la cuenta'
                    using errcode = '42501';
            end if;
        elsif
            new.rol is distinct from old.rol
            or new.baneado is distinct from old.baneado
            or new.baneado_motivo is distinct from old.baneado_motivo
        then
            raise exception 'No está permitido modificar los controles de la cuenta'
                using errcode = '42501';
        end if;
    end if;

    return new;
end;
$$;

revoke all on function public.protect_account_control_columns() from public, anon, authenticated;

drop trigger if exists protect_account_control_columns_trigger on public.perfiles;
create trigger protect_account_control_columns_trigger
before insert or update on public.perfiles
for each row execute function public.protect_account_control_columns();

-- Perfiles es la única excepción de lectura: una cuenta bloqueada puede leer
-- su propia fila para que la app muestre el bloqueo y su motivo. No puede
-- insertar, actualizar ni borrar ninguna fila.
alter table public.perfiles enable row level security;

drop policy if exists nexo_active_profile_select on public.perfiles;
create policy nexo_active_profile_select
on public.perfiles
as restrictive
for select
to authenticated
using (
    public.is_requesting_user_active()
    or id = auth.uid()
);

drop policy if exists nexo_active_profile_insert on public.perfiles;
create policy nexo_active_profile_insert
on public.perfiles
as restrictive
for insert
to authenticated
with check (
    public.is_requesting_user_active()
    and id = auth.uid()
);

drop policy if exists nexo_active_profile_update on public.perfiles;
create policy nexo_active_profile_update
on public.perfiles
as restrictive
for update
to authenticated
using (public.is_requesting_user_active())
with check (public.is_requesting_user_active());

drop policy if exists nexo_active_profile_delete on public.perfiles;
create policy nexo_active_profile_delete
on public.perfiles
as restrictive
for delete
to authenticated
using (public.is_requesting_user_active());

-- Todas las demás tablas públicas reciben una política RESTRICTIVE. Al ser
-- restrictiva se combina con AND con las políticas existentes, de modo que
-- ninguna política permisiva previa puede abrir acceso a una cuenta bloqueada.
do $$
declare
    target record;
begin
    for target in
        select
            n.nspname as schema_name,
            c.relname as table_name,
            c.relrowsecurity as rls_was_enabled
        from pg_class as c
        join pg_namespace as n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind in ('r', 'p')
          and c.relname <> 'perfiles'
    loop
        execute format(
            'alter table %I.%I enable row level security',
            target.schema_name,
            target.table_name
        );

        -- Si RLS estaba desactivado, estas políticas base conservan el acceso
        -- por filas que antes daban los GRANT de la tabla. Los GRANT siguen
        -- determinando qué operaciones puede realizar cada rol.
        if not target.rls_was_enabled then
            execute format(
                'drop policy if exists nexo_previous_anon_access on %I.%I',
                target.schema_name,
                target.table_name
            );
            execute format(
                'create policy nexo_previous_anon_access on %I.%I for all to anon using (true) with check (true)',
                target.schema_name,
                target.table_name
            );
            execute format(
                'drop policy if exists nexo_previous_authenticated_access on %I.%I',
                target.schema_name,
                target.table_name
            );
            execute format(
                'create policy nexo_previous_authenticated_access on %I.%I for all to authenticated using (true) with check (true)',
                target.schema_name,
                target.table_name
            );
        end if;

        execute format(
            'drop policy if exists nexo_active_users_only on %I.%I',
            target.schema_name,
            target.table_name
        );
        execute format(
            'create policy nexo_active_users_only on %I.%I as restrictive for all to authenticated using (public.is_requesting_user_active()) with check (public.is_requesting_user_active())',
            target.schema_name,
            target.table_name
        );
    end loop;
end
$$;

commit;

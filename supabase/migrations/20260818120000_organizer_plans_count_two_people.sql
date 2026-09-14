-- Planes hechos del organizador: cuenta también planes de 2 personas
-- (organizador + 1 asistente aceptado).

begin;

create or replace function public.get_organizer_completed_plans_count(p_organizador_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select count(*)::integer
    from public.planes as p
    where p.creador_id = p_organizador_id
      and coalesce(p.modo_privado, false) = false
      and p.fecha_evento is not null
      and p.fecha_evento < now()
      and p.estado is distinct from 'cancelado'
      and (
          select count(*)
          from public.participantes as part
          where part.plan_id = p.id
            and part.estado = 'aceptado'
      ) >= 1;
$$;

revoke all on function public.get_organizer_completed_plans_count(uuid) from public;
grant execute on function public.get_organizer_completed_plans_count(uuid) to authenticated, anon, service_role;

notify pgrst, 'reload schema';

commit;

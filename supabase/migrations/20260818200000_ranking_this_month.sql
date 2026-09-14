-- Ranking de personas: planes aceptados con fecha de evento en el mes actual (Madrid).
-- SECURITY DEFINER porque participantes no es enumerable en global.

begin;

create or replace function public.get_person_ranking_this_month(
    p_limit integer default 80,
    p_user_ids uuid[] default null
)
returns table (usuario_id uuid, score integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    with month_bounds as (
        select
            date_trunc('month', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid' as start_at,
            (date_trunc('month', now() at time zone 'Europe/Madrid') + interval '1 month')
                at time zone 'Europe/Madrid' as end_at
    )
    select
        pa.usuario_id,
        count(*)::integer as score
    from public.participantes as pa
    join public.planes as pl on pl.id = pa.plan_id
    join public.perfiles as pe on pe.id = pa.usuario_id
    cross join month_bounds as mb
    where pa.estado = 'aceptado'
      and pl.fecha_evento >= mb.start_at
      and pl.fecha_evento < mb.end_at
      and pl.estado is distinct from 'cancelado'
      and coalesce(pl.is_direct_chat, false) = false
      and coalesce(pl.is_group_chat, false) = false
      and coalesce(pl.categoria, '') not in ('Chat', 'Grupo')
      and coalesce(pe.baneado, false) = false
      and (p_user_ids is null or pa.usuario_id = any (p_user_ids))
    group by pa.usuario_id
    having count(*) > 0
    order by count(*) desc, pa.usuario_id asc
    limit greatest(1, least(coalesce(p_limit, 80), 200));
$$;

revoke all on function public.get_person_ranking_this_month(integer, uuid[]) from public;
grant execute on function public.get_person_ranking_this_month(integer, uuid[]) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

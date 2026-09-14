-- Dashboard de producto para la cuenta owner.
-- Agrega usuarios, planes, embudo y confianza sin devolver datos personales.

begin;

create or replace function public.get_owner_analytics_dashboard(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_days integer;
    v_now timestamptz := now();
    v_start timestamptz;
    v_prev_start timestamptz;
    v_today date;
    v_today_start timestamptz;
    v_out jsonb;
begin
    if not public.is_owner() then
        raise exception 'not_authorized' using errcode = '42501';
    end if;

    v_days := case when coalesce(p_days, 7) >= 30 then 30 else 7 end;
    v_start := v_now - make_interval(days => v_days);
    v_prev_start := v_start - make_interval(days => v_days);
    v_today := (v_now at time zone 'Europe/Madrid')::date;
    v_today_start := v_today::timestamp at time zone 'Europe/Madrid';

    with real_plans as (
        select
            p.id,
            p.creador_id,
            p.categoria,
            p.estado,
            p.fecha_evento,
            p.creado_en
        from public.planes as p
        where coalesce(p.is_direct_chat, false) = false
          and coalesce(p.is_group_chat, false) = false
    ),
    activity as (
        select x.user_id, x.at
        from (
            select rp.creador_id as user_id, rp.creado_en as at
            from real_plans as rp
            union all
            select pa.usuario_id, pa.creado_en
            from public.participantes as pa
            join real_plans as rp on rp.id = pa.plan_id
            where pa.estado = 'aceptado'::public.tipo_estado_participante
            union all
            select m.emisor_id, m.creado_en
            from public.mensajes as m
            union all
            select v.evaluador_id, v.creado_en
            from public.valoraciones as v
        ) as x
        join public.perfiles as pe on pe.id = x.user_id
        where coalesce(pe.rol, 'user') <> 'owner'
    ),
    cohort as (
        select
            pe.id,
            pe.registro_completado,
            pe.creado_en
        from public.perfiles as pe
        where pe.creado_en >= v_start
          and pe.creado_en < v_now
          and coalesce(pe.rol, 'user') <> 'owner'
    ),
    plan_people as (
        select
            rp.id,
            rp.creado_en,
            (
                (
                    select count(*)
                    from public.participantes as pa
                    where pa.plan_id = rp.id
                      and pa.estado = 'aceptado'::public.tipo_estado_participante
                )
                + case
                    when exists (
                        select 1
                        from public.participantes as pa
                        where pa.plan_id = rp.id
                          and pa.usuario_id = rp.creador_id
                          and pa.estado = 'aceptado'::public.tipo_estado_participante
                    ) then 0
                    else 1
                  end
            )::integer as people
        from real_plans as rp
        where rp.creado_en >= v_start
          and rp.creado_en < v_now
    ),
    d1_cohort as (
        select pe.id, pe.creado_en
        from public.perfiles as pe
        where pe.creado_en < v_today_start - interval '1 day'
          and pe.creado_en >= v_today_start - interval '14 days'
          and coalesce(pe.rol, 'user') <> 'owner'
    ),
    d7_cohort as (
        select pe.id, pe.creado_en
        from public.perfiles as pe
        where pe.creado_en < v_today_start - interval '7 days'
          and pe.creado_en >= v_today_start - interval '21 days'
          and coalesce(pe.rol, 'user') <> 'owner'
    )
    select jsonb_build_object(
        'days', v_days,
        'generated_at', v_now,
        'health', jsonb_build_object(
            'users_total', (select count(*)::integer from public.perfiles),
            'users_onboarded', (
                select count(*)::integer
                from public.perfiles
                where registro_completado
            ),
            'users_banned', (
                select count(*)::integer
                from public.perfiles
                where baneado
            ),
            'dau', (
                select count(distinct a.user_id)::integer
                from activity as a
                where a.at >= v_today_start
            ),
            'wau', (
                select count(distinct a.user_id)::integer
                from activity as a
                where a.at >= v_now - interval '7 days'
            ),
            'mau', (
                select count(distinct a.user_id)::integer
                from activity as a
                where a.at >= v_now - interval '30 days'
            ),
            'new_users', (select count(*)::integer from cohort),
            'new_users_prev', (
                select count(*)::integer
                from public.perfiles as pe
                where pe.creado_en >= v_prev_start
                  and pe.creado_en < v_start
                  and coalesce(pe.rol, 'user') <> 'owner'
            ),
            'retention_d1', (
                select case
                    when count(*) < 5 then null
                    else round(
                        100.0 * count(*) filter (
                            where exists (
                                select 1
                                from activity as a
                                where a.user_id = d.id
                                  and (a.at at time zone 'Europe/Madrid')::date
                                      = (d.creado_en at time zone 'Europe/Madrid')::date + 1
                            )
                        ) / count(*),
                        1
                    )
                end
                from d1_cohort as d
            ),
            'retention_d1_n', (select count(*)::integer from d1_cohort),
            'retention_d7', (
                select case
                    when count(*) < 5 then null
                    else round(
                        100.0 * count(*) filter (
                            where exists (
                                select 1
                                from activity as a
                                where a.user_id = d.id
                                  and (a.at at time zone 'Europe/Madrid')::date
                                      = (d.creado_en at time zone 'Europe/Madrid')::date + 7
                            )
                        ) / count(*),
                        1
                    )
                end
                from d7_cohort as d
            ),
            'retention_d7_n', (select count(*)::integer from d7_cohort)
        ),
        'supply', jsonb_build_object(
            'plans', (select count(*)::integer from plan_people),
            'plans_prev', (
                select count(*)::integer
                from real_plans as rp
                where rp.creado_en >= v_prev_start
                  and rp.creado_en < v_start
            ),
            'upcoming', (
                select count(*)::integer
                from real_plans as rp
                where rp.fecha_evento >= v_now
                  and rp.estado is distinct from 'cancelado'
            ),
            'filled', (
                select count(*)::integer from plan_people where people >= 2
            ),
            'lonely', (
                select count(*)::integer from plan_people where people < 2
            ),
            'joins', (
                select count(*)::integer
                from public.participantes as pa
                join real_plans as rp on rp.id = pa.plan_id
                where pa.estado = 'aceptado'::public.tipo_estado_participante
                  and pa.creado_en >= v_start
                  and pa.creado_en < v_now
            ),
            'joins_prev', (
                select count(*)::integer
                from public.participantes as pa
                join real_plans as rp on rp.id = pa.plan_id
                where pa.estado = 'aceptado'::public.tipo_estado_participante
                  and pa.creado_en >= v_prev_start
                  and pa.creado_en < v_start
            )
        ),
        'funnel', jsonb_build_object(
            'signed_up', (select count(*)::integer from cohort),
            'onboarded', (
                select count(*)::integer from cohort where registro_completado
            ),
            'activated', (
                select count(*)::integer
                from cohort as c
                where exists (
                    select 1 from real_plans as rp
                    where rp.creador_id = c.id
                )
                   or exists (
                    select 1
                    from public.participantes as pa
                    join real_plans as rp on rp.id = pa.plan_id
                    where pa.usuario_id = c.id
                      and pa.estado = 'aceptado'::public.tipo_estado_participante
                )
            ),
            'messaged', (
                select count(*)::integer
                from cohort as c
                where exists (
                    select 1 from public.mensajes as m where m.emisor_id = c.id
                )
            ),
            'rated', (
                select count(*)::integer
                from cohort as c
                where exists (
                    select 1 from public.valoraciones as v where v.evaluador_id = c.id
                )
            )
        ),
        'series', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'd', to_char(g.day_ts::date, 'YYYY-MM-DD'),
                    'users', (
                        select count(*)::integer
                        from public.perfiles as pe
                        where (pe.creado_en at time zone 'Europe/Madrid')::date = g.day_ts::date
                          and coalesce(pe.rol, 'user') <> 'owner'
                    ),
                    'plans', (
                        select count(*)::integer
                        from real_plans as rp
                        where (rp.creado_en at time zone 'Europe/Madrid')::date = g.day_ts::date
                    )
                )
                order by g.day_ts
            )
            from generate_series(
                (v_start at time zone 'Europe/Madrid')::date,
                v_today,
                interval '1 day'
            ) as g(day_ts)
        ), '[]'::jsonb),
        'categories', coalesce((
            select jsonb_agg(jsonb_build_object('key', x.categoria, 'n', x.n) order by x.n desc)
            from (
                select rp.categoria, count(*)::integer as n
                from real_plans as rp
                where rp.creado_en >= v_start
                  and rp.creado_en < v_now
                group by rp.categoria
                order by count(*) desc
                limit 5
            ) as x
        ), '[]'::jsonb),
        'trust', jsonb_build_object(
            'reports_open', (
                select (
                    (select count(*) from public.reportes_usuarios where estado in ('abierto', 'en_revision'))
                    + (select count(*) from public.reportes_planes where estado in ('abierto', 'en_revision'))
                    + (select count(*) from public.reportes_mensajes where estado in ('abierto', 'en_revision'))
                )::integer
            ),
            'reports_period', (
                select (
                    (select count(*) from public.reportes_usuarios where creado_en >= v_start)
                    + (select count(*) from public.reportes_planes where creado_en >= v_start)
                    + (select count(*) from public.reportes_mensajes where creado_en >= v_start)
                )::integer
            ),
            'tickets_open', (
                select count(*)::integer
                from public.mensajes_soporte
                where estado in ('abierto', 'en_revision')
            ),
            'tickets_period', (
                select count(*)::integer
                from public.mensajes_soporte
                where creado_en >= v_start
            )
        ),
        'organizers', jsonb_build_object(
            'approved', (
                select count(*)::integer
                from public.perfiles
                where es_organizador
            ),
            'pending', (
                select count(*)::integer
                from public.solicitudes_organizador
                where estado = 'pendiente'
            ),
            'plans', (
                select count(*)::integer
                from real_plans as rp
                join public.perfiles as pe on pe.id = rp.creador_id
                where pe.es_organizador
                  and rp.creado_en >= v_start
                  and rp.creado_en < v_now
            )
        )
    )
    into v_out;

    return v_out;
end;
$$;

revoke all on function public.get_owner_analytics_dashboard(integer) from public, anon;
grant execute on function public.get_owner_analytics_dashboard(integer) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

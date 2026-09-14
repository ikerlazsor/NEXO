-- Insights privados para cuentas de comunidad.
-- Unicidad: una fila por persona (y plan, si aplica) y día en Europe/Madrid.
-- Así, entrar varias veces el mismo día no infla; semanas distintas sí cuentan
-- aparte en el rango «semana», y el mes sigue siendo personas distintas.

begin;

create table if not exists public.organizador_insight_events (
    id uuid primary key default gen_random_uuid(),
    organizador_id uuid not null references public.perfiles(id) on delete cascade,
    actor_id uuid not null references public.perfiles(id) on delete cascade,
    event_name text not null
        check (event_name in ('profile_view', 'plan_save', 'follow', 'unfollow')),
    plan_id uuid references public.planes(id) on delete set null,
    period_day date not null,
    created_at timestamptz not null default now(),
    check (organizador_id <> actor_id)
);

create unique index if not exists organizador_insight_view_day_uidx
    on public.organizador_insight_events (organizador_id, actor_id, period_day)
    where event_name = 'profile_view';

create unique index if not exists organizador_insight_save_day_uidx
    on public.organizador_insight_events (organizador_id, actor_id, plan_id, period_day)
    where event_name = 'plan_save' and plan_id is not null;

create unique index if not exists organizador_insight_follow_day_uidx
    on public.organizador_insight_events (organizador_id, actor_id, period_day)
    where event_name = 'follow';

create unique index if not exists organizador_insight_unfollow_day_uidx
    on public.organizador_insight_events (organizador_id, actor_id, period_day)
    where event_name = 'unfollow';

create index if not exists organizador_insight_org_name_day_idx
    on public.organizador_insight_events (organizador_id, event_name, period_day);

alter table public.organizador_insight_events enable row level security;

drop policy if exists organizador_insight_events_owner_select on public.organizador_insight_events;
create policy organizador_insight_events_owner_select
on public.organizador_insight_events
for select to authenticated
using (organizador_id = auth.uid());

drop policy if exists nexo_active_users_only on public.organizador_insight_events;
create policy nexo_active_users_only
on public.organizador_insight_events as restrictive
for all to authenticated
using (public.is_requesting_user_active())
with check (public.is_requesting_user_active());

revoke all on table public.organizador_insight_events from public, anon;
grant select on table public.organizador_insight_events to authenticated;
grant all on table public.organizador_insight_events to service_role;

create or replace function public.log_organizer_insight_event(
    p_organizador_id uuid,
    p_actor_id uuid,
    p_event_name text,
    p_plan_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if p_organizador_id is null
        or p_actor_id is null
        or p_organizador_id = p_actor_id
        or p_event_name not in ('profile_view', 'plan_save', 'follow', 'unfollow')
    then
        return;
    end if;
    if p_event_name = 'plan_save' and p_plan_id is null then
        return;
    end if;

    insert into public.organizador_insight_events (
        organizador_id,
        actor_id,
        event_name,
        plan_id,
        period_day
    ) values (
        p_organizador_id,
        p_actor_id,
        p_event_name,
        p_plan_id,
        (timezone('Europe/Madrid', now()))::date
    )
    on conflict do nothing;
end;
$$;

revoke all on function public.log_organizer_insight_event(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.log_organizer_insight_event(uuid, uuid, text, uuid) to service_role;

create or replace function public.record_organizer_profile_view(p_organizador_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid uuid := auth.uid();
begin
    if v_uid is null or p_organizador_id is null or v_uid = p_organizador_id then
        return;
    end if;
    if not public.is_requesting_user_active() then
        return;
    end if;
    if not exists (
        select 1
        from public.perfiles
        where id = p_organizador_id
          and es_organizador
          and coalesce(baneado, false) = false
    ) then
        return;
    end if;
    perform public.log_organizer_insight_event(p_organizador_id, v_uid, 'profile_view', null);
end;
$$;

revoke all on function public.record_organizer_profile_view(uuid) from public;
grant execute on function public.record_organizer_profile_view(uuid) to authenticated, service_role;

create or replace function public.trg_log_organizer_plan_save()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_org uuid;
    v_is_org boolean := false;
begin
    select pl.creador_id, coalesce(pf.es_organizador, false)
      into v_org, v_is_org
    from public.planes as pl
    join public.perfiles as pf on pf.id = pl.creador_id
    where pl.id = new.plan_id;

    if v_is_org and v_org is not null and v_org <> new.usuario_id then
        perform public.log_organizer_insight_event(v_org, new.usuario_id, 'plan_save', new.plan_id);
    end if;
    return new;
end;
$$;

drop trigger if exists trg_organizer_plan_save on public.planes_guardados;
create trigger trg_organizer_plan_save
after insert on public.planes_guardados
for each row
execute function public.trg_log_organizer_plan_save();

create or replace function public.follow_organizer(p_organizador_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    uid uuid := auth.uid();
    n int := 0;
begin
    if uid is null then
        raise exception 'not_authenticated';
    end if;
    if uid = p_organizador_id then
        raise exception 'cannot_follow_self';
    end if;
    if not exists (
        select 1 from public.perfiles
        where id = p_organizador_id and es_organizador and baneado is false
    ) then
        raise exception 'not_organizer';
    end if;
    insert into public.seguidores (seguidor_id, organizador_id)
    values (uid, p_organizador_id)
    on conflict do nothing;
    get diagnostics n = row_count;
    if n > 0 then
        perform public.log_organizer_insight_event(p_organizador_id, uid, 'follow', null);
    end if;
end;
$$;

create or replace function public.unfollow_organizer(p_organizador_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    n int := 0;
begin
    if auth.uid() is null then
        raise exception 'not_authenticated';
    end if;
    delete from public.seguidores
    where seguidor_id = auth.uid()
      and organizador_id = p_organizador_id;
    get diagnostics n = row_count;
    if n > 0 then
        perform public.log_organizer_insight_event(p_organizador_id, auth.uid(), 'unfollow', null);
    end if;
end;
$$;

revoke all on function public.follow_organizer(uuid) from public;
revoke all on function public.unfollow_organizer(uuid) from public;
grant execute on function public.follow_organizer(uuid) to authenticated, service_role;
grant execute on function public.unfollow_organizer(uuid) to authenticated, service_role;

insert into public.organizador_insight_events (
    organizador_id, actor_id, event_name, plan_id, period_day, created_at
)
select
    pl.creador_id,
    pg.usuario_id,
    'plan_save',
    pg.plan_id,
    (timezone('Europe/Madrid', pg.creado_en))::date,
    pg.creado_en
from public.planes_guardados as pg
join public.planes as pl on pl.id = pg.plan_id
join public.perfiles as pf on pf.id = pl.creador_id
where pf.es_organizador
  and pg.usuario_id <> pl.creador_id
on conflict do nothing;

insert into public.organizador_insight_events (
    organizador_id, actor_id, event_name, period_day, created_at
)
select
    s.organizador_id,
    s.seguidor_id,
    'follow',
    (timezone('Europe/Madrid', s.creado_en))::date,
    s.creado_en
from public.seguidores as s
on conflict do nothing;

create or replace function public.get_organizer_insights(p_range text default 'week')
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid uuid := auth.uid();
    v_now_local timestamp := timezone('Europe/Madrid', now());
    v_month_start timestamptz;
    v_out jsonb;
begin
    if v_uid is null then
        raise exception 'not_authenticated' using errcode = '42501';
    end if;
    if not exists (
        select 1 from public.perfiles
        where id = v_uid and es_organizador and coalesce(baneado, false) = false
    ) then
        raise exception 'not_authorized' using errcode = '42501';
    end if;

    v_month_start := date_trunc('month', v_now_local) at time zone 'Europe/Madrid';

    with real_plans as (
        select pl.id, pl.titulo, pl.creado_en
        from public.planes as pl
        where pl.creador_id = v_uid
          and coalesce(pl.is_direct_chat, false) = false
          and coalesce(pl.is_group_chat, false) = false
          and coalesce(pl.categoria, '') not in ('Grupo', 'Chat')
    ),
    join_rows as (
        select
            pa.usuario_id,
            pa.plan_id,
            date_trunc('week', timezone('Europe/Madrid', pa.creado_en)) as week_bucket
        from public.participantes as pa
        join real_plans as rp on rp.id = pa.plan_id
        where pa.estado = 'aceptado'::public.tipo_estado_participante
          and pa.usuario_id <> v_uid
          and pa.creado_en >= v_month_start
    ),
    view_rows as (
        select
            e.actor_id,
            date_trunc('week', timezone('Europe/Madrid', e.created_at)) as week_bucket
        from public.organizador_insight_events as e
        where e.organizador_id = v_uid
          and e.event_name = 'profile_view'
          and e.created_at >= v_month_start
    ),
    save_rows as (
        select
            e.actor_id,
            e.plan_id,
            date_trunc('week', timezone('Europe/Madrid', e.created_at)) as week_bucket
        from public.organizador_insight_events as e
        where e.organizador_id = v_uid
          and e.event_name = 'plan_save'
          and e.plan_id is not null
          and e.created_at >= v_month_start
    ),
    follow_rows as (
        select
            e.actor_id,
            date_trunc('week', timezone('Europe/Madrid', e.created_at)) as week_bucket
        from public.organizador_insight_events as e
        where e.organizador_id = v_uid
          and e.event_name = 'follow'
          and e.created_at >= v_month_start
    ),
    unfollow_rows as (
        select
            e.actor_id,
            date_trunc('week', timezone('Europe/Madrid', e.created_at)) as week_bucket
        from public.organizador_insight_events as e
        where e.organizador_id = v_uid
          and e.event_name = 'unfollow'
          and e.created_at >= v_month_start
    ),
    ratings as (
        select
            coalesce(round(avg(v.puntuacion_general)::numeric, 2), 0) as score,
            count(*) filter (where v.puntuacion_general is not null)::int as reviews
        from public.valoraciones as v
        where v.evaluado_id = v_uid
          and coalesce(v.tipo, 'persona') = 'organizacion'
    ),
    pos_keys as (
        select unnest(array[
            'organizado','buen_ambiente','puntual_org','comunicacion','fiel_anuncio'
        ]::text[]) as k
    ),
    neg_keys as (
        select unnest(array[
            'desorganizado','retraso','masificado','no_anunciado','mal_ambiente'
        ]::text[]) as k
    ),
    pos_counts as (
        select x.k, count(*)::int as n
        from public.valoraciones as v
        cross join lateral unnest(coalesce(v.aspectos_positivos, '{}'::text[])) as x(k)
        where v.evaluado_id = v_uid
          and coalesce(v.tipo, 'persona') = 'organizacion'
        group by x.k
    ),
    neg_counts as (
        select x.k, count(*)::int as n
        from public.valoraciones as v
        cross join lateral unnest(coalesce(v.aspectos_negativos, '{}'::text[])) as x(k)
        where v.evaluado_id = v_uid
          and coalesce(v.tipo, 'persona') = 'organizacion'
        group by x.k
    ),
    positives as (
        select jsonb_agg(
            jsonb_build_object('key', pk.k, 'n', coalesce(pc.n, 0))
            order by coalesce(pc.n, 0) desc, pk.k
        ) as items
        from pos_keys as pk
        left join pos_counts as pc on pc.k = pk.k
    ),
    negatives as (
        select jsonb_agg(
            jsonb_build_object('key', nk.k, 'n', coalesce(nc.n, 0))
            order by coalesce(nc.n, 0) desc, nk.k
        ) as items
        from neg_keys as nk
        left join neg_counts as nc on nc.k = nk.k
    ),
    members as (
        select pe.fecha_nacimiento, pe.genero
        from public.seguidores as s
        join public.perfiles as pe on pe.id = s.seguidor_id
        where s.organizador_id = v_uid
    ),
    joiners as (
        select pe.fecha_nacimiento, pe.genero
        from public.perfiles as pe
        where pe.id in (
            select pa.usuario_id
            from public.participantes as pa
            join real_plans as rp on rp.id = pa.plan_id
            where pa.estado = 'aceptado'::public.tipo_estado_participante
              and pa.usuario_id <> v_uid
        )
    ),
    member_stats as (
        select
            count(*)::int as total,
            round(avg(extract(year from age(fecha_nacimiento::timestamp)))::numeric, 1) as age_avg,
            count(*) filter (where fecha_nacimiento is not null)::int as age_n,
            count(*) filter (where genero = 'masculino')::int as masculino,
            count(*) filter (where genero = 'femenino')::int as femenino,
            count(*) filter (where genero = 'no_binario')::int as no_binario,
            count(*) filter (where genero = 'otro')::int as otro,
            count(*) filter (
                where genero is null or genero = 'prefiero_no_decir'
            )::int as unknown
        from members
    ),
    joiner_stats as (
        select
            count(*)::int as total,
            round(avg(extract(year from age(fecha_nacimiento::timestamp)))::numeric, 1) as age_avg,
            count(*) filter (where fecha_nacimiento is not null)::int as age_n,
            count(*) filter (where genero = 'masculino')::int as masculino,
            count(*) filter (where genero = 'femenino')::int as femenino,
            count(*) filter (where genero = 'no_binario')::int as no_binario,
            count(*) filter (where genero = 'otro')::int as otro,
            count(*) filter (
                where genero is null or genero = 'prefiero_no_decir'
            )::int as unknown
        from joiners
    ),
    top_saved as (
        select rp.id, rp.titulo, count(distinct e.actor_id)::int as n
        from public.organizador_insight_events as e
        join real_plans as rp on rp.id = e.plan_id
        where e.organizador_id = v_uid
          and e.event_name = 'plan_save'
        group by rp.id, rp.titulo
        order by n desc, rp.titulo
        limit 1
    ),
    top_joined as (
        select rp.id, rp.titulo, count(*)::int as n
        from public.participantes as pa
        join real_plans as rp on rp.id = pa.plan_id
        where pa.estado = 'aceptado'::public.tipo_estado_participante
          and pa.usuario_id <> v_uid
        group by rp.id, rp.titulo
        order by n desc, rp.titulo
        limit 1
    )
    select jsonb_build_object(
        'generated_at', now(),
        'activity', jsonb_build_object(
            'joins_week', (select count(distinct (usuario_id, plan_id, week_bucket))::int from join_rows),
            'joins_month', (select count(distinct (usuario_id, plan_id))::int from join_rows),
            'profile_views_week', (select count(distinct (actor_id, week_bucket))::int from view_rows),
            'profile_views_month', (select count(distinct actor_id)::int from view_rows),
            'saves_week', (select count(distinct (actor_id, plan_id, week_bucket))::int from save_rows),
            'saves_month', (select count(distinct (actor_id, plan_id))::int from save_rows),
            'follows_week', (select count(distinct (actor_id, week_bucket))::int from follow_rows),
            'follows_month', (select count(distinct actor_id)::int from follow_rows),
            'unfollows_week', (select count(distinct (actor_id, week_bucket))::int from unfollow_rows),
            'unfollows_month', (select count(distinct actor_id)::int from unfollow_rows)
        ),
        'followers_total', (
            select count(*)::int from public.seguidores where organizador_id = v_uid
        ),
        'rating', jsonb_build_object(
            'score', (select score from ratings),
            'reviews', (select reviews from ratings),
            'positives', coalesce((select items from positives), '[]'::jsonb),
            'negatives', coalesce((select items from negatives), '[]'::jsonb)
        ),
        'members', jsonb_build_object(
            'total', (select total from member_stats),
            'age_avg', (select age_avg from member_stats),
            'age_n', (select age_n from member_stats),
            'gender', jsonb_build_object(
                'masculino', (select masculino from member_stats),
                'femenino', (select femenino from member_stats),
                'no_binario', (select no_binario from member_stats),
                'otro', (select otro from member_stats),
                'unknown', (select unknown from member_stats)
            )
        ),
        'joiners', jsonb_build_object(
            'total', (select total from joiner_stats),
            'age_avg', (select age_avg from joiner_stats),
            'age_n', (select age_n from joiner_stats),
            'gender', jsonb_build_object(
                'masculino', (select masculino from joiner_stats),
                'femenino', (select femenino from joiner_stats),
                'no_binario', (select no_binario from joiner_stats),
                'otro', (select otro from joiner_stats),
                'unknown', (select unknown from joiner_stats)
            )
        ),
        'top_saved', (
            select case when ts.id is null then null else jsonb_build_object(
                'id', ts.id, 'title', ts.titulo, 'n', ts.n
            ) end
            from top_saved as ts
        ),
        'top_joined', (
            select case when tj.id is null then null else jsonb_build_object(
                'id', tj.id, 'title', tj.titulo, 'n', tj.n
            ) end
            from top_joined as tj
        )
    )
    into v_out;

    return coalesce(v_out, '{}'::jsonb);
end;
$$;

revoke all on function public.get_organizer_insights(text) from public;
grant execute on function public.get_organizer_insights(text) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

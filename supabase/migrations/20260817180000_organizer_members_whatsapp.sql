begin;

alter table public.solicitudes_organizador
    add column if not exists whatsapp text;

drop function if exists public.request_organizer_account(text, text, text, text, text, text, text, text, text[], text, text);
drop function if exists public.request_organizer_account(text, text, text, text, text, text, text, text, text[], text, text, text);

create function public.request_organizer_account(
    p_nombre text,
    p_tipo text,
    p_ciudad text,
    p_web text,
    p_instagram text,
    p_descripcion text,
    p_motivo text default '',
    p_cover_url text default null,
    p_categorias text[] default '{}'::text[],
    p_informacion text default '',
    p_logo_url text default null,
    p_whatsapp text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    uid uuid := auth.uid();
    rid uuid;
    v_cats text[];
    v_desc text := btrim(coalesce(p_descripcion, ''));
    v_info text := btrim(coalesce(p_informacion, ''));
begin
    if uid is null then
        raise exception 'not_authenticated';
    end if;
    if not public.is_requesting_user_active() then
        raise exception 'account_banned';
    end if;
    if exists (select 1 from public.perfiles where id = uid and es_organizador) then
        raise exception 'already_organizer';
    end if;
    if exists (
        select 1 from public.solicitudes_organizador
        where usuario_id = uid and estado = 'pendiente'
    ) then
        raise exception 'request_pending';
    end if;
    if length(btrim(coalesce(p_nombre, ''))) < 2
        or length(v_desc) < 20
        or length(v_desc) > 300
        or length(v_info) < 40
        or length(v_info) > 4000
        or p_tipo not in ('sports', 'erasmus', 'leisure', 'community', 'other')
    then
        raise exception 'invalid_request';
    end if;

    v_cats := coalesce((
        select array_agg(distinct x)
        from unnest(coalesce(p_categorias, '{}'::text[])) as x
        where x in ('sports', 'erasmus', 'leisure', 'community', 'other', 'social', 'tardeos', 'travel', 'events')
    ), '{}'::text[]);
    if cardinality(v_cats) = 0 then
        v_cats := array[p_tipo];
    end if;

    insert into public.solicitudes_organizador (
        usuario_id, nombre_org, tipo, ciudad, web, instagram, whatsapp, descripcion, motivo,
        cover_url, categorias, informacion, logo_url
    ) values (
        uid,
        left(btrim(p_nombre), 80),
        p_tipo,
        nullif(left(btrim(coalesce(p_ciudad, '')), 80), ''),
        nullif(left(btrim(coalesce(p_web, '')), 200), ''),
        nullif(left(btrim(coalesce(p_instagram, '')), 80), ''),
        nullif(left(btrim(coalesce(p_whatsapp, '')), 200), ''),
        left(v_desc, 300),
        left(btrim(coalesce(p_motivo, '')), 800),
        nullif(left(btrim(coalesce(p_cover_url, '')), 500), ''),
        v_cats,
        left(v_info, 4000),
        nullif(left(btrim(coalesce(p_logo_url, '')), 500), '')
    )
    returning id into rid;

    return rid;
end;
$$;

revoke all on function public.request_organizer_account(text, text, text, text, text, text, text, text, text[], text, text, text) from public;
grant execute on function public.request_organizer_account(text, text, text, text, text, text, text, text, text[], text, text, text) to authenticated, service_role;

create or replace function public.admin_set_organizer_request(
    p_id uuid,
    p_estado text,
    p_notas text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    rec public.solicitudes_organizador;
    existing jsonb;
begin
    if not public.is_staff() then
        raise exception 'not_authorized';
    end if;
    if p_estado not in ('aprobado', 'rechazado') then
        raise exception 'invalid_estado';
    end if;

    select * into rec from public.solicitudes_organizador where id = p_id;
    if not found then
        raise exception 'not_found';
    end if;
    if rec.estado <> 'pendiente' then
        raise exception 'already_reviewed';
    end if;

    update public.solicitudes_organizador
    set estado = p_estado,
        notas_internas = nullif(btrim(coalesce(p_notas, '')), ''),
        revisado_por = auth.uid(),
        revisado_en = now()
    where id = p_id;

    if p_estado = 'aprobado' then
        select coalesce(organizador, '{}'::jsonb) into existing
        from public.perfiles where id = rec.usuario_id;

        update public.perfiles
        set es_organizador = true,
            nombre = rec.nombre_org,
            descripcion = rec.descripcion,
            cover_url = coalesce(rec.cover_url, cover_url),
            avatar_url = coalesce(rec.logo_url, avatar_url),
            organizador = coalesce(existing, '{}'::jsonb) || jsonb_build_object(
                'tipo', rec.tipo,
                'ciudad', rec.ciudad,
                'web', rec.web,
                'instagram', rec.instagram,
                'whatsapp', rec.whatsapp,
                'categorias', to_jsonb(coalesce(rec.categorias, array[rec.tipo])),
                'portada', coalesce(rec.cover_url, existing->>'portada'),
                'informacion', rec.informacion
            )
        where id = rec.usuario_id;
    end if;
end;
$$;

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
      ) >= 2;
$$;

revoke all on function public.get_organizer_completed_plans_count(uuid) from public;
grant execute on function public.get_organizer_completed_plans_count(uuid) to authenticated, anon, service_role;

grant select on public.seguidores to authenticated;

create or replace function public.get_organizer_member_ids(p_organizador_id uuid)
returns table (seguidor_id uuid, creado_en timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select s.seguidor_id, s.creado_en
    from public.seguidores as s
    where s.organizador_id = p_organizador_id
    order by s.creado_en desc
    limit 200;
$$;

revoke all on function public.get_organizer_member_ids(uuid) from public;
grant execute on function public.get_organizer_member_ids(uuid) to authenticated, anon, service_role;

notify pgrst, 'reload schema';

commit;

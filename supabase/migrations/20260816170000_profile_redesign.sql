begin;

alter table public.perfiles
    add column if not exists cover_url text;

alter table public.solicitudes_organizador
    add column if not exists cover_url text;

alter table public.solicitudes_organizador
    add column if not exists categorias text[] not null default '{}'::text[];

drop function if exists public.get_public_profiles(uuid[]);

create function public.get_public_profiles(p_user_ids uuid[])
returns table (
    id uuid,
    nombre text,
    nombre_usuario text,
    avatar_url text,
    cover_url text,
    descripcion text,
    etiquetas text[],
    edad integer,
    genero public.tipo_genero,
    habitos_consumo jsonb,
    ambientes_preferidos text[],
    perfil_gustos jsonb,
    es_organizador boolean,
    organizador jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    requester uuid := auth.uid();
begin
    if requester is null then
        raise exception 'not_authenticated';
    end if;
    if not public.is_requesting_user_active() then
        raise exception 'account_banned';
    end if;
    if p_user_ids is null or cardinality(p_user_ids) = 0 then
        return;
    end if;
    if cardinality(p_user_ids) > 200 then
        raise exception 'too_many_profiles';
    end if;

    return query
    select
        p.id,
        p.nombre,
        p.nombre_usuario,
        p.avatar_url,
        coalesce(
            nullif(btrim(coalesce(p.cover_url, '')), ''),
            nullif(btrim(coalesce(p.organizador->>'portada', '')), ''),
            nullif(btrim(coalesce(p.perfil_gustos->>'cover_url', '')), '')
        ) as cover_url,
        p.descripcion,
        case
            when p.es_organizador then '{}'::text[]
            when coalesce((p.perfil_gustos #>> '{privacidad,mostrar_aficiones}')::boolean, true)
                then coalesce(p.etiquetas, '{}'::text[])
            else '{}'::text[]
        end as etiquetas,
        case
            when p.es_organizador then null
            when coalesce((p.perfil_gustos #>> '{privacidad,mostrar_edad}')::boolean, true)
                 and p.fecha_nacimiento is not null
                then extract(year from age(current_date, p.fecha_nacimiento))::integer
            else null
        end as edad,
        case
            when p.es_organizador then null
            when coalesce((p.perfil_gustos #>> '{privacidad,mostrar_genero}')::boolean, true)
                then p.genero
            else null
        end as genero,
        case
            when p.es_organizador then '{}'::jsonb
            else jsonb_build_object(
                'bebida', case
                    when coalesce((p.perfil_gustos #>> '{privacidad,mostrar_bebida}')::boolean, true)
                        then coalesce(p.habitos_consumo->'bebida', '"no_especificado"'::jsonb)
                    else '"no_especificado"'::jsonb
                end,
                'tabaco', case
                    when coalesce((p.perfil_gustos #>> '{privacidad,mostrar_tabaco}')::boolean, true)
                        then coalesce(p.habitos_consumo->'tabaco', '"no_especificado"'::jsonb)
                    else '"no_especificado"'::jsonb
                end
            )
        end as habitos_consumo,
        case
            when p.es_organizador then '{}'::text[]
            when coalesce((p.perfil_gustos #>> '{privacidad,mostrar_aficiones}')::boolean, true)
                then coalesce(p.ambientes_preferidos, '{}'::text[])
            else '{}'::text[]
        end as ambientes_preferidos,
        jsonb_build_object(
            'privacidad', jsonb_build_object(
                'mostrar_edad', coalesce((p.perfil_gustos #>> '{privacidad,mostrar_edad}')::boolean, true),
                'mostrar_genero', coalesce((p.perfil_gustos #>> '{privacidad,mostrar_genero}')::boolean, true),
                'mostrar_bebida', coalesce((p.perfil_gustos #>> '{privacidad,mostrar_bebida}')::boolean, true),
                'mostrar_tabaco', coalesce((p.perfil_gustos #>> '{privacidad,mostrar_tabaco}')::boolean, true),
                'mostrar_aficiones', coalesce((p.perfil_gustos #>> '{privacidad,mostrar_aficiones}')::boolean, true)
            ),
            'cover_url', coalesce(
                nullif(btrim(coalesce(p.cover_url, '')), ''),
                nullif(btrim(coalesce(p.organizador->>'portada', '')), ''),
                nullif(btrim(coalesce(p.perfil_gustos->>'cover_url', '')), '')
            )
        ) as perfil_gustos,
        p.es_organizador,
        case when p.es_organizador then coalesce(p.organizador, '{}'::jsonb) else '{}'::jsonb end
    from public.perfiles as p
    where p.id = any(p_user_ids)
      and public.can_view_profile_identity(p.id);
end;
$$;

revoke all on function public.get_public_profiles(uuid[]) from public;
grant execute on function public.get_public_profiles(uuid[]) to authenticated, service_role;

drop function if exists public.request_organizer_account(text, text, text, text, text, text, text);

create function public.request_organizer_account(
    p_nombre text,
    p_tipo text,
    p_ciudad text,
    p_web text,
    p_instagram text,
    p_descripcion text,
    p_motivo text,
    p_cover_url text default null,
    p_categorias text[] default '{}'::text[]
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
        or length(btrim(coalesce(p_descripcion, ''))) < 20
        or length(btrim(coalesce(p_motivo, ''))) < 12
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
        usuario_id, nombre_org, tipo, ciudad, web, instagram, descripcion, motivo, cover_url, categorias
    ) values (
        uid,
        left(btrim(p_nombre), 80),
        p_tipo,
        nullif(left(btrim(coalesce(p_ciudad, '')), 80), ''),
        nullif(left(btrim(coalesce(p_web, '')), 200), ''),
        nullif(left(btrim(coalesce(p_instagram, '')), 80), ''),
        left(btrim(p_descripcion), 800),
        left(btrim(p_motivo), 800),
        nullif(left(btrim(coalesce(p_cover_url, '')), 500), ''),
        v_cats
    )
    returning id into rid;

    update public.perfiles
    set cover_url = coalesce(nullif(left(btrim(coalesce(p_cover_url, '')), 500), ''), cover_url),
        descripcion = left(btrim(p_descripcion), 5000),
        organizador = coalesce(organizador, '{}'::jsonb) || jsonb_build_object(
            'portada', nullif(left(btrim(coalesce(p_cover_url, '')), 500), ''),
            'categorias', to_jsonb(v_cats)
        )
    where id = uid;

    return rid;
end;
$$;

revoke all on function public.request_organizer_account(text, text, text, text, text, text, text, text, text[]) from public;
grant execute on function public.request_organizer_account(text, text, text, text, text, text, text, text, text[]) to authenticated, service_role;

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
            organizador = coalesce(existing, '{}'::jsonb) || jsonb_build_object(
                'tipo', rec.tipo,
                'ciudad', rec.ciudad,
                'web', rec.web,
                'instagram', rec.instagram,
                'categorias', to_jsonb(coalesce(rec.categorias, array[rec.tipo])),
                'portada', coalesce(rec.cover_url, existing->>'portada')
            )
        where id = rec.usuario_id;
    end if;
end;
$$;

create or replace function public.get_mutual_friends(p_other_id uuid, p_limit integer default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    uid uuid := auth.uid();
    v_limit integer := greatest(1, least(coalesce(p_limit, 5), 12));
    v_total integer := 0;
    v_items jsonb := '[]'::jsonb;
begin
    if uid is null then
        raise exception 'not_authenticated';
    end if;
    if p_other_id is null or p_other_id = uid then
        return jsonb_build_object('total', 0, 'items', '[]'::jsonb);
    end if;
    if not public.can_view_profile_identity(p_other_id) then
        return jsonb_build_object('total', 0, 'items', '[]'::jsonb);
    end if;

    with my_friends as (
        select case
            when a.usuario_origen_id = uid then a.usuario_destino_id
            else a.usuario_origen_id
        end as fid
        from public.amistades a
        where a.estado = 'aceptado'
          and (a.usuario_origen_id = uid or a.usuario_destino_id = uid)
    ),
    their_friends as (
        select case
            when a.usuario_origen_id = p_other_id then a.usuario_destino_id
            else a.usuario_origen_id
        end as fid
        from public.amistades a
        where a.estado = 'aceptado'
          and (a.usuario_origen_id = p_other_id or a.usuario_destino_id = p_other_id)
    ),
    mutual as (
        select m.fid
        from my_friends m
        join their_friends t on t.fid = m.fid
        where m.fid <> uid and m.fid <> p_other_id
          and public.can_view_profile_identity(m.fid)
    )
    select count(*)::integer into v_total from mutual;

    select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id,
        'nombre', coalesce(p.nombre, 'Usuario'),
        'avatar_url', p.avatar_url
    ) order by p.nombre), '[]'::jsonb)
    into v_items
    from (
        select fid from mutual limit v_limit
    ) x
    join public.perfiles p on p.id = x.fid;

    return jsonb_build_object('total', v_total, 'items', coalesce(v_items, '[]'::jsonb));
end;
$$;

revoke all on function public.get_mutual_friends(uuid, integer) from public;
grant execute on function public.get_mutual_friends(uuid, integer) to authenticated, service_role;

create or replace function public.get_public_attended_plans(p_user_id uuid, p_limit integer default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    uid uuid := auth.uid();
    v_limit integer := greatest(1, least(coalesce(p_limit, 12), 40));
    v_items jsonb := '[]'::jsonb;
begin
    if uid is null then
        raise exception 'not_authenticated';
    end if;
    if p_user_id is null or not public.can_view_profile_identity(p_user_id) then
        return '[]'::jsonb;
    end if;

    select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
    into v_items
    from (
        select
            pl.id,
            pl.titulo,
            pl.imagen_url,
            pl.fecha_evento,
            pl.nombre_ubicacion,
            pl.categoria
        from public.historial_planes hp
        join public.planes pl on pl.id = hp.plan_id
        where hp.usuario_id = p_user_id
          and coalesce(pl.modo_privado, false) = false
        order by coalesce(pl.fecha_evento, hp.creado_en) desc nulls last
        limit v_limit
    ) x;

    return coalesce(v_items, '[]'::jsonb);
end;
$$;

revoke all on function public.get_public_attended_plans(uuid, integer) from public;
grant execute on function public.get_public_attended_plans(uuid, integer) to authenticated, service_role;

create or replace function public.get_organizer_friend_attendees(p_organizador_id uuid, p_limit integer default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    uid uuid := auth.uid();
    v_limit integer := greatest(1, least(coalesce(p_limit, 5), 12));
    v_total integer := 0;
    v_items jsonb := '[]'::jsonb;
begin
    if uid is null then
        raise exception 'not_authenticated';
    end if;
    if p_organizador_id is null or not public.can_view_profile_identity(p_organizador_id) then
        return jsonb_build_object('total', 0, 'items', '[]'::jsonb);
    end if;

    with my_friends as (
        select case
            when a.usuario_origen_id = uid then a.usuario_destino_id
            else a.usuario_origen_id
        end as fid
        from public.amistades a
        where a.estado = 'aceptado'
          and (a.usuario_origen_id = uid or a.usuario_destino_id = uid)
    ),
    attended as (
        select distinct hp.usuario_id as fid
        from public.historial_planes hp
        join public.planes pl on pl.id = hp.plan_id
        join my_friends f on f.fid = hp.usuario_id
        where pl.creador_id = p_organizador_id
          and coalesce(pl.modo_privado, false) = false
          and hp.usuario_id <> uid
          and public.can_view_profile_identity(hp.usuario_id)
    )
    select count(*)::integer into v_total from attended;

    select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id,
        'nombre', coalesce(p.nombre, 'Usuario'),
        'avatar_url', p.avatar_url
    )), '[]'::jsonb)
    into v_items
    from (
        select fid from attended limit v_limit
    ) x
    join public.perfiles p on p.id = x.fid;

    return jsonb_build_object('total', v_total, 'items', coalesce(v_items, '[]'::jsonb));
end;
$$;

revoke all on function public.get_organizer_friend_attendees(uuid, integer) from public;
grant execute on function public.get_organizer_friend_attendees(uuid, integer) to authenticated, service_role;

commit;

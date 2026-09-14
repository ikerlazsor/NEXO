begin;

alter table public.perfiles
    add column if not exists es_organizador boolean not null default false;

alter table public.perfiles
    add column if not exists organizador jsonb not null default '{}'::jsonb;

alter table public.planes
    add column if not exists imagenes_url text[] not null default '{}'::text[];

alter table public.planes
    add column if not exists recurrencia jsonb;

alter table public.planes
    add column if not exists serie_id uuid;

create table if not exists public.solicitudes_organizador (
    id uuid primary key default gen_random_uuid(),
    usuario_id uuid not null references public.perfiles(id) on delete cascade,
    nombre_org text not null,
    tipo text not null,
    ciudad text,
    web text,
    instagram text,
    descripcion text not null,
    motivo text not null,
    estado text not null default 'pendiente'
        check (estado in ('pendiente', 'aprobado', 'rechazado')),
    notas_internas text,
    revisado_por uuid references public.perfiles(id) on delete set null,
    revisado_en timestamptz,
    creado_en timestamptz not null default now()
);

create index if not exists solicitudes_organizador_estado_idx
    on public.solicitudes_organizador (estado, creado_en desc);

create unique index if not exists solicitudes_organizador_one_pending
    on public.solicitudes_organizador (usuario_id)
    where estado = 'pendiente';

create table if not exists public.seguidores (
    seguidor_id uuid not null references public.perfiles(id) on delete cascade,
    organizador_id uuid not null references public.perfiles(id) on delete cascade,
    creado_en timestamptz not null default now(),
    primary key (seguidor_id, organizador_id),
    check (seguidor_id <> organizador_id)
);

create index if not exists seguidores_organizador_idx
    on public.seguidores (organizador_id);

alter table public.solicitudes_organizador enable row level security;
alter table public.seguidores enable row level security;

drop policy if exists solicitudes_organizador_select_own on public.solicitudes_organizador;
create policy solicitudes_organizador_select_own
on public.solicitudes_organizador for select to authenticated
using (usuario_id = auth.uid() or public.is_staff());

drop policy if exists seguidores_select on public.seguidores;
create policy seguidores_select
on public.seguidores for select to authenticated
using (true);

create or replace function public.protect_account_control_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
    if current_user in ('authenticated', 'anon') then
        if tg_op = 'INSERT' then
            if new.rol is not null and new.rol <> 'user' then
                raise exception 'No está permitido asignar el rol de la cuenta' using errcode = '42501';
            end if;
            if new.baneado is true or new.baneado_motivo is not null then
                raise exception 'No está permitido modificar el bloqueo de la cuenta' using errcode = '42501';
            end if;
            if new.es_organizador is true then
                raise exception 'No está permitido asignar la cuenta de organizador' using errcode = '42501';
            end if;
        elsif
            new.rol is distinct from old.rol
            or new.baneado is distinct from old.baneado
            or new.baneado_motivo is distinct from old.baneado_motivo
            or new.es_organizador is distinct from old.es_organizador
        then
            raise exception 'No está permitido modificar los controles de la cuenta' using errcode = '42501';
        end if;
    end if;
    return new;
end;
$$;

create or replace function public.request_organizer_account(
    p_nombre text,
    p_tipo text,
    p_ciudad text,
    p_web text,
    p_instagram text,
    p_descripcion text,
    p_motivo text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    uid uuid := auth.uid();
    rid uuid;
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

    insert into public.solicitudes_organizador (
        usuario_id, nombre_org, tipo, ciudad, web, instagram, descripcion, motivo
    ) values (
        uid,
        left(btrim(p_nombre), 80),
        p_tipo,
        nullif(left(btrim(coalesce(p_ciudad, '')), 80), ''),
        nullif(left(btrim(coalesce(p_web, '')), 200), ''),
        nullif(left(btrim(coalesce(p_instagram, '')), 80), ''),
        left(btrim(p_descripcion), 800),
        left(btrim(p_motivo), 800)
    )
    returning id into rid;

    return rid;
end;
$$;

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
        update public.perfiles
        set es_organizador = true,
            nombre = rec.nombre_org,
            descripcion = rec.descripcion,
            organizador = jsonb_build_object(
                'tipo', rec.tipo,
                'ciudad', rec.ciudad,
                'web', rec.web,
                'instagram', rec.instagram
            )
        where id = rec.usuario_id;
    end if;
end;
$$;

create or replace function public.follow_organizer(p_organizador_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    uid uuid := auth.uid();
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
end;
$$;

create or replace function public.unfollow_organizer(p_organizador_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if auth.uid() is null then
        raise exception 'not_authenticated';
    end if;
    delete from public.seguidores
    where seguidor_id = auth.uid()
      and organizador_id = p_organizador_id;
end;
$$;

create or replace function public.get_organizer_follow_stats(p_organizador_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select jsonb_build_object(
        'followers', (
            select count(*)::integer from public.seguidores where organizador_id = p_organizador_id
        ),
        'following', exists (
            select 1 from public.seguidores
            where organizador_id = p_organizador_id and seguidor_id = auth.uid()
        )
    );
$$;

create or replace function public.materialize_organizer_recurrence()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    src public.planes;
    next_at timestamptz;
    created int := 0;
    step interval;
begin
    for src in
        select p.*
        from public.planes p
        join public.perfiles c on c.id = p.creador_id
        where c.es_organizador
          and p.recurrencia is not null
          and coalesce((p.recurrencia->>'paused')::boolean, false) = false
          and p.fecha_evento is not null
          and p.fecha_evento <= now() + interval '12 hours'
          and p.estado not in ('cancelado')
          and not exists (
              select 1 from public.planes n
              where n.serie_id = coalesce(p.serie_id, p.id)
                and n.fecha_evento > p.fecha_evento
          )
        order by p.fecha_evento
        limit 40
    loop
        step := case
            when src.recurrencia->>'freq' = 'biweekly' then interval '14 days'
            else interval '7 days'
        end;
        next_at := src.fecha_evento + step;
        if src.recurrencia ? 'until'
           and nullif(src.recurrencia->>'until', '') is not null
           and next_at::date > (src.recurrencia->>'until')::date
        then
            continue;
        end if;

        insert into public.planes (
            titulo, descripcion, categoria, tipo_deporte, creador_id, fecha_evento,
            maximo_participantes, minimo_participantes, imagen_url, imagenes_url,
            nombre_ubicacion, latitud, longitud, requiere_aprobacion, solo_chicas,
            solo_amigos, modo_privado, is_direct_chat, is_group_chat, recurrencia, serie_id
        ) values (
            src.titulo, src.descripcion, src.categoria, src.tipo_deporte, src.creador_id, next_at,
            src.maximo_participantes, src.minimo_participantes, src.imagen_url, src.imagenes_url,
            src.nombre_ubicacion, src.latitud, src.longitud, src.requiere_aprobacion, src.solo_chicas,
            false, false, false, false, src.recurrencia, coalesce(src.serie_id, src.id)
        );

        insert into public.participantes (plan_id, usuario_id, estado)
        select id, src.creador_id, 'aceptado' from public.planes
        where creador_id = src.creador_id and fecha_evento = next_at
        order by creado_en desc limit 1
        on conflict do nothing;

        created := created + 1;
    end loop;
    return created;
end;
$$;

create or replace function public.create_meetup_plan(p_payload jsonb)
returns planes
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid uuid := auth.uid();
    v_plan public.planes;
    v_max int;
    v_min int;
    v_limit int := 3;
    v_images text[];
    v_rec jsonb;
    v_serie uuid;
begin
    if v_uid is null then
        raise exception 'not_authenticated' using errcode = '42501';
    end if;

    if exists (select 1 from public.perfiles where id = v_uid and es_organizador) then
        v_limit := 10;
    end if;

    if to_regprocedure('public.count_user_active_plans(uuid)') is not null then
        if public.count_user_active_plans(v_uid) >= v_limit then
            raise exception 'active_plan_limit_reached' using errcode = 'P0001';
        end if;
    end if;

    v_max := greatest(2, least(
        case when exists (select 1 from public.perfiles where id = v_uid and es_organizador) then 800 else 25 end,
        coalesce((p_payload->>'maximo_participantes')::int, 4)
    ));
    v_min := greatest(2, least(v_max, coalesce((p_payload->>'minimo_participantes')::int, 2)));
    v_images := coalesce(
        array(select jsonb_array_elements_text(p_payload->'imagenes_url')),
        '{}'::text[]
    );
    v_rec := case when p_payload ? 'recurrencia' then p_payload->'recurrencia' else null end;
    v_serie := case when v_rec is not null then gen_random_uuid() else null end;

    insert into public.planes (
        titulo, descripcion, categoria, tipo_deporte, creador_id, fecha_evento,
        maximo_participantes, minimo_participantes, imagen_url, imagenes_url,
        nombre_ubicacion, latitud, longitud, requiere_aprobacion, solo_chicas,
        solo_amigos, modo_privado, is_direct_chat, is_group_chat, recurrencia, serie_id
    ) values (
        nullif(trim(coalesce(p_payload->>'titulo', '')), ''),
        nullif(trim(coalesce(p_payload->>'descripcion', '')), ''),
        nullif(trim(coalesce(p_payload->>'categoria', '')), ''),
        nullif(trim(coalesce(p_payload->>'tipo_deporte', '')), ''),
        v_uid,
        nullif(p_payload->>'fecha_evento', '')::timestamptz,
        v_max, v_min,
        nullif(trim(coalesce(p_payload->>'imagen_url', '')), ''),
        v_images,
        nullif(trim(coalesce(p_payload->>'nombre_ubicacion', '')), ''),
        nullif(p_payload->>'latitud', '')::float8,
        nullif(p_payload->>'longitud', '')::float8,
        coalesce((p_payload->>'requiere_aprobacion')::boolean, false),
        coalesce((p_payload->>'solo_chicas')::boolean, false),
        coalesce((p_payload->>'solo_amigos')::boolean, false),
        coalesce((p_payload->>'modo_privado')::boolean, false),
        false, false, v_rec, v_serie
    )
    returning * into v_plan;

    insert into public.participantes (plan_id, usuario_id, estado)
    values (v_plan.id, v_uid, 'aceptado')
    on conflict do nothing;

    return v_plan;
end;
$$;

drop function if exists public.get_public_profiles(uuid[]);

create function public.get_public_profiles(p_user_ids uuid[])
returns table (
    id uuid,
    nombre text,
    nombre_usuario text,
    avatar_url text,
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
            )
        ) as perfil_gustos,
        p.es_organizador,
        case when p.es_organizador then coalesce(p.organizador, '{}'::jsonb) else '{}'::jsonb end
    from public.perfiles as p
    where p.id = any(p_user_ids)
      and public.can_view_profile_identity(p.id);
end;
$$;

create or replace function public.admin_moderation_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    c_soporte integer := 0;
    c_planes integer := 0;
    c_users integer := 0;
    c_messages integer := 0;
    c_orgs integer := 0;
begin
    if not public.is_staff() then
        raise exception 'not_authorized';
    end if;

    select count(*)::integer into c_soporte
      from public.mensajes_soporte where estado in ('abierto', 'en_revision');
    select count(*)::integer into c_planes
      from public.reportes_planes where estado in ('abierto', 'en_revision');
    select count(*)::integer into c_users
      from public.reportes_usuarios where estado in ('abierto', 'en_revision');
    select count(*)::integer into c_messages
      from public.reportes_mensajes where estado in ('abierto', 'en_revision');
    select count(*)::integer into c_orgs
      from public.solicitudes_organizador where estado = 'pendiente';

    return jsonb_build_object(
        'soporte', c_soporte,
        'reportes_planes', c_planes,
        'reportes_usuarios', c_users,
        'reportes_mensajes', c_messages,
        'organizadores', c_orgs,
        'total', c_soporte + c_planes + c_users + c_messages + c_orgs
    );
end;
$$;

create or replace function public.update_organizer_profile(
    p_ciudad text,
    p_web text,
    p_instagram text,
    p_tipo text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    uid uuid := auth.uid();
    v_tipo text := nullif(btrim(coalesce(p_tipo, '')), '');
begin
    if uid is null then
        raise exception 'not_authenticated';
    end if;
    if not exists (
        select 1 from public.perfiles
        where id = uid and es_organizador and baneado is false
    ) then
        raise exception 'not_organizer';
    end if;
    if v_tipo is not null and v_tipo not in (
        'sports', 'erasmus', 'leisure', 'community', 'other'
    ) then
        raise exception 'invalid_tipo';
    end if;

    update public.perfiles
    set organizador = coalesce(organizador, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'ciudad', nullif(btrim(coalesce(p_ciudad, '')), ''),
        'web', nullif(btrim(coalesce(p_web, '')), ''),
        'instagram', nullif(btrim(regexp_replace(coalesce(p_instagram, ''), '^@', '')), ''),
        'tipo', v_tipo
    ))
    where id = uid;
end;
$$;

create or replace function public.get_guest_feed()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    result jsonb;
begin
    select coalesce(jsonb_agg(feed.plan_json order by feed.fecha_evento_sort asc nulls last), '[]'::jsonb)
    into result
    from (
        select
            pl.fecha_evento as fecha_evento_sort,
            jsonb_build_object(
                'id', pl.id,
                'titulo', pl.titulo,
                'imagen_url', pl.imagen_url,
                'imagenes_url', coalesce(pl.imagenes_url, '{}'::text[]),
                'recurrencia', pl.recurrencia,
                'es_organizador', coalesce(creator.es_organizador, false),
                'categoria', pl.categoria,
                'tipo_deporte', pl.tipo_deporte,
                'solo_chicas', pl.solo_chicas,
                'solo_amigos', pl.solo_amigos,
                'modo_privado', pl.modo_privado,
                'fecha_evento', pl.fecha_evento,
                'nombre_ubicacion', pl.nombre_ubicacion,
                'latitud', pl.latitud,
                'longitud', pl.longitud,
                'maximo_participantes', pl.maximo_participantes,
                'creador_id', pl.creador_id,
                'requiere_aprobacion', pl.requiere_aprobacion,
                'descripcion', pl.descripcion,
                'estado', pl.estado,
                'joinedCount', (
                    select count(*)::integer
                    from public.participantes as part
                    where part.plan_id = pl.id
                      and part.estado = 'aceptado'
                ),
                'participantsList', (
                    select coalesce(jsonb_agg(cards.card order by cards.ord, cards.nombre), '[]'::jsonb)
                    from (
                        select
                            0 as ord,
                            c.nombre,
                            jsonb_build_object(
                                'id', c.id,
                                'nombre', c.nombre,
                                'nombre_usuario', c.nombre_usuario,
                                'avatar_url', c.avatar_url,
                                'es_organizador', c.es_organizador,
                                'isCreator', true
                            ) as card
                        from public.perfiles as c
                        where c.id = pl.creador_id
                          and coalesce(c.baneado, false) = false
                        union all
                        select
                            1,
                            p.nombre,
                            jsonb_build_object(
                                'id', p.id,
                                'nombre', p.nombre,
                                'nombre_usuario', p.nombre_usuario,
                                'avatar_url', p.avatar_url,
                                'es_organizador', p.es_organizador,
                                'isCreator', false
                            )
                        from public.participantes as part
                        join public.perfiles as p on p.id = part.usuario_id
                        where part.plan_id = pl.id
                          and part.estado = 'aceptado'
                          and part.usuario_id <> pl.creador_id
                          and coalesce(p.baneado, false) = false
                    ) as cards
                )
            ) as plan_json
        from public.planes as pl
        join public.perfiles as creator on creator.id = pl.creador_id
        where coalesce(pl.modo_privado, false) = false
          and coalesce(pl.solo_amigos, false) = false
          and coalesce(pl.is_direct_chat, false) = false
          and coalesce(pl.is_group_chat, false) = false
          and pl.categoria not in ('Grupo', 'Chat')
          and pl.estado not in ('finalizado', 'cancelado')
          and (pl.fecha_evento is null or pl.fecha_evento >= now())
          and coalesce(creator.baneado, false) = false
        order by pl.fecha_evento asc nulls last
        limit 100
    ) as feed;

    return coalesce(result, '[]'::jsonb);
end;
$$;

create or replace function public.get_guest_plan(p_plan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    result jsonb;
begin
    if p_plan_id is null then
        return null;
    end if;

    select jsonb_build_object(
        'plan', jsonb_build_object(
            'id', pl.id,
            'titulo', pl.titulo,
            'imagen_url', pl.imagen_url,
            'imagenes_url', coalesce(pl.imagenes_url, '{}'::text[]),
            'recurrencia', pl.recurrencia,
            'es_organizador', coalesce(creator.es_organizador, false),
            'categoria', pl.categoria,
            'tipo_deporte', pl.tipo_deporte,
            'solo_chicas', pl.solo_chicas,
            'modo_privado', pl.modo_privado,
            'fecha_evento', pl.fecha_evento,
            'nombre_ubicacion', pl.nombre_ubicacion,
            'latitud', pl.latitud,
            'longitud', pl.longitud,
            'maximo_participantes', pl.maximo_participantes,
            'creador_id', pl.creador_id,
            'requiere_aprobacion', pl.requiere_aprobacion,
            'descripcion', pl.descripcion,
            'chat_eliminado_en', pl.chat_eliminado_en
        ),
        'joinedCount', (
            select count(*)::integer
            from public.participantes as part
            where part.plan_id = pl.id
              and part.estado = 'aceptado'
        ),
        'participants', (
            select coalesce(jsonb_agg(cards.card order by cards.ord, cards.nombre), '[]'::jsonb)
            from (
                select
                    0 as ord,
                    c.nombre,
                    jsonb_build_object(
                        'id', c.id,
                        'nombre', c.nombre,
                        'nombre_usuario', c.nombre_usuario,
                        'avatar_url', c.avatar_url,
                        'es_organizador', c.es_organizador,
                        'isCreator', true
                    ) as card
                from public.perfiles as c
                where c.id = pl.creador_id
                  and coalesce(c.baneado, false) = false
                union all
                select
                    1,
                    p.nombre,
                    jsonb_build_object(
                        'id', p.id,
                        'nombre', p.nombre,
                        'nombre_usuario', p.nombre_usuario,
                        'avatar_url', p.avatar_url,
                        'es_organizador', p.es_organizador,
                        'isCreator', false
                    )
                from public.participantes as part
                join public.perfiles as p on p.id = part.usuario_id
                where part.plan_id = pl.id
                  and part.estado = 'aceptado'
                  and part.usuario_id <> pl.creador_id
                  and coalesce(p.baneado, false) = false
            ) as cards
        )
    )
    into result
    from public.planes as pl
    join public.perfiles as creator on creator.id = pl.creador_id
    where pl.id = p_plan_id
      and coalesce(pl.modo_privado, false) = false
      and coalesce(pl.solo_amigos, false) = false
      and coalesce(pl.is_direct_chat, false) = false
      and coalesce(pl.is_group_chat, false) = false
      and pl.categoria not in ('Grupo', 'Chat')
      and pl.estado <> 'cancelado'
      and coalesce(creator.baneado, false) = false;

    return result;
end;
$$;

revoke all on function public.request_organizer_account(text, text, text, text, text, text, text) from public;
revoke all on function public.admin_set_organizer_request(uuid, text, text) from public;
revoke all on function public.follow_organizer(uuid) from public;
revoke all on function public.unfollow_organizer(uuid) from public;
revoke all on function public.get_organizer_follow_stats(uuid) from public;
revoke all on function public.materialize_organizer_recurrence() from public;
revoke all on function public.get_public_profiles(uuid[]) from public;
revoke all on function public.update_organizer_profile(text, text, text, text) from public;
revoke all on function public.get_guest_feed() from public;
revoke all on function public.get_guest_plan(uuid) from public;

grant execute on function public.request_organizer_account(text, text, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.admin_set_organizer_request(uuid, text, text) to authenticated, service_role;
grant execute on function public.follow_organizer(uuid) to authenticated, service_role;
grant execute on function public.unfollow_organizer(uuid) to authenticated, service_role;
grant execute on function public.get_organizer_follow_stats(uuid) to authenticated, service_role;
grant execute on function public.materialize_organizer_recurrence() to authenticated, service_role;
grant execute on function public.get_public_profiles(uuid[]) to authenticated, service_role;
grant execute on function public.update_organizer_profile(text, text, text, text) to authenticated, service_role;
grant execute on function public.get_guest_feed() to anon, service_role;
grant execute on function public.get_guest_plan(uuid) to anon, service_role;

commit;

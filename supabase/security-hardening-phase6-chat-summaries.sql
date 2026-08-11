-- NEXO chat summaries - phase 6
-- Ejecutar completo una sola vez en Supabase SQL Editor.

begin;

-- Estos índices permiten obtener el último mensaje de cada conversación sin
-- descargar lotes globales ni recorrer el historial completo.
create index if not exists mensajes_plan_ultimo_idx
    on public.mensajes (plan_id, creado_en desc)
    where plan_id is not null;

create index if not exists mensajes_directos_emisor_receptor_ultimo_idx
    on public.mensajes (emisor_id, receptor_id, creado_en desc)
    where plan_id is null and receptor_id is not null;

create index if not exists mensajes_directos_receptor_emisor_ultimo_idx
    on public.mensajes (receptor_id, emisor_id, creado_en desc)
    where plan_id is null and receptor_id is not null;

create or replace function public.get_chat_summaries(
    p_plan_read_at jsonb default '{}'::jsonb,
    p_direct_read_at jsonb default '{}'::jsonb
)
returns table (
    conversation_kind text,
    conversation_id uuid,
    title text,
    image_url text,
    category text,
    creator_id uuid,
    event_at timestamptz,
    created_at timestamptz,
    chat_deleted_at timestamptz,
    last_content text,
    last_type text,
    last_at timestamptz,
    last_sender_id uuid,
    last_sender_name text,
    unread_count bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
    with caller as (
        select auth.uid() as user_id
        where auth.uid() is not null
    ),
    accessible_plan_ids as (
        select p.id
        from public.planes p
        cross join caller c
        where p.creador_id = c.user_id

        union

        select pa.plan_id
        from public.participantes pa
        cross join caller c
        where pa.usuario_id = c.user_id
          and pa.estado = 'aceptado'
    ),
    plan_rows as (
        select
            'plan'::text as conversation_kind,
            p.id as conversation_id,
            p.titulo::text as title,
            p.imagen_url::text as image_url,
            p.categoria::text as category,
            p.creador_id as creator_id,
            p.fecha_evento::timestamptz as event_at,
            p.creado_en::timestamptz as created_at,
            p.chat_eliminado_en::timestamptz as chat_deleted_at,
            latest.contenido::text as last_content,
            latest.tipo::text as last_type,
            latest.creado_en::timestamptz as last_at,
            latest.emisor_id as last_sender_id,
            sender.nombre::text as last_sender_name,
            coalesce(unread.total, 0)::bigint as unread_count
        from accessible_plan_ids access
        join public.planes p on p.id = access.id
        cross join caller c
        left join lateral (
            select m.contenido, m.tipo, m.creado_en, m.emisor_id
            from public.mensajes m
            where m.plan_id = p.id
            order by m.creado_en desc
            limit 1
        ) latest on true
        left join public.perfiles sender on sender.id = latest.emisor_id
        left join lateral (
            select count(*)::bigint as total
            from public.mensajes m
            where m.plan_id = p.id
              and m.emisor_id <> c.user_id
              and m.creado_en > coalesce(
                  nullif(p_plan_read_at ->> p.id::text, '')::timestamptz,
                  '1970-01-01 00:00:00+00'::timestamptz
              )
        ) unread on true
    ),
    direct_peer_ids as (
        select distinct peer_id
        from (
            select m.receptor_id as peer_id
            from public.mensajes m
            cross join caller c
            where m.plan_id is null
              and m.emisor_id = c.user_id
              and m.receptor_id is not null

            union all

            select m.emisor_id as peer_id
            from public.mensajes m
            cross join caller c
            where m.plan_id is null
              and m.receptor_id = c.user_id
        ) peers
        where peer_id is not null
    ),
    direct_rows as (
        select
            'direct'::text as conversation_kind,
            peers.peer_id as conversation_id,
            coalesce(profile.nombre, 'Usuario')::text as title,
            profile.avatar_url::text as image_url,
            null::text as category,
            null::uuid as creator_id,
            null::timestamptz as event_at,
            null::timestamptz as created_at,
            null::timestamptz as chat_deleted_at,
            latest.contenido::text as last_content,
            latest.tipo::text as last_type,
            latest.creado_en::timestamptz as last_at,
            latest.emisor_id as last_sender_id,
            sender.nombre::text as last_sender_name,
            coalesce(unread.total, 0)::bigint as unread_count
        from direct_peer_ids peers
        cross join caller c
        left join public.perfiles profile on profile.id = peers.peer_id
        left join public.chats_directos_ocultos hidden
          on hidden.usuario_id = c.user_id
         and hidden.peer_id = peers.peer_id
        left join lateral (
            select dm.contenido, dm.tipo, dm.creado_en, dm.emisor_id
            from (
                select m.contenido, m.tipo, m.creado_en, m.emisor_id
                from public.mensajes m
                where m.plan_id is null
                  and m.emisor_id = c.user_id
                  and m.receptor_id = peers.peer_id

                union all

                select m.contenido, m.tipo, m.creado_en, m.emisor_id
                from public.mensajes m
                where m.plan_id is null
                  and m.emisor_id = peers.peer_id
                  and m.receptor_id = c.user_id
            ) dm
            order by dm.creado_en desc
            limit 1
        ) latest on true
        left join public.perfiles sender on sender.id = latest.emisor_id
        left join lateral (
            select count(*)::bigint as total
            from public.mensajes m
            where m.plan_id is null
              and m.emisor_id = peers.peer_id
              and m.receptor_id = c.user_id
              and m.creado_en > coalesce(
                  nullif(p_direct_read_at ->> peers.peer_id::text, '')::timestamptz,
                  '1970-01-01 00:00:00+00'::timestamptz
              )
        ) unread on true
        where hidden.peer_id is null
           or latest.creado_en > hidden.oculto_en
    )
    select combined.*
    from (
        select * from plan_rows
        union all
        select * from direct_rows
    ) combined
    order by coalesce(
        combined.last_at,
        combined.created_at,
        '1970-01-01 00:00:00+00'::timestamptz
    ) desc;
$$;

revoke all on function public.get_chat_summaries(jsonb, jsonb) from public, anon;
grant execute on function public.get_chat_summaries(jsonb, jsonb) to authenticated;

commit;

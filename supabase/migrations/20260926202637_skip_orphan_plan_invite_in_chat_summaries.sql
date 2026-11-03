-- Si el último mensaje es una tarjeta @@nexo_plan_invite de un plan ya borrado,
-- saltarlo y usar el mensaje anterior (evita preview fantasma en Chats).

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
language plpgsql
stable
security definer
set search_path = public, pg_temp
set statement_timeout = '12s'
as $$
declare
    v_uid uuid := auth.uid();
begin
    if v_uid is null then
        return;
    end if;

    return query
    with accessible_plan_ids as (
        select p.id, p.creado_en as plan_created_at
        from public.planes p
        where p.creador_id = v_uid

        union

        select pa.plan_id, p.creado_en
        from public.participantes pa
        join public.planes p on p.id = pa.plan_id
        where pa.usuario_id = v_uid
          and pa.estado = 'aceptado'
    ),
    plan_join_at as (
        select
            a.id as plan_id,
            greatest(
                coalesce(
                    nullif(p_plan_read_at ->> a.id::text, '')::timestamptz,
                    '-infinity'::timestamptz
                ),
                coalesce(
                    (
                        select pa.creado_en
                        from public.participantes pa
                        where pa.plan_id = a.id
                          and pa.usuario_id = v_uid
                          and pa.estado = 'aceptado'
                        order by pa.creado_en desc
                        limit 1
                    ),
                    a.plan_created_at
                )
            ) as since
        from accessible_plan_ids a
    ),
    last_plan_msg as (
        select distinct on (m.plan_id)
            m.plan_id,
            m.contenido,
            m.tipo,
            m.creado_en,
            m.emisor_id
        from public.mensajes m
        where m.plan_id in (select id from accessible_plan_ids)
          and (
            coalesce(m.contenido, '') not like '@@nexo_plan_invite:%'
            or exists (
                select 1
                from public.planes tp
                where tp.id::text = substring(m.contenido from '"planId"\s*:\s*"([0-9a-fA-F-]{36})"')
            )
          )
        order by m.plan_id, m.creado_en desc
    ),
    plan_unread as (
        select m.plan_id, count(*)::bigint as total
        from public.mensajes m
        join plan_join_at j on j.plan_id = m.plan_id
        where m.emisor_id <> v_uid
          and coalesce(m.contenido, '') not like '@@nexo_system:%'
          and m.creado_en > j.since
        group by m.plan_id
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
            coalesce(u.total, 0)::bigint as unread_count
        from accessible_plan_ids access
        join public.planes p on p.id = access.id
        left join last_plan_msg latest on latest.plan_id = p.id
        left join public.perfiles sender on sender.id = latest.emisor_id
        left join plan_unread u on u.plan_id = p.id
    ),
    direct_peer_ids as (
        select distinct peer_id
        from (
            select m.receptor_id as peer_id
            from public.mensajes m
            where m.plan_id is null
              and m.emisor_id = v_uid
              and m.receptor_id is not null

            union

            select m.emisor_id as peer_id
            from public.mensajes m
            where m.plan_id is null
              and m.receptor_id = v_uid
        ) peers
        where peer_id is not null
    ),
    last_direct_msg as (
        select distinct on (peer_id)
            peer_id,
            contenido,
            tipo,
            creado_en,
            emisor_id
        from (
            select
                m.receptor_id as peer_id,
                m.contenido,
                m.tipo,
                m.creado_en,
                m.emisor_id
            from public.mensajes m
            where m.plan_id is null
              and m.emisor_id = v_uid
              and m.receptor_id in (select peer_id from direct_peer_ids)

            union all

            select
                m.emisor_id as peer_id,
                m.contenido,
                m.tipo,
                m.creado_en,
                m.emisor_id
            from public.mensajes m
            where m.plan_id is null
              and m.receptor_id = v_uid
              and m.emisor_id in (select peer_id from direct_peer_ids)
        ) dm
        order by peer_id, creado_en desc
    ),
    direct_unread as (
        select m.emisor_id as peer_id, count(*)::bigint as total
        from public.mensajes m
        where m.plan_id is null
          and m.receptor_id = v_uid
          and m.emisor_id in (select peer_id from direct_peer_ids)
          and coalesce(m.contenido, '') not like '@@nexo_system:%'
          and m.creado_en > coalesce(
              nullif(p_direct_read_at ->> m.emisor_id::text, '')::timestamptz,
              '1970-01-01 00:00:00+00'::timestamptz
          )
        group by m.emisor_id
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
            coalesce(u.total, 0)::bigint as unread_count
        from direct_peer_ids peers
        left join public.perfiles profile on profile.id = peers.peer_id
        left join public.chats_directos_ocultos hidden
          on hidden.usuario_id = v_uid
         and hidden.peer_id = peers.peer_id
        left join last_direct_msg latest on latest.peer_id = peers.peer_id
        left join public.perfiles sender on sender.id = latest.emisor_id
        left join direct_unread u on u.peer_id = peers.peer_id
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
end;
$$;

revoke all on function public.get_chat_summaries(jsonb, jsonb) from public, anon;
grant execute on function public.get_chat_summaries(jsonb, jsonb) to authenticated;
grant execute on function public.get_chat_summaries(jsonb, jsonb) to service_role;

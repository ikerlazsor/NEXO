-- Un plan convertido en chat fijo sigue contando como plan hecho
-- y en «planes a los que he ido» conserva la portada y el título de cuando acabó.

create or replace function public.recalcular_badge_categorias(p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tapas integer := 0;
    v_deporte integer := 0;
    v_fiesta integer := 0;
    v_estudio integer := 0;
    v_solo_chicas integer := 0;
    v_categorias integer := 0;
    v_planes integer := 0;
begin
    insert into public.estadisticas_usuario (usuario_id)
    values (p_usuario)
    on conflict (usuario_id) do nothing;

    select
        count(*) filter (
            where p.categoria in ('FOODIES', 'Tapas', 'Café')
        ),
        count(*) filter (
            where p.categoria in ('DEPORTES', 'Deporte')
        ),
        count(*) filter (
            where p.categoria in ('VIBES', 'Fiesta', 'Ocio', 'Solo chicas')
        ),
        count(*) filter (
            where p.categoria in ('DESCUBRIR', 'Estudio')
        ),
        count(*) filter (
            where p.solo_chicas = true or p.categoria = 'Solo chicas'
        ),
        count(distinct case
            when p.categoria in ('FOODIES', 'Tapas', 'Café') then 'FOODIES'
            when p.categoria in ('DEPORTES', 'Deporte') then 'DEPORTES'
            when p.categoria in ('VIBES', 'Fiesta', 'Ocio', 'Solo chicas') then 'VIBES'
            when p.categoria in ('DESCUBRIR', 'Estudio') then 'DESCUBRIR'
            when p.categoria = 'AIRE_LIBRE' then 'AIRE_LIBRE'
            when p.categoria = 'SHOWTIME' then 'SHOWTIME'
            else null
        end),
        count(*)
    into v_tapas, v_deporte, v_fiesta, v_estudio, v_solo_chicas, v_categorias, v_planes
    from public.historial_planes hp
    join public.planes p on p.id = hp.plan_id
    where hp.usuario_id = p_usuario
      and coalesce(p.is_direct_chat, false) = false
      and coalesce(p.is_group_chat, false) = false
      and (
        coalesce(p.categoria, '') not in ('Chat', 'Grupo')
        or (
          p.categoria = 'Grupo'
          and p.fecha_evento is not null
          and p.fecha_evento <= now()
        )
      );

    update public.estadisticas_usuario set
        planes_tapas = v_tapas,
        planes_deporte = v_deporte,
        planes_fiesta = v_fiesta,
        planes_estudio = v_estudio,
        planes_solo_chicas = v_solo_chicas,
        categorias_probadas = v_categorias,
        numero_planes_realizados = v_planes,
        actualizado_en = now()
    where usuario_id = p_usuario;
end;
$$;

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
            coalesce(nullif(btrim(pl.titulo_cierre), ''), pl.titulo) as titulo,
            coalesce(nullif(btrim(pl.imagen_cierre), ''), pl.imagen_url) as imagen_url,
            pl.fecha_evento,
            pl.nombre_ubicacion,
            pl.categoria
        from public.historial_planes hp
        join public.planes pl on pl.id = hp.plan_id
        where hp.usuario_id = p_user_id
          and coalesce(hp.oculto_perfil, false) = false
          and coalesce(pl.modo_privado, false) = false
          and coalesce(pl.is_group_chat, false) = false
          and coalesce(pl.categoria, '') <> 'Chat'
        order by coalesce(pl.fecha_evento, hp.creado_en) desc nulls last
        limit v_limit
    ) x;

    return coalesce(v_items, '[]'::jsonb);
end;
$$;

revoke all on function public.get_public_attended_plans(uuid, integer) from public;
grant execute on function public.get_public_attended_plans(uuid, integer) to authenticated, service_role;

do $$
declare
    r uuid;
begin
    for r in
        select distinct hp.usuario_id
        from public.historial_planes hp
        join public.planes p on p.id = hp.plan_id
        where p.categoria = 'Grupo'
          and coalesce(p.is_group_chat, false) = false
          and p.fecha_evento is not null
          and p.fecha_evento <= now()
    loop
        perform public.recalcular_badge_categorias(r);
    end loop;
end $$;

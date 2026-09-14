-- Conteos de categoría alineados con FOODIES / AIRE_LIBRE / SHOWTIME / etc.
-- Invitados: recuento de miembros de organizador.

begin;

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
      and coalesce(p.is_group_chat, false) = false
      and coalesce(p.is_direct_chat, false) = false
      and coalesce(p.categoria, '') not in ('Chat', 'Grupo');

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

-- Categorías crudas del historial (mapeo FOODIES/legacy en el cliente).
create or replace function public.get_user_attended_categories(p_user_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_cats text[];
begin
    if p_user_id is null then
        return '{}';
    end if;
    if auth.uid() is distinct from p_user_id
       and not public.can_view_profile_identity(p_user_id) then
        return '{}';
    end if;

    select coalesce(array_agg(pl.categoria), '{}')
    into v_cats
    from public.historial_planes hp
    join public.planes pl on pl.id = hp.plan_id
    where hp.usuario_id = p_user_id
      and coalesce(pl.is_group_chat, false) = false
      and coalesce(pl.is_direct_chat, false) = false
      and coalesce(pl.categoria, '') not in ('Chat', 'Grupo');

    return coalesce(v_cats, '{}');
end;
$$;

revoke all on function public.get_user_attended_categories(uuid) from public;
grant execute on function public.get_user_attended_categories(uuid) to authenticated, service_role;

grant execute on function public.get_organizer_follow_stats(uuid) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;

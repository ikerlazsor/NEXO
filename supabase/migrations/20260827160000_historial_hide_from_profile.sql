-- Ocultar un plan del carrusel «A los que he ido» sin borrar historial ni bajar el contador.
-- Borrar la fila de historial_planes sigue bajando numero_planes_realizados (trigger existente).

alter table public.historial_planes
    add column if not exists oculto_perfil boolean not null default false;

comment on column public.historial_planes.oculto_perfil is
    'Si true, el plan no aparece en get_public_attended_plans; el contador de planes realizados no cambia.';

create index if not exists idx_historial_usuario_perfil_visible
    on public.historial_planes (usuario_id)
    where oculto_perfil = false;

drop policy if exists "historial_update_own" on public.historial_planes;
create policy "historial_update_own" on public.historial_planes
    for update to authenticated
    using (usuario_id = auth.uid())
    with check (usuario_id = auth.uid());

drop policy if exists "historial_delete_own" on public.historial_planes;
create policy "historial_delete_own" on public.historial_planes
    for delete to authenticated
    using (usuario_id = auth.uid());

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
          and coalesce(hp.oculto_perfil, false) = false
          and coalesce(pl.modo_privado, false) = false
        order by coalesce(pl.fecha_evento, hp.creado_en) desc nulls last
        limit v_limit
    ) x;

    return coalesce(v_items, '[]'::jsonb);
end;
$$;

revoke all on function public.get_public_attended_plans(uuid, integer) from public;
grant execute on function public.get_public_attended_plans(uuid, integer) to authenticated, service_role;

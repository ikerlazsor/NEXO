-- Una sola ida para abrir un perfil: ficha + estadísticas materializadas + planes vistos.

create or replace function public.get_profile_screen(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    uid uuid := auth.uid();
    v_profile jsonb;
    v_stats jsonb;
    v_attended jsonb;
begin
    if uid is null then
        raise exception 'not_authenticated';
    end if;
    if p_user_id is null or not public.can_view_profile_identity(p_user_id) then
        return null;
    end if;

    select jsonb_build_object(
        'id', p.id,
        'nombre', p.nombre,
        'nombre_usuario', p.nombre_usuario,
        'avatar_url', p.avatar_url,
        'cover_url', p.cover_url,
        'descripcion', p.descripcion,
        'etiquetas', coalesce(p.etiquetas, '{}'::text[]),
        'fecha_nacimiento', p.fecha_nacimiento,
        'genero', p.genero,
        'habitos_consumo', coalesce(p.habitos_consumo, '{}'::jsonb),
        'ambientes_preferidos', coalesce(p.ambientes_preferidos, '{}'::text[]),
        'perfil_gustos', coalesce(p.perfil_gustos, '{}'::jsonb),
        'es_organizador', coalesce(p.es_organizador, false),
        'organizador', p.organizador
    )
    into v_profile
    from public.perfiles p
    where p.id = p_user_id;

    if v_profile is null then
        return null;
    end if;

    select jsonb_build_object(
        'valoracion_media', s.valoracion_media,
        'porcentaje_repetiria', s.porcentaje_repetiria,
        'porcentaje_asistencia', s.porcentaje_asistencia,
        'numero_valoraciones', s.numero_valoraciones,
        'numero_evaluadores_distintos', s.numero_evaluadores_distintos,
        'numero_planes_realizados', s.numero_planes_realizados,
        'numero_amistades', s.numero_amistades,
        'aspecto_positivo_mas_votado', s.aspecto_positivo_mas_votado,
        'aspecto_negativo_mas_votado', s.aspecto_negativo_mas_votado,
        'planes_tapas', s.planes_tapas,
        'planes_deporte', s.planes_deporte,
        'planes_fiesta', s.planes_fiesta,
        'planes_estudio', s.planes_estudio,
        'planes_solo_chicas', s.planes_solo_chicas,
        'categorias_probadas', s.categorias_probadas,
        'planes_creados', s.planes_creados,
        'personas_distintas', s.personas_distintas
    )
    into v_stats
    from public.estadisticas_usuario s
    where s.usuario_id = p_user_id;

    select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
    into v_attended
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
        limit 12
    ) x;

    return jsonb_build_object(
        'profile', v_profile,
        'stats', coalesce(v_stats, '{}'::jsonb),
        'attended', coalesce(v_attended, '[]'::jsonb)
    );
end;
$$;

revoke all on function public.get_profile_screen(uuid) from public, anon;
grant execute on function public.get_profile_screen(uuid) to authenticated, service_role;

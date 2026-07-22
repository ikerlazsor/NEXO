-- ============================================================
-- Lectura pública de estadísticas de perfil (planes, valoración, amigos…)
-- + login por nombre de usuario
-- Ejecutar en Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.estadisticas_usuario ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "estadisticas_select_public" ON public.estadisticas_usuario;
CREATE POLICY "estadisticas_select_public"
ON public.estadisticas_usuario
FOR SELECT
TO authenticated
USING (true);

-- Stats de perfil vía RPC (bypass RLS): evita ceros en perfiles ajenos
CREATE OR REPLACE FUNCTION public.get_user_public_stats(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'valoracion_media', COALESCE(e.valoracion_media, 0),
    'porcentaje_repetiria', COALESCE(e.porcentaje_repetiria, 0),
    'porcentaje_asistencia', COALESCE(e.porcentaje_asistencia, 0),
    'numero_valoraciones', COALESCE(e.numero_valoraciones, 0),
    'numero_evaluadores_distintos', COALESCE(e.numero_evaluadores_distintos, 0),
    'numero_planes_realizados', COALESCE(e.numero_planes_realizados, 0),
    'numero_amistades', COALESCE(e.numero_amistades, 0),
    'aspecto_positivo_mas_votado', e.aspecto_positivo_mas_votado,
    'aspecto_negativo_mas_votado', e.aspecto_negativo_mas_votado
  )
  FROM (SELECT p_user_id AS id) u
  LEFT JOIN public.estadisticas_usuario e ON e.usuario_id = u.id;
$$;

REVOKE ALL ON FUNCTION public.get_user_public_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_public_stats(uuid) TO authenticated;

-- Email de login a partir del @usuario (solo para iniciar sesión)
CREATE OR REPLACE FUNCTION public.get_login_email_by_username(p_username text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT u.email
  FROM public.perfiles p
  JOIN auth.users u ON u.id = p.id
  WHERE lower(btrim(p.nombre_usuario)) = lower(btrim(p_username))
    AND btrim(p_username) <> ''
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_login_email_by_username(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_login_email_by_username(text) TO anon, authenticated;

-- Refuerzo: RPC de insignias también expone campos de reputación
CREATE OR REPLACE FUNCTION public.get_badge_stats(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'valoracionMedia', COALESCE(e.valoracion_media, 0),
    'porcentajeRepetiria', COALESCE(e.porcentaje_repetiria, 0),
    'porcentajeAsistencia', COALESCE(e.porcentaje_asistencia, 0),
    'numeroValoraciones', COALESCE(e.numero_valoraciones, 0),
    'numeroEvaluadoresDistintos', COALESCE(e.numero_evaluadores_distintos, 0),
    'numeroPlanesRealizados', COALESCE(e.numero_planes_realizados, 0),
    'numeroAmistades', COALESCE(e.numero_amistades, 0),
    'aspectoPositivoMasVotado', e.aspecto_positivo_mas_votado,
    'aspectoNegativoMasVotado', e.aspecto_negativo_mas_votado,
    'numeroExpulsiones', 0,
    'planesTapas', COALESCE(e.planes_tapas, 0),
    'planesDeporte', COALESCE(e.planes_deporte, 0),
    'planesFiesta', COALESCE(e.planes_fiesta, 0),
    'planesEstudio', COALESCE(e.planes_estudio, 0),
    'planesSoloChicas', COALESCE(e.planes_solo_chicas, 0),
    'categoriasProbadas', COALESCE(e.categorias_probadas, 0),
    'planesCreados', COALESCE(e.planes_creados, 0),
    'personasDistintas', COALESCE(e.personas_distintas, 0),
    'cuentaAntiguedadDias', COALESCE(
      GREATEST(
        0,
        FLOOR(EXTRACT(EPOCH FROM (now() - u.created_at)) / 86400)::int
      ),
      0
    )
  )
  FROM auth.users u
  LEFT JOIN public.estadisticas_usuario e ON e.usuario_id = u.id
  WHERE u.id = p_user_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_badge_stats(uuid) TO authenticated;

-- ============================================================
-- NEXO · Estadísticas de insignias materializadas
-- Ejecutar ENTERO en el SQL Editor de Supabase.
--
-- ORDEN RECOMENDADO:
--   1. perfiles-signup-fix.sql   (si aún no lo ejecutaste)
--   2. badge-stats-materialized.sql  ← ESTE ARCHIVO
--   3. badge-legacy-cleanup.sql  (quita tablas insignias antiguas)
--
-- QUÉ SUSTITUYE (sin duplicar lógica):
--   • get_badge_stats antigua (agregaba historial_planes + participantes
--     en cada llamada) → lectura directa de estadisticas_usuario
--   • on_historial_change que solo contaba numero_planes_realizados
--     → recalcular_badge_categorias (cuenta + categorías en un sitio)
--   • Cálculo en cliente de categorías/co-participantes en cada visita
--     → triggers mantienen columnas materializadas
--
-- QUÉ NO TOCA (sigue igual):
--   • recalcular_estadisticas_valoraciones (valoraciones)
--   • recalcular_numero_amistades (amistades)
--   • Tablas insignias/usuario_insignias → las quita badge-legacy-cleanup.sql
--     (la app usa lib/badges.ts, no esas tablas)
--
-- Idempotente: puede ejecutarse varias veces.
-- ============================================================

-- ---------- 1. Columnas nuevas ----------
ALTER TABLE public.estadisticas_usuario
    ADD COLUMN IF NOT EXISTS planes_tapas integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS planes_deporte integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS planes_fiesta integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS planes_estudio integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS planes_solo_chicas integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS categorias_probadas integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS planes_creados integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS personas_distintas integer NOT NULL DEFAULT 0;

-- ---------- 2. Recalcular conteos por categoría (historial_planes) ----------
CREATE OR REPLACE FUNCTION public.recalcular_badge_categorias(p_usuario uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tapas integer := 0;
    v_deporte integer := 0;
    v_fiesta integer := 0;
    v_estudio integer := 0;
    v_solo_chicas integer := 0;
    v_categorias integer := 0;
    v_planes integer := 0;
BEGIN
    INSERT INTO public.estadisticas_usuario (usuario_id)
    VALUES (p_usuario)
    ON CONFLICT (usuario_id) DO NOTHING;

    SELECT
        COUNT(*) FILTER (WHERE p.categoria = 'Tapas'),
        COUNT(*) FILTER (WHERE p.categoria = 'Deporte'),
        COUNT(*) FILTER (WHERE p.categoria = 'Fiesta'),
        COUNT(*) FILTER (WHERE p.categoria = 'Estudio'),
        COUNT(*) FILTER (WHERE p.solo_chicas = true OR p.categoria = 'Solo chicas'),
        COUNT(DISTINCT p.categoria) FILTER (
            WHERE p.categoria IN ('Tapas', 'Fiesta', 'Deporte', 'Estudio', 'Solo chicas')
        ),
        COUNT(*)
    INTO v_tapas, v_deporte, v_fiesta, v_estudio, v_solo_chicas, v_categorias, v_planes
    FROM public.historial_planes hp
    JOIN public.planes p ON p.id = hp.plan_id
    WHERE hp.usuario_id = p_usuario;

    UPDATE public.estadisticas_usuario SET
        planes_tapas          = v_tapas,
        planes_deporte        = v_deporte,
        planes_fiesta         = v_fiesta,
        planes_estudio        = v_estudio,
        planes_solo_chicas    = v_solo_chicas,
        categorias_probadas   = v_categorias,
        numero_planes_realizados = v_planes,
        actualizado_en        = now()
    WHERE usuario_id = p_usuario;
END;
$$;

-- ---------- 3. Recalcular planes creados (feed) ----------
CREATE OR REPLACE FUNCTION public.recalcular_planes_creados(p_usuario uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count integer := 0;
BEGIN
    INSERT INTO public.estadisticas_usuario (usuario_id)
    VALUES (p_usuario)
    ON CONFLICT (usuario_id) DO NOTHING;

    SELECT COUNT(*)::integer INTO v_count
    FROM public.planes
    WHERE creador_id = p_usuario
      AND categoria IN ('Tapas', 'Fiesta', 'Deporte', 'Estudio', 'Solo chicas');

    UPDATE public.estadisticas_usuario SET
        planes_creados = v_count,
        actualizado_en = now()
    WHERE usuario_id = p_usuario;
END;
$$;

-- ---------- 4. Recalcular personas distintas (co-participantes) ----------
CREATE OR REPLACE FUNCTION public.recalcular_personas_distintas(p_usuario uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count integer := 0;
BEGIN
    IF p_usuario IS NULL THEN
        RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.perfiles WHERE id = p_usuario) THEN
        RETURN;
    END IF;

    INSERT INTO public.estadisticas_usuario (usuario_id)
    VALUES (p_usuario)
    ON CONFLICT (usuario_id) DO NOTHING;

    SELECT COUNT(DISTINCT p2.usuario_id)::integer INTO v_count
    FROM public.participantes p1
    JOIN public.participantes p2 ON p1.plan_id = p2.plan_id
    WHERE p1.usuario_id = p_usuario
      AND p1.estado = 'aceptado'
      AND p2.estado = 'aceptado'
      AND p2.usuario_id <> p_usuario;

    UPDATE public.estadisticas_usuario SET
        personas_distintas = v_count,
        actualizado_en = now()
    WHERE usuario_id = p_usuario;
END;
$$;

-- ---------- 5. Trigger historial_planes (categorías + planes realizados) ----------
CREATE OR REPLACE FUNCTION public.on_historial_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_usuario uuid := COALESCE(NEW.usuario_id, OLD.usuario_id);
BEGIN
    PERFORM public.recalcular_badge_categorias(v_usuario);
    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_historial_stats ON public.historial_planes;
CREATE TRIGGER trg_historial_stats
    AFTER INSERT OR DELETE ON public.historial_planes
    FOR EACH ROW EXECUTE FUNCTION public.on_historial_change();

-- ---------- 6. Trigger planes (planes creados) ----------
CREATE OR REPLACE FUNCTION public.on_plan_creador_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM public.recalcular_planes_creados(NEW.creador_id);
    END IF;
    IF TG_OP IN ('DELETE', 'UPDATE') THEN
        PERFORM public.recalcular_planes_creados(OLD.creador_id);
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.creador_id IS DISTINCT FROM OLD.creador_id THEN
        PERFORM public.recalcular_planes_creados(NEW.creador_id);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_planes_creados_stats ON public.planes;
CREATE TRIGGER trg_planes_creados_stats
    AFTER INSERT OR UPDATE OF creador_id, categoria OR DELETE ON public.planes
    FOR EACH ROW EXECUTE FUNCTION public.on_plan_creador_change();

-- ---------- 7. Trigger participantes (personas distintas) ----------
CREATE OR REPLACE FUNCTION public.on_participante_badge_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_plan_id uuid := COALESCE(NEW.plan_id, OLD.plan_id);
    v_user uuid;
BEGIN
    FOR v_user IN
        SELECT DISTINCT usuario_id
        FROM public.participantes
        WHERE plan_id = v_plan_id
          AND estado = 'aceptado'
    LOOP
        PERFORM public.recalcular_personas_distintas(v_user);
    END LOOP;

    IF TG_OP IN ('DELETE', 'UPDATE') AND OLD.estado = 'aceptado' THEN
        PERFORM public.recalcular_personas_distintas(OLD.usuario_id);
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_participantes_badge_stats ON public.participantes;
CREATE TRIGGER trg_participantes_badge_stats
    AFTER INSERT OR UPDATE OF estado, plan_id, usuario_id OR DELETE ON public.participantes
    FOR EACH ROW EXECUTE FUNCTION public.on_participante_badge_stats();

-- ---------- 8. Backfill datos existentes ----------
DO $$
DECLARE
    u record;
BEGIN
    FOR u IN SELECT DISTINCT usuario_id AS id FROM public.estadisticas_usuario
    LOOP
        PERFORM public.recalcular_badge_categorias(u.id);
        PERFORM public.recalcular_planes_creados(u.id);
        PERFORM public.recalcular_personas_distintas(u.id);
    END LOOP;

    FOR u IN SELECT DISTINCT creador_id AS id FROM public.planes WHERE creador_id IS NOT NULL
    LOOP
        PERFORM public.recalcular_planes_creados(u.id);
    END LOOP;

    FOR u IN SELECT DISTINCT usuario_id AS id FROM public.historial_planes
    LOOP
        PERFORM public.recalcular_badge_categorias(u.id);
    END LOOP;

    FOR u IN SELECT DISTINCT usuario_id AS id FROM public.participantes WHERE estado = 'aceptado'
    LOOP
        PERFORM public.recalcular_personas_distintas(u.id);
    END LOOP;
END;
$$;

-- ---------- 9. RPC rápida: lectura directa (sin agregaciones) ----------
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
    'numeroValoraciones', COALESCE(e.numero_valoraciones, 0),
    'numeroPlanesRealizados', COALESCE(e.numero_planes_realizados, 0),
    'numeroAmistades', COALESCE(e.numero_amistades, 0),
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

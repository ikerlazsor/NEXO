-- ============================================================
-- Stats de reputación en perfil
-- - % repetiría: solo cuenta si / no (ignora indiferente / tal vez)
-- - Aspecto negativo: solo si ≥5 valoraciones y ≥20% tienen ≥1 negativo
-- Ejecutar en Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.estadisticas_usuario
    ADD COLUMN IF NOT EXISTS porcentaje_asistencia numeric DEFAULT 0,
    ADD COLUMN IF NOT EXISTS numero_evaluadores_distintos integer DEFAULT 0;

CREATE OR REPLACE FUNCTION public.recalcular_estadisticas_valoraciones(p_usuario uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_media numeric;
    v_total integer;
    v_repetiria numeric;
    v_asistencias integer;
    v_asistencia_total integer;
    v_asistencia_pct numeric;
    v_evaluadores integer;
    v_pos text;
    v_pos_votos integer;
    v_neg text;
    v_neg_votos integer;
    v_con_negativo integer;
BEGIN
    INSERT INTO public.estadisticas_usuario (usuario_id)
    VALUES (p_usuario)
    ON CONFLICT (usuario_id) DO NOTHING;

    SELECT COALESCE(ROUND(AVG(puntuacion_general)::numeric, 2), 0),
           COUNT(*) FILTER (WHERE puntuacion_general IS NOT NULL),
           -- Solo si / no (indiferente no entra en el denominador)
           COALESCE(ROUND(
               100.0 * COUNT(*) FILTER (WHERE repetiria_experiencia = 'si')
               / NULLIF(COUNT(*) FILTER (WHERE repetiria_experiencia IN ('si', 'no')), 0)
           , 2), 0),
           COUNT(*) FILTER (WHERE asistencia = true),
           COUNT(*) FILTER (WHERE asistencia IS NOT NULL),
           COUNT(DISTINCT evaluador_id),
           COUNT(*) FILTER (
               WHERE COALESCE(cardinality(aspectos_negativos), 0) > 0
           )
      INTO v_media, v_total, v_repetiria, v_asistencias, v_asistencia_total, v_evaluadores, v_con_negativo
      FROM public.valoraciones
     WHERE evaluado_id = p_usuario;

    v_asistencia_pct := COALESCE(ROUND(
        100.0 * v_asistencias / NULLIF(v_asistencia_total, 0)
    , 2), 0);

    SELECT a, c INTO v_pos, v_pos_votos FROM (
        SELECT unnest(aspectos_positivos) AS a, COUNT(*) AS c
          FROM public.valoraciones
         WHERE evaluado_id = p_usuario
         GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1
    ) s;

    -- Solo mostrar negativo si hay ≥5 valoraciones y ≥20% eligieron alguno
    IF v_total >= 5 AND (100.0 * v_con_negativo / v_total) >= 20 THEN
        SELECT a, c INTO v_neg, v_neg_votos FROM (
            SELECT unnest(aspectos_negativos) AS a, COUNT(*) AS c
              FROM public.valoraciones
             WHERE evaluado_id = p_usuario
               AND COALESCE(cardinality(aspectos_negativos), 0) > 0
             GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1
        ) s;
    ELSE
        v_neg := NULL;
        v_neg_votos := 0;
    END IF;

    UPDATE public.estadisticas_usuario SET
        valoracion_media               = LEAST(5, GREATEST(0, v_media)),
        numero_valoraciones            = v_total,
        porcentaje_repetiria           = v_repetiria,
        numero_asistencias_confirmadas = v_asistencias,
        porcentaje_asistencia          = v_asistencia_pct,
        numero_evaluadores_distintos   = v_evaluadores,
        aspecto_positivo_mas_votado    = v_pos,
        votos_aspecto_positivo         = COALESCE(v_pos_votos, 0),
        aspecto_negativo_mas_votado    = v_neg,
        votos_aspecto_negativo         = COALESCE(v_neg_votos, 0),
        actualizado_en                 = now()
    WHERE usuario_id = p_usuario;
END;
$$;

-- Recalcular usuarios con valoraciones
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN SELECT DISTINCT evaluado_id AS id FROM public.valoraciones
    LOOP
        PERFORM public.recalcular_estadisticas_valoraciones(r.id);
    END LOOP;
END;
$$;

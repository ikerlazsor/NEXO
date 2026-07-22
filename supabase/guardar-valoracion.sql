-- ============================================================
-- Fix: guardar varias valoraciones por plan (1 por persona)
-- Ejecutar ENTERO en Supabase SQL Editor.
-- ============================================================

-- Columnas mínimas
ALTER TABLE public.valoraciones
    ADD COLUMN IF NOT EXISTS plan_id uuid,
    ADD COLUMN IF NOT EXISTS evaluador_id uuid,
    ADD COLUMN IF NOT EXISTS evaluado_id uuid,
    ADD COLUMN IF NOT EXISTS asistencia boolean,
    ADD COLUMN IF NOT EXISTS puntuacion_general integer,
    ADD COLUMN IF NOT EXISTS repetiria_experiencia text,
    ADD COLUMN IF NOT EXISTS aspectos_positivos text[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS aspectos_negativos text[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS motivos_seguridad text[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS incidencia_seguridad boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS actualizado_en timestamptz DEFAULT now();

ALTER TABLE public.estadisticas_usuario
    ADD COLUMN IF NOT EXISTS valoracion_media numeric DEFAULT 0,
    ADD COLUMN IF NOT EXISTS numero_valoraciones integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS porcentaje_repetiria numeric DEFAULT 0,
    ADD COLUMN IF NOT EXISTS porcentaje_asistencia numeric DEFAULT 0,
    ADD COLUMN IF NOT EXISTS numero_evaluadores_distintos integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS numero_asistencias_confirmadas integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS aspecto_positivo_mas_votado text,
    ADD COLUMN IF NOT EXISTS votos_aspecto_positivo integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS aspecto_negativo_mas_votado text,
    ADD COLUMN IF NOT EXISTS votos_aspecto_negativo integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS actualizado_en timestamptz DEFAULT now();

-- Quitar unique incorrectos (p.ej. solo plan+evaluador = 1 valoración por plan)
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'valoraciones'
          AND c.contype = 'u'
          AND c.conname <> 'valoraciones_unique_pair'
    LOOP
        EXECUTE format('ALTER TABLE public.valoraciones DROP CONSTRAINT IF EXISTS %I', r.conname);
    END LOOP;
END $$;

DROP INDEX IF EXISTS public.valoraciones_plan_evaluador_uidx;
DROP INDEX IF EXISTS public.valoraciones_evaluador_plan_key;

-- Unique correcto: una fila por (plan, quien valora, a quién)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'valoraciones_unique_pair'
    ) THEN
        ALTER TABLE public.valoraciones
            ADD CONSTRAINT valoraciones_unique_pair
            UNIQUE (plan_id, evaluador_id, evaluado_id);
    END IF;
EXCEPTION WHEN others THEN
    NULL;
END $$;

-- CHECKs de aspectos sin depender de array_text_sin_duplicados
ALTER TABLE public.valoraciones DROP CONSTRAINT IF EXISTS valoraciones_aspectos_positivos_check;
ALTER TABLE public.valoraciones DROP CONSTRAINT IF EXISTS valoraciones_aspectos_negativos_check;

ALTER TABLE public.valoraciones
    ADD CONSTRAINT valoraciones_aspectos_positivos_check
    CHECK (
        cardinality(COALESCE(aspectos_positivos, '{}'::text[])) <= 2
        AND COALESCE(aspectos_positivos, '{}'::text[]) <@ ARRAY[
            'agradable','puntual','respetuoso','cercano','divertido','social'
        ]::text[]
    );

ALTER TABLE public.valoraciones
    ADD CONSTRAINT valoraciones_aspectos_negativos_check
    CHECK (
        cardinality(COALESCE(aspectos_negativos, '{}'::text[])) <= 2
        AND COALESCE(aspectos_negativos, '{}'::text[]) <@ ARRAY[
            'impuntual','irrespetuoso','frio','poco_participativo','incomodo'
        ]::text[]
    );

-- Trigger de stats: nunca tumba el INSERT
CREATE OR REPLACE FUNCTION public.on_valoracion_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    BEGIN
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            PERFORM public.recalcular_estadisticas_valoraciones(NEW.evaluado_id);
        END IF;
        IF TG_OP IN ('DELETE', 'UPDATE') THEN
            PERFORM public.recalcular_estadisticas_valoraciones(OLD.evaluado_id);
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'recalcular_estadisticas_valoraciones failed: %', SQLERRM;
    END;
    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_valoraciones_stats ON public.valoraciones;
CREATE TRIGGER trg_valoraciones_stats
    AFTER INSERT OR UPDATE OR DELETE ON public.valoraciones
    FOR EACH ROW EXECUTE FUNCTION public.on_valoracion_change();

-- RLS permisivo
ALTER TABLE public.valoraciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "valoraciones_select" ON public.valoraciones;
CREATE POLICY "valoraciones_select" ON public.valoraciones
    FOR SELECT TO authenticated
    USING (
        evaluador_id = auth.uid()
        OR evaluado_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.participantes p
            WHERE p.plan_id = valoraciones.plan_id
              AND p.usuario_id = auth.uid()
              AND p.estado = 'aceptado'
        )
    );

DROP POLICY IF EXISTS "valoraciones_insert_own" ON public.valoraciones;
CREATE POLICY "valoraciones_insert_own" ON public.valoraciones
    FOR INSERT TO authenticated
    WITH CHECK (evaluador_id = auth.uid() AND evaluador_id <> evaluado_id);

DROP POLICY IF EXISTS "valoraciones_update_own" ON public.valoraciones;
CREATE POLICY "valoraciones_update_own" ON public.valoraciones
    FOR UPDATE TO authenticated
    USING (evaluador_id = auth.uid())
    WITH CHECK (evaluador_id = auth.uid());

-- RPC: insert/update explícito (sin ON CONFLICT frágil)
DROP FUNCTION IF EXISTS public.guardar_valoracion(uuid, uuid, boolean, integer, text, text[], text[]);
DROP FUNCTION IF EXISTS public.guardar_valoracion(uuid, uuid, boolean, integer, text, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.guardar_valoracion(
    p_plan_id uuid,
    p_evaluado_id uuid,
    p_asistencia boolean,
    p_puntuacion_general integer DEFAULT NULL,
    p_repetiria_experiencia text DEFAULT NULL,
    p_aspectos_positivos jsonb DEFAULT '[]'::jsonb,
    p_aspectos_negativos jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_pos text[];
    v_neg text[];
    v_asistencia boolean;
    v_score integer;
    v_rep text;
    v_existing uuid;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
    END IF;
    IF p_plan_id IS NULL OR p_evaluado_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_params');
    END IF;
    IF v_uid = p_evaluado_id THEN
        RETURN jsonb_build_object('ok', false, 'error', 'self_rating');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.planes WHERE id = p_plan_id) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'plan_not_found');
    END IF;

    SELECT COALESCE(
        ARRAY(
            SELECT DISTINCT x
            FROM jsonb_array_elements_text(COALESCE(p_aspectos_positivos, '[]'::jsonb)) AS t(x)
            WHERE x = ANY (ARRAY['agradable','puntual','respetuoso','cercano','divertido','social'])
            LIMIT 2
        ),
        '{}'::text[]
    ) INTO v_pos;

    SELECT COALESCE(
        ARRAY(
            SELECT DISTINCT x
            FROM jsonb_array_elements_text(COALESCE(p_aspectos_negativos, '[]'::jsonb)) AS t(x)
            WHERE x = ANY (ARRAY['impuntual','irrespetuoso','frio','poco_participativo','incomodo'])
            LIMIT 2
        ),
        '{}'::text[]
    ) INTO v_neg;

    v_asistencia := COALESCE(p_asistencia, true);

    IF v_asistencia THEN
        v_score := p_puntuacion_general;
        v_rep := p_repetiria_experiencia;
        IF v_score IS NULL OR v_score < 1 OR v_score > 5 THEN
            RETURN jsonb_build_object('ok', false, 'error', 'incomplete_rating');
        END IF;
        IF v_rep IS NULL OR v_rep NOT IN ('si', 'no', 'indiferente') THEN
            RETURN jsonb_build_object('ok', false, 'error', 'incomplete_rating');
        END IF;
    ELSE
        v_score := NULL;
        v_rep := NULL;
        v_pos := '{}';
        v_neg := '{}';
    END IF;

    SELECT id INTO v_existing
    FROM public.valoraciones
    WHERE plan_id = p_plan_id
      AND evaluador_id = v_uid
      AND evaluado_id = p_evaluado_id
    LIMIT 1;

    BEGIN
        IF v_existing IS NOT NULL THEN
            UPDATE public.valoraciones SET
                asistencia = v_asistencia,
                puntuacion_general = v_score,
                repetiria_experiencia = v_rep,
                aspectos_positivos = v_pos,
                aspectos_negativos = v_neg,
                actualizado_en = now()
            WHERE id = v_existing;
        ELSE
            INSERT INTO public.valoraciones (
                plan_id,
                evaluador_id,
                evaluado_id,
                asistencia,
                puntuacion_general,
                repetiria_experiencia,
                aspectos_positivos,
                aspectos_negativos,
                motivos_seguridad,
                incidencia_seguridad
            ) VALUES (
                p_plan_id,
                v_uid,
                p_evaluado_id,
                v_asistencia,
                v_score,
                v_rep,
                v_pos,
                v_neg,
                '{}'::text[],
                false
            );
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
    END;

    RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.guardar_valoracion(uuid, uuid, boolean, integer, text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guardar_valoracion(uuid, uuid, boolean, integer, text, jsonb, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

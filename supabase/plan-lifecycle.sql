-- ============================================================
-- Ciclo de vida post-plan: historial, chat 24h, valoraciones +3h
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- Marca de fin de plan / chat (opcional, informativa)
ALTER TABLE public.planes
    ADD COLUMN IF NOT EXISTS finalizado_en timestamptz;

ALTER TABLE public.planes
    ADD COLUMN IF NOT EXISTS chat_eliminado_en timestamptz;

-- Marca el plan como finalizado. El historial personal lo escribe la app
-- solo cuando el usuario completa/omite la valoración (y el plan sí se hizo).
CREATE OR REPLACE FUNCTION public.archive_ended_plan(p_plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_fecha timestamptz;
    v_cat text;
BEGIN
    SELECT fecha_evento, categoria INTO v_fecha, v_cat
    FROM public.planes WHERE id = p_plan_id;

    IF v_fecha IS NULL OR v_cat IN ('Grupo', 'Chat') THEN
        RETURN;
    END IF;

    IF v_fecha > now() THEN
        RETURN;
    END IF;

    UPDATE public.planes
    SET finalizado_en = COALESCE(finalizado_en, now())
    WHERE id = p_plan_id AND finalizado_en IS NULL;
END;
$$;

-- Archiva todos los planes cuya fecha ya pasó
CREATE OR REPLACE FUNCTION public.archive_all_ended_plans()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    r record;
    n integer := 0;
BEGIN
    FOR r IN
        SELECT id FROM public.planes
        WHERE fecha_evento IS NOT NULL
          AND fecha_evento <= now()
          AND COALESCE(categoria, '') NOT IN ('Grupo', 'Chat')
    LOOP
        PERFORM public.archive_ended_plan(r.id);
        n := n + 1;
    END LOOP;
    RETURN n;
END;
$$;

-- Elimina el chat de planes caducados (fecha_evento + 24h).
-- Conserva el plan + historial + valoraciones para estadísticas.
CREATE OR REPLACE FUNCTION public.purge_expired_plan_chats()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    r record;
    n integer := 0;
BEGIN
    PERFORM public.archive_all_ended_plans();

    FOR r IN
        SELECT id FROM public.planes
        WHERE fecha_evento IS NOT NULL
          AND fecha_evento + interval '24 hours' <= now()
          AND chat_eliminado_en IS NULL
          AND COALESCE(categoria, '') NOT IN ('Grupo', 'Chat')
    LOOP
        DELETE FROM public.mensajes WHERE plan_id = r.id;
        DELETE FROM public.invitaciones_planes WHERE plan_id = r.id;
        DELETE FROM public.planes_guardados WHERE plan_id = r.id;
        UPDATE public.planes
        SET chat_eliminado_en = now(),
            finalizado_en = COALESCE(finalizado_en, now())
        WHERE id = r.id;
        n := n + 1;
    END LOOP;
    RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_ended_plan(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_all_ended_plans() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_expired_plan_chats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_ended_plan(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_all_ended_plans() TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_plan_chats() TO authenticated;

-- RLS valoraciones (si no existen)
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
    WITH CHECK (
        evaluador_id = auth.uid()
        AND evaluador_id <> evaluado_id
        AND EXISTS (
            SELECT 1 FROM public.participantes p
            WHERE p.plan_id = valoraciones.plan_id
              AND p.usuario_id = auth.uid()
              AND p.estado = 'aceptado'
        )
        AND EXISTS (
            SELECT 1 FROM public.participantes p2
            WHERE p2.plan_id = valoraciones.plan_id
              AND p2.usuario_id = valoraciones.evaluado_id
              AND p2.estado = 'aceptado'
        )
        AND EXISTS (
            SELECT 1 FROM public.planes pl
            WHERE pl.id = valoraciones.plan_id
              AND pl.fecha_evento IS NOT NULL
              AND pl.fecha_evento + interval '3 hours' <= now()
              AND COALESCE(pl.categoria, '') NOT IN ('Grupo', 'Chat')
        )
    );

DROP POLICY IF EXISTS "valoraciones_update_own" ON public.valoraciones;
CREATE POLICY "valoraciones_update_own" ON public.valoraciones
    FOR UPDATE TO authenticated
    USING (evaluador_id = auth.uid())
    WITH CHECK (evaluador_id = auth.uid());

-- Unicidad para upsert de valoraciones e historial
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
    -- Si ya hay un unique distinto, no bloqueamos
    NULL;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'historial_planes_unique_pair'
    ) THEN
        ALTER TABLE public.historial_planes
            ADD CONSTRAINT historial_planes_unique_pair
            UNIQUE (usuario_id, plan_id);
    END IF;
EXCEPTION WHEN others THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_planes_fecha_evento ON public.planes (fecha_evento);
CREATE INDEX IF NOT EXISTS idx_valoraciones_evaluador_plan ON public.valoraciones (evaluador_id, plan_id);
CREATE INDEX IF NOT EXISTS idx_valoraciones_evaluado ON public.valoraciones (evaluado_id);

-- ============================================================
-- Nexo Fútbol: formato del plan + alineaciones (posiciones)
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- 1. Formato de fútbol en el plan (5v5 / 7v7 / 11v11)
ALTER TABLE public.planes
    ADD COLUMN IF NOT EXISTS futbol_formato text;

ALTER TABLE public.planes
    DROP CONSTRAINT IF EXISTS planes_futbol_formato_check;

ALTER TABLE public.planes
    ADD CONSTRAINT planes_futbol_formato_check
    CHECK (futbol_formato IS NULL OR futbol_formato IN ('5v5', '7v7', '11v11'));

-- 2. Tabla de alineaciones (qué usuario ocupa qué posición en qué equipo)
CREATE TABLE IF NOT EXISTS public.alineaciones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id uuid NOT NULL REFERENCES public.planes(id) ON DELETE CASCADE,
    equipo smallint NOT NULL CHECK (equipo IN (0, 1)),
    posicion smallint NOT NULL,
    usuario_id uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT alineaciones_slot_unico UNIQUE (plan_id, equipo, posicion),
    CONSTRAINT alineaciones_usuario_unico UNIQUE (plan_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS idx_alineaciones_plan ON public.alineaciones (plan_id);

-- 3. RLS
ALTER TABLE public.alineaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "alineaciones_select" ON public.alineaciones;
DROP POLICY IF EXISTS "alineaciones_insert_own" ON public.alineaciones;
DROP POLICY IF EXISTS "alineaciones_delete_own" ON public.alineaciones;

-- Cualquier usuario autenticado puede ver la alineación
CREATE POLICY "alineaciones_select"
ON public.alineaciones
FOR SELECT
TO authenticated
USING (true);

-- Solo puedes ocupar una posición para ti mismo, y debes ser participante del plan
CREATE POLICY "alineaciones_insert_own"
ON public.alineaciones
FOR INSERT
TO authenticated
WITH CHECK (
    usuario_id = auth.uid()
    AND (
        EXISTS (
            SELECT 1 FROM public.participantes p
            WHERE p.plan_id = alineaciones.plan_id
              AND p.usuario_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM public.planes pl
            WHERE pl.id = alineaciones.plan_id
              AND pl.user_id = auth.uid()
        )
    )
);

-- Solo puedes liberar tu propia posición
CREATE POLICY "alineaciones_delete_own"
ON public.alineaciones
FOR DELETE
TO authenticated
USING (usuario_id = auth.uid());

-- 4. Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'alineaciones'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.alineaciones;
  END IF;
END $$;

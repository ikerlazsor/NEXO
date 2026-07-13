-- ============================================================
-- Nexo: planes por solicitud + estado de participantes
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- 1) ¿El plan requiere aprobación del anfitrión para unirse?
ALTER TABLE public.planes
    ADD COLUMN IF NOT EXISTS requiere_aprobacion boolean NOT NULL DEFAULT false;

-- 2) Estado del participante:
--    'aceptado'  -> está dentro del plan (cuenta para las plazas)
--    'pendiente' -> ha solicitado unirse y espera aprobación
ALTER TABLE public.participantes
    ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'aceptado'
    CHECK (estado IN ('aceptado', 'pendiente'));

-- Asegura que los participantes existentes queden como 'aceptado'
UPDATE public.participantes SET estado = 'aceptado' WHERE estado IS NULL;

CREATE INDEX IF NOT EXISTS idx_participantes_plan_estado
    ON public.participantes (plan_id, estado);

-- Políticas RLS del anfitrión: ver supabase/participantes-host-rls.sql

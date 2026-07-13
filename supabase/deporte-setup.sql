-- ============================================================
-- Nexo Deporte: subtipo + formatos ampliados
-- Ejecutar en Supabase SQL Editor
-- ============================================================

ALTER TABLE public.planes
    ADD COLUMN IF NOT EXISTS deporte_tipo text;

-- Quitar restricción antigua (solo 5v5/7v7/11v11) para permitir basket:5v5, padel:2v2, etc.
ALTER TABLE public.planes
    DROP CONSTRAINT IF EXISTS planes_futbol_formato_check;

ALTER TABLE public.planes
    DROP CONSTRAINT IF EXISTS planes_deporte_tipo_check;

ALTER TABLE public.planes
    ADD CONSTRAINT planes_deporte_tipo_check
    CHECK (
        deporte_tipo IS NULL
        OR deporte_tipo IN ('futbol', 'basket', 'padel', 'tenis', 'running')
    );

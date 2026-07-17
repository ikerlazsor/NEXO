-- Modo solo chicas como opción en cualquier categoría de plan
ALTER TABLE public.planes
    ADD COLUMN IF NOT EXISTS solo_chicas boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_planes_solo_chicas ON public.planes (solo_chicas)
    WHERE solo_chicas = true;

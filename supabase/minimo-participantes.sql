-- Mínimo de participantes por plan (incluye al creador)
ALTER TABLE public.planes
    ADD COLUMN IF NOT EXISTS minimo_participantes integer NOT NULL DEFAULT 2;

ALTER TABLE public.planes
    DROP CONSTRAINT IF EXISTS planes_min_max_participantes_check;

ALTER TABLE public.planes
    ADD CONSTRAINT planes_min_max_participantes_check
    CHECK (minimo_participantes >= 2 AND maximo_participantes >= minimo_participantes);

UPDATE public.planes
SET minimo_participantes = LEAST(2, maximo_participantes)
WHERE minimo_participantes IS NULL OR minimo_participantes < 2;

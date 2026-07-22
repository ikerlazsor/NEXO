-- Visibilidad de planes: solo amigos / modo privado (solo invitados).
-- Ejecutar en Supabase SQL Editor.

ALTER TABLE public.planes
    ADD COLUMN IF NOT EXISTS solo_amigos boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS modo_privado boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.planes.solo_amigos IS
    'Si true, el plan solo aparece en el feed a amigos del creador (y participantes/invitados).';
COMMENT ON COLUMN public.planes.modo_privado IS
    'Si true, el plan solo aparece a invitados y participantes (no en el feed público).';

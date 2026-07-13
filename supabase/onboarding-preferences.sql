-- ============================================================
-- Nexo: preferencias de onboarding (gustos del usuario)
-- Ejecutar en Supabase SQL Editor
-- ============================================================

ALTER TABLE public.perfiles
    ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

ALTER TABLE public.perfiles
    ADD COLUMN IF NOT EXISTS preferred_categories text[] DEFAULT '{}'::text[];

ALTER TABLE public.perfiles
    ADD COLUMN IF NOT EXISTS preferred_sports text[] DEFAULT '{}'::text[];

ALTER TABLE public.perfiles
    ADD COLUMN IF NOT EXISTS preferred_province text;

ALTER TABLE public.perfiles
    ADD COLUMN IF NOT EXISTS preferred_vibes text[] DEFAULT '{}'::text[];

ALTER TABLE public.perfiles
    ADD COLUMN IF NOT EXISTS social_energy text;

ALTER TABLE public.perfiles
    ADD COLUMN IF NOT EXISTS taste_profile jsonb DEFAULT '{}'::jsonb;

ALTER TABLE public.perfiles
    ADD COLUMN IF NOT EXISTS aura_score integer;

-- Usuarios existentes: marcar onboarding como completado para no forzar el flujo
-- UPDATE public.perfiles SET onboarding_completed = true WHERE onboarding_completed = false;

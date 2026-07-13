-- ============================================================
-- Nexo: campos públicos de perfil (Sobre mí + personalidad)
-- Ejecutar en Supabase SQL Editor
-- ============================================================

ALTER TABLE public.perfiles
    ADD COLUMN IF NOT EXISTS about_me text;

ALTER TABLE public.perfiles
    ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}'::text[];

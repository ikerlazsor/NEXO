-- ============================================================
-- Nexo: arreglar "Database error saving new user" al registrarse
-- Ejecutar en Supabase SQL Editor
-- ============================================================
-- Causa habitual: trigger en auth.users que inserta en perfiles
-- con columnas/metadata incorrectas o bloqueado por RLS.

-- 1. Asegurar columnas de onboarding (por si no se ejecutó antes)
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

-- 2. Trigger robusto: crea perfil al registrarse en Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    display_name text;
BEGIN
    display_name := COALESCE(
        NULLIF(TRIM(NEW.raw_user_meta_data->>'nombre'), ''),
        NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
        NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
        NULLIF(TRIM(split_part(NEW.email, '@', 1)), ''),
        'Usuario'
    );

    INSERT INTO public.perfiles (id, nombre, onboarding_completed)
    VALUES (NEW.id, display_name, false)
    ON CONFLICT (id) DO UPDATE
        SET nombre = EXCLUDED.nombre
        WHERE public.perfiles.nombre IS NULL
           OR TRIM(public.perfiles.nombre) = ''
           OR public.perfiles.nombre = 'Usuario';

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        RAISE LOG 'handle_new_user error for %: %', NEW.id, SQLERRM;
        RAISE;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- 3. RLS: lectura + insert/update del propio perfil
ALTER TABLE public.perfiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "perfiles_read_authenticated" ON public.perfiles;
CREATE POLICY "perfiles_read_authenticated"
ON public.perfiles
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "perfiles_insert_own" ON public.perfiles;
CREATE POLICY "perfiles_insert_own"
ON public.perfiles
FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "perfiles_update_own" ON public.perfiles;
CREATE POLICY "perfiles_update_own"
ON public.perfiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

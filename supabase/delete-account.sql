-- ============================================================
-- Nexo: nombre de usuario único + eliminar cuenta propia
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- El nombre visible puede repetirse; el handle (nombre_usuario) es único
DROP INDEX IF EXISTS public.perfiles_nombre_lower_unique;

CREATE UNIQUE INDEX IF NOT EXISTS perfiles_nombre_usuario_lower_unique
    ON public.perfiles (lower(nombre_usuario))
    WHERE nombre_usuario IS NOT NULL AND btrim(nombre_usuario) <> '';

-- Comprobar si un handle ya está en uso (registro y edición de perfil)
CREATE OR REPLACE FUNCTION public.is_username_taken(
    check_name text,
    exclude_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.perfiles
        WHERE lower(nombre_usuario) = lower(btrim(check_name))
          AND btrim(check_name) <> ''
          AND (exclude_id IS NULL OR id <> exclude_id)
    );
$$;

REVOKE ALL ON FUNCTION public.is_username_taken(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_username_taken(text, uuid) TO anon, authenticated;

-- Elimina la cuenta autenticada y datos en cascada (perfiles → planes, amigos, etc.)
CREATE OR REPLACE FUNCTION public.delete_own_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    uid uuid := auth.uid();
BEGIN
    IF uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated';
    END IF;

    DELETE FROM auth.users WHERE id = uid;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_own_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;

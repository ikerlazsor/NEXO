-- ============================================================
-- Nexo: nombre de usuario único + eliminar cuenta propia
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- Índice único case-insensitive (ignora vacíos)
CREATE UNIQUE INDEX IF NOT EXISTS perfiles_nombre_lower_unique
    ON public.perfiles (lower(trim(nombre)))
    WHERE nombre IS NOT NULL AND trim(nombre) <> '';

-- Comprobar si un nombre ya está en uso (registro y edición de perfil)
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
        WHERE lower(trim(nombre)) = lower(trim(check_name))
          AND trim(check_name) <> ''
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

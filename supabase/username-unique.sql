-- ============================================================
-- Nombre de usuario único (handle) vs nombre visible
-- Ejecutar en Supabase SQL Editor.
-- ============================================================

-- El nombre visible (nombre) puede repetirse: quitar unique antiguo si existía
DROP INDEX IF EXISTS public.perfiles_nombre_lower_unique;

-- Handle único case-insensitive
CREATE UNIQUE INDEX IF NOT EXISTS perfiles_nombre_usuario_lower_unique
    ON public.perfiles (lower(nombre_usuario))
    WHERE nombre_usuario IS NOT NULL AND btrim(nombre_usuario) <> '';

-- Comprobar disponibilidad del handle
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

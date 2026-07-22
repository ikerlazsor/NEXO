-- ============================================================
-- Email único en registro
-- Ejecutar en Supabase SQL Editor.
-- Comprueba auth.users para que solo exista una cuenta por email.
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_email_taken(check_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM auth.users
        WHERE lower(email) = lower(btrim(check_email))
          AND btrim(check_email) <> ''
    );
$$;

REVOKE ALL ON FUNCTION public.is_email_taken(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_email_taken(text) TO anon, authenticated;

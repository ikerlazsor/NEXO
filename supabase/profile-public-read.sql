-- ============================================================
-- Nexo: lectura de perfiles entre usuarios autenticados
-- Necesario para ver nombre, avatar, sobre mí y tags de otros.
-- Ejecutar en Supabase SQL Editor
-- ============================================================

ALTER TABLE public.perfiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "perfiles_read_authenticated" ON public.perfiles;
CREATE POLICY "perfiles_read_authenticated"
ON public.perfiles
FOR SELECT
TO authenticated
USING (true);

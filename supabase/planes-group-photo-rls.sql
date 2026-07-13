-- Permite al creador actualizar image_url de sus grupos (categoría Grupo)
DROP POLICY IF EXISTS "planes_update_owner" ON public.planes;

CREATE POLICY "planes_update_owner"
ON public.planes
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

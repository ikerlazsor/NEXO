-- Permite al creador del plan borrarlo y datos hijos (ejecutar en SQL Editor)

DROP POLICY IF EXISTS "planes_delete_owner" ON public.planes;
CREATE POLICY "planes_delete_owner"
ON public.planes
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "mensajes_delete_plan_owner" ON public.mensajes;
CREATE POLICY "mensajes_delete_plan_owner"
ON public.mensajes
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.planes pl
    WHERE pl.id = mensajes.plan_id AND pl.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "participantes_delete_plan_owner" ON public.participantes;
CREATE POLICY "participantes_delete_plan_owner"
ON public.participantes
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.planes pl
    WHERE pl.id = participantes.plan_id AND pl.user_id = auth.uid()
  )
);

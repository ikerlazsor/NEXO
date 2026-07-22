-- Creador (y participantes aceptados) pueden ver todas las invitaciones pendientes del plan.
-- Solo el creador (además del invitador/invitado) puede borrar cualquier invitación del plan.

ALTER TABLE public.invitaciones_planes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inv_planes_select" ON public.invitaciones_planes;
CREATE POLICY "inv_planes_select" ON public.invitaciones_planes
    FOR SELECT TO authenticated
    USING (
        invitador_id = auth.uid()
        OR invitado_id = auth.uid()
        OR EXISTS (
            SELECT 1
            FROM public.planes p
            WHERE p.id = invitaciones_planes.plan_id
              AND p.creador_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1
            FROM public.participantes part
            WHERE part.plan_id = invitaciones_planes.plan_id
              AND part.usuario_id = auth.uid()
              AND part.estado = 'aceptado'
        )
    );

DROP POLICY IF EXISTS "inv_planes_delete" ON public.invitaciones_planes;
CREATE POLICY "inv_planes_delete" ON public.invitaciones_planes
    FOR DELETE TO authenticated
    USING (
        invitador_id = auth.uid()
        OR invitado_id = auth.uid()
        OR EXISTS (
            SELECT 1
            FROM public.planes p
            WHERE p.id = invitaciones_planes.plan_id
              AND p.creador_id = auth.uid()
        )
    );

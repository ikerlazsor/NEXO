-- Invitaciones a planes / grupos de chat
CREATE TABLE IF NOT EXISTS public.plan_invitaciones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id uuid NOT NULL REFERENCES public.planes(id) ON DELETE CASCADE,
    invitador_id uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
    invitado_id uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
    tipo text NOT NULL DEFAULT 'plan' CHECK (tipo IN ('plan', 'grupo')),
    estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aceptado', 'rechazado')),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT plan_invitaciones_unique UNIQUE (plan_id, invitado_id)
);

CREATE INDEX IF NOT EXISTS idx_plan_invitaciones_invitado ON public.plan_invitaciones (invitado_id, estado);

ALTER TABLE public.plan_invitaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plan_invitaciones_select" ON public.plan_invitaciones;
DROP POLICY IF EXISTS "plan_invitaciones_insert" ON public.plan_invitaciones;
DROP POLICY IF EXISTS "plan_invitaciones_update_invitado" ON public.plan_invitaciones;

CREATE POLICY "plan_invitaciones_select"
ON public.plan_invitaciones
FOR SELECT
TO authenticated
USING (invitador_id = auth.uid() OR invitado_id = auth.uid());

CREATE POLICY "plan_invitaciones_insert"
ON public.plan_invitaciones
FOR INSERT
TO authenticated
WITH CHECK (
    invitador_id = auth.uid()
    AND (
        EXISTS (
            SELECT 1 FROM public.participantes p
            WHERE p.plan_id = plan_invitaciones.plan_id
              AND p.usuario_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM public.planes pl
            WHERE pl.id = plan_invitaciones.plan_id
              AND pl.user_id = auth.uid()
        )
    )
);

CREATE POLICY "plan_invitaciones_update_invitado"
ON public.plan_invitaciones
FOR UPDATE
TO authenticated
USING (invitado_id = auth.uid())
WITH CHECK (invitado_id = auth.uid());

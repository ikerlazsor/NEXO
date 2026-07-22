-- ============================================================
-- Registro de expulsiones de planes (para stats de perfil)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.expulsiones_plan (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id uuid NOT NULL REFERENCES public.planes(id) ON DELETE CASCADE,
    usuario_id uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
    expulsado_por uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
    creado_en timestamptz NOT NULL DEFAULT now(),
    UNIQUE (plan_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS idx_expulsiones_usuario ON public.expulsiones_plan (usuario_id);

ALTER TABLE public.expulsiones_plan ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expulsiones_select_authenticated" ON public.expulsiones_plan;
CREATE POLICY "expulsiones_select_authenticated" ON public.expulsiones_plan
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "expulsiones_insert_creator" ON public.expulsiones_plan;
CREATE POLICY "expulsiones_insert_creator" ON public.expulsiones_plan
    FOR INSERT TO authenticated
    WITH CHECK (
        expulsado_por = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.planes p
            WHERE p.id = plan_id AND p.creador_id = auth.uid()
        )
    );

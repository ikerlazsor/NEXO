-- ============================================================
-- Reportes de usuarios + mensaje opcional en reportes de planes
-- ============================================================

ALTER TABLE public.reportes_planes
    ADD COLUMN IF NOT EXISTS mensaje text;

CREATE TABLE IF NOT EXISTS public.reportes_usuarios (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    denunciado_id uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
    reportador_id uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
    motivo text NOT NULL DEFAULT 'otro',
    mensaje text,
    creado_en timestamptz NOT NULL DEFAULT now(),
    UNIQUE (denunciado_id, reportador_id)
);

ALTER TABLE public.reportes_usuarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reportes_usuarios_insert_own" ON public.reportes_usuarios;
CREATE POLICY "reportes_usuarios_insert_own" ON public.reportes_usuarios
    FOR INSERT TO authenticated WITH CHECK (reportador_id = auth.uid());

DROP POLICY IF EXISTS "reportes_usuarios_select_own" ON public.reportes_usuarios;
CREATE POLICY "reportes_usuarios_select_own" ON public.reportes_usuarios
    FOR SELECT TO authenticated USING (reportador_id = auth.uid());

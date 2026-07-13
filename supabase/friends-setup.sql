-- ============================================================
-- Nexo Amigos: ejecutar en Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.amistades (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
    amigo_id uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
    estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aceptado', 'rechazado')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT amistades_no_self CHECK (usuario_id <> amigo_id),
    CONSTRAINT amistades_unique_pair UNIQUE (usuario_id, amigo_id)
);

CREATE INDEX IF NOT EXISTS idx_amistades_usuario ON public.amistades (usuario_id, estado);
CREATE INDEX IF NOT EXISTS idx_amistades_amigo ON public.amistades (amigo_id, estado);

ALTER TABLE public.amistades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "amistades_select_own" ON public.amistades;
DROP POLICY IF EXISTS "amistades_insert_own" ON public.amistades;
DROP POLICY IF EXISTS "amistades_update_recipient" ON public.amistades;
DROP POLICY IF EXISTS "amistades_delete_own" ON public.amistades;

CREATE POLICY "amistades_select_own"
ON public.amistades
FOR SELECT
TO authenticated
USING (auth.uid() = usuario_id OR auth.uid() = amigo_id);

CREATE POLICY "amistades_insert_own"
ON public.amistades
FOR INSERT
TO authenticated
WITH CHECK (
    auth.uid() = usuario_id
    AND usuario_id <> amigo_id
);

CREATE POLICY "amistades_update_recipient"
ON public.amistades
FOR UPDATE
TO authenticated
USING (auth.uid() = amigo_id OR auth.uid() = usuario_id)
WITH CHECK (auth.uid() = amigo_id OR auth.uid() = usuario_id);

CREATE POLICY "amistades_delete_own"
ON public.amistades
FOR DELETE
TO authenticated
USING (auth.uid() = usuario_id OR auth.uid() = amigo_id);

-- Realtime opcional para solicitudes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'amistades'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.amistades;
  END IF;
END $$;

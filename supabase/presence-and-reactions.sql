-- Reacciones a mensajes (una por usuario y mensaje; se puede cambiar)
CREATE TABLE IF NOT EXISTS public.mensaje_reacciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mensaje_id uuid NOT NULL REFERENCES public.mensajes (id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  emoji text NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mensaje_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS mensaje_reacciones_mensaje_idx
  ON public.mensaje_reacciones (mensaje_id);

ALTER TABLE public.mensaje_reacciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reacciones_select" ON public.mensaje_reacciones;
CREATE POLICY "reacciones_select"
  ON public.mensaje_reacciones FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "reacciones_insert_own" ON public.mensaje_reacciones;
CREATE POLICY "reacciones_insert_own"
  ON public.mensaje_reacciones FOR INSERT TO authenticated
  WITH CHECK (usuario_id = auth.uid());

DROP POLICY IF EXISTS "reacciones_update_own" ON public.mensaje_reacciones;
CREATE POLICY "reacciones_update_own"
  ON public.mensaje_reacciones FOR UPDATE TO authenticated
  USING (usuario_id = auth.uid())
  WITH CHECK (usuario_id = auth.uid());

DROP POLICY IF EXISTS "reacciones_delete_own" ON public.mensaje_reacciones;
CREATE POLICY "reacciones_delete_own"
  ON public.mensaje_reacciones FOR DELETE TO authenticated
  USING (usuario_id = auth.uid());

-- Realtime opcional (si falla porque ya está, ignora)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.mensaje_reacciones;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

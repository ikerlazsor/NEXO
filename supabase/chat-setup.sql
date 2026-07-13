-- ============================================================
-- Nexo Chat: ejecutar en Supabase SQL Editor
-- Configura RLS, Storage y Realtime para mensajes del chat
-- ============================================================

-- 1. Habilitar Realtime en la tabla mensajes (solo si aun no esta activo)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'mensajes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.mensajes;
  END IF;
END $$;

-- 2. Asegurar columnas necesarias (idempotente)
ALTER TABLE public.mensajes
  ADD COLUMN IF NOT EXISTS tipo text DEFAULT 'texto',
  ADD COLUMN IF NOT EXISTS archivo_url text;

-- 3. Indice para paginacion y consultas por plan
CREATE INDEX IF NOT EXISTS idx_mensajes_plan_created
  ON public.mensajes (plan_id, created_at DESC);

-- 4. RLS en mensajes
ALTER TABLE public.mensajes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mensajes_select_participantes" ON public.mensajes;
DROP POLICY IF EXISTS "mensajes_insert_participantes" ON public.mensajes;

CREATE POLICY "mensajes_select_participantes"
ON public.mensajes
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.participantes p
    WHERE p.plan_id = mensajes.plan_id
      AND p.usuario_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.planes pl
    WHERE pl.id = mensajes.plan_id
      AND pl.user_id = auth.uid()
  )
);

CREATE POLICY "mensajes_insert_participantes"
ON public.mensajes
FOR INSERT
TO authenticated
WITH CHECK (
  usuario_id = auth.uid()
  AND (
    EXISTS (
      SELECT 1 FROM public.participantes p
      WHERE p.plan_id = mensajes.plan_id
        AND p.usuario_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.planes pl
      WHERE pl.id = mensajes.plan_id
        AND pl.user_id = auth.uid()
    )
  )
);

-- 5. Bucket de Storage para archivos del chat
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-files', 'chat-files', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "chat_files_select_public" ON storage.objects;
DROP POLICY IF EXISTS "chat_files_insert_authenticated" ON storage.objects;

CREATE POLICY "chat_files_select_public"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'chat-files');

CREATE POLICY "chat_files_insert_authenticated"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'chat-files');

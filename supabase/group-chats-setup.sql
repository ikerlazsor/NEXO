-- Grupos de chat sin plan (invitar amigos)
ALTER TABLE public.planes
    ADD COLUMN IF NOT EXISTS is_group_chat boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_planes_group_chat ON public.planes (is_group_chat)
    WHERE is_group_chat = true;

-- RLS participantes: anfitrión, miembros, feed público (sin recursión infinita)
ALTER TABLE public.participantes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "participantes_select_same_plan" ON public.participantes;
DROP POLICY IF EXISTS "participantes_update_host" ON public.participantes;
DROP POLICY IF EXISTS "participantes_delete_host_or_self" ON public.participantes;
DROP POLICY IF EXISTS "participantes_insert_self_or_host" ON public.participantes;

-- Funciones SECURITY DEFINER evitan recursión al comprobar membresía
CREATE OR REPLACE FUNCTION public.user_is_plan_member(p_plan_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.participantes p
    WHERE p.plan_id = p_plan_id AND p.usuario_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.plan_is_feed_public(p_plan_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.planes pl
    WHERE pl.id = p_plan_id
      AND COALESCE(pl.is_direct_chat, false) = false
      AND COALESCE(pl.is_group_chat, false) = false
      AND COALESCE(pl.category, '') NOT IN ('Chat', 'Grupo')
  );
$$;

CREATE POLICY "participantes_select_same_plan"
ON public.participantes
FOR SELECT
TO authenticated
USING (
    usuario_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.planes pl
        WHERE pl.id = participantes.plan_id AND pl.user_id = auth.uid()
    )
    OR public.user_is_plan_member(participantes.plan_id)
    OR public.plan_is_feed_public(participantes.plan_id)
);

CREATE POLICY "participantes_update_host"
ON public.participantes
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.planes pl
        WHERE pl.id = participantes.plan_id AND pl.user_id = auth.uid()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.planes pl
        WHERE pl.id = participantes.plan_id AND pl.user_id = auth.uid()
    )
);

CREATE POLICY "participantes_delete_host_or_self"
ON public.participantes
FOR DELETE
TO authenticated
USING (
    usuario_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.planes pl
        WHERE pl.id = participantes.plan_id AND pl.user_id = auth.uid()
    )
);

CREATE POLICY "participantes_insert_self_or_host"
ON public.participantes
FOR INSERT
TO authenticated
WITH CHECK (
    usuario_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.planes pl
        WHERE pl.id = participantes.plan_id AND pl.user_id = auth.uid()
    )
);

-- Un plan convertido en chat fijo sigue siendo valorable.
-- keep_plan_chat_forever pone categoria = 'Grupo' y deja is_group_chat en falso.
-- Los grupos creados en Chats tienen is_group_chat y una fecha futura.

DROP POLICY IF EXISTS "valoraciones_insert_own" ON public.valoraciones;
CREATE POLICY "valoraciones_insert_own" ON public.valoraciones
    FOR INSERT TO authenticated
    WITH CHECK (
        evaluador_id = auth.uid()
        AND evaluador_id <> evaluado_id
        AND EXISTS (
            SELECT 1 FROM public.participantes p
            WHERE p.plan_id = valoraciones.plan_id
              AND p.usuario_id = auth.uid()
              AND p.estado = 'aceptado'
        )
        AND EXISTS (
            SELECT 1 FROM public.participantes p2
            WHERE p2.plan_id = valoraciones.plan_id
              AND p2.usuario_id = valoraciones.evaluado_id
              AND p2.estado = 'aceptado'
        )
        AND EXISTS (
            SELECT 1 FROM public.planes pl
            WHERE pl.id = valoraciones.plan_id
              AND pl.fecha_evento IS NOT NULL
              AND pl.fecha_evento + interval '1 hour' <= now()
              AND COALESCE(pl.categoria, '') <> 'Chat'
              AND (
                COALESCE(pl.categoria, '') <> 'Grupo'
                OR COALESCE(pl.is_group_chat, false) = false
              )
        )
    );

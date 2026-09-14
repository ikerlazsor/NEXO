-- Cierre del plan a 1h (antes 2h). Chat de plan a 48h (antes 24h).

CREATE OR REPLACE FUNCTION public.purge_expired_plan_chats()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    r record;
    n integer := 0;
BEGIN
    PERFORM public.archive_all_ended_plans();
    PERFORM public.purge_past_saved_plans();

    FOR r IN
        SELECT id FROM public.planes
        WHERE fecha_evento IS NOT NULL
          AND fecha_evento + interval '48 hours' <= now()
          AND chat_eliminado_en IS NULL
          AND COALESCE(categoria, '') NOT IN ('Grupo', 'Chat')
    LOOP
        DELETE FROM public.mensajes WHERE plan_id = r.id;
        DELETE FROM public.invitaciones_planes WHERE plan_id = r.id;
        DELETE FROM public.planes_guardados WHERE plan_id = r.id;
        UPDATE public.planes
        SET chat_eliminado_en = now(),
            finalizado_en = COALESCE(finalizado_en, now())
        WHERE id = r.id;
        n := n + 1;
    END LOOP;
    RETURN n;
END;
$$;

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
              AND COALESCE(pl.categoria, '') NOT IN ('Grupo', 'Chat')
        )
    );

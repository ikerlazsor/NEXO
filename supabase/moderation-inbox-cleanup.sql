-- ============================================================
-- Moderación: borrar items de bandeja + conservar reportes al
-- eliminar un plan (historial en inbox).
-- Ejecutar en Supabase SQL Editor.
-- ============================================================

-- ---------- Reportes de planes: sobrevivir a delete del plan ----------
ALTER TABLE public.reportes_planes
    ADD COLUMN IF NOT EXISTS plan_titulo text,
    ADD COLUMN IF NOT EXISTS plan_eliminado boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS plan_eliminado_en timestamptz;

-- Quitar FK CASCADE antigua (nombre puede variar)
DO $$
DECLARE
    cname text;
BEGIN
    SELECT con.conname INTO cname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'reportes_planes'
      AND con.contype = 'f'
      AND pg_get_constraintdef(con.oid) ILIKE '%plan_id%';

    IF cname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.reportes_planes DROP CONSTRAINT %I', cname);
    END IF;
END $$;

ALTER TABLE public.reportes_planes
    ALTER COLUMN plan_id DROP NOT NULL;

-- FK nueva: al borrar el plan, plan_id queda NULL y el reporte permanece
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'reportes_planes_plan_id_fkey'
          AND conrelid = 'public.reportes_planes'::regclass
    ) THEN
        ALTER TABLE public.reportes_planes
            ADD CONSTRAINT reportes_planes_plan_id_fkey
            FOREIGN KEY (plan_id) REFERENCES public.planes(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Rellenar títulos snapshot desde planes existentes
UPDATE public.reportes_planes r
SET plan_titulo = p.titulo
FROM public.planes p
WHERE r.plan_id = p.id
  AND (r.plan_titulo IS NULL OR btrim(r.plan_titulo) = '');

-- ---------- admin_delete_plan: NO borra reportes; los marca ----------
CREATE OR REPLACE FUNCTION public.admin_delete_plan(target_plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_title text;
BEGIN
    IF NOT public.is_owner() THEN
        RAISE EXCEPTION 'not_authorized';
    END IF;
    IF target_plan_id IS NULL THEN
        RAISE EXCEPTION 'invalid_target';
    END IF;

    SELECT titulo INTO v_title FROM public.planes WHERE id = target_plan_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'plan_not_found';
    END IF;

    -- Conservar el reporte en la bandeja con snapshot
    UPDATE public.reportes_planes
    SET
        plan_titulo = COALESCE(NULLIF(btrim(plan_titulo), ''), v_title, 'Plan'),
        plan_eliminado = true,
        plan_eliminado_en = now(),
        estado = CASE
            WHEN estado IN ('abierto', 'en_revision') THEN 'resuelto'
            ELSE estado
        END,
        revisado_en = COALESCE(revisado_en, now()),
        revisado_por = COALESCE(revisado_por, auth.uid())
    WHERE plan_id = target_plan_id;

    DELETE FROM public.mensajes WHERE plan_id = target_plan_id;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'invitaciones_planes'
    ) THEN
        DELETE FROM public.invitaciones_planes WHERE plan_id = target_plan_id;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'expulsiones_plan'
    ) THEN
        DELETE FROM public.expulsiones_plan WHERE plan_id = target_plan_id;
    END IF;

    DELETE FROM public.participantes WHERE plan_id = target_plan_id;
    DELETE FROM public.planes_guardados WHERE plan_id = target_plan_id;
    DELETE FROM public.historial_planes WHERE plan_id = target_plan_id;
    DELETE FROM public.valoraciones WHERE plan_id = target_plan_id;
    -- ON DELETE SET NULL en reportes_planes
    DELETE FROM public.planes WHERE id = target_plan_id;
END;
$$;

-- ---------- Borrar elementos de la bandeja (limpieza) ----------
CREATE OR REPLACE FUNCTION public.admin_delete_inbox_item(
    item_kind text,
    item_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_staff() THEN
        RAISE EXCEPTION 'not_authorized';
    END IF;
    IF item_id IS NULL THEN
        RAISE EXCEPTION 'invalid_target';
    END IF;

    IF item_kind = 'soporte' THEN
        DELETE FROM public.mensajes_soporte WHERE id = item_id;
    ELSIF item_kind = 'plan' THEN
        DELETE FROM public.reportes_planes WHERE id = item_id;
    ELSIF item_kind = 'user' THEN
        DELETE FROM public.reportes_usuarios WHERE id = item_id;
    ELSE
        RAISE EXCEPTION 'invalid_kind';
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'item_not_found';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_inbox_item(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_inbox_item(text, uuid) TO authenticated;

-- Staff puede borrar filas también por RLS (además del RPC)
DROP POLICY IF EXISTS "mensajes_soporte_delete_staff" ON public.mensajes_soporte;
CREATE POLICY "mensajes_soporte_delete_staff" ON public.mensajes_soporte
    FOR DELETE TO authenticated
    USING (public.is_staff());

DROP POLICY IF EXISTS "reportes_planes_delete_staff" ON public.reportes_planes;
CREATE POLICY "reportes_planes_delete_staff" ON public.reportes_planes
    FOR DELETE TO authenticated
    USING (public.is_staff());

DROP POLICY IF EXISTS "reportes_usuarios_delete_staff" ON public.reportes_usuarios;
CREATE POLICY "reportes_usuarios_delete_staff" ON public.reportes_usuarios
    FOR DELETE TO authenticated
    USING (public.is_staff());

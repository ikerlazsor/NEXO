-- Quita de «planes guardados» los planes cuya fecha/hora ya ha pasado.
-- Ejecutar en Supabase SQL Editor (también está incluido en plan-lifecycle.sql).

CREATE OR REPLACE FUNCTION public.purge_past_saved_plans()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    n integer := 0;
BEGIN
    WITH deleted AS (
        DELETE FROM public.planes_guardados pg
        USING public.planes p
        WHERE pg.plan_id = p.id
          AND p.fecha_evento IS NOT NULL
          AND p.fecha_evento <= now()
        RETURNING pg.plan_id
    )
    SELECT COUNT(*)::integer INTO n FROM deleted;
    RETURN COALESCE(n, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.purge_past_saved_plans() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_past_saved_plans() TO authenticated;

-- Limpieza inmediata al ejecutar este script:
SELECT public.purge_past_saved_plans();

-- ============================================================
-- Nexo: lista de espera en planes completos
-- Ejecutar en Supabase SQL Editor
-- ============================================================

ALTER TABLE public.participantes
    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.participantes
    DROP CONSTRAINT IF EXISTS participantes_estado_check;

ALTER TABLE public.participantes
    ADD CONSTRAINT participantes_estado_check
    CHECK (estado IN ('aceptado', 'pendiente', 'lista_espera'));

CREATE INDEX IF NOT EXISTS idx_participantes_waitlist
    ON public.participantes (plan_id, estado, created_at);

-- Promueve al primero en lista de espera si hay hueco
CREATE OR REPLACE FUNCTION public.promote_waitlist(p_plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_max int;
    v_count int;
    v_next_id uuid;
BEGIN
    SELECT max_people INTO v_max FROM planes WHERE id = p_plan_id;
    IF v_max IS NULL THEN
        RETURN;
    END IF;

    SELECT COUNT(*)::int INTO v_count
    FROM participantes
    WHERE plan_id = p_plan_id AND estado = 'aceptado';

    IF v_count >= v_max THEN
        RETURN;
    END IF;

    SELECT id INTO v_next_id
    FROM participantes
    WHERE plan_id = p_plan_id AND estado = 'lista_espera'
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_next_id IS NOT NULL THEN
        UPDATE participantes SET estado = 'aceptado' WHERE id = v_next_id;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.promote_waitlist(uuid) TO authenticated;

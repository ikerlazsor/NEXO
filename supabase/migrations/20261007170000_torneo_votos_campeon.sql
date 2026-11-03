-- Encuesta "quién gana la liguilla" por plan/torneo.

CREATE TABLE IF NOT EXISTS public.torneo_votos_campeon (
    plan_id uuid NOT NULL REFERENCES public.planes (id) ON DELETE CASCADE,
    usuario_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    equipo integer NOT NULL CHECK (equipo >= 0 AND equipo < 32),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (plan_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS torneo_votos_campeon_plan_idx
    ON public.torneo_votos_campeon (plan_id);

ALTER TABLE public.torneo_votos_campeon ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS torneo_votos_select ON public.torneo_votos_campeon;
CREATE POLICY torneo_votos_select ON public.torneo_votos_campeon
    FOR SELECT TO authenticated
    USING (public.user_can_view_plan(plan_id, auth.uid()));

DROP POLICY IF EXISTS torneo_votos_upsert ON public.torneo_votos_campeon;
CREATE POLICY torneo_votos_insert ON public.torneo_votos_campeon
    FOR INSERT TO authenticated
    WITH CHECK (
        usuario_id = auth.uid()
        AND public.user_can_view_plan(plan_id, auth.uid())
    );

DROP POLICY IF EXISTS torneo_votos_update ON public.torneo_votos_campeon;
CREATE POLICY torneo_votos_update ON public.torneo_votos_campeon
    FOR UPDATE TO authenticated
    USING (usuario_id = auth.uid())
    WITH CHECK (
        usuario_id = auth.uid()
        AND public.user_can_view_plan(plan_id, auth.uid())
    );

CREATE OR REPLACE FUNCTION public.get_torneo_votos_campeon(p_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_my integer;
    v_total integer;
    v_totals jsonb;
BEGIN
    IF p_plan_id IS NULL THEN
        RETURN NULL;
    END IF;
    IF v_uid IS NOT NULL AND NOT public.user_can_view_plan(p_plan_id, v_uid) THEN
        RETURN NULL;
    END IF;

    SELECT v.equipo INTO v_my
    FROM public.torneo_votos_campeon v
    WHERE v.plan_id = p_plan_id AND v.usuario_id = v_uid;

    SELECT count(*)::integer INTO v_total
    FROM public.torneo_votos_campeon v
    WHERE v.plan_id = p_plan_id;

    SELECT coalesce(jsonb_agg(
        jsonb_build_object('equipo', x.equipo, 'votos', x.votos)
        ORDER BY x.equipo
    ), '[]'::jsonb)
    INTO v_totals
    FROM (
        SELECT equipo, count(*)::integer AS votos
        FROM public.torneo_votos_campeon
        WHERE plan_id = p_plan_id
        GROUP BY equipo
    ) x;

    RETURN jsonb_build_object(
        'myVote', to_jsonb(v_my),
        'total', v_total,
        'totals', v_totals
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.vote_torneo_campeon(p_plan_id uuid, p_equipo integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
BEGIN
    IF v_uid IS NULL OR p_plan_id IS NULL OR p_equipo IS NULL OR p_equipo < 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'bad_request');
    END IF;
    IF NOT public.user_can_view_plan(p_plan_id, v_uid) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;

    INSERT INTO public.torneo_votos_campeon (plan_id, usuario_id, equipo, updated_at)
    VALUES (p_plan_id, v_uid, p_equipo, now())
    ON CONFLICT (plan_id, usuario_id)
    DO UPDATE SET equipo = EXCLUDED.equipo, updated_at = now();

    RETURN public.get_torneo_votos_campeon(p_plan_id);
END;
$$;

REVOKE ALL ON FUNCTION public.vote_torneo_campeon(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_torneo_votos_campeon(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vote_torneo_campeon(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_torneo_votos_campeon(uuid) TO authenticated;

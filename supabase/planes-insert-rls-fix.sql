-- ============================================================
-- Fix crear plan: RLS insert + SELECT post-insert + RPC seguro
-- Ejecutar ENTERO en Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.planes ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.planes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.participantes TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Quitar políticas viejas / duplicadas
DROP POLICY IF EXISTS "planes_insert_own" ON public.planes;
DROP POLICY IF EXISTS "planes_update_own" ON public.planes;
DROP POLICY IF EXISTS "planes_update_owner" ON public.planes;
DROP POLICY IF EXISTS "planes_delete_own" ON public.planes;
DROP POLICY IF EXISTS "planes_delete_owner" ON public.planes;
DROP POLICY IF EXISTS "planes_select" ON public.planes;

-- INSERT: solo como creador
CREATE POLICY "planes_insert_own" ON public.planes
    FOR INSERT TO authenticated
    WITH CHECK (creador_id = auth.uid());

-- UPDATE / DELETE
CREATE POLICY "planes_update_own" ON public.planes
    FOR UPDATE TO authenticated
    USING (creador_id = auth.uid())
    WITH CHECK (creador_id = auth.uid());

CREATE POLICY "planes_delete_own" ON public.planes
    FOR DELETE TO authenticated
    USING (creador_id = auth.uid());

-- SELECT: el creador SIEMPRE ve su plan (evita fallo de .insert().select())
-- y el resto pasa por user_can_view_plan si existe.
DO $$
BEGIN
    IF to_regprocedure('public.user_can_view_plan(uuid,uuid)') IS NOT NULL THEN
        EXECUTE $p$
            CREATE POLICY "planes_select" ON public.planes
                FOR SELECT TO authenticated
                USING (
                    creador_id = auth.uid()
                    OR public.user_can_view_plan(id, auth.uid())
                )
        $p$;
    ELSE
        EXECUTE $p$
            CREATE POLICY "planes_select" ON public.planes
                FOR SELECT TO authenticated
                USING (true)
        $p$;
    END IF;
END $$;

-- RPC: crea plan + te añade como participante (bypass RLS seguro)
CREATE OR REPLACE FUNCTION public.create_meetup_plan(p_payload jsonb)
RETURNS public.planes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_plan public.planes;
    v_max int;
    v_min int;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;

    -- Límite de planes activos (si existe la función)
    IF to_regprocedure('public.count_user_active_plans(uuid)') IS NOT NULL THEN
        IF public.count_user_active_plans(v_uid) >= 5 THEN
            RAISE EXCEPTION 'active_plan_limit_reached' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    v_max := GREATEST(2, LEAST(25, COALESCE((p_payload->>'maximo_participantes')::int, 4)));
    v_min := GREATEST(2, LEAST(v_max, COALESCE((p_payload->>'minimo_participantes')::int, 2)));

    INSERT INTO public.planes (
        titulo,
        descripcion,
        categoria,
        tipo_deporte,
        creador_id,
        fecha_evento,
        maximo_participantes,
        minimo_participantes,
        imagen_url,
        nombre_ubicacion,
        latitud,
        longitud,
        requiere_aprobacion,
        solo_chicas,
        solo_amigos,
        modo_privado,
        is_direct_chat,
        is_group_chat
    ) VALUES (
        NULLIF(trim(COALESCE(p_payload->>'titulo', '')), ''),
        NULLIF(trim(COALESCE(p_payload->>'descripcion', '')), ''),
        NULLIF(trim(COALESCE(p_payload->>'categoria', '')), ''),
        NULLIF(trim(COALESCE(p_payload->>'tipo_deporte', '')), ''),
        v_uid,
        NULLIF(p_payload->>'fecha_evento', '')::timestamptz,
        v_max,
        v_min,
        NULLIF(trim(COALESCE(p_payload->>'imagen_url', '')), ''),
        NULLIF(trim(COALESCE(p_payload->>'nombre_ubicacion', '')), ''),
        NULLIF(p_payload->>'latitud', '')::float8,
        NULLIF(p_payload->>'longitud', '')::float8,
        COALESCE((p_payload->>'requiere_aprobacion')::boolean, false),
        COALESCE((p_payload->>'solo_chicas')::boolean, false),
        COALESCE((p_payload->>'solo_amigos')::boolean, false),
        COALESCE((p_payload->>'modo_privado')::boolean, false),
        false,
        false
    )
    RETURNING * INTO v_plan;

    INSERT INTO public.participantes (plan_id, usuario_id, estado)
    VALUES (v_plan.id, v_uid, 'aceptado')
    ON CONFLICT DO NOTHING;

    RETURN v_plan;
END;
$$;

REVOKE ALL ON FUNCTION public.create_meetup_plan(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_meetup_plan(jsonb) TO authenticated;

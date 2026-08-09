-- Owner ve todos los planes de meetup (bypass privado / solo amigos).
-- Ejecutar en Supabase SQL Editor si plan-access-enforce.sql ya estaba aplicado.

CREATE OR REPLACE FUNCTION public.user_can_view_plan(p_plan_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_plan public.planes%ROWTYPE;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN false;
    END IF;

    SELECT * INTO v_plan FROM public.planes WHERE id = p_plan_id;
    IF NOT FOUND THEN
        RETURN false;
    END IF;

    -- Chats directos / grupos: solo miembros (o creador)
    IF COALESCE(v_plan.is_direct_chat, false) OR COALESCE(v_plan.is_group_chat, false) THEN
        RETURN v_plan.creador_id = p_user_id
            OR EXISTS (
                SELECT 1 FROM public.participantes p
                WHERE p.plan_id = p_plan_id AND p.usuario_id = p_user_id
            );
    END IF;

    IF v_plan.creador_id = p_user_id THEN
        RETURN true;
    END IF;

    -- Owner: ve todos los planes de meetup para moderar
    IF EXISTS (
        SELECT 1 FROM public.perfiles pf
        WHERE pf.id = p_user_id
          AND pf.rol = 'owner'
          AND COALESCE(pf.baneado, false) = false
    ) THEN
        RETURN true;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.participantes p
        WHERE p.plan_id = p_plan_id AND p.usuario_id = p_user_id
    ) THEN
        RETURN true;
    END IF;

    IF public.user_has_plan_invite(p_plan_id, p_user_id) THEN
        RETURN true;
    END IF;

    IF COALESCE(v_plan.modo_privado, false) THEN
        RETURN false;
    END IF;

    IF COALESCE(v_plan.solo_amigos, false) THEN
        RETURN public.users_are_friends(v_plan.creador_id, p_user_id);
    END IF;

    RETURN true;
END;
$$;

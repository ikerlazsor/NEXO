-- ============================================================
-- Cupo del plan + reglas de acceso (solo chicas / amigos / privado)
-- Ejecutar ENTERO en Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.planes
    ADD COLUMN IF NOT EXISTS is_direct_chat boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS is_group_chat boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS solo_chicas boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS solo_amigos boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS modo_privado boolean NOT NULL DEFAULT false;

-- Amistad aceptada entre dos usuarios
CREATE OR REPLACE FUNCTION public.users_are_friends(a uuid, b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.amistades am
        WHERE am.estado = 'aceptado'
          AND (
              (am.usuario_origen_id = a AND am.usuario_destino_id = b)
              OR (am.usuario_origen_id = b AND am.usuario_destino_id = a)
          )
    );
$$;

-- Invitación pendiente (soporta invitaciones_planes y plan_invitaciones)
CREATE OR REPLACE FUNCTION public.user_has_plan_invite(p_plan_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF to_regclass('public.invitaciones_planes') IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.invitaciones_planes inv
            WHERE inv.plan_id = p_plan_id
              AND inv.invitado_id = p_user_id
              AND inv.estado = 'pendiente'
        ) THEN
            RETURN true;
        END IF;
    END IF;

    IF to_regclass('public.plan_invitaciones') IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.plan_invitaciones inv
            WHERE inv.plan_id = p_plan_id
              AND inv.invitado_id = p_user_id
              AND inv.estado = 'pendiente'
        ) THEN
            RETURN true;
        END IF;
    END IF;

    RETURN false;
END;
$$;

-- ¿Puede ver el plan? (feed / detalle / deep link)
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

    -- Owner: ve todos los planes de meetup (feed / detalle) para moderar
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

GRANT EXECUTE ON FUNCTION public.users_are_friends(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_plan_invite(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_view_plan(uuid, uuid) TO authenticated;

-- SELECT de planes: ya no es público total
DROP POLICY IF EXISTS "planes_select" ON public.planes;
CREATE POLICY "planes_select" ON public.planes
    FOR SELECT TO authenticated
    USING (public.user_can_view_plan(id, auth.uid()));

-- Insert/update/delete propios (no tocar al reaplicar este script)
DROP POLICY IF EXISTS "planes_insert_own" ON public.planes;
CREATE POLICY "planes_insert_own" ON public.planes
    FOR INSERT TO authenticated
    WITH CHECK (creador_id = auth.uid());

DROP POLICY IF EXISTS "planes_update_own" ON public.planes;
DROP POLICY IF EXISTS "planes_update_owner" ON public.planes;
CREATE POLICY "planes_update_own" ON public.planes
    FOR UPDATE TO authenticated
    USING (creador_id = auth.uid())
    WITH CHECK (creador_id = auth.uid());

DROP POLICY IF EXISTS "planes_delete_own" ON public.planes;
DROP POLICY IF EXISTS "planes_delete_owner" ON public.planes;
CREATE POLICY "planes_delete_own" ON public.planes
    FOR DELETE TO authenticated
    USING (creador_id = auth.uid());

-- Cupo + solo chicas + amigos/privado al pasar a participante
CREATE OR REPLACE FUNCTION public.enforce_plan_join_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_plan public.planes%ROWTYPE;
    v_genero text;
    v_accepted int;
    v_max int;
    v_is_creator boolean;
    v_solo_chicas boolean;
BEGIN
    SELECT * INTO v_plan FROM public.planes WHERE id = NEW.plan_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'plan_not_found' USING ERRCODE = 'P0001';
    END IF;

    v_is_creator := v_plan.creador_id IS NOT DISTINCT FROM NEW.usuario_id;

    -- Solo chicas (flag o categoría legacy)
    v_solo_chicas := COALESCE(v_plan.solo_chicas, false)
        OR COALESCE(v_plan.categoria, '') = 'Solo chicas';

    IF v_solo_chicas AND NOT v_is_creator THEN
        SELECT genero INTO v_genero FROM public.perfiles WHERE id = NEW.usuario_id;
        IF v_genero IS DISTINCT FROM 'femenino' THEN
            RAISE EXCEPTION 'solo_chicas_only'
                USING ERRCODE = 'P0001',
                      DETAIL = 'only female users can join this plan';
        END IF;
    END IF;

    -- Privado: hace falta invitación (salvo creador). En INSERT; si ya eres participante (UPDATE) no aplica.
    IF COALESCE(v_plan.modo_privado, false) AND NOT v_is_creator AND TG_OP = 'INSERT' THEN
        IF NOT public.user_has_plan_invite(NEW.plan_id, NEW.usuario_id) THEN
            RAISE EXCEPTION 'plan_private_invite_required'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- Solo amigos (si no es privado): amigo o invitado
    IF COALESCE(v_plan.solo_amigos, false)
       AND NOT COALESCE(v_plan.modo_privado, false)
       AND NOT v_is_creator
       AND TG_OP = 'INSERT' THEN
        IF NOT public.users_are_friends(v_plan.creador_id, NEW.usuario_id)
           AND NOT public.user_has_plan_invite(NEW.plan_id, NEW.usuario_id) THEN
            RAISE EXCEPTION 'friends_only_plan'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- Cupo al pasar a aceptado
    IF NEW.estado IS NOT DISTINCT FROM 'aceptado' THEN
        IF TG_OP = 'UPDATE' AND OLD.estado IS NOT DISTINCT FROM 'aceptado' THEN
            RETURN NEW;
        END IF;

        v_max := v_plan.maximo_participantes;
        IF v_max IS NOT NULL THEN
            SELECT COUNT(*)::int INTO v_accepted
            FROM public.participantes
            WHERE plan_id = NEW.plan_id
              AND estado = 'aceptado'
              AND (TG_OP = 'INSERT' OR id IS DISTINCT FROM NEW.id);

            IF v_accepted >= v_max THEN
                RAISE EXCEPTION 'plan_full'
                    USING ERRCODE = 'P0001',
                          DETAIL = format('plan %s is full (%s/%s)', NEW.plan_id, v_accepted, v_max);
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_plan_join_rules ON public.participantes;
CREATE TRIGGER trg_enforce_plan_join_rules
    BEFORE INSERT OR UPDATE OF estado ON public.participantes
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_plan_join_rules();

-- ============================================================
-- Límite de planes activos (máx. 3) al promover lista de espera
-- y al pasar a estado 'aceptado'.
-- Ejecutar ENTERO en Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.participantes
    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.participantes
    ADD COLUMN IF NOT EXISTS creado_en timestamptz;

UPDATE public.participantes
SET creado_en = COALESCE(creado_en, created_at, now())
WHERE creado_en IS NULL;

UPDATE public.participantes
SET created_at = COALESCE(created_at, creado_en, now())
WHERE created_at IS NULL;

-- Cuenta planes activos: creados futuros/sin fecha + unidos aceptados
-- (excluyendo los que ya cuentan como creador y los chats de grupo/directo).
CREATE OR REPLACE FUNCTION public.count_user_active_plans(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        (
            SELECT COUNT(*)::int
            FROM public.planes
            WHERE creador_id = p_user_id
              AND COALESCE(is_group_chat, false) = false
              AND COALESCE(is_direct_chat, false) = false
              AND COALESCE(categoria, '') NOT IN ('Grupo', 'Chat')
              AND (fecha_evento IS NULL OR fecha_evento >= now())
        )
        +
        (
            SELECT COUNT(*)::int
            FROM public.participantes p
            JOIN public.planes pl ON pl.id = p.plan_id
            WHERE p.usuario_id = p_user_id
              AND p.estado = 'aceptado'
              AND pl.creador_id IS DISTINCT FROM p_user_id
              AND COALESCE(pl.is_group_chat, false) = false
              AND COALESCE(pl.is_direct_chat, false) = false
              AND COALESCE(pl.categoria, '') NOT IN ('Grupo', 'Chat')
              AND (pl.fecha_evento IS NULL OR pl.fecha_evento >= now())
        );
$$;

GRANT EXECUTE ON FUNCTION public.count_user_active_plans(uuid) TO authenticated;

-- Impide superar 5 planes activos al insertar/actualizar a 'aceptado'
-- (el creador del plan sí puede estar como aceptado en su propio plan).
CREATE OR REPLACE FUNCTION public.enforce_active_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_max int := 5;
    v_is_creator boolean;
    v_is_chat boolean;
    v_count int;
BEGIN
    IF NEW.estado IS DISTINCT FROM 'aceptado' THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.estado IS NOT DISTINCT FROM 'aceptado' THEN
        RETURN NEW;
    END IF;

    SELECT
        (pl.creador_id = NEW.usuario_id),
        (
            COALESCE(pl.is_group_chat, false)
            OR COALESCE(pl.is_direct_chat, false)
            OR COALESCE(pl.categoria, '') IN ('Grupo', 'Chat')
        )
    INTO v_is_creator, v_is_chat
    FROM public.planes pl
    WHERE pl.id = NEW.plan_id;

    IF COALESCE(v_is_creator, false) OR COALESCE(v_is_chat, false) THEN
        RETURN NEW;
    END IF;

    v_count := public.count_user_active_plans(NEW.usuario_id);
    IF v_count >= v_max THEN
        RAISE EXCEPTION 'active_plan_limit_reached'
            USING ERRCODE = 'P0001',
                  DETAIL = format('user %s already has %s active plans', NEW.usuario_id, v_count);
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_active_plan_limit ON public.participantes;
CREATE TRIGGER trg_enforce_active_plan_limit
    BEFORE INSERT OR UPDATE OF estado ON public.participantes
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_active_plan_limit();

-- Promueve al primero en espera con hueco en el plan Y sin superar el límite personal.
-- Si el primero está al máximo de planes, prueba el siguiente (sigue en espera).
CREATE OR REPLACE FUNCTION public.promote_waitlist(p_plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_max_spots int;
    v_count int;
    v_next_id uuid;
    v_next_user uuid;
    v_tried uuid[] := ARRAY[]::uuid[];
    v_user_active int;
    v_max_active int := 5;
BEGIN
    SELECT maximo_participantes INTO v_max_spots FROM public.planes WHERE id = p_plan_id;
    IF v_max_spots IS NULL THEN
        RETURN;
    END IF;

    SELECT COUNT(*)::int INTO v_count
    FROM public.participantes
    WHERE plan_id = p_plan_id AND estado = 'aceptado';

    IF v_count >= v_max_spots THEN
        RETURN;
    END IF;

    LOOP
        SELECT p.id, p.usuario_id
        INTO v_next_id, v_next_user
        FROM public.participantes p
        WHERE p.plan_id = p_plan_id
          AND p.estado = 'lista_espera'
          AND NOT (p.id = ANY (v_tried))
        ORDER BY COALESCE(p.creado_en, p.created_at) ASC NULLS LAST
        LIMIT 1;

        EXIT WHEN v_next_id IS NULL;

        v_user_active := public.count_user_active_plans(v_next_user);
        IF v_user_active >= v_max_active THEN
            v_tried := array_append(v_tried, v_next_id);
            CONTINUE;
        END IF;

        UPDATE public.participantes
        SET estado = 'aceptado'
        WHERE id = v_next_id;

        EXIT;
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.promote_waitlist(uuid) TO authenticated;

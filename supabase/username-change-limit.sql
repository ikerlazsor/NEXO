-- ============================================================
-- @username: hasta 2 cambios cada 7 días
-- El primer @ al registrarse NO cuenta como cambio.
-- Ejecutar entero en Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.perfiles
    ADD COLUMN IF NOT EXISTS nombre_usuario_cambiado_en timestamptz;

ALTER TABLE public.perfiles
    ADD COLUMN IF NOT EXISTS nombre_usuario_cambios timestamptz[] DEFAULT '{}'::timestamptz[];

-- Si había cooldown antiguo (1 cambio), migrar a 1 entrada en la ventana
UPDATE public.perfiles
SET nombre_usuario_cambios = ARRAY[nombre_usuario_cambiado_en]
WHERE nombre_usuario_cambiado_en IS NOT NULL
  AND nombre_usuario_cambiado_en > now() - interval '7 days'
  AND coalesce(cardinality(nombre_usuario_cambios), 0) = 0;

UPDATE public.perfiles
SET nombre_usuario_cambiado_en = NULL
WHERE nombre_usuario_cambiado_en IS NOT NULL
  AND nombre_usuario_cambiado_en <= now() - interval '7 days'
  AND coalesce(cardinality(nombre_usuario_cambios), 0) = 0;

CREATE OR REPLACE FUNCTION public.change_username(new_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    uid uuid := auth.uid();
    normalized text;
    current_handle text;
    cambios timestamptz[];
    recent timestamptz[];
    next_allowed timestamptz;
    days_left numeric;
BEGIN
    IF uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated';
    END IF;

    normalized := lower(btrim(new_name));
    normalized := translate(
        normalized,
        'áàäâãåéèëêíìïîóòöôõúùüûñç',
        'aaaaaaeeeeiiiiooooouuuunc'
    );
    normalized := regexp_replace(normalized, '[^a-z0-9._]', '', 'g');
    normalized := regexp_replace(normalized, '\.{2,}', '.', 'g');
    normalized := trim(both '.' from normalized);

    IF length(normalized) < 3 OR length(normalized) > 20 THEN
        RAISE EXCEPTION 'invalid_username';
    END IF;
    IF normalized !~ '^[a-z0-9._]+$' THEN
        RAISE EXCEPTION 'invalid_username';
    END IF;

    SELECT
        nombre_usuario,
        coalesce(nombre_usuario_cambios, '{}'::timestamptz[])
    INTO current_handle, cambios
    FROM public.perfiles
    WHERE id = uid
    FOR UPDATE;

    IF current_handle IS NOT NULL AND lower(btrim(current_handle)) = normalized THEN
        RETURN jsonb_build_object('ok', true, 'unchanged', true);
    END IF;

    -- Solo timestamps de la ventana de 7 días
    SELECT coalesce(array_agg(t ORDER BY t), '{}'::timestamptz[])
    INTO recent
    FROM unnest(cambios) AS t
    WHERE t > now() - interval '7 days';

    IF coalesce(cardinality(recent), 0) >= 2 THEN
        next_allowed := recent[1] + interval '7 days';
        days_left := ceil(EXTRACT(EPOCH FROM (next_allowed - now())) / 86400.0);
        RAISE EXCEPTION 'username_cooldown:%', greatest(1, days_left::int);
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.perfiles
        WHERE lower(nombre_usuario) = normalized
          AND id <> uid
    ) THEN
        RAISE EXCEPTION 'username_taken';
    END IF;

    PERFORM set_config('app.username_change_ok', '1', true);

    -- Primer handle (registro / onboarding): no cuenta como cambio
    IF current_handle IS NULL OR btrim(current_handle) = '' THEN
        UPDATE public.perfiles
        SET nombre_usuario = normalized
        WHERE id = uid;
        RETURN jsonb_build_object('ok', true, 'nombre_usuario', normalized, 'initial', true);
    END IF;

    recent := recent || ARRAY[now()];

    UPDATE public.perfiles
    SET
        nombre_usuario = normalized,
        nombre_usuario_cambios = recent,
        nombre_usuario_cambiado_en = now()
    WHERE id = uid;

    RETURN jsonb_build_object(
        'ok', true,
        'nombre_usuario', normalized,
        'changes_in_window', cardinality(recent)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.change_username(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.change_username(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.protect_username_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    recent timestamptz[];
    next_allowed timestamptz;
    days_left numeric;
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.nombre_usuario IS DISTINCT FROM OLD.nombre_usuario
    THEN
        -- Primer @ (registro): no registrar cooldown
        IF OLD.nombre_usuario IS NULL OR btrim(OLD.nombre_usuario) = '' THEN
            NEW.nombre_usuario_cambiado_en := OLD.nombre_usuario_cambiado_en;
            NEW.nombre_usuario_cambios := coalesce(OLD.nombre_usuario_cambios, '{}'::timestamptz[]);
            RETURN NEW;
        END IF;

        SELECT coalesce(array_agg(t ORDER BY t), '{}'::timestamptz[])
        INTO recent
        FROM unnest(coalesce(OLD.nombre_usuario_cambios, '{}'::timestamptz[])) AS t
        WHERE t > now() - interval '7 days';

        IF coalesce(cardinality(recent), 0) >= 2
           AND current_setting('app.username_change_ok', true) IS DISTINCT FROM '1'
        THEN
            next_allowed := recent[1] + interval '7 days';
            days_left := ceil(EXTRACT(EPOCH FROM (next_allowed - now())) / 86400.0);
            RAISE EXCEPTION 'username_cooldown:%', greatest(1, days_left::int);
        END IF;

        -- Si viene por RPC ya actualiza el array; si no, registrar aquí
        IF current_setting('app.username_change_ok', true) IS DISTINCT FROM '1' THEN
            NEW.nombre_usuario_cambios := recent || ARRAY[now()];
            NEW.nombre_usuario_cambiado_en := now();
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_username_change ON public.perfiles;
CREATE TRIGGER trg_protect_username_change
    BEFORE UPDATE OF nombre_usuario ON public.perfiles
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_username_change();

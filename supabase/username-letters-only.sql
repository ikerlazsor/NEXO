-- Letras, números, . y _ en @usuario (sin tildes ni otros símbolos).
-- Ejecutar en Supabase SQL Editor si ya tenías change_username antiguo.

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
    last_changed timestamptz;
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

    SELECT nombre_usuario, nombre_usuario_cambiado_en
    INTO current_handle, last_changed
    FROM public.perfiles
    WHERE id = uid
    FOR UPDATE;

    IF current_handle IS NOT NULL AND lower(btrim(current_handle)) = normalized THEN
        RETURN jsonb_build_object('ok', true, 'unchanged', true);
    END IF;

    IF last_changed IS NOT NULL AND last_changed > now() - interval '7 days' THEN
        next_allowed := last_changed + interval '7 days';
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

    UPDATE public.perfiles
    SET
        nombre_usuario = normalized,
        nombre_usuario_cambiado_en = now()
    WHERE id = uid;

    RETURN jsonb_build_object('ok', true, 'nombre_usuario', normalized);
END;
$$;

REVOKE ALL ON FUNCTION public.change_username(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.change_username(text) TO authenticated;

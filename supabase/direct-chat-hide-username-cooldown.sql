-- ============================================================
-- Ocultar chats directos + cooldown 7 días para @username
-- Ejecutar en Supabase SQL Editor.
-- ============================================================

-- ---------- Chats directos ocultos (borrar de mi lista) ----------
CREATE TABLE IF NOT EXISTS public.chats_directos_ocultos (
    usuario_id uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
    peer_id uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
    oculto_en timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (usuario_id, peer_id),
    CONSTRAINT chats_directos_ocultos_no_self CHECK (usuario_id <> peer_id)
);

CREATE INDEX IF NOT EXISTS idx_chats_directos_ocultos_usuario
    ON public.chats_directos_ocultos (usuario_id);

ALTER TABLE public.chats_directos_ocultos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chats_ocultos_select_own" ON public.chats_directos_ocultos;
CREATE POLICY "chats_ocultos_select_own" ON public.chats_directos_ocultos
    FOR SELECT TO authenticated
    USING (usuario_id = auth.uid());

DROP POLICY IF EXISTS "chats_ocultos_insert_own" ON public.chats_directos_ocultos;
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'not_banned'
    ) THEN
        EXECUTE $pol$
            CREATE POLICY "chats_ocultos_insert_own" ON public.chats_directos_ocultos
                FOR INSERT TO authenticated
                WITH CHECK (usuario_id = auth.uid() AND public.not_banned())
        $pol$;
    ELSE
        EXECUTE $pol$
            CREATE POLICY "chats_ocultos_insert_own" ON public.chats_directos_ocultos
                FOR INSERT TO authenticated
                WITH CHECK (usuario_id = auth.uid())
        $pol$;
    END IF;
END $$;

DROP POLICY IF EXISTS "chats_ocultos_update_own" ON public.chats_directos_ocultos;
CREATE POLICY "chats_ocultos_update_own" ON public.chats_directos_ocultos
    FOR UPDATE TO authenticated
    USING (usuario_id = auth.uid())
    WITH CHECK (usuario_id = auth.uid());

DROP POLICY IF EXISTS "chats_ocultos_delete_own" ON public.chats_directos_ocultos;
CREATE POLICY "chats_ocultos_delete_own" ON public.chats_directos_ocultos
    FOR DELETE TO authenticated
    USING (usuario_id = auth.uid());

-- Si not_banned no existe aún (migración owner no aplicada), fallback sin ella
-- (ya cubierto arriba)

-- ---------- Cooldown @username (1 cambio / 7 días) ----------
ALTER TABLE public.perfiles
    ADD COLUMN IF NOT EXISTS nombre_usuario_cambiado_en timestamptz;

-- Rellenar: NO marcar cooldown en handles existentes (null = nunca cambiado desde la app)
-- Si ya se ejecutó un backfill con now(), resetear:
UPDATE public.perfiles
SET nombre_usuario_cambiado_en = NULL
WHERE nombre_usuario_cambiado_en IS NOT NULL;

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
    -- Quitar tildes comunes; permitir a-z, 0-9, . y _
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

-- Impide saltarse el cooldown con update directo del cliente
CREATE OR REPLACE FUNCTION public.protect_username_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.nombre_usuario IS DISTINCT FROM OLD.nombre_usuario
    THEN
        IF OLD.nombre_usuario IS NOT NULL
           AND btrim(OLD.nombre_usuario) <> ''
           AND OLD.nombre_usuario_cambiado_en IS NOT NULL
           AND OLD.nombre_usuario_cambiado_en > now() - interval '7 days'
           AND current_setting('app.username_change_ok', true) IS DISTINCT FROM '1'
        THEN
            RAISE EXCEPTION 'username_cooldown';
        END IF;
        NEW.nombre_usuario_cambiado_en := now();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_username_change ON public.perfiles;
CREATE TRIGGER trg_protect_username_change
    BEFORE UPDATE OF nombre_usuario ON public.perfiles
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_username_change();

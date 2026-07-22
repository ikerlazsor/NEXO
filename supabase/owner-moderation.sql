-- ============================================================
-- Moderación Nexo: roles, ban, tickets de soporte, inbox staff
-- Ejecutar ENTERO en Supabase SQL Editor.
--
-- Después, asigna tu cuenta (solo una vez):
--   UPDATE public.perfiles SET rol = 'owner' WHERE id = 'TU-UUID';
-- ============================================================

-- ---------- Columnas en perfiles ----------
ALTER TABLE public.perfiles
    ADD COLUMN IF NOT EXISTS rol text NOT NULL DEFAULT 'user',
    ADD COLUMN IF NOT EXISTS baneado boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS baneado_en timestamptz,
    ADD COLUMN IF NOT EXISTS baneado_motivo text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'perfiles_rol_check'
          AND conrelid = 'public.perfiles'::regclass
    ) THEN
        ALTER TABLE public.perfiles
            ADD CONSTRAINT perfiles_rol_check
            CHECK (rol IN ('user', 'admin', 'owner'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_perfiles_rol ON public.perfiles (rol) WHERE rol IN ('admin', 'owner');
CREATE INDEX IF NOT EXISTS idx_perfiles_baneado ON public.perfiles (baneado) WHERE baneado = true;

-- ---------- Helpers ----------
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.perfiles p
        WHERE p.id = auth.uid()
          AND p.rol IN ('admin', 'owner')
          AND COALESCE(p.baneado, false) = false
    );
$$;

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.perfiles p
        WHERE p.id = auth.uid()
          AND p.rol = 'owner'
          AND COALESCE(p.baneado, false) = false
    );
$$;

CREATE OR REPLACE FUNCTION public.current_user_banned()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT p.baneado FROM public.perfiles p WHERE p.id = auth.uid()),
        false
    );
$$;

CREATE OR REPLACE FUNCTION public.not_banned()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT auth.uid() IS NOT NULL AND NOT public.current_user_banned();
$$;

REVOKE ALL ON FUNCTION public.is_staff() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_owner() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_banned() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.not_banned() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_banned() TO authenticated;
GRANT EXECUTE ON FUNCTION public.not_banned() TO authenticated;

-- Impide que un usuario se auto-desbanee o se auto-promueva desde la app.
-- Desde el SQL Editor (sin JWT) sí se puede asignar el primer owner.
CREATE OR REPLACE FUNCTION public.protect_perfiles_moderation_cols()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.rol IS DISTINCT FROM OLD.rol
           OR NEW.baneado IS DISTINCT FROM OLD.baneado
           OR NEW.baneado_en IS DISTINCT FROM OLD.baneado_en
           OR NEW.baneado_motivo IS DISTINCT FROM OLD.baneado_motivo
        THEN
            -- SQL Editor / service role: auth.uid() es NULL → permitir bootstrap
            IF auth.uid() IS NULL THEN
                RETURN NEW;
            END IF;

            -- Desde la app: solo un owner puede cambiar estos campos
            IF NOT public.is_owner() THEN
                NEW.rol := OLD.rol;
                NEW.baneado := OLD.baneado;
                NEW.baneado_en := OLD.baneado_en;
                NEW.baneado_motivo := OLD.baneado_motivo;
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_perfiles_moderation ON public.perfiles;
CREATE TRIGGER trg_protect_perfiles_moderation
    BEFORE UPDATE ON public.perfiles
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_perfiles_moderation_cols();

-- Bloquea escrituras de cuentas baneadas (seguridad real, no solo UI)
CREATE OR REPLACE FUNCTION public.reject_if_banned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF public.current_user_banned() THEN
        RAISE EXCEPTION 'account_banned'
            USING ERRCODE = 'P0001',
                  HINT = 'Esta cuenta está suspendida.';
    END IF;
    RETURN NEW;
END;
$$;

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'perfiles',
        'planes',
        'participantes',
        'amistades',
        'mensajes',
        'invitaciones_planes',
        'planes_guardados',
        'historial_planes',
        'valoraciones',
        'reportes_planes',
        'reportes_usuarios',
        'expulsiones_plan'
    ]
    LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = t
        ) THEN
            EXECUTE format('DROP TRIGGER IF EXISTS trg_reject_if_banned ON public.%I', t);
            EXECUTE format(
                'CREATE TRIGGER trg_reject_if_banned BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.reject_if_banned()',
                t
            );
        END IF;
    END LOOP;
END $$;

-- ---------- Tablas de reportes (por si aún no existen) ----------
CREATE TABLE IF NOT EXISTS public.reportes_planes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id uuid NOT NULL REFERENCES public.planes(id) ON DELETE CASCADE,
    reportador_id uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
    motivo text NOT NULL DEFAULT 'otro',
    mensaje text,
    creado_en timestamptz NOT NULL DEFAULT now(),
    UNIQUE (plan_id, reportador_id)
);

ALTER TABLE public.reportes_planes
    ADD COLUMN IF NOT EXISTS mensaje text;

ALTER TABLE public.reportes_planes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reportes_select_own" ON public.reportes_planes;
CREATE POLICY "reportes_select_own" ON public.reportes_planes
    FOR SELECT TO authenticated
    USING (reportador_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.reportes_usuarios (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    denunciado_id uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
    reportador_id uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
    motivo text NOT NULL DEFAULT 'otro',
    mensaje text,
    creado_en timestamptz NOT NULL DEFAULT now(),
    UNIQUE (denunciado_id, reportador_id)
);

ALTER TABLE public.reportes_usuarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reportes_usuarios_select_own" ON public.reportes_usuarios;
CREATE POLICY "reportes_usuarios_select_own" ON public.reportes_usuarios
    FOR SELECT TO authenticated
    USING (reportador_id = auth.uid());

-- Triggers anti-ban en reportes (si las tablas se acaban de crear)
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['reportes_planes', 'reportes_usuarios']
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_reject_if_banned ON public.%I', t);
        EXECUTE format(
            'CREATE TRIGGER trg_reject_if_banned BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.reject_if_banned()',
            t
        );
    END LOOP;
END $$;

-- ---------- Estado en reportes ----------
ALTER TABLE public.reportes_planes
    ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'abierto',
    ADD COLUMN IF NOT EXISTS notas_internas text,
    ADD COLUMN IF NOT EXISTS revisado_en timestamptz,
    ADD COLUMN IF NOT EXISTS revisado_por uuid REFERENCES public.perfiles(id) ON DELETE SET NULL;

ALTER TABLE public.reportes_usuarios
    ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'abierto',
    ADD COLUMN IF NOT EXISTS notas_internas text,
    ADD COLUMN IF NOT EXISTS revisado_en timestamptz,
    ADD COLUMN IF NOT EXISTS revisado_por uuid REFERENCES public.perfiles(id) ON DELETE SET NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'reportes_planes_estado_check'
          AND conrelid = 'public.reportes_planes'::regclass
    ) THEN
        ALTER TABLE public.reportes_planes
            ADD CONSTRAINT reportes_planes_estado_check
            CHECK (estado IN ('abierto', 'en_revision', 'resuelto', 'descartado'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'reportes_usuarios_estado_check'
          AND conrelid = 'public.reportes_usuarios'::regclass
    ) THEN
        ALTER TABLE public.reportes_usuarios
            ADD CONSTRAINT reportes_usuarios_estado_check
            CHECK (estado IN ('abierto', 'en_revision', 'resuelto', 'descartado'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reportes_planes_estado ON public.reportes_planes (estado, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_reportes_usuarios_estado ON public.reportes_usuarios (estado, creado_en DESC);

-- Staff puede leer/actualizar reportes
DROP POLICY IF EXISTS "reportes_select_staff" ON public.reportes_planes;
CREATE POLICY "reportes_select_staff" ON public.reportes_planes
    FOR SELECT TO authenticated
    USING (public.is_staff());

DROP POLICY IF EXISTS "reportes_update_staff" ON public.reportes_planes;
CREATE POLICY "reportes_update_staff" ON public.reportes_planes
    FOR UPDATE TO authenticated
    USING (public.is_staff())
    WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "reportes_usuarios_select_staff" ON public.reportes_usuarios;
CREATE POLICY "reportes_usuarios_select_staff" ON public.reportes_usuarios
    FOR SELECT TO authenticated
    USING (public.is_staff());

DROP POLICY IF EXISTS "reportes_usuarios_update_staff" ON public.reportes_usuarios;
CREATE POLICY "reportes_usuarios_update_staff" ON public.reportes_usuarios
    FOR UPDATE TO authenticated
    USING (public.is_staff())
    WITH CHECK (public.is_staff());

-- Inserts de reportes solo si no estás baneado
DROP POLICY IF EXISTS "reportes_insert_own" ON public.reportes_planes;
CREATE POLICY "reportes_insert_own" ON public.reportes_planes
    FOR INSERT TO authenticated
    WITH CHECK (reportador_id = auth.uid() AND public.not_banned());

DROP POLICY IF EXISTS "reportes_usuarios_insert_own" ON public.reportes_usuarios;
CREATE POLICY "reportes_usuarios_insert_own" ON public.reportes_usuarios
    FOR INSERT TO authenticated
    WITH CHECK (reportador_id = auth.uid() AND public.not_banned());

-- ---------- Tickets soporte / contacto / ideas ----------
CREATE TABLE IF NOT EXISTS public.mensajes_soporte (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
    tipo text NOT NULL,
    asunto text,
    mensaje text NOT NULL,
    estado text NOT NULL DEFAULT 'abierto',
    notas_internas text,
    creado_en timestamptz NOT NULL DEFAULT now(),
    actualizado_en timestamptz NOT NULL DEFAULT now(),
    revisado_en timestamptz,
    revisado_por uuid REFERENCES public.perfiles(id) ON DELETE SET NULL,
    CONSTRAINT mensajes_soporte_tipo_check
        CHECK (tipo IN ('contacto', 'problema', 'idea', 'denuncia_general')),
    CONSTRAINT mensajes_soporte_estado_check
        CHECK (estado IN ('abierto', 'en_revision', 'resuelto', 'descartado'))
);

CREATE INDEX IF NOT EXISTS idx_mensajes_soporte_estado
    ON public.mensajes_soporte (estado, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_mensajes_soporte_usuario
    ON public.mensajes_soporte (usuario_id, creado_en DESC);

ALTER TABLE public.mensajes_soporte ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mensajes_soporte_insert_own" ON public.mensajes_soporte;
CREATE POLICY "mensajes_soporte_insert_own" ON public.mensajes_soporte
    FOR INSERT TO authenticated
    WITH CHECK (usuario_id = auth.uid() AND public.not_banned());

DROP POLICY IF EXISTS "mensajes_soporte_select_own" ON public.mensajes_soporte;
CREATE POLICY "mensajes_soporte_select_own" ON public.mensajes_soporte
    FOR SELECT TO authenticated
    USING (usuario_id = auth.uid() OR public.is_staff());

DROP POLICY IF EXISTS "mensajes_soporte_update_staff" ON public.mensajes_soporte;
CREATE POLICY "mensajes_soporte_update_staff" ON public.mensajes_soporte
    FOR UPDATE TO authenticated
    USING (public.is_staff())
    WITH CHECK (public.is_staff());

DROP TRIGGER IF EXISTS trg_reject_if_banned ON public.mensajes_soporte;
CREATE TRIGGER trg_reject_if_banned
    BEFORE INSERT OR UPDATE ON public.mensajes_soporte
    FOR EACH ROW
    EXECUTE FUNCTION public.reject_if_banned();

-- Staff puede actualizar estado; usuarios no tocan notas/estado
CREATE OR REPLACE FUNCTION public.protect_mensajes_soporte_cols()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NOT public.is_staff() THEN
        NEW.estado := OLD.estado;
        NEW.notas_internas := OLD.notas_internas;
        NEW.revisado_en := OLD.revisado_en;
        NEW.revisado_por := OLD.revisado_por;
        NEW.usuario_id := OLD.usuario_id;
        NEW.tipo := OLD.tipo;
    END IF;
    NEW.actualizado_en := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_mensajes_soporte ON public.mensajes_soporte;
CREATE TRIGGER trg_protect_mensajes_soporte
    BEFORE UPDATE ON public.mensajes_soporte
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_mensajes_soporte_cols();

-- ---------- RPCs de moderación (solo owner) ----------
CREATE OR REPLACE FUNCTION public.admin_ban_user(
    target_id uuid,
    motivo text DEFAULT NULL,
    banned boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    target_rol text;
BEGIN
    IF NOT public.is_owner() THEN
        RAISE EXCEPTION 'not_authorized';
    END IF;
    IF target_id IS NULL OR target_id = auth.uid() THEN
        RAISE EXCEPTION 'invalid_target';
    END IF;

    SELECT rol INTO target_rol FROM public.perfiles WHERE id = target_id;
    IF target_rol IS NULL THEN
        RAISE EXCEPTION 'user_not_found';
    END IF;
    IF target_rol IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'cannot_moderate_staff';
    END IF;

    UPDATE public.perfiles
    SET
        baneado = banned,
        baneado_en = CASE WHEN banned THEN now() ELSE NULL END,
        baneado_motivo = CASE WHEN banned THEN NULLIF(trim(motivo), '') ELSE NULL END
    WHERE id = target_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_user(target_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    target_rol text;
    plan_row record;
    has_col boolean;
    has_table boolean;
BEGIN
    IF NOT public.is_owner() THEN
        RAISE EXCEPTION 'not_authorized';
    END IF;
    IF target_id IS NULL OR target_id = auth.uid() THEN
        RAISE EXCEPTION 'invalid_target';
    END IF;

    SELECT rol INTO target_rol FROM public.perfiles WHERE id = target_id;
    IF target_rol IS NULL THEN
        RAISE EXCEPTION 'user_not_found';
    END IF;
    IF target_rol IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'cannot_moderate_staff';
    END IF;

    DELETE FROM public.participantes WHERE usuario_id = target_id;

    FOR plan_row IN SELECT id FROM public.planes WHERE creador_id = target_id LOOP
        DELETE FROM public.mensajes WHERE plan_id = plan_row.id;

        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'invitaciones_planes'
        ) THEN
            DELETE FROM public.invitaciones_planes WHERE plan_id = plan_row.id;
        END IF;

        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'reportes_planes'
        ) THEN
            DELETE FROM public.reportes_planes WHERE plan_id = plan_row.id;
        END IF;

        DELETE FROM public.participantes WHERE plan_id = plan_row.id;
        DELETE FROM public.planes_guardados WHERE plan_id = plan_row.id;
        DELETE FROM public.historial_planes WHERE plan_id = plan_row.id;
        DELETE FROM public.valoraciones WHERE plan_id = plan_row.id;
        DELETE FROM public.planes WHERE id = plan_row.id;
    END LOOP;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'amistades' AND column_name = 'usuario_origen_id'
    ) INTO has_col;
    IF has_col THEN
        DELETE FROM public.amistades
        WHERE usuario_origen_id = target_id OR usuario_destino_id = target_id;
    ELSE
        DELETE FROM public.amistades
        WHERE usuario_id = target_id OR amigo_id = target_id;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'bloqueos' AND column_name = 'usuario_origen_id'
    ) INTO has_col;
    IF has_col THEN
        DELETE FROM public.bloqueos
        WHERE usuario_origen_id = target_id OR usuario_destino_id = target_id;
    ELSE
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'bloqueos' AND column_name = 'bloqueador_id'
        ) INTO has_col;
        IF has_col THEN
            DELETE FROM public.bloqueos
            WHERE bloqueador_id = target_id OR bloqueado_id = target_id;
        END IF;
    END IF;

    DELETE FROM public.planes_guardados WHERE usuario_id = target_id;
    DELETE FROM public.historial_planes WHERE usuario_id = target_id;
    DELETE FROM public.valoraciones WHERE evaluador_id = target_id OR evaluado_id = target_id;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'invitaciones_planes'
    ) THEN
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'invitaciones_planes'
              AND column_name = 'invitador_id'
        ) INTO has_col;
        IF has_col THEN
            DELETE FROM public.invitaciones_planes
            WHERE invitador_id = target_id OR invitado_id = target_id;
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'reportes_planes'
    ) THEN
        DELETE FROM public.reportes_planes WHERE reportador_id = target_id;
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'reportes_usuarios'
    ) THEN
        DELETE FROM public.reportes_usuarios
        WHERE reportador_id = target_id OR denunciado_id = target_id;
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'mensajes_soporte'
    ) THEN
        DELETE FROM public.mensajes_soporte WHERE usuario_id = target_id;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'mensajes' AND column_name = 'emisor_id'
    ) INTO has_col;
    IF has_col THEN
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'mensajes' AND column_name = 'receptor_id'
        ) INTO has_table;
        IF has_table THEN
            DELETE FROM public.mensajes
            WHERE emisor_id = target_id OR receptor_id = target_id;
        ELSE
            DELETE FROM public.mensajes WHERE emisor_id = target_id;
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'estadisticas_usuario'
    ) THEN
        DELETE FROM public.estadisticas_usuario WHERE usuario_id = target_id;
    END IF;

    DELETE FROM public.perfiles WHERE id = target_id;
    DELETE FROM auth.users WHERE id = target_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_plan(target_plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_owner() THEN
        RAISE EXCEPTION 'not_authorized';
    END IF;
    IF target_plan_id IS NULL THEN
        RAISE EXCEPTION 'invalid_target';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.planes WHERE id = target_plan_id) THEN
        RAISE EXCEPTION 'plan_not_found';
    END IF;

    DELETE FROM public.mensajes WHERE plan_id = target_plan_id;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'invitaciones_planes'
    ) THEN
        DELETE FROM public.invitaciones_planes WHERE plan_id = target_plan_id;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'reportes_planes'
    ) THEN
        DELETE FROM public.reportes_planes WHERE plan_id = target_plan_id;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'expulsiones_plan'
    ) THEN
        DELETE FROM public.expulsiones_plan WHERE plan_id = target_plan_id;
    END IF;

    DELETE FROM public.participantes WHERE plan_id = target_plan_id;
    DELETE FROM public.planes_guardados WHERE plan_id = target_plan_id;
    DELETE FROM public.historial_planes WHERE plan_id = target_plan_id;
    DELETE FROM public.valoraciones WHERE plan_id = target_plan_id;
    DELETE FROM public.planes WHERE id = target_plan_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_ticket_estado(
    ticket_id uuid,
    nuevo_estado text,
    notas text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_staff() THEN
        RAISE EXCEPTION 'not_authorized';
    END IF;
    IF nuevo_estado NOT IN ('abierto', 'en_revision', 'resuelto', 'descartado') THEN
        RAISE EXCEPTION 'invalid_estado';
    END IF;

    UPDATE public.mensajes_soporte
    SET
        estado = nuevo_estado,
        notas_internas = COALESCE(NULLIF(trim(notas), ''), notas_internas),
        revisado_en = now(),
        revisado_por = auth.uid(),
        actualizado_en = now()
    WHERE id = ticket_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ticket_not_found';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_report_estado(
    report_kind text,
    report_id uuid,
    nuevo_estado text,
    notas text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_staff() THEN
        RAISE EXCEPTION 'not_authorized';
    END IF;
    IF nuevo_estado NOT IN ('abierto', 'en_revision', 'resuelto', 'descartado') THEN
        RAISE EXCEPTION 'invalid_estado';
    END IF;

    IF report_kind = 'plan' THEN
        UPDATE public.reportes_planes
        SET
            estado = nuevo_estado,
            notas_internas = COALESCE(NULLIF(trim(notas), ''), notas_internas),
            revisado_en = now(),
            revisado_por = auth.uid()
        WHERE id = report_id;
    ELSIF report_kind = 'user' THEN
        UPDATE public.reportes_usuarios
        SET
            estado = nuevo_estado,
            notas_internas = COALESCE(NULLIF(trim(notas), ''), notas_internas),
            revisado_en = now(),
            revisado_por = auth.uid()
        WHERE id = report_id;
    ELSE
        RAISE EXCEPTION 'invalid_kind';
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'report_not_found';
    END IF;
END;
$$;

-- Contadores para badge del inbox
CREATE OR REPLACE FUNCTION public.admin_moderation_counts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    c_soporte int := 0;
    c_planes int := 0;
    c_users int := 0;
BEGIN
    IF NOT public.is_staff() THEN
        RAISE EXCEPTION 'not_authorized';
    END IF;

    SELECT count(*)::int INTO c_soporte
    FROM public.mensajes_soporte
    WHERE estado IN ('abierto', 'en_revision');

    SELECT count(*)::int INTO c_planes
    FROM public.reportes_planes
    WHERE estado IN ('abierto', 'en_revision');

    SELECT count(*)::int INTO c_users
    FROM public.reportes_usuarios
    WHERE estado IN ('abierto', 'en_revision');

    RETURN jsonb_build_object(
        'soporte', c_soporte,
        'reportes_planes', c_planes,
        'reportes_usuarios', c_users,
        'total', c_soporte + c_planes + c_users
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_ban_user(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_user(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_plan(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_ticket_estado(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_report_estado(text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_moderation_counts() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_ban_user(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_plan(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_ticket_estado(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_report_estado(text, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_moderation_counts() TO authenticated;

-- Lectura de ban/rol propia (y staff ve baneados)
-- La política select existente ya permite leer perfiles; no hace falta cambiarla.

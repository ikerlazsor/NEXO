-- ============================================================
-- Límites diarios anti-abuso
--   · Solicitudes de amistad enviadas: máx. 20 / día
--   · Denuncias de planes: máx. 2 / día
--   · Denuncias de usuarios: máx. 3 / día
--   · Bloqueos de personas: máx. 5 / día
-- Día = date_trunc('day', now() AT TIME ZONE 'Europe/Madrid')
-- Ejecutar ENTERO en Supabase SQL Editor.
-- ============================================================

CREATE OR REPLACE FUNCTION public.day_start_madrid()
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
    SELECT date_trunc('day', now() AT TIME ZONE 'Europe/Madrid')
        AT TIME ZONE 'Europe/Madrid';
$$;

-- ---------- Amistades: 20 envíos / día ----------
CREATE OR REPLACE FUNCTION public.enforce_friend_request_daily_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_start timestamptz := public.day_start_madrid();
    v_count integer;
    v_uid uuid;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.estado IS DISTINCT FROM 'pendiente' THEN
            RETURN NEW;
        END IF;
        v_uid := NEW.usuario_origen_id;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Solo cuenta reenviar (p.ej. rechazado → pendiente)
        IF NOT (
            NEW.estado = 'pendiente'
            AND OLD.estado IS DISTINCT FROM 'pendiente'
        ) THEN
            RETURN NEW;
        END IF;
        v_uid := NEW.usuario_origen_id;
        NEW.creado_en := now();
    ELSE
        RETURN NEW;
    END IF;

    -- En INSERT la fila nueva aún no existe; en UPDATE excluimos la propia
    SELECT COUNT(*)::integer INTO v_count
    FROM public.amistades
    WHERE usuario_origen_id = v_uid
      AND creado_en >= v_start
      AND (TG_OP = 'INSERT' OR id <> NEW.id);

    IF v_count >= 20 THEN
        RAISE EXCEPTION 'friend_request_daily_limit'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_friend_request_daily_limit ON public.amistades;
CREATE TRIGGER trg_friend_request_daily_limit
    BEFORE INSERT OR UPDATE OF estado ON public.amistades
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_friend_request_daily_limit();

CREATE INDEX IF NOT EXISTS idx_amistades_origen_creado
    ON public.amistades (usuario_origen_id, creado_en DESC);

-- ---------- Reportes de planes: 2 / día ----------
CREATE OR REPLACE FUNCTION public.enforce_plan_report_daily_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_start timestamptz := public.day_start_madrid();
    v_count integer;
BEGIN
    SELECT COUNT(*)::integer INTO v_count
    FROM public.reportes_planes
    WHERE reportador_id = NEW.reportador_id
      AND creado_en >= v_start;

    IF v_count >= 2 THEN
        RAISE EXCEPTION 'plan_report_daily_limit'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_plan_report_daily_limit ON public.reportes_planes;
CREATE TRIGGER trg_plan_report_daily_limit
    BEFORE INSERT ON public.reportes_planes
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_plan_report_daily_limit();

CREATE INDEX IF NOT EXISTS idx_reportes_planes_reportador_creado
    ON public.reportes_planes (reportador_id, creado_en DESC);

-- ---------- Reportes de usuarios: 3 / día ----------
CREATE OR REPLACE FUNCTION public.enforce_user_report_daily_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_start timestamptz := public.day_start_madrid();
    v_count integer;
BEGIN
    SELECT COUNT(*)::integer INTO v_count
    FROM public.reportes_usuarios
    WHERE reportador_id = NEW.reportador_id
      AND creado_en >= v_start;

    IF v_count >= 3 THEN
        RAISE EXCEPTION 'user_report_daily_limit'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_report_daily_limit ON public.reportes_usuarios;
CREATE TRIGGER trg_user_report_daily_limit
    BEFORE INSERT ON public.reportes_usuarios
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_user_report_daily_limit();

CREATE INDEX IF NOT EXISTS idx_reportes_usuarios_reportador_creado
    ON public.reportes_usuarios (reportador_id, creado_en DESC);

-- ---------- Bloqueos: 5 / día ----------
ALTER TABLE public.bloqueos
    ADD COLUMN IF NOT EXISTS creado_en timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.enforce_block_daily_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_start timestamptz := public.day_start_madrid();
    v_count integer;
    v_blocker uuid;
    v_use_origen boolean;
BEGIN
    v_use_origen := EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'bloqueos'
          AND column_name = 'usuario_origen_id'
    );

    IF v_use_origen THEN
        v_blocker := NEW.usuario_origen_id;
        SELECT COUNT(*)::integer INTO v_count
        FROM public.bloqueos
        WHERE usuario_origen_id = v_blocker
          AND creado_en >= v_start;
    ELSE
        v_blocker := NEW.bloqueador_id;
        SELECT COUNT(*)::integer INTO v_count
        FROM public.bloqueos
        WHERE bloqueador_id = v_blocker
          AND creado_en >= v_start;
    END IF;

    IF v_count >= 5 THEN
        RAISE EXCEPTION 'block_daily_limit'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_daily_limit ON public.bloqueos;
CREATE TRIGGER trg_block_daily_limit
    BEFORE INSERT ON public.bloqueos
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_block_daily_limit();

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'bloqueos' AND column_name = 'usuario_origen_id'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_bloqueos_origen_creado
            ON public.bloqueos (usuario_origen_id, creado_en DESC);
    ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'bloqueos' AND column_name = 'bloqueador_id'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_bloqueos_bloqueador_creado
            ON public.bloqueos (bloqueador_id, creado_en DESC);
    END IF;
END $$;

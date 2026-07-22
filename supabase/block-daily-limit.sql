-- Solo bloqueos: máx. 5 / día (si ya ejecutaste daily-action-limits.sql antes).
-- Si aún no lo has ejecutado, corre daily-action-limits.sql entero (ya incluye esto).

CREATE OR REPLACE FUNCTION public.day_start_madrid()
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
    SELECT date_trunc('day', now() AT TIME ZONE 'Europe/Madrid')
        AT TIME ZONE 'Europe/Madrid';
$$;

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

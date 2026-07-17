-- Asegura columna de fecha en historial_planes (creado_en o created_at)
ALTER TABLE public.historial_planes
    ADD COLUMN IF NOT EXISTS creado_en timestamptz;

DO $$
BEGIN
    -- Si solo existe created_at, copiar a creado_en
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'historial_planes' AND column_name = 'created_at'
    ) THEN
        UPDATE public.historial_planes
        SET creado_en = COALESCE(creado_en, created_at)
        WHERE creado_en IS NULL;
    END IF;

    -- Default + not null suave
    ALTER TABLE public.historial_planes
        ALTER COLUMN creado_en SET DEFAULT now();

    UPDATE public.historial_planes SET creado_en = now() WHERE creado_en IS NULL;
EXCEPTION WHEN others THEN
    NULL;
END $$;

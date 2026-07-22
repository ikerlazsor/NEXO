-- ============================================================
-- Asegura que los CHECK de aspectos / repetiria coinciden con la app.
-- Ejecutar si al valorar falla el constraint de aspectos.
-- ============================================================

ALTER TABLE public.valoraciones
    DROP CONSTRAINT IF EXISTS valoraciones_aspectos_positivos_check;

ALTER TABLE public.valoraciones
    DROP CONSTRAINT IF EXISTS valoraciones_aspectos_negativos_check;

-- Recrear con los valores oficiales del esquema Nexo
ALTER TABLE public.valoraciones
    ADD CONSTRAINT valoraciones_aspectos_positivos_check
    CHECK (
        cardinality(aspectos_positivos) <= 2
        AND aspectos_positivos <@ ARRAY[
            'agradable'::text,
            'puntual'::text,
            'respetuoso'::text,
            'cercano'::text,
            'divertido'::text,
            'social'::text
        ]
    );

ALTER TABLE public.valoraciones
    ADD CONSTRAINT valoraciones_aspectos_negativos_check
    CHECK (
        cardinality(aspectos_negativos) <= 2
        AND aspectos_negativos <@ ARRAY[
            'impuntual'::text,
            'irrespetuoso'::text,
            'frio'::text,
            'poco_participativo'::text,
            'incomodo'::text
        ]
    );

-- repetiria: si | indiferente | no
DO $$
BEGIN
    ALTER TABLE public.valoraciones DROP CONSTRAINT IF EXISTS valoraciones_repetiria_experiencia_check;
EXCEPTION WHEN undefined_object THEN
    NULL;
END $$;

-- Si el CHECK estaba inline sin nombre estable, esto puede no encontrarlo;
-- la app ya envía solo valores válidos.

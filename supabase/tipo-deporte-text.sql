-- Convierte tipo_deporte (y categoria si aplica) de enum a text
-- para aceptar subcategorías nuevas: cafe, tapas, senderismo, etc.
-- Ejecutar en Supabase SQL Editor.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns c
        JOIN pg_type t ON t.typname = c.udt_name
        WHERE c.table_schema = 'public'
          AND c.table_name = 'planes'
          AND c.column_name = 'tipo_deporte'
          AND t.typtype = 'e'
    ) THEN
        ALTER TABLE public.planes
            ALTER COLUMN tipo_deporte TYPE text USING tipo_deporte::text;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns c
        JOIN pg_type t ON t.typname = c.udt_name
        WHERE c.table_schema = 'public'
          AND c.table_name = 'planes'
          AND c.column_name = 'categoria'
          AND t.typtype = 'e'
    ) THEN
        ALTER TABLE public.planes
            ALTER COLUMN categoria TYPE text USING categoria::text;
    END IF;
END $$;

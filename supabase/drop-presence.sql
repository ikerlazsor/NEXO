-- Quitar presencia / última vez en línea
ALTER TABLE public.perfiles
  DROP COLUMN IF EXISTS ultima_vez;

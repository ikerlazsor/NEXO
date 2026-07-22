-- Reset cooldown: null = nunca cambiado el @ desde la app
-- (el backfill anterior marcaba now() y bloqueaba 7 días por error)
UPDATE public.perfiles
SET nombre_usuario_cambiado_en = NULL;

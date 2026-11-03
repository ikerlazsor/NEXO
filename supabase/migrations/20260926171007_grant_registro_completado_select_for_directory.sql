-- Buscar/invitar filtran por registro_completado, pero authenticated no tenía SELECT
-- sobre esa columna → PostgREST fallaba y la UI quedaba vacía.
grant select (registro_completado) on table public.perfiles to authenticated;

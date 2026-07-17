-- ============================================================
-- NEXO · Limpieza del sistema antiguo de insignias en BD
-- Ejecutar DESPUÉS de badge-stats-materialized.sql
--
-- La app calcula insignias en el cliente (lib/badges.ts) usando
-- estadísticas materializadas en estadisticas_usuario.
-- Las tablas insignias / requisitos_insignias / usuario_insignias
-- eran un catálogo BD que la app NUNCA consulta → se eliminan.
-- ============================================================

-- Quitar tablas legacy (orden por dependencias FK)
DROP TABLE IF EXISTS public.usuario_insignias CASCADE;
DROP TABLE IF EXISTS public.requisitos_insignias CASCADE;
DROP TABLE IF EXISTS public.insignias CASCADE;

-- Si existía una versión antigua de get_badge_stats con agregaciones
-- pesadas, badge-stats-materialized.sql ya la reemplazó con CREATE OR REPLACE.
-- No hace falta DROP FUNCTION.

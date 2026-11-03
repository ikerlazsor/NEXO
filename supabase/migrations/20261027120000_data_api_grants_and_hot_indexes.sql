-- 30 oct: tablas nuevas en public ya no reciben GRANT automático a la Data API.
-- Cubre las actuales y las que se creen después (default privileges + event trigger).
-- Índices de FKs calientes para no degradar al crecer.

GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO postgres, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.grant_data_api_on_new_relation()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN (
      'CREATE TABLE',
      'CREATE TABLE AS',
      'CREATE VIEW',
      'CREATE MATERIALIZED VIEW',
      'CREATE FOREIGN TABLE'
    )
  LOOP
    IF obj.schema_name = 'public'
       AND obj.object_type IN ('table', 'view', 'materialized view', 'foreign table')
    THEN
      EXECUTE format(
        'GRANT ALL ON %s TO postgres, anon, authenticated, service_role',
        obj.object_identity
      );
    END IF;
  END LOOP;
END;
$$;

DROP EVENT TRIGGER IF EXISTS grant_data_api_on_new_relation;
CREATE EVENT TRIGGER grant_data_api_on_new_relation
  ON ddl_command_end
  WHEN TAG IN (
    'CREATE TABLE',
    'CREATE TABLE AS',
    'CREATE VIEW',
    'CREATE MATERIALIZED VIEW',
    'CREATE FOREIGN TABLE'
  )
  EXECUTE FUNCTION public.grant_data_api_on_new_relation();

CREATE INDEX IF NOT EXISTS idx_torneo_votos_campeon_usuario_id
  ON public.torneo_votos_campeon (usuario_id);
CREATE INDEX IF NOT EXISTS idx_cierres_valoracion_plan_id
  ON public.cierres_valoracion (plan_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_id
  ON public.analytics_events (user_id);

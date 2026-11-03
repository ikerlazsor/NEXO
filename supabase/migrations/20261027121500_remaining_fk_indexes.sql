-- FKs de admin/insights sin índice: ON DELETE a perfiles no debe escanear.
CREATE INDEX IF NOT EXISTS idx_reportes_planes_revisado_por
  ON public.reportes_planes (revisado_por);
CREATE INDEX IF NOT EXISTS idx_reportes_usuarios_revisado_por
  ON public.reportes_usuarios (revisado_por);
CREATE INDEX IF NOT EXISTS idx_mensajes_soporte_revisado_por
  ON public.mensajes_soporte (revisado_por);
CREATE INDEX IF NOT EXISTS idx_reportes_mensajes_denunciado_id
  ON public.reportes_mensajes (denunciado_id);
CREATE INDEX IF NOT EXISTS idx_reportes_mensajes_revisado_por
  ON public.reportes_mensajes (revisado_por);
CREATE INDEX IF NOT EXISTS idx_solicitudes_organizador_revisado_por
  ON public.solicitudes_organizador (revisado_por);
CREATE INDEX IF NOT EXISTS idx_organizador_insight_events_actor_id
  ON public.organizador_insight_events (actor_id);
CREATE INDEX IF NOT EXISTS idx_organizador_insight_events_plan_id
  ON public.organizador_insight_events (plan_id);

-- NEXO production schema baseline
-- Exported from project nixeproyzxvqzyrvsxcx on 2026-08-11.
-- Schema only: no auth users, application rows, secrets, or storage objects.
-- Production predates migration tracking. Mark this migration as applied before
-- pushing later migrations to the linked production project.

set statement_timeout = 0;
set lock_timeout = 0;
set client_encoding = 'UTF8';
set standard_conforming_strings = on;
set check_function_bodies = false;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

set search_path = public, extensions, pg_catalog;

-- ---------------------------------------------------------------------------
-- ENUM TYPES
-- ---------------------------------------------------------------------------

create type public.tipo_asistencia as enum ('asistio', 'no_asistio', 'asistio_parcialmente');

create type public.tipo_comunicacion as enum ('muy_facil', 'facil', 'normal', 'dificil', 'muy_dificil');

create type public.tipo_convivencia as enum ('totalmente_comodo', 'bastante_comodo', 'normal', 'poco_comodo', 'incomodo');

create type public.tipo_deporte as enum ('futbol', 'baloncesto', 'padel', 'tenis', 'running', 'senderismo', 'otro');

create type public.tipo_estado_amistad as enum ('pendiente', 'aceptado', 'rechazado');

create type public.tipo_estado_participante as enum ('pendiente', 'aceptado', 'rechazado', 'lista_espera', 'en_espera');

create type public.tipo_estado_plan as enum ('abierto', 'completo', 'en_curso', 'finalizado', 'cancelado');

create type public.tipo_genero as enum ('masculino', 'femenino', 'no_binario', 'otro', 'prefiero_no_decirlo');

create type public.tipo_mensaje as enum ('texto', 'audio', 'imagen');

create type public.tipo_repetir as enum ('si', 'indiferente', 'no');

-- ---------------------------------------------------------------------------
-- TABLES
-- ---------------------------------------------------------------------------

create table public.ai_search_usage (
  user_id uuid not null,
  window_started_at timestamp with time zone default now() not null,
  request_count integer default 0 not null,
  updated_at timestamp with time zone default now() not null,
  constraint ai_search_usage_pkey PRIMARY KEY (user_id)
);

create table public.amistades (
  id uuid default gen_random_uuid() not null,
  usuario_origen_id uuid not null,
  usuario_destino_id uuid not null,
  estado tipo_estado_amistad default 'pendiente'::tipo_estado_amistad not null,
  creado_en timestamp with time zone default now() not null,
  actualizado_en timestamp with time zone default now() not null,
  constraint amistades_pkey PRIMARY KEY (id),
  constraint amistades_unicas UNIQUE (usuario_origen_id, usuario_destino_id)
);

create table public.analytics_events (
  id uuid default gen_random_uuid() not null,
  event_name text not null,
  user_id uuid,
  props jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  constraint analytics_events_pkey PRIMARY KEY (id)
);

create table public.bloqueos (
  id uuid default gen_random_uuid() not null,
  bloqueador_id uuid not null,
  bloqueado_id uuid not null,
  creado_en timestamp with time zone default now() not null,
  constraint bloqueos_pkey PRIMARY KEY (id),
  constraint bloqueos_unicos UNIQUE (bloqueador_id, bloqueado_id)
);

create table public.chats_directos_ocultos (
  usuario_id uuid not null,
  peer_id uuid not null,
  oculto_en timestamp with time zone default now() not null,
  constraint chats_directos_ocultos_pkey PRIMARY KEY (usuario_id, peer_id)
);

create table public.estadisticas_usuario (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid not null,
  valoracion_media numeric(3,2) default 0.00 not null,
  porcentaje_repetiria numeric(5,2) default 0.00 not null,
  numero_planes_realizados integer default 0 not null,
  numero_amistades integer default 0 not null,
  numero_reportes integer default 0 not null,
  creado_en timestamp with time zone default now() not null,
  actualizado_en timestamp with time zone default now() not null,
  numero_valoraciones integer default 0 not null,
  numero_asistencias_confirmadas integer default 0 not null,
  aspecto_positivo_mas_votado text,
  votos_aspecto_positivo integer default 0 not null,
  aspecto_negativo_mas_votado text,
  votos_aspecto_negativo integer default 0 not null,
  planes_tapas integer default 0 not null,
  planes_deporte integer default 0 not null,
  planes_fiesta integer default 0 not null,
  planes_estudio integer default 0 not null,
  planes_solo_chicas integer default 0 not null,
  categorias_probadas integer default 0 not null,
  planes_creados integer default 0 not null,
  personas_distintas integer default 0 not null,
  porcentaje_asistencia numeric default 0,
  numero_evaluadores_distintos integer default 0,
  constraint estadisticas_usuario_pkey PRIMARY KEY (id),
  constraint estadisticas_usuario_usuario_id_key UNIQUE (usuario_id)
);

create table public.expulsiones_plan (
  id uuid default gen_random_uuid() not null,
  plan_id uuid not null,
  usuario_id uuid not null,
  expulsado_por uuid not null,
  creado_en timestamp with time zone default now() not null,
  constraint expulsiones_plan_pkey PRIMARY KEY (id),
  constraint expulsiones_plan_plan_id_usuario_id_key UNIQUE (plan_id, usuario_id)
);

create table public.historial_planes (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid not null,
  plan_id uuid not null,
  creado_en timestamp with time zone default now(),
  constraint historial_planes_pkey PRIMARY KEY (id),
  constraint historial_planes_unique_pair UNIQUE (usuario_id, plan_id),
  constraint historial_unicos UNIQUE (usuario_id, plan_id)
);

create table public.invitaciones_planes (
  id uuid default gen_random_uuid() not null,
  plan_id uuid not null,
  invitador_id uuid not null,
  invitado_id uuid not null,
  tipo text default 'plan'::text not null,
  estado tipo_estado_amistad default 'pendiente'::tipo_estado_amistad not null,
  creado_en timestamp with time zone default now() not null,
  constraint inv_planes_unicas UNIQUE (plan_id, invitado_id),
  constraint invitaciones_planes_pkey PRIMARY KEY (id)
);

create table public.mensaje_reacciones (
  id uuid default gen_random_uuid() not null,
  mensaje_id uuid not null,
  usuario_id uuid not null,
  emoji text not null,
  creado_en timestamp with time zone default now() not null,
  constraint mensaje_reacciones_mensaje_id_usuario_id_key UNIQUE (mensaje_id, usuario_id),
  constraint mensaje_reacciones_pkey PRIMARY KEY (id)
);

create table public.mensajes (
  id uuid default gen_random_uuid() not null,
  plan_id uuid,
  emisor_id uuid not null,
  receptor_id uuid,
  contenido text not null,
  tipo tipo_mensaje default 'texto'::tipo_mensaje not null,
  archivo_url text,
  creado_en timestamp with time zone default now() not null,
  constraint mensajes_pkey PRIMARY KEY (id)
);

create table public.mensajes_soporte (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid not null,
  tipo text not null,
  asunto text,
  mensaje text not null,
  estado text default 'abierto'::text not null,
  notas_internas text,
  creado_en timestamp with time zone default now() not null,
  actualizado_en timestamp with time zone default now() not null,
  revisado_en timestamp with time zone,
  revisado_por uuid,
  constraint mensajes_soporte_pkey PRIMARY KEY (id)
);

create table public.participantes (
  id uuid default gen_random_uuid() not null,
  plan_id uuid not null,
  usuario_id uuid not null,
  estado tipo_estado_participante default 'pendiente'::tipo_estado_participante not null,
  creado_en timestamp with time zone default now() not null,
  actualizado_en timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null,
  constraint participantes_pkey PRIMARY KEY (id),
  constraint participantes_unicos UNIQUE (plan_id, usuario_id)
);

create table public.perfiles (
  id uuid not null,
  nombre text,
  nombre_usuario text,
  avatar_url text,
  descripcion text,
  fecha_nacimiento date,
  genero tipo_genero,
  ambientes_preferidos text[] default '{}'::text[],
  etiquetas text[] default '{}'::text[],
  habitos_consumo jsonb default '{"bebida": "no_especificado", "tabaco": "no_especificado"}'::jsonb,
  perfil_gustos jsonb default '{}'::jsonb,
  registro_completado boolean default false not null,
  creado_en timestamp with time zone default now() not null,
  actualizado_en timestamp with time zone default now() not null,
  nombre_usuario_cambiado_en timestamp with time zone,
  rol text default 'user'::text not null,
  baneado boolean default false not null,
  baneado_en timestamp with time zone,
  baneado_motivo text,
  nombre_usuario_cambios timestamp with time zone[] default '{}'::timestamp with time zone[],
  notificaciones_push boolean default true not null,
  notif_messages boolean default true not null,
  notif_social boolean default true not null,
  notif_reminders boolean default true not null,
  constraint perfiles_nombre_usuario_key UNIQUE (nombre_usuario),
  constraint perfiles_pkey PRIMARY KEY (id)
);

create table public.plan_invitaciones (
  id uuid default gen_random_uuid() not null,
  plan_id uuid not null,
  invitador_id uuid not null,
  invitado_id uuid not null,
  tipo text default 'plan'::text not null,
  estado text default 'pendiente'::text not null,
  created_at timestamp with time zone default now() not null,
  constraint plan_invitaciones_pkey PRIMARY KEY (id),
  constraint plan_invitaciones_unique UNIQUE (plan_id, invitado_id)
);

create table public.planes (
  id uuid default gen_random_uuid() not null,
  creador_id uuid not null,
  titulo text not null,
  categoria text not null,
  tipo_deporte text,
  descripcion text,
  imagen_url text,
  nombre_ubicacion text,
  latitud double precision,
  longitud double precision,
  fecha_evento timestamp with time zone not null,
  maximo_participantes integer not null,
  requiere_aprobacion boolean default false not null,
  estado tipo_estado_plan default 'abierto'::tipo_estado_plan not null,
  creado_en timestamp with time zone default now() not null,
  actualizado_en timestamp with time zone default now() not null,
  minimo_participantes integer default 2 not null,
  solo_chicas boolean default false not null,
  finalizado_en timestamp with time zone,
  chat_eliminado_en timestamp with time zone,
  solo_amigos boolean default false not null,
  modo_privado boolean default false not null,
  is_direct_chat boolean default false,
  is_group_chat boolean default false,
  constraint planes_pkey PRIMARY KEY (id)
);

create table public.planes_guardados (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid not null,
  plan_id uuid not null,
  creado_en timestamp with time zone default now() not null,
  constraint planes_guardados_pkey PRIMARY KEY (id),
  constraint planes_guardados_unicos UNIQUE (usuario_id, plan_id)
);

create table public.push_chat_mutes (
  user_id uuid not null,
  plan_id uuid not null,
  created_at timestamp with time zone default now() not null,
  constraint push_chat_mutes_pkey PRIMARY KEY (user_id, plan_id)
);

create table public.push_dispatch_usage (
  user_id uuid not null,
  window_started_at timestamp with time zone default now() not null,
  request_count integer default 0 not null,
  updated_at timestamp with time zone default now() not null,
  constraint push_dispatch_usage_pkey PRIMARY KEY (user_id)
);

create table public.push_message_deliveries (
  message_id text not null,
  sender_id uuid not null,
  push_token text not null,
  status text default 'processing'::text not null,
  attempts integer default 1 not null,
  processing_started_at timestamp with time zone,
  accepted_at timestamp with time zone,
  expo_ticket_id text,
  last_error text,
  updated_at timestamp with time zone default now() not null,
  constraint push_message_deliveries_pkey PRIMARY KEY (message_id, push_token)
);

create table public.push_message_dispatches (
  message_id text not null,
  sender_id uuid not null,
  dispatched_at timestamp with time zone default now() not null,
  constraint push_message_dispatches_pkey PRIMARY KEY (message_id)
);

create table public.push_notification_outbox (
  id uuid default gen_random_uuid() not null,
  event_key text not null,
  event_type text not null,
  recipient_id uuid not null,
  actor_id uuid not null,
  plan_id uuid not null,
  plan_title text not null,
  status text default 'pending'::text not null,
  attempts integer default 0 not null,
  available_at timestamp with time zone default now() not null,
  processing_started_at timestamp with time zone,
  sent_at timestamp with time zone,
  expo_ticket_ids jsonb,
  last_error text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint push_notification_outbox_event_key_key UNIQUE (event_key),
  constraint push_notification_outbox_pkey PRIMARY KEY (id)
);

create table public.push_tokens (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  token text not null,
  platform text,
  updated_at timestamp with time zone default now() not null,
  constraint push_tokens_pkey PRIMARY KEY (id),
  constraint push_tokens_user_id_token_key UNIQUE (user_id, token)
);

create table public.reportes_planes (
  id uuid default gen_random_uuid() not null,
  plan_id uuid,
  reportador_id uuid not null,
  motivo text default 'otro'::text not null,
  creado_en timestamp with time zone default now() not null,
  mensaje text,
  estado text default 'abierto'::text not null,
  notas_internas text,
  revisado_en timestamp with time zone,
  revisado_por uuid,
  plan_titulo text,
  plan_eliminado boolean default false not null,
  plan_eliminado_en timestamp with time zone,
  constraint reportes_planes_pkey PRIMARY KEY (id),
  constraint reportes_planes_plan_id_reportador_id_key UNIQUE (plan_id, reportador_id)
);

create table public.reportes_usuarios (
  id uuid default gen_random_uuid() not null,
  denunciado_id uuid not null,
  reportador_id uuid not null,
  motivo text default 'otro'::text not null,
  mensaje text,
  creado_en timestamp with time zone default now() not null,
  estado text default 'abierto'::text not null,
  notas_internas text,
  revisado_en timestamp with time zone,
  revisado_por uuid,
  constraint reportes_usuarios_denunciado_id_reportador_id_key UNIQUE (denunciado_id, reportador_id),
  constraint reportes_usuarios_pkey PRIMARY KEY (id)
);

create table public.valoraciones (
  id uuid default gen_random_uuid() not null,
  plan_id uuid not null,
  evaluador_id uuid not null,
  evaluado_id uuid not null,
  asistencia boolean,
  puntuacion_general integer,
  repetiria_experiencia text,
  aspectos_positivos text[] default '{}'::text[] not null,
  aspectos_negativos text[] default '{}'::text[] not null,
  motivos_seguridad text[] default '{}'::text[] not null,
  creado_en timestamp with time zone default now() not null,
  incidencia_seguridad boolean default false not null,
  detalle_otro_seguridad text,
  actualizado_en timestamp with time zone default now() not null,
  constraint valoraciones_pkey PRIMARY KEY (id),
  constraint valoraciones_unique_pair UNIQUE (plan_id, evaluador_id, evaluado_id)
);

-- ---------------------------------------------------------------------------
-- FUNCTIONS
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.actualizar_estadisticas_tras_valoracion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
if tg_op = 'DELETE' then
perform public.recalcular_estadisticas_usuario(
old.evaluado_id
);

return old;
end if;

if tg_op = 'UPDATE'
and old.evaluado_id is distinct from new.evaluado_id then

perform public.recalcular_estadisticas_usuario(
old.evaluado_id
);
end if;

perform public.recalcular_estadisticas_usuario(
new.evaluado_id
);

return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.actualizar_estadisticas_usuario()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$

DECLARE

usuario uuid;

BEGIN


usuario := NEW.evaluado_id;



INSERT INTO public.estadisticas_usuario(usuario_id)

VALUES(usuario)

ON CONFLICT(usuario_id) DO NOTHING;



UPDATE public.estadisticas_usuario


SET



numero_valoraciones = (

SELECT COUNT(*)

FROM valoraciones

WHERE evaluado_id = usuario

),



media_experiencia = (

SELECT COALESCE(AVG(puntuacion),0)

FROM valoraciones

WHERE evaluado_id = usuario

),



porcentaje_repetiria = (

SELECT COALESCE(

COUNT(*) FILTER(
WHERE volveria_a_coincidir='si'
)

*100.0 /
NULLIF(COUNT(*),0),

0)

FROM valoraciones

WHERE evaluado_id = usuario

),



porcentaje_experiencias_positivas = (

SELECT COALESCE(

COUNT(*) FILTER(
WHERE puntuacion >=4
)

*100.0 /
NULLIF(COUNT(*),0),

0)

FROM valoraciones

WHERE evaluado_id = usuario

),



media_puntualidad = (

SELECT COALESCE(AVG(puntualidad),0)

FROM valoraciones

WHERE evaluado_id = usuario

),



media_comunicacion = (

SELECT COALESCE(AVG(comunicacion),0)

FROM valoraciones

WHERE evaluado_id = usuario

),



media_convivencia = (

SELECT COALESCE(AVG(convivencia),0)

FROM valoraciones

WHERE evaluado_id = usuario

),



porcentaje_asistencia = (

SELECT COALESCE(

COUNT(*) FILTER(
WHERE asistencia='asistio'
)

*100.0 /
NULLIF(COUNT(*),0),

0)

FROM valoraciones

WHERE evaluado_id = usuario

),



veces_buena_energia = (

SELECT COUNT(*)

FROM valoraciones

WHERE evaluado_id = usuario

AND 'buena_energia'=ANY(actitudes)

),



veces_cercana_agradable = (

SELECT COUNT(*)

FROM valoraciones

WHERE evaluado_id = usuario

AND 'cercana_agradable'=ANY(actitudes)

),



veces_participativa = (

SELECT COUNT(*)

FROM valoraciones

WHERE evaluado_id = usuario

AND 'participativa'=ANY(actitudes)

),



veces_respetuosa = (

SELECT COUNT(*)

FROM valoraciones

WHERE evaluado_id = usuario

AND 'respetuosa'=ANY(actitudes)

),



veces_impuntual = (

SELECT COUNT(*)

FROM valoraciones

WHERE evaluado_id = usuario

AND 'ser_mas_puntual'=ANY(aspectos_mejorar)

),



updated_at = now()



WHERE usuario_id = usuario;



RETURN NEW;


END;

$function$
;

CREATE OR REPLACE FUNCTION public.actualizar_estadisticas_usuario(v_usuario uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
v_val_media numeric(3,2) := 0.00;
v_pct_repetir numeric(5,2) := 0.00;
v_punt_media numeric(3,2) := 0.00;
v_com_media numeric(3,2) := 0.00;
v_conv_media numeric(3,2) := 0.00;
v_planes_realizados integer := 0;
v_amistades integer := 0;
v_buena_energia integer := 0;
v_reportes integer := 0;
v_total_vals integer := 0;
BEGIN
-- 1. Agrupar datos de valoraciones recibidas
SELECT
COALESCE(COUNT(*), 0),
COALESCE(AVG(puntuacion_general), 0.00),
COALESCE(AVG(puntualidad), 0.00),
COALESCE(AVG(
CASE comunicacion
WHEN 'muy_facil' THEN 5.0
WHEN 'facil' THEN 4.0
WHEN 'normal' THEN 3.0
WHEN 'dificil' THEN 2.0
WHEN 'muy_dificil' THEN 1.0
ELSE NULL
END
), 0.00),
COALESCE(AVG(
CASE respeto_convivencia
WHEN 'totalmente_comodo' THEN 5.0
WHEN 'bastante_comodo' THEN 4.0
WHEN 'normal' THEN 3.0
WHEN 'poco_comodo' THEN 2.0
WHEN 'incomodo' THEN 1.0
ELSE NULL
END
), 0.00),
COALESCE((COUNT(*) FILTER (WHERE repetiria_experiencia = 'si')::numeric / NULLIF(COUNT(*), 0)) * 100, 0.00),
COALESCE(COUNT(*) FILTER (WHERE 'buena_energia' = ANY(aspectos_positivos)), 0),
COALESCE(COUNT(*) FILTER (WHERE array_length(reporte_seguridad, 1) > 0), 0)
INTO
v_total_vals, v_val_media, v_punt_media, v_com_media, v_conv_media, v_pct_repetir, v_buena_energia, v_reportes
FROM public.valoraciones
WHERE evaluado_id = v_usuario;

-- 2. Calcular planes finalizados en los que el usuario fue aceptado
SELECT COUNT(DISTINCT p.plan_id)
INTO v_planes_realizados
FROM public.participantes p
JOIN public.planes pl ON p.plan_id = pl.id
WHERE p.usuario_id = v_usuario AND p.estado = 'aceptado' AND pl.estado = 'finalizado';

-- 3. Calcular amistades aceptadas
SELECT COUNT(*)
INTO v_amistades
FROM public.amistades
WHERE (usuario_origen_id = v_usuario OR usuario_destino_id = v_usuario) AND estado = 'aceptado';

-- 4. Guardar resultados calculados en la tabla de estadísticas caché
INSERT INTO public.estadisticas_usuario (
usuario_id, valoracion_media, porcentaje_repetiria, puntualidad_media,
comunicacion_media, convivencia_media, numero_planes_realizados,
numero_amistades, veces_buena_energia, numero_reportes
) VALUES (
v_usuario, v_val_media, v_pct_repetir, v_punt_media,
v_com_media, v_conv_media, v_planes_realizados,
v_amistades, v_buena_energia, v_reportes
)
ON CONFLICT (usuario_id) DO UPDATE SET
valoracion_media = EXCLUDED.valoracion_media,
porcentaje_repetiria = EXCLUDED.porcentaje_repetiria,
puntualidad_media = EXCLUDED.puntualidad_media,
comunicacion_media = EXCLUDED.comunicacion_media,
convivencia_media = EXCLUDED.convivencia_media,
numero_planes_realizados = EXCLUDED.numero_planes_realizados,
numero_amistades = EXCLUDED.numero_amistades,
veces_buena_energia = EXCLUDED.veces_buena_energia,
numero_reportes = EXCLUDED.numero_reportes,
actualizado_en = now();

-- 5. Sincronizar simultáneamente los campos directos en 'perfiles'
UPDATE public.perfiles
SET
valoracion_media = v_val_media,
numero_valoraciones = v_total_vals
WHERE id = v_usuario;

END;
$function$
;

CREATE OR REPLACE FUNCTION public.actualizar_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
NEW.actualizado_en = now();
RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_ban_user(target_id uuid, motivo text DEFAULT NULL::text, banned boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    target_rol text;
BEGIN
    IF NOT public.is_owner() THEN
        RAISE EXCEPTION 'not_authorized';
    END IF;
    IF target_id IS NULL OR target_id = auth.uid() THEN
        RAISE EXCEPTION 'invalid_target';
    END IF;

    SELECT rol INTO target_rol FROM public.perfiles WHERE id = target_id;
    IF target_rol IS NULL THEN
        RAISE EXCEPTION 'user_not_found';
    END IF;
    IF target_rol IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'cannot_moderate_staff';
    END IF;

    UPDATE public.perfiles
    SET
        baneado = banned,
        baneado_en = CASE WHEN banned THEN now() ELSE NULL END,
        baneado_motivo = CASE WHEN banned THEN NULLIF(trim(motivo), '') ELSE NULL END
    WHERE id = target_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_delete_inbox_item(item_kind text, item_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT public.is_staff() THEN
        RAISE EXCEPTION 'not_authorized';
    END IF;
    IF item_id IS NULL THEN
        RAISE EXCEPTION 'invalid_target';
    END IF;

    IF item_kind = 'soporte' THEN
        DELETE FROM public.mensajes_soporte WHERE id = item_id;
    ELSIF item_kind = 'plan' THEN
        DELETE FROM public.reportes_planes WHERE id = item_id;
    ELSIF item_kind = 'user' THEN
        DELETE FROM public.reportes_usuarios WHERE id = item_id;
    ELSE
        RAISE EXCEPTION 'invalid_kind';
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'item_not_found';
    END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_delete_plan(target_plan_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_title text;
BEGIN
    IF NOT public.is_owner() THEN
        RAISE EXCEPTION 'not_authorized';
    END IF;
    IF target_plan_id IS NULL THEN
        RAISE EXCEPTION 'invalid_target';
    END IF;

    SELECT titulo INTO v_title FROM public.planes WHERE id = target_plan_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'plan_not_found';
    END IF;

    -- Conservar el reporte en la bandeja con snapshot
    UPDATE public.reportes_planes
    SET
        plan_titulo = COALESCE(NULLIF(btrim(plan_titulo), ''), v_title, 'Plan'),
        plan_eliminado = true,
        plan_eliminado_en = now(),
        estado = CASE
            WHEN estado IN ('abierto', 'en_revision') THEN 'resuelto'
            ELSE estado
        END,
        revisado_en = COALESCE(revisado_en, now()),
        revisado_por = COALESCE(revisado_por, auth.uid())
    WHERE plan_id = target_plan_id;

    DELETE FROM public.mensajes WHERE plan_id = target_plan_id;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'invitaciones_planes'
    ) THEN
        DELETE FROM public.invitaciones_planes WHERE plan_id = target_plan_id;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'expulsiones_plan'
    ) THEN
        DELETE FROM public.expulsiones_plan WHERE plan_id = target_plan_id;
    END IF;

    DELETE FROM public.participantes WHERE plan_id = target_plan_id;
    DELETE FROM public.planes_guardados WHERE plan_id = target_plan_id;
    DELETE FROM public.historial_planes WHERE plan_id = target_plan_id;
    DELETE FROM public.valoraciones WHERE plan_id = target_plan_id;
    -- ON DELETE SET NULL en reportes_planes
    DELETE FROM public.planes WHERE id = target_plan_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_delete_user(target_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    target_rol text;
    plan_row record;
    has_col boolean;
    has_table boolean;
BEGIN
    IF NOT public.is_owner() THEN
        RAISE EXCEPTION 'not_authorized';
    END IF;
    IF target_id IS NULL OR target_id = auth.uid() THEN
        RAISE EXCEPTION 'invalid_target';
    END IF;

    SELECT rol INTO target_rol FROM public.perfiles WHERE id = target_id;
    IF target_rol IS NULL THEN
        RAISE EXCEPTION 'user_not_found';
    END IF;
    IF target_rol IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'cannot_moderate_staff';
    END IF;

    DELETE FROM public.participantes WHERE usuario_id = target_id;

    FOR plan_row IN SELECT id FROM public.planes WHERE creador_id = target_id LOOP
        DELETE FROM public.mensajes WHERE plan_id = plan_row.id;

        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'invitaciones_planes'
        ) THEN
            DELETE FROM public.invitaciones_planes WHERE plan_id = plan_row.id;
        END IF;

        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'reportes_planes'
        ) THEN
            DELETE FROM public.reportes_planes WHERE plan_id = plan_row.id;
        END IF;

        DELETE FROM public.participantes WHERE plan_id = plan_row.id;
        DELETE FROM public.planes_guardados WHERE plan_id = plan_row.id;
        DELETE FROM public.historial_planes WHERE plan_id = plan_row.id;
        DELETE FROM public.valoraciones WHERE plan_id = plan_row.id;
        DELETE FROM public.planes WHERE id = plan_row.id;
    END LOOP;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'amistades' AND column_name = 'usuario_origen_id'
    ) INTO has_col;
    IF has_col THEN
        DELETE FROM public.amistades
        WHERE usuario_origen_id = target_id OR usuario_destino_id = target_id;
    ELSE
        DELETE FROM public.amistades
        WHERE usuario_id = target_id OR amigo_id = target_id;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'bloqueos' AND column_name = 'usuario_origen_id'
    ) INTO has_col;
    IF has_col THEN
        DELETE FROM public.bloqueos
        WHERE usuario_origen_id = target_id OR usuario_destino_id = target_id;
    ELSE
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'bloqueos' AND column_name = 'bloqueador_id'
        ) INTO has_col;
        IF has_col THEN
            DELETE FROM public.bloqueos
            WHERE bloqueador_id = target_id OR bloqueado_id = target_id;
        END IF;
    END IF;

    DELETE FROM public.planes_guardados WHERE usuario_id = target_id;
    DELETE FROM public.historial_planes WHERE usuario_id = target_id;
    DELETE FROM public.valoraciones WHERE evaluador_id = target_id OR evaluado_id = target_id;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'invitaciones_planes'
    ) THEN
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'invitaciones_planes'
              AND column_name = 'invitador_id'
        ) INTO has_col;
        IF has_col THEN
            DELETE FROM public.invitaciones_planes
            WHERE invitador_id = target_id OR invitado_id = target_id;
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'reportes_planes'
    ) THEN
        DELETE FROM public.reportes_planes WHERE reportador_id = target_id;
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'reportes_usuarios'
    ) THEN
        DELETE FROM public.reportes_usuarios
        WHERE reportador_id = target_id OR denunciado_id = target_id;
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'mensajes_soporte'
    ) THEN
        DELETE FROM public.mensajes_soporte WHERE usuario_id = target_id;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'mensajes' AND column_name = 'emisor_id'
    ) INTO has_col;
    IF has_col THEN
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'mensajes' AND column_name = 'receptor_id'
        ) INTO has_table;
        IF has_table THEN
            DELETE FROM public.mensajes
            WHERE emisor_id = target_id OR receptor_id = target_id;
        ELSE
            DELETE FROM public.mensajes WHERE emisor_id = target_id;
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'estadisticas_usuario'
    ) THEN
        DELETE FROM public.estadisticas_usuario WHERE usuario_id = target_id;
    END IF;

    DELETE FROM public.perfiles WHERE id = target_id;
    DELETE FROM auth.users WHERE id = target_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_moderation_counts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    c_soporte int := 0;
    c_planes int := 0;
    c_users int := 0;
BEGIN
    IF NOT public.is_staff() THEN
        RAISE EXCEPTION 'not_authorized';
    END IF;

    SELECT count(*)::int INTO c_soporte
    FROM public.mensajes_soporte
    WHERE estado IN ('abierto', 'en_revision');

    SELECT count(*)::int INTO c_planes
    FROM public.reportes_planes
    WHERE estado IN ('abierto', 'en_revision');

    SELECT count(*)::int INTO c_users
    FROM public.reportes_usuarios
    WHERE estado IN ('abierto', 'en_revision');

    RETURN jsonb_build_object(
        'soporte', c_soporte,
        'reportes_planes', c_planes,
        'reportes_usuarios', c_users,
        'total', c_soporte + c_planes + c_users
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_set_report_estado(report_kind text, report_id uuid, nuevo_estado text, notas text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT public.is_staff() THEN
        RAISE EXCEPTION 'not_authorized';
    END IF;
    IF nuevo_estado NOT IN ('abierto', 'en_revision', 'resuelto', 'descartado') THEN
        RAISE EXCEPTION 'invalid_estado';
    END IF;

    IF report_kind = 'plan' THEN
        UPDATE public.reportes_planes
        SET
            estado = nuevo_estado,
            notas_internas = COALESCE(NULLIF(trim(notas), ''), notas_internas),
            revisado_en = now(),
            revisado_por = auth.uid()
        WHERE id = report_id;
    ELSIF report_kind = 'user' THEN
        UPDATE public.reportes_usuarios
        SET
            estado = nuevo_estado,
            notas_internas = COALESCE(NULLIF(trim(notas), ''), notas_internas),
            revisado_en = now(),
            revisado_por = auth.uid()
        WHERE id = report_id;
    ELSE
        RAISE EXCEPTION 'invalid_kind';
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'report_not_found';
    END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_set_ticket_estado(ticket_id uuid, nuevo_estado text, notas text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT public.is_staff() THEN
        RAISE EXCEPTION 'not_authorized';
    END IF;
    IF nuevo_estado NOT IN ('abierto', 'en_revision', 'resuelto', 'descartado') THEN
        RAISE EXCEPTION 'invalid_estado';
    END IF;

    UPDATE public.mensajes_soporte
    SET
        estado = nuevo_estado,
        notas_internas = COALESCE(NULLIF(trim(notas), ''), notas_internas),
        revisado_en = now(),
        revisado_por = auth.uid(),
        actualizado_en = now()
    WHERE id = ticket_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ticket_not_found';
    END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.archive_all_ended_plans()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    r record;
    n integer := 0;
BEGIN
    FOR r IN
        SELECT id FROM public.planes
        WHERE fecha_evento IS NOT NULL
          AND fecha_evento <= now()
          AND COALESCE(categoria, '') NOT IN ('Grupo', 'Chat')
    LOOP
        PERFORM public.archive_ended_plan(r.id);
        n := n + 1;
    END LOOP;
    RETURN n;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.archive_ended_plan(p_plan_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_fecha timestamptz;
    v_cat text;
BEGIN
    SELECT fecha_evento, categoria INTO v_fecha, v_cat
    FROM public.planes WHERE id = p_plan_id;

    IF v_fecha IS NULL OR v_cat IN ('Grupo', 'Chat') THEN
        RETURN;
    END IF;

    IF v_fecha > now() THEN
        RETURN;
    END IF;

    UPDATE public.planes
    SET finalizado_en = COALESCE(finalizado_en, now())
    WHERE id = p_plan_id AND finalizado_en IS NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.array_text_sin_duplicados(valores text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
select coalesce(
cardinality(valores) =
(
select count(distinct elemento)
from unnest(valores) as elemento
),
true
);
$function$
;

CREATE OR REPLACE FUNCTION public.borrar_propia_cuenta()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$DECLARE
    uid uuid := auth.uid();
BEGIN
    IF uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated';
    END IF;

    DELETE FROM auth.users WHERE id = uid;
END;$function$
;

CREATE OR REPLACE FUNCTION public.change_username(new_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    uid uuid := auth.uid();
    normalized text;
    current_handle text;
    cambios timestamptz[];
    recent timestamptz[];
    next_allowed timestamptz;
    days_left numeric;
BEGIN
    IF uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated';
    END IF;

    normalized := lower(btrim(new_name));
    normalized := translate(
        normalized,
        'áàäâãåéèëêíìïîóòöôõúùüûñç',
        'aaaaaaeeeeiiiiooooouuuunc'
    );
    normalized := regexp_replace(normalized, '[^a-z0-9._]', '', 'g');
    normalized := regexp_replace(normalized, '\.{2,}', '.', 'g');
    normalized := trim(both '.' from normalized);

    IF length(normalized) < 3 OR length(normalized) > 20 THEN
        RAISE EXCEPTION 'invalid_username';
    END IF;
    IF normalized !~ '^[a-z0-9._]+$' THEN
        RAISE EXCEPTION 'invalid_username';
    END IF;

    SELECT
        nombre_usuario,
        coalesce(nombre_usuario_cambios, '{}'::timestamptz[])
    INTO current_handle, cambios
    FROM public.perfiles
    WHERE id = uid
    FOR UPDATE;

    IF current_handle IS NOT NULL AND lower(btrim(current_handle)) = normalized THEN
        RETURN jsonb_build_object('ok', true, 'unchanged', true);
    END IF;

    SELECT coalesce(array_agg(t ORDER BY t), '{}'::timestamptz[])
    INTO recent
    FROM unnest(cambios) AS t
    WHERE t > now() - interval '7 days';

    IF coalesce(cardinality(recent), 0) >= 2 THEN
        next_allowed := recent[1] + interval '7 days';
        days_left := ceil(EXTRACT(EPOCH FROM (next_allowed - now())) / 86400.0);
        RAISE EXCEPTION 'username_cooldown:%', greatest(1, days_left::int);
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.perfiles
        WHERE lower(nombre_usuario) = normalized
          AND id <> uid
    ) THEN
        RAISE EXCEPTION 'username_taken';
    END IF;

    PERFORM set_config('app.username_change_ok', '1', true);

    -- Primer @ (registro): no cuenta
    IF current_handle IS NULL OR btrim(current_handle) = '' THEN
        UPDATE public.perfiles
        SET nombre_usuario = normalized
        WHERE id = uid;
        RETURN jsonb_build_object('ok', true, 'nombre_usuario', normalized, 'initial', true);
    END IF;

    recent := recent || ARRAY[now()];

    UPDATE public.perfiles
    SET
        nombre_usuario = normalized,
        nombre_usuario_cambios = recent,
        nombre_usuario_cambiado_en = now()
    WHERE id = uid;

    RETURN jsonb_build_object(
        'ok', true,
        'nombre_usuario', normalized,
        'changes_in_window', cardinality(recent)
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_push_message(p_message_id text, p_sender_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    inserted_count integer := 0;
begin
    if nullif(trim(p_message_id), '') is null or p_sender_id is null then
        return false;
    end if;

    delete from public.push_message_dispatches
    where sender_id = p_sender_id
      and dispatched_at < now() - interval '30 days';

    insert into public.push_message_dispatches (message_id, sender_id)
    values (p_message_id, p_sender_id)
    on conflict (message_id) do nothing;

    get diagnostics inserted_count = row_count;
    return inserted_count = 1;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_push_message_delivery(p_message_id text, p_sender_id uuid, p_push_token text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    claimed boolean := false;
begin
    if nullif(trim(p_message_id), '') is null
       or p_sender_id is null
       or nullif(trim(p_push_token), '') is null then
        return false;
    end if;

    insert into public.push_message_deliveries (
        message_id,
        sender_id,
        push_token,
        status,
        attempts,
        processing_started_at,
        updated_at
    )
    values (
        p_message_id,
        p_sender_id,
        p_push_token,
        'processing',
        1,
        now(),
        now()
    )
    on conflict (message_id, push_token) do update
       set status = 'processing',
           attempts = push_message_deliveries.attempts + 1,
           processing_started_at = now(),
           last_error = null,
           updated_at = now()
     where push_message_deliveries.sender_id = excluded.sender_id
       and push_message_deliveries.attempts < 8
       and (
           push_message_deliveries.status = 'failed'
           or (
               push_message_deliveries.status = 'processing'
               and push_message_deliveries.processing_started_at < now() - interval '5 minutes'
           )
       )
    returning true into claimed;

    return coalesce(claimed, false);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_push_outbox_event(p_event_id uuid)
 RETURNS push_notification_outbox
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    claimed public.push_notification_outbox;
begin
    update public.push_notification_outbox
       set status = 'processing',
           attempts = attempts + 1,
           processing_started_at = now(),
           updated_at = now(),
           last_error = null
     where id = p_event_id
       and available_at <= now()
       and (
           status in ('pending', 'failed')
           or (
               status = 'processing'
               and processing_started_at < now() - interval '5 minutes'
           )
       )
       and attempts < 8
    returning * into claimed;

    return claimed;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.complete_push_message_delivery(p_message_id text, p_sender_id uuid, p_push_token text, p_succeeded boolean, p_ticket_id text DEFAULT NULL::text, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    update public.push_message_deliveries
       set status = case when p_succeeded then 'accepted' else 'failed' end,
           accepted_at = case when p_succeeded then now() else null end,
           expo_ticket_id = case when p_succeeded then p_ticket_id else expo_ticket_id end,
           last_error = case
               when p_succeeded then null
               else left(coalesce(p_error, 'expo_delivery_failed'), 500)
           end,
           processing_started_at = null,
           updated_at = now()
     where message_id = p_message_id
       and sender_id = p_sender_id
       and push_token = p_push_token
       and status = 'processing';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.complete_push_outbox_event(p_event_id uuid, p_succeeded boolean, p_ticket_ids jsonb DEFAULT NULL::jsonb, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    update public.push_notification_outbox
       set status = case when p_succeeded then 'sent' else 'failed' end,
           sent_at = case when p_succeeded then now() else null end,
           expo_ticket_ids = case when p_succeeded then p_ticket_ids else expo_ticket_ids end,
           last_error = case
               when p_succeeded then null
               else left(coalesce(p_error, 'expo_delivery_failed'), 500)
           end,
           available_at = case
               when p_succeeded then available_at
               else now() + make_interval(secs => least(900, (30 * power(2, greatest(attempts - 1, 0)))::integer))
           end,
           processing_started_at = null,
           updated_at = now()
     where id = p_event_id
       and status = 'processing';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.consume_ai_search_quota()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    caller_id uuid := auth.uid();
    accepted boolean := false;
begin
    if caller_id is null then
        return false;
    end if;

    insert into public.ai_search_usage (
        user_id,
        window_started_at,
        request_count,
        updated_at
    )
    values (caller_id, now(), 1, now())
    on conflict (user_id) do update
    set
        window_started_at = case
            when ai_search_usage.window_started_at <= now() - interval '1 hour'
                then now()
            else ai_search_usage.window_started_at
        end,
        request_count = case
            when ai_search_usage.window_started_at <= now() - interval '1 hour'
                then 1
            else ai_search_usage.request_count + 1
        end,
        updated_at = now()
    where
        ai_search_usage.window_started_at <= now() - interval '1 hour'
        or ai_search_usage.request_count < 30
    returning true into accepted;

    return coalesce(accepted, false);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.consume_push_dispatch_quota(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    accepted boolean := false;
begin
    if p_user_id is null then
        return false;
    end if;

    insert into public.push_dispatch_usage (
        user_id,
        window_started_at,
        request_count,
        updated_at
    )
    values (p_user_id, now(), 1, now())
    on conflict (user_id) do update
    set
        window_started_at = case
            when push_dispatch_usage.window_started_at <= now() - interval '1 minute'
                then now()
            else push_dispatch_usage.window_started_at
        end,
        request_count = case
            when push_dispatch_usage.window_started_at <= now() - interval '1 minute'
                then 1
            else push_dispatch_usage.request_count + 1
        end,
        updated_at = now()
    where
        push_dispatch_usage.window_started_at <= now() - interval '1 minute'
        or push_dispatch_usage.request_count < 120
    returning true into accepted;

    return coalesce(accepted, false);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.count_user_active_plans(p_user_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT
        (
            SELECT COUNT(*)::int
            FROM public.planes
            WHERE creador_id = p_user_id
              AND (fecha_evento IS NULL OR fecha_evento >= now())
        )
        +
        (
            SELECT COUNT(*)::int
            FROM public.participantes p
            JOIN public.planes pl ON pl.id = p.plan_id
            WHERE p.usuario_id = p_user_id
              AND p.estado = 'aceptado'
              AND pl.creador_id IS DISTINCT FROM p_user_id
              AND (pl.fecha_evento IS NULL OR pl.fecha_evento >= now())
        );
$function$
;

CREATE OR REPLACE FUNCTION public.crear_estadisticas_iniciales()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
INSERT INTO public.estadisticas_usuario (usuario_id)
VALUES (NEW.id)
ON CONFLICT (usuario_id) DO NOTHING;
RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.crear_estadisticas_para_perfil()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
insert into public.estadisticas_usuario (
usuario_id
)
values (
new.id
)
on conflict (usuario_id) do nothing;

return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_meetup_plan(p_payload jsonb)
 RETURNS planes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_uid uuid := auth.uid();
    v_plan public.planes;
    v_max int;
    v_min int;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;

    -- Límite de planes activos (si existe la función)
    IF to_regprocedure('public.count_user_active_plans(uuid)') IS NOT NULL THEN
        IF public.count_user_active_plans(v_uid) >= 3 THEN
            RAISE EXCEPTION 'active_plan_limit_reached' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    v_max := GREATEST(2, LEAST(25, COALESCE((p_payload->>'maximo_participantes')::int, 4)));
    v_min := GREATEST(2, LEAST(v_max, COALESCE((p_payload->>'minimo_participantes')::int, 2)));

    INSERT INTO public.planes (
        titulo,
        descripcion,
        categoria,
        tipo_deporte,
        creador_id,
        fecha_evento,
        maximo_participantes,
        minimo_participantes,
        imagen_url,
        nombre_ubicacion,
        latitud,
        longitud,
        requiere_aprobacion,
        solo_chicas,
        solo_amigos,
        modo_privado,
        is_direct_chat,
        is_group_chat
    ) VALUES (
        NULLIF(trim(COALESCE(p_payload->>'titulo', '')), ''),
        NULLIF(trim(COALESCE(p_payload->>'descripcion', '')), ''),
        NULLIF(trim(COALESCE(p_payload->>'categoria', '')), ''),
        NULLIF(trim(COALESCE(p_payload->>'tipo_deporte', '')), ''),
        v_uid,
        NULLIF(p_payload->>'fecha_evento', '')::timestamptz,
        v_max,
        v_min,
        NULLIF(trim(COALESCE(p_payload->>'imagen_url', '')), ''),
        NULLIF(trim(COALESCE(p_payload->>'nombre_ubicacion', '')), ''),
        NULLIF(p_payload->>'latitud', '')::float8,
        NULLIF(p_payload->>'longitud', '')::float8,
        COALESCE((p_payload->>'requiere_aprobacion')::boolean, false),
        COALESCE((p_payload->>'solo_chicas')::boolean, false),
        COALESCE((p_payload->>'solo_amigos')::boolean, false),
        COALESCE((p_payload->>'modo_privado')::boolean, false),
        false,
        false
    )
    RETURNING * INTO v_plan;

    INSERT INTO public.participantes (plan_id, usuario_id, estado)
    VALUES (v_plan.id, v_uid, 'aceptado')
    ON CONFLICT DO NOTHING;

    RETURN v_plan;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.current_user_banned()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT COALESCE(
        (SELECT p.baneado FROM public.perfiles p WHERE p.id = auth.uid()),
        false
    );
$function$
;

CREATE OR REPLACE FUNCTION public.day_start_madrid()
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
AS $function$
    SELECT date_trunc('day', now() AT TIME ZONE 'Europe/Madrid')
        AT TIME ZONE 'Europe/Madrid';
$function$
;

CREATE OR REPLACE FUNCTION public.delete_own_account()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    uid uuid := auth.uid();
BEGIN
    IF uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated';
    END IF;

    DELETE FROM auth.users WHERE id = uid;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_active_plan_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_max int := 3;
    v_is_creator boolean;
    v_count int;
BEGIN
    IF NEW.estado IS DISTINCT FROM 'aceptado' THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.estado IS NOT DISTINCT FROM 'aceptado' THEN
        RETURN NEW;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.planes
        WHERE id = NEW.plan_id AND creador_id = NEW.usuario_id
    ) INTO v_is_creator;

    IF v_is_creator THEN
        RETURN NEW;
    END IF;

    v_count := public.count_user_active_plans(NEW.usuario_id);
    IF v_count >= v_max THEN
        RAISE EXCEPTION 'active_plan_limit_reached'
            USING ERRCODE = 'P0001',
                  DETAIL = format('user %s already has %s active plans', NEW.usuario_id, v_count);
    END IF;

    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_block_daily_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_friend_request_daily_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_start timestamptz := public.day_start_madrid();
    v_count integer;
    v_uid uuid;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.estado IS DISTINCT FROM 'pendiente' THEN
            RETURN NEW;
        END IF;
        v_uid := NEW.usuario_origen_id;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Solo cuenta reenviar (p.ej. rechazado → pendiente)
        IF NOT (
            NEW.estado = 'pendiente'
            AND OLD.estado IS DISTINCT FROM 'pendiente'
        ) THEN
            RETURN NEW;
        END IF;
        v_uid := NEW.usuario_origen_id;
        NEW.creado_en := now();
    ELSE
        RETURN NEW;
    END IF;

    -- En INSERT la fila nueva aún no existe; en UPDATE excluimos la propia
    SELECT COUNT(*)::integer INTO v_count
    FROM public.amistades
    WHERE usuario_origen_id = v_uid
      AND creado_en >= v_start
      AND (TG_OP = 'INSERT' OR id <> NEW.id);

    IF v_count >= 20 THEN
        RAISE EXCEPTION 'friend_request_daily_limit'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_plan_join_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_plan public.planes%ROWTYPE;
    v_genero text;
    v_accepted int;
    v_max int;
    v_is_creator boolean;
    v_solo_chicas boolean;
BEGIN
    SELECT * INTO v_plan FROM public.planes WHERE id = NEW.plan_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'plan_not_found' USING ERRCODE = 'P0001';
    END IF;

    v_is_creator := v_plan.creador_id IS NOT DISTINCT FROM NEW.usuario_id;

    -- Solo chicas (flag o categoría legacy)
    v_solo_chicas := COALESCE(v_plan.solo_chicas, false)
        OR COALESCE(v_plan.categoria, '') = 'Solo chicas';

    IF v_solo_chicas AND NOT v_is_creator THEN
        SELECT genero INTO v_genero FROM public.perfiles WHERE id = NEW.usuario_id;
        IF v_genero IS DISTINCT FROM 'femenino' THEN
            RAISE EXCEPTION 'solo_chicas_only'
                USING ERRCODE = 'P0001',
                      DETAIL = 'only female users can join this plan';
        END IF;
    END IF;

    -- Privado: hace falta invitación (salvo creador). En INSERT; si ya eres participante (UPDATE) no aplica.
    IF COALESCE(v_plan.modo_privado, false) AND NOT v_is_creator AND TG_OP = 'INSERT' THEN
        IF NOT public.user_has_plan_invite(NEW.plan_id, NEW.usuario_id) THEN
            RAISE EXCEPTION 'plan_private_invite_required'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- Solo amigos (si no es privado): amigo o invitado
    IF COALESCE(v_plan.solo_amigos, false)
       AND NOT COALESCE(v_plan.modo_privado, false)
       AND NOT v_is_creator
       AND TG_OP = 'INSERT' THEN
        IF NOT public.users_are_friends(v_plan.creador_id, NEW.usuario_id)
           AND NOT public.user_has_plan_invite(NEW.plan_id, NEW.usuario_id) THEN
            RAISE EXCEPTION 'friends_only_plan'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- Cupo al pasar a aceptado
    IF NEW.estado IS NOT DISTINCT FROM 'aceptado' THEN
        IF TG_OP = 'UPDATE' AND OLD.estado IS NOT DISTINCT FROM 'aceptado' THEN
            RETURN NEW;
        END IF;

        v_max := v_plan.maximo_participantes;
        IF v_max IS NOT NULL THEN
            SELECT COUNT(*)::int INTO v_accepted
            FROM public.participantes
            WHERE plan_id = NEW.plan_id
              AND estado = 'aceptado'
              AND (TG_OP = 'INSERT' OR id IS DISTINCT FROM NEW.id);

            IF v_accepted >= v_max THEN
                RAISE EXCEPTION 'plan_full'
                    USING ERRCODE = 'P0001',
                          DETAIL = format('plan %s is full (%s/%s)', NEW.plan_id, v_accepted, v_max);
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_plan_report_daily_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_start timestamptz := public.day_start_madrid();
    v_count integer;
BEGIN
    SELECT COUNT(*)::integer INTO v_count
    FROM public.reportes_planes
    WHERE reportador_id = NEW.reportador_id
      AND creado_en >= v_start;

    IF v_count >= 2 THEN
        RAISE EXCEPTION 'plan_report_daily_limit'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_user_report_daily_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_start timestamptz := public.day_start_madrid();
    v_count integer;
BEGIN
    SELECT COUNT(*)::integer INTO v_count
    FROM public.reportes_usuarios
    WHERE reportador_id = NEW.reportador_id
      AND creado_en >= v_start;

    IF v_count >= 3 THEN
        RAISE EXCEPTION 'user_report_daily_limit'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.evaluar_insignias_usuario()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
r_requisito RECORD;
v_valor_usuario integer;
BEGIN
-- Buscar qué requisitos de insignias se han cumplido
FOR r_requisito IN
SELECT ri.insignia_id, ri.campo_evaluado, ri.valor_requerido
FROM public.requisitos_insignias ri
LOOP
IF r_requisito.campo_evaluado = 'numero_amistades' THEN
v_valor_usuario := NEW.numero_amistades;
ELSIF r_requisito.campo_evaluado = 'numero_planes_realizados' THEN
v_valor_usuario := NEW.numero_planes_realizados;
ELSE
v_valor_usuario := 0;
END IF;

-- Otorgar insignia si cumple el requisito de forma automática
IF v_valor_usuario >= r_requisito.valor_requerido THEN
INSERT INTO public.usuario_insignias (usuario_id, insignia_id)
VALUES (NEW.usuario_id, r_requisito.insignia_id)
ON CONFLICT (usuario_id, insignia_id) DO NOTHING;
END IF;
END LOOP;

RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_badge_stats(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'valoracionMedia', COALESCE(e.valoracion_media, 0),
    'porcentajeRepetiria', COALESCE(e.porcentaje_repetiria, 0),
    'porcentajeAsistencia', COALESCE(e.porcentaje_asistencia, 0),
    'numeroValoraciones', COALESCE(e.numero_valoraciones, 0),
    'numeroEvaluadoresDistintos', COALESCE(e.numero_evaluadores_distintos, 0),
    'numeroPlanesRealizados', COALESCE(e.numero_planes_realizados, 0),
    'numeroAmistades', COALESCE(e.numero_amistades, 0),
    'aspectoPositivoMasVotado', e.aspecto_positivo_mas_votado,
    'aspectoNegativoMasVotado', e.aspecto_negativo_mas_votado,
    'numeroExpulsiones', 0,
    'planesTapas', COALESCE(e.planes_tapas, 0),
    'planesDeporte', COALESCE(e.planes_deporte, 0),
    'planesFiesta', COALESCE(e.planes_fiesta, 0),
    'planesEstudio', COALESCE(e.planes_estudio, 0),
    'planesSoloChicas', COALESCE(e.planes_solo_chicas, 0),
    'categoriasProbadas', COALESCE(e.categorias_probadas, 0),
    'planesCreados', COALESCE(e.planes_creados, 0),
    'personasDistintas', COALESCE(e.personas_distintas, 0),
    'cuentaAntiguedadDias', COALESCE(
      GREATEST(
        0,
        FLOOR(EXTRACT(EPOCH FROM (now() - u.created_at)) / 86400)::int
      ),
      0
    )
  )
  FROM auth.users u
  LEFT JOIN public.estadisticas_usuario e ON e.usuario_id = u.id
  WHERE u.id = p_user_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_chat_summaries(p_plan_read_at jsonb DEFAULT '{}'::jsonb, p_direct_read_at jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(conversation_kind text, conversation_id uuid, title text, image_url text, category text, creator_id uuid, event_at timestamp with time zone, created_at timestamp with time zone, chat_deleted_at timestamp with time zone, last_content text, last_type text, last_at timestamp with time zone, last_sender_id uuid, last_sender_name text, unread_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    with caller as (
        select auth.uid() as user_id
        where auth.uid() is not null
    ),
    accessible_plan_ids as (
        select p.id
        from public.planes p
        cross join caller c
        where p.creador_id = c.user_id

        union

        select pa.plan_id
        from public.participantes pa
        cross join caller c
        where pa.usuario_id = c.user_id
          and pa.estado = 'aceptado'
    ),
    plan_rows as (
        select
            'plan'::text as conversation_kind,
            p.id as conversation_id,
            p.titulo::text as title,
            p.imagen_url::text as image_url,
            p.categoria::text as category,
            p.creador_id as creator_id,
            p.fecha_evento::timestamptz as event_at,
            p.creado_en::timestamptz as created_at,
            p.chat_eliminado_en::timestamptz as chat_deleted_at,
            latest.contenido::text as last_content,
            latest.tipo::text as last_type,
            latest.creado_en::timestamptz as last_at,
            latest.emisor_id as last_sender_id,
            sender.nombre::text as last_sender_name,
            coalesce(unread.total, 0)::bigint as unread_count
        from accessible_plan_ids access
        join public.planes p on p.id = access.id
        cross join caller c
        left join lateral (
            select m.contenido, m.tipo, m.creado_en, m.emisor_id
            from public.mensajes m
            where m.plan_id = p.id
            order by m.creado_en desc
            limit 1
        ) latest on true
        left join public.perfiles sender on sender.id = latest.emisor_id
        left join lateral (
            select count(*)::bigint as total
            from public.mensajes m
            where m.plan_id = p.id
              and m.emisor_id <> c.user_id
              and m.creado_en > coalesce(
                  nullif(p_plan_read_at ->> p.id::text, '')::timestamptz,
                  '1970-01-01 00:00:00+00'::timestamptz
              )
        ) unread on true
    ),
    direct_peer_ids as (
        select distinct peer_id
        from (
            select m.receptor_id as peer_id
            from public.mensajes m
            cross join caller c
            where m.plan_id is null
              and m.emisor_id = c.user_id
              and m.receptor_id is not null

            union all

            select m.emisor_id as peer_id
            from public.mensajes m
            cross join caller c
            where m.plan_id is null
              and m.receptor_id = c.user_id
        ) peers
        where peer_id is not null
    ),
    direct_rows as (
        select
            'direct'::text as conversation_kind,
            peers.peer_id as conversation_id,
            coalesce(profile.nombre, 'Usuario')::text as title,
            profile.avatar_url::text as image_url,
            null::text as category,
            null::uuid as creator_id,
            null::timestamptz as event_at,
            null::timestamptz as created_at,
            null::timestamptz as chat_deleted_at,
            latest.contenido::text as last_content,
            latest.tipo::text as last_type,
            latest.creado_en::timestamptz as last_at,
            latest.emisor_id as last_sender_id,
            sender.nombre::text as last_sender_name,
            coalesce(unread.total, 0)::bigint as unread_count
        from direct_peer_ids peers
        cross join caller c
        left join public.perfiles profile on profile.id = peers.peer_id
        left join public.chats_directos_ocultos hidden
          on hidden.usuario_id = c.user_id
         and hidden.peer_id = peers.peer_id
        left join lateral (
            select dm.contenido, dm.tipo, dm.creado_en, dm.emisor_id
            from (
                select m.contenido, m.tipo, m.creado_en, m.emisor_id
                from public.mensajes m
                where m.plan_id is null
                  and m.emisor_id = c.user_id
                  and m.receptor_id = peers.peer_id

                union all

                select m.contenido, m.tipo, m.creado_en, m.emisor_id
                from public.mensajes m
                where m.plan_id is null
                  and m.emisor_id = peers.peer_id
                  and m.receptor_id = c.user_id
            ) dm
            order by dm.creado_en desc
            limit 1
        ) latest on true
        left join public.perfiles sender on sender.id = latest.emisor_id
        left join lateral (
            select count(*)::bigint as total
            from public.mensajes m
            where m.plan_id is null
              and m.emisor_id = peers.peer_id
              and m.receptor_id = c.user_id
              and m.creado_en > coalesce(
                  nullif(p_direct_read_at ->> peers.peer_id::text, '')::timestamptz,
                  '1970-01-01 00:00:00+00'::timestamptz
              )
        ) unread on true
        where hidden.peer_id is null
           or latest.creado_en > hidden.oculto_en
    )
    select combined.*
    from (
        select * from plan_rows
        union all
        select * from direct_rows
    ) combined
    order by coalesce(
        combined.last_at,
        combined.created_at,
        '1970-01-01 00:00:00+00'::timestamptz
    ) desc;
$function$
;

CREATE OR REPLACE FUNCTION public.get_due_push_outbox_event_ids(p_limit integer DEFAULT 25)
 RETURNS TABLE(id uuid)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select o.id
      from public.push_notification_outbox o
     where o.available_at <= now()
       and o.attempts < 8
       and (
           o.status in ('pending', 'failed')
           or (
               o.status = 'processing'
               and o.processing_started_at < now() - interval '5 minutes'
           )
       )
     order by o.created_at asc
     limit least(greatest(coalesce(p_limit, 25), 1), 100);
$function$
;

CREATE OR REPLACE FUNCTION public.get_login_email_by_username(p_username text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT u.email
  FROM public.perfiles p
  JOIN auth.users u ON u.id = p.id
  WHERE lower(btrim(p.nombre_usuario)) = lower(btrim(p_username))
    AND btrim(p_username) <> ''
  LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_public_stats(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'valoracion_media', COALESCE(e.valoracion_media, 0),
    'porcentaje_repetiria', COALESCE(e.porcentaje_repetiria, 0),
    'porcentaje_asistencia', COALESCE(e.porcentaje_asistencia, 0),
    'numero_valoraciones', COALESCE(e.numero_valoraciones, 0),
    'numero_evaluadores_distintos', COALESCE(e.numero_evaluadores_distintos, 0),
    'numero_planes_realizados', COALESCE(e.numero_planes_realizados, 0),
    'numero_amistades', COALESCE(e.numero_amistades, 0),
    'aspecto_positivo_mas_votado', e.aspecto_positivo_mas_votado,
    'aspecto_negativo_mas_votado', e.aspecto_negativo_mas_votado
  )
  FROM (SELECT p_user_id AS id) u
  LEFT JOIN public.estadisticas_usuario e ON e.usuario_id = u.id;
$function$
;

CREATE OR REPLACE FUNCTION public.guardar_valoracion(p_plan_id uuid, p_evaluado_id uuid, p_asistencia boolean, p_puntuacion_general integer DEFAULT NULL::integer, p_repetiria_experiencia text DEFAULT NULL::text, p_aspectos_positivos jsonb DEFAULT '[]'::jsonb, p_aspectos_negativos jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_uid uuid := auth.uid();
    v_pos text[];
    v_neg text[];
    v_asistencia boolean;
    v_score integer;
    v_rep text;
    v_existing uuid;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
    END IF;
    IF p_plan_id IS NULL OR p_evaluado_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_params');
    END IF;
    IF v_uid = p_evaluado_id THEN
        RETURN jsonb_build_object('ok', false, 'error', 'self_rating');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.planes WHERE id = p_plan_id) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'plan_not_found');
    END IF;

    SELECT COALESCE(
        ARRAY(
            SELECT DISTINCT x
            FROM jsonb_array_elements_text(COALESCE(p_aspectos_positivos, '[]'::jsonb)) AS t(x)
            WHERE x = ANY (ARRAY['agradable','puntual','respetuoso','cercano','divertido','social'])
            LIMIT 2
        ),
        '{}'::text[]
    ) INTO v_pos;

    SELECT COALESCE(
        ARRAY(
            SELECT DISTINCT x
            FROM jsonb_array_elements_text(COALESCE(p_aspectos_negativos, '[]'::jsonb)) AS t(x)
            WHERE x = ANY (ARRAY['impuntual','irrespetuoso','frio','poco_participativo','incomodo'])
            LIMIT 2
        ),
        '{}'::text[]
    ) INTO v_neg;

    v_asistencia := COALESCE(p_asistencia, true);

    IF v_asistencia THEN
        v_score := p_puntuacion_general;
        v_rep := p_repetiria_experiencia;
        IF v_score IS NULL OR v_score < 1 OR v_score > 5 THEN
            RETURN jsonb_build_object('ok', false, 'error', 'incomplete_rating');
        END IF;
        IF v_rep IS NULL OR v_rep NOT IN ('si', 'no', 'indiferente') THEN
            RETURN jsonb_build_object('ok', false, 'error', 'incomplete_rating');
        END IF;
    ELSE
        v_score := NULL;
        v_rep := NULL;
        v_pos := '{}';
        v_neg := '{}';
    END IF;

    SELECT id INTO v_existing
    FROM public.valoraciones
    WHERE plan_id = p_plan_id
      AND evaluador_id = v_uid
      AND evaluado_id = p_evaluado_id
    LIMIT 1;

    BEGIN
        IF v_existing IS NOT NULL THEN
            UPDATE public.valoraciones SET
                asistencia = v_asistencia,
                puntuacion_general = v_score,
                repetiria_experiencia = v_rep,
                aspectos_positivos = v_pos,
                aspectos_negativos = v_neg,
                actualizado_en = now()
            WHERE id = v_existing;
        ELSE
            INSERT INTO public.valoraciones (
                plan_id,
                evaluador_id,
                evaluado_id,
                asistencia,
                puntuacion_general,
                repetiria_experiencia,
                aspectos_positivos,
                aspectos_negativos,
                motivos_seguridad,
                incidencia_seguridad
            ) VALUES (
                p_plan_id,
                v_uid,
                p_evaluado_id,
                v_asistencia,
                v_score,
                v_rep,
                v_pos,
                v_neg,
                '{}'::text[],
                false
            );
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
    END;

    RETURN jsonb_build_object('ok', true);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    display_name text;
BEGIN
    display_name := COALESCE(
        NULLIF(TRIM(NEW.raw_user_meta_data->>'nombre'), ''),
        NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
        NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
        NULLIF(TRIM(split_part(NEW.email, '@', 1)), ''),
        'Usuario'
    );

    INSERT INTO public.perfiles (id, nombre, registro_completado)
    VALUES (NEW.id, display_name, false)
    ON CONFLICT (id) DO UPDATE
        SET nombre = EXCLUDED.nombre
        WHERE public.perfiles.nombre IS NULL
           OR TRIM(public.perfiles.nombre) = ''
           OR public.perfiles.nombre = 'Usuario';

    INSERT INTO public.estadisticas_usuario (usuario_id)
    VALUES (NEW.id)
    ON CONFLICT (usuario_id) DO NOTHING;

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        -- Nunca bloqueamos el alta en Auth: la app reintenta con
        -- ensureProfile() tras el login.
        RAISE LOG 'handle_new_user error for %: %', NEW.id, SQLERRM;
        RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_nuevo_usuario()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  insert into public.perfiles (id, nombre, avatar_url, tags)
  values (
    new.id, 
    coalesce(new.raw_user_meta_data->>'nombre', 'Usuario'), 
    null,
    array[]::text[]
  );
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.invoke_push_outbox_dispatcher()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_project_url text;
    v_function_base_url text;
    v_publishable_key text;
    v_dispatch_secret text;
begin
    select decrypted_secret
      into v_project_url
      from vault.decrypted_secrets
     where name = 'nexo_project_url'
     limit 1;

    select decrypted_secret
      into v_publishable_key
      from vault.decrypted_secrets
     where name = 'nexo_publishable_key'
     limit 1;

    select decrypted_secret
      into v_dispatch_secret
      from vault.decrypted_secrets
     where name = 'nexo_dispatch_secret'
     limit 1;

    if nullif(trim(v_project_url), '') is null
       or nullif(trim(v_publishable_key), '') is null
       or nullif(trim(v_dispatch_secret), '') is null then
        raise warning 'NEXO push dispatcher: faltan secretos en Vault';
        return;
    end if;

    -- Data API puede mostrar la URL con /rest/v1. Normalizamos cualquier
    -- endpoint de Supabase a la raíz del proyecto antes de llamar a Functions.
    v_function_base_url := regexp_replace(
        rtrim(trim(v_project_url), '/'),
        '/(rest|auth|storage|functions)/v1(/.*)?$',
        ''
    );

    perform net.http_post(
        url := v_function_base_url || '/functions/v1/dispatch-push-outbox',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'apikey', v_publishable_key,
            'x-nexo-dispatch-secret', v_dispatch_secret
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
    );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_email_taken(check_email text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM auth.users
        WHERE lower(email) = lower(btrim(check_email))
          AND btrim(check_email) <> ''
    );
$function$
;

CREATE OR REPLACE FUNCTION public.is_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.perfiles p
        WHERE p.id = auth.uid()
          AND p.rol = 'owner'
          AND COALESCE(p.baneado, false) = false
    );
$function$
;

CREATE OR REPLACE FUNCTION public.is_requesting_user_active()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    select
        auth.uid() is not null
        and coalesce(
            (
                select p.baneado is not true
                from public.perfiles as p
                where p.id = auth.uid()
            ),
            true
        );
$function$
;

CREATE OR REPLACE FUNCTION public.is_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.perfiles p
        WHERE p.id = auth.uid()
          AND p.rol IN ('admin', 'owner')
          AND COALESCE(p.baneado, false) = false
    );
$function$
;

CREATE OR REPLACE FUNCTION public.is_username_taken(check_name text, exclude_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.perfiles
        WHERE lower(nombre_usuario) = lower(btrim(check_name))
          AND btrim(check_name) <> ''
          AND (exclude_id IS NULL OR id <> exclude_id)
    );
$function$
;

CREATE OR REPLACE FUNCTION public.nombre_usuario_ya_tomado(check_name text, exclude_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$SELECT EXISTS (
        SELECT 1
        FROM public.perfiles
        WHERE lower(trim(nombre)) = lower(trim(check_name))
          AND trim(check_name) <> ''
          AND (exclude_id IS NULL OR id <> exclude_id)
    );$function$
;

CREATE OR REPLACE FUNCTION public.not_banned()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT auth.uid() IS NOT NULL AND NOT public.current_user_banned();
$function$
;

CREATE OR REPLACE FUNCTION public.on_amistad_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM public.recalcular_numero_amistades(NEW.usuario_origen_id);
        PERFORM public.recalcular_numero_amistades(NEW.usuario_destino_id);
    END IF;
    IF TG_OP IN ('DELETE', 'UPDATE') THEN
        PERFORM public.recalcular_numero_amistades(OLD.usuario_origen_id);
        PERFORM public.recalcular_numero_amistades(OLD.usuario_destino_id);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.on_historial_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_usuario uuid := COALESCE(NEW.usuario_id, OLD.usuario_id);
BEGIN
    PERFORM public.recalcular_badge_categorias(v_usuario);
    RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.on_participante_badge_stats()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_plan_id uuid := COALESCE(NEW.plan_id, OLD.plan_id);
    v_user uuid;
BEGIN
    FOR v_user IN
        SELECT DISTINCT usuario_id
        FROM public.participantes
        WHERE plan_id = v_plan_id
          AND estado = 'aceptado'
    LOOP
        PERFORM public.recalcular_personas_distintas(v_user);
    END LOOP;

    IF TG_OP IN ('DELETE', 'UPDATE') AND OLD.estado = 'aceptado' THEN
        PERFORM public.recalcular_personas_distintas(OLD.usuario_id);
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.on_plan_creador_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM public.recalcular_planes_creados(NEW.creador_id);
    END IF;
    IF TG_OP IN ('DELETE', 'UPDATE') THEN
        PERFORM public.recalcular_planes_creados(OLD.creador_id);
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.creador_id IS DISTINCT FROM OLD.creador_id THEN
        PERFORM public.recalcular_planes_creados(NEW.creador_id);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.on_valoracion_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    BEGIN
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            PERFORM public.recalcular_estadisticas_valoraciones(NEW.evaluado_id);
        END IF;
        IF TG_OP IN ('DELETE', 'UPDATE') THEN
            PERFORM public.recalcular_estadisticas_valoraciones(OLD.evaluado_id);
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'recalcular_estadisticas_valoraciones failed: %', SQLERRM;
    END;
    RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.plan_is_feed_public(p_plan_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.planes pl
    WHERE pl.id = p_plan_id
      AND COALESCE(pl.is_direct_chat, false) = false
      AND COALESCE(pl.is_group_chat, false) = false
      AND COALESCE(pl.category, '') NOT IN ('Chat', 'Grupo')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.procesar_lista_espera()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_plan_tipo_aprobacion BOOLEAN;
    v_plan_fecha_evento TIMESTAMPTZ; -- Tu columna real
    v_siguiente_usuario UUID;
BEGIN
    -- Comprobamos si alguien abandona su plaza
    IF (TG_OP = 'DELETE') OR (TG_OP = 'UPDATE' AND OLD.estado = 'aceptado' AND NEW.estado != 'aceptado') THEN
        
        -- Sacamos la configuración y la fecha del evento
        SELECT requiere_aprobacion, fecha_evento 
        INTO v_plan_tipo_aprobacion, v_plan_fecha_evento
        FROM planes
        WHERE id = OLD.plan_id;

        -- LA REGLA DE ORO: Solo procesamos si faltan más de 2 horas para el evento
        IF v_plan_fecha_evento > (NOW() + INTERVAL '2 hours') THEN
            
            -- Buscamos al más antiguo de la lista de espera
            SELECT usuario_id INTO v_siguiente_usuario
            FROM participantes
            WHERE plan_id = OLD.plan_id AND estado = 'en_espera'
            ORDER BY created_at ASC
            LIMIT 1;

            -- Si hay alguien esperando, actuamos según el tipo de plan
            IF v_siguiente_usuario IS NOT NULL THEN
                IF v_plan_tipo_aprobacion = TRUE THEN
                    UPDATE participantes SET estado = 'pendiente' WHERE usuario_id = v_siguiente_usuario AND plan_id = OLD.plan_id;
                ELSE
                    UPDATE participantes SET estado = 'aceptado' WHERE usuario_id = v_siguiente_usuario AND plan_id = OLD.plan_id;
                END IF;
            END IF;

        END IF; -- Fin de la comprobación de tiempo
    END IF;
    
    RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.promote_waitlist(p_plan_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_max_spots int;
    v_count int;
    v_next_id uuid;
    v_next_user uuid;
    v_tried uuid[] := ARRAY[]::uuid[];
    v_user_active int;
    v_max_active int := 3;
BEGIN
    SELECT maximo_participantes INTO v_max_spots FROM public.planes WHERE id = p_plan_id;
    IF v_max_spots IS NULL THEN
        RETURN;
    END IF;

    SELECT COUNT(*)::int INTO v_count
    FROM public.participantes
    WHERE plan_id = p_plan_id AND estado = 'aceptado';

    IF v_count >= v_max_spots THEN
        RETURN;
    END IF;

    LOOP
        SELECT p.id, p.usuario_id
        INTO v_next_id, v_next_user
        FROM public.participantes p
        WHERE p.plan_id = p_plan_id
          AND p.estado = 'lista_espera'
          AND NOT (p.id = ANY (v_tried))
        ORDER BY COALESCE(p.creado_en, p.created_at) ASC NULLS LAST
        LIMIT 1;

        EXIT WHEN v_next_id IS NULL;

        v_user_active := public.count_user_active_plans(v_next_user);
        IF v_user_active >= v_max_active THEN
            v_tried := array_append(v_tried, v_next_id);
            CONTINUE;
        END IF;

        UPDATE public.participantes
        SET estado = 'aceptado'
        WHERE id = v_next_id;

        EXIT;
    END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.protect_account_control_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
    if current_user in ('authenticated', 'anon') then
        if tg_op = 'INSERT' then
            if new.rol is not null and new.rol <> 'user' then
                raise exception 'No está permitido asignar el rol de la cuenta'
                    using errcode = '42501';
            end if;
            if new.baneado is true or new.baneado_motivo is not null then
                raise exception 'No está permitido modificar el bloqueo de la cuenta'
                    using errcode = '42501';
            end if;
        elsif
            new.rol is distinct from old.rol
            or new.baneado is distinct from old.baneado
            or new.baneado_motivo is distinct from old.baneado_motivo
        then
            raise exception 'No está permitido modificar los controles de la cuenta'
                using errcode = '42501';
        end if;
    end if;

    return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.protect_mensajes_soporte_cols()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF TG_OP = 'UPDATE' AND NOT public.is_staff() THEN
        NEW.estado := OLD.estado;
        NEW.notas_internas := OLD.notas_internas;
        NEW.revisado_en := OLD.revisado_en;
        NEW.revisado_por := OLD.revisado_por;
        NEW.usuario_id := OLD.usuario_id;
        NEW.tipo := OLD.tipo;
    END IF;
    NEW.actualizado_en := now();
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.protect_perfiles_moderation_cols()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.rol IS DISTINCT FROM OLD.rol
           OR NEW.baneado IS DISTINCT FROM OLD.baneado
           OR NEW.baneado_en IS DISTINCT FROM OLD.baneado_en
           OR NEW.baneado_motivo IS DISTINCT FROM OLD.baneado_motivo
        THEN
            -- SQL Editor / service role: auth.uid() es NULL → permitir
            IF auth.uid() IS NULL THEN
                RETURN NEW;
            END IF;

            IF NOT public.is_owner() THEN
                NEW.rol := OLD.rol;
                NEW.baneado := OLD.baneado;
                NEW.baneado_en := OLD.baneado_en;
                NEW.baneado_motivo := OLD.baneado_motivo;
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.protect_username_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    recent timestamptz[];
    next_allowed timestamptz;
    days_left numeric;
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.nombre_usuario IS DISTINCT FROM OLD.nombre_usuario
    THEN
        IF OLD.nombre_usuario IS NULL OR btrim(OLD.nombre_usuario) = '' THEN
            NEW.nombre_usuario_cambiado_en := OLD.nombre_usuario_cambiado_en;
            NEW.nombre_usuario_cambios := coalesce(OLD.nombre_usuario_cambios, '{}'::timestamptz[]);
            RETURN NEW;
        END IF;

        SELECT coalesce(array_agg(t ORDER BY t), '{}'::timestamptz[])
        INTO recent
        FROM unnest(coalesce(OLD.nombre_usuario_cambios, '{}'::timestamptz[])) AS t
        WHERE t > now() - interval '7 days';

        IF coalesce(cardinality(recent), 0) >= 2
           AND current_setting('app.username_change_ok', true) IS DISTINCT FROM '1'
        THEN
            next_allowed := recent[1] + interval '7 days';
            days_left := ceil(EXTRACT(EPOCH FROM (next_allowed - now())) / 86400.0);
            RAISE EXCEPTION 'username_cooldown:%', greatest(1, days_left::int);
        END IF;

        IF current_setting('app.username_change_ok', true) IS DISTINCT FROM '1' THEN
            NEW.nombre_usuario_cambios := recent || ARRAY[now()];
            NEW.nombre_usuario_cambiado_en := now();
        END IF;
    END IF;
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.purge_expired_plan_chats()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    r record;
    n integer := 0;
BEGIN
    PERFORM public.archive_all_ended_plans();

    FOR r IN
        SELECT id FROM public.planes
        WHERE fecha_evento IS NOT NULL
          AND fecha_evento + interval '24 hours' <= now()
          AND chat_eliminado_en IS NULL
          AND COALESCE(categoria, '') NOT IN ('Grupo', 'Chat')
    LOOP
        DELETE FROM public.mensajes WHERE plan_id = r.id;
        DELETE FROM public.invitaciones_planes WHERE plan_id = r.id;
        DELETE FROM public.planes_guardados WHERE plan_id = r.id;
        UPDATE public.planes
        SET chat_eliminado_en = now(),
            finalizado_en = COALESCE(finalizado_en, now())
        WHERE id = r.id;
        n := n + 1;
    END LOOP;
    RETURN n;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.purge_past_saved_plans()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    n integer := 0;
BEGIN
    WITH deleted AS (
        DELETE FROM public.planes_guardados pg
        USING public.planes p
        WHERE pg.plan_id = p.id
          AND p.fecha_evento IS NOT NULL
          AND p.fecha_evento <= now()
        RETURNING pg.plan_id
    )
    SELECT COUNT(*)::integer INTO n FROM deleted;
    RETURN COALESCE(n, 0);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.queue_plan_join_decision_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
    v_actor_id uuid := auth.uid();
    v_creator_id uuid;
    v_plan_title text;
    v_event_type text;
    v_recipient_id uuid;
    v_participant_id text;
begin
    if old.estado is distinct from 'pendiente' then
        if tg_op = 'DELETE' then
            return old;
        end if;
        return new;
    end if;

    select p.creador_id, coalesce(nullif(trim(p.titulo), ''), 'el plan')
      into v_creator_id, v_plan_title
      from public.planes p
     where p.id = old.plan_id;

    -- Solo una decisión realizada por el creador puede generar este evento.
    if v_actor_id is null or v_creator_id is null or v_actor_id <> v_creator_id then
        if tg_op = 'DELETE' then
            return old;
        end if;
        return new;
    end if;

    if tg_op = 'DELETE' then
        v_event_type := 'plan_join_rejected';
    elsif new.estado = 'aceptado' then
        v_event_type := 'plan_join_accepted';
    elsif new.estado = 'rechazado' then
        v_event_type := 'plan_join_rejected';
    else
        return new;
    end if;

    v_recipient_id := old.usuario_id;
    v_participant_id := old.id::text;

    insert into public.push_notification_outbox (
        event_key,
        event_type,
        recipient_id,
        actor_id,
        plan_id,
        plan_title
    )
    values (
        'plan-join:' || v_participant_id || ':' || v_event_type,
        v_event_type,
        v_recipient_id,
        v_actor_id,
        old.plan_id,
        v_plan_title
    )
    on conflict (event_key) do nothing;

    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.recalcular_badge_categorias(p_usuario uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_tapas integer := 0;
    v_deporte integer := 0;
    v_fiesta integer := 0;
    v_estudio integer := 0;
    v_solo_chicas integer := 0;
    v_categorias integer := 0;
    v_planes integer := 0;
BEGIN
    INSERT INTO public.estadisticas_usuario (usuario_id)
    VALUES (p_usuario)
    ON CONFLICT (usuario_id) DO NOTHING;

    SELECT
        COUNT(*) FILTER (WHERE p.categoria = 'Tapas'),
        COUNT(*) FILTER (WHERE p.categoria = 'Deporte'),
        COUNT(*) FILTER (WHERE p.categoria = 'Fiesta'),
        COUNT(*) FILTER (WHERE p.categoria = 'Estudio'),
        COUNT(*) FILTER (WHERE p.solo_chicas = true OR p.categoria = 'Solo chicas'),
        COUNT(DISTINCT p.categoria) FILTER (
            WHERE p.categoria IN ('Tapas', 'Fiesta', 'Deporte', 'Estudio', 'Solo chicas')
        ),
        COUNT(*)
    INTO v_tapas, v_deporte, v_fiesta, v_estudio, v_solo_chicas, v_categorias, v_planes
    FROM public.historial_planes hp
    JOIN public.planes p ON p.id = hp.plan_id
    WHERE hp.usuario_id = p_usuario;

    UPDATE public.estadisticas_usuario SET
        planes_tapas          = v_tapas,
        planes_deporte        = v_deporte,
        planes_fiesta         = v_fiesta,
        planes_estudio        = v_estudio,
        planes_solo_chicas    = v_solo_chicas,
        categorias_probadas   = v_categorias,
        numero_planes_realizados = v_planes,
        actualizado_en        = now()
    WHERE usuario_id = p_usuario;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recalcular_estadisticas_usuario(p_usuario_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
v_valoracion_media numeric(3,2);
v_porcentaje_repetiria numeric(5,2);
v_numero_valoraciones integer;
v_numero_asistencias integer;
v_numero_reportes integer;

v_aspecto_positivo text;
v_votos_positivo integer;

v_aspecto_negativo text;
v_votos_negativo integer;
begin
-- Solo cuentan para la puntuación las valoraciones que
-- confirman que la persona asistió.
select
coalesce(round(avg(v.puntuacion_general)::numeric, 2), 0),
coalesce(
round(
(
count(*) filter (
where v.repetiria_experiencia = 'si'
)::numeric
/
nullif(
count(*) filter (
where v.repetiria_experiencia is not null
),
0
)
) * 100,
2
),
0
),
count(*) filter (
where v.asistencia = true
)::integer,
count(*) filter (
where v.asistencia = true
)::integer,
count(*) filter (
where v.incidencia_seguridad = true
)::integer
into
v_valoracion_media,
v_porcentaje_repetiria,
v_numero_valoraciones,
v_numero_asistencias,
v_numero_reportes
from public.valoraciones v
where v.evaluado_id = p_usuario_id;

-- Aspecto positivo más votado.
-- En caso de empate se utiliza el orden alfabético
-- para que el resultado sea estable.
select
votos.aspecto,
votos.total
into
v_aspecto_positivo,
v_votos_positivo
from (
select
aspecto,
count(*)::integer as total
from public.valoraciones v
cross join lateral unnest(v.aspectos_positivos) as aspecto
where v.evaluado_id = p_usuario_id
and v.asistencia = true
group by aspecto
order by total desc, aspecto asc
limit 1
) as votos;

-- Aspecto negativo más votado.
select
votos.aspecto,
votos.total
into
v_aspecto_negativo,
v_votos_negativo
from (
select
aspecto,
count(*)::integer as total
from public.valoraciones v
cross join lateral unnest(v.aspectos_negativos) as aspecto
where v.evaluado_id = p_usuario_id
and v.asistencia = true
group by aspecto
order by total desc, aspecto asc
limit 1
) as votos;

insert into public.estadisticas_usuario (
usuario_id,
valoracion_media,
porcentaje_repetiria,
numero_valoraciones,
numero_asistencias_confirmadas,
aspecto_positivo_mas_votado,
votos_aspecto_positivo,
aspecto_negativo_mas_votado,
votos_aspecto_negativo,
numero_reportes,
actualizado_en
)
values (
p_usuario_id,
coalesce(v_valoracion_media, 0),
coalesce(v_porcentaje_repetiria, 0),
coalesce(v_numero_valoraciones, 0),
coalesce(v_numero_asistencias, 0),
v_aspecto_positivo,
coalesce(v_votos_positivo, 0),
v_aspecto_negativo,
coalesce(v_votos_negativo, 0),
coalesce(v_numero_reportes, 0),
now()
)
on conflict (usuario_id)
do update set
valoracion_media =
excluded.valoracion_media,

porcentaje_repetiria =
excluded.porcentaje_repetiria,

numero_valoraciones =
excluded.numero_valoraciones,

numero_asistencias_confirmadas =
excluded.numero_asistencias_confirmadas,

aspecto_positivo_mas_votado =
excluded.aspecto_positivo_mas_votado,

votos_aspecto_positivo =
excluded.votos_aspecto_positivo,

aspecto_negativo_mas_votado =
excluded.aspecto_negativo_mas_votado,

votos_aspecto_negativo =
excluded.votos_aspecto_negativo,

numero_reportes =
excluded.numero_reportes,

actualizado_en = now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.recalcular_estadisticas_valoraciones(p_usuario uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_media numeric;
    v_total integer;
    v_repetiria numeric;
    v_asistencias integer;
    v_asistencia_total integer;
    v_asistencia_pct numeric;
    v_evaluadores integer;
    v_pos text;
    v_pos_votos integer;
    v_neg text;
    v_neg_votos integer;
    v_con_negativo integer;
BEGIN
    INSERT INTO public.estadisticas_usuario (usuario_id)
    VALUES (p_usuario)
    ON CONFLICT (usuario_id) DO NOTHING;

    SELECT COALESCE(ROUND(AVG(puntuacion_general)::numeric, 2), 0),
           COUNT(*) FILTER (WHERE puntuacion_general IS NOT NULL),
           -- Solo si / no (indiferente no entra en el denominador)
           COALESCE(ROUND(
               100.0 * COUNT(*) FILTER (WHERE repetiria_experiencia = 'si')
               / NULLIF(COUNT(*) FILTER (WHERE repetiria_experiencia IN ('si', 'no')), 0)
           , 2), 0),
           COUNT(*) FILTER (WHERE asistencia = true),
           COUNT(*) FILTER (WHERE asistencia IS NOT NULL),
           COUNT(DISTINCT evaluador_id),
           COUNT(*) FILTER (
               WHERE COALESCE(cardinality(aspectos_negativos), 0) > 0
           )
      INTO v_media, v_total, v_repetiria, v_asistencias, v_asistencia_total, v_evaluadores, v_con_negativo
      FROM public.valoraciones
     WHERE evaluado_id = p_usuario;

    v_asistencia_pct := COALESCE(ROUND(
        100.0 * v_asistencias / NULLIF(v_asistencia_total, 0)
    , 2), 0);

    SELECT a, c INTO v_pos, v_pos_votos FROM (
        SELECT unnest(aspectos_positivos) AS a, COUNT(*) AS c
          FROM public.valoraciones
         WHERE evaluado_id = p_usuario
         GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1
    ) s;

    -- Solo mostrar negativo si hay ≥5 valoraciones y ≥20% eligieron alguno
    IF v_total >= 5 AND (100.0 * v_con_negativo / v_total) >= 20 THEN
        SELECT a, c INTO v_neg, v_neg_votos FROM (
            SELECT unnest(aspectos_negativos) AS a, COUNT(*) AS c
              FROM public.valoraciones
             WHERE evaluado_id = p_usuario
               AND COALESCE(cardinality(aspectos_negativos), 0) > 0
             GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1
        ) s;
    ELSE
        v_neg := NULL;
        v_neg_votos := 0;
    END IF;

    UPDATE public.estadisticas_usuario SET
        valoracion_media               = LEAST(5, GREATEST(0, v_media)),
        numero_valoraciones            = v_total,
        porcentaje_repetiria           = v_repetiria,
        numero_asistencias_confirmadas = v_asistencias,
        porcentaje_asistencia          = v_asistencia_pct,
        numero_evaluadores_distintos   = v_evaluadores,
        aspecto_positivo_mas_votado    = v_pos,
        votos_aspecto_positivo         = COALESCE(v_pos_votos, 0),
        aspecto_negativo_mas_votado    = v_neg,
        votos_aspecto_negativo         = COALESCE(v_neg_votos, 0),
        actualizado_en                 = now()
    WHERE usuario_id = p_usuario;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recalcular_numero_amistades(p_usuario uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    INSERT INTO public.estadisticas_usuario (usuario_id)
    VALUES (p_usuario)
    ON CONFLICT (usuario_id) DO NOTHING;

    UPDATE public.estadisticas_usuario SET
        numero_amistades = (
            SELECT COUNT(*) FROM public.amistades
             WHERE estado = 'aceptado'
               AND (usuario_origen_id = p_usuario OR usuario_destino_id = p_usuario)
        ),
        actualizado_en = now()
    WHERE usuario_id = p_usuario;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recalcular_personas_distintas(p_usuario uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_count integer := 0;
BEGIN
    IF p_usuario IS NULL THEN
        RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.perfiles WHERE id = p_usuario) THEN
        RETURN;
    END IF;

    INSERT INTO public.estadisticas_usuario (usuario_id)
    VALUES (p_usuario)
    ON CONFLICT (usuario_id) DO NOTHING;

    SELECT COUNT(DISTINCT p2.usuario_id)::integer INTO v_count
    FROM public.participantes p1
    JOIN public.participantes p2 ON p1.plan_id = p2.plan_id
    WHERE p1.usuario_id = p_usuario
      AND p1.estado = 'aceptado'
      AND p2.estado = 'aceptado'
      AND p2.usuario_id <> p_usuario;

    UPDATE public.estadisticas_usuario SET
        personas_distintas = v_count,
        actualizado_en = now()
    WHERE usuario_id = p_usuario;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recalcular_planes_creados(p_usuario uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_count integer := 0;
BEGIN
    INSERT INTO public.estadisticas_usuario (usuario_id)
    VALUES (p_usuario)
    ON CONFLICT (usuario_id) DO NOTHING;

    SELECT COUNT(*)::integer INTO v_count
    FROM public.planes
    WHERE creador_id = p_usuario
      AND categoria IN ('Tapas', 'Fiesta', 'Deporte', 'Estudio', 'Solo chicas');

    UPDATE public.estadisticas_usuario SET
        planes_creados = v_count,
        actualizado_en = now()
    WHERE usuario_id = p_usuario;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reject_if_banned()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF public.current_user_banned() THEN
        RAISE EXCEPTION 'account_banned'
            USING ERRCODE = 'P0001',
                  HINT = 'Esta cuenta está suspendida.';
    END IF;
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.touch_actualizado_en()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.actualizado_en := now();
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.tr_amistades_estadisticas()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
IF (TG_OP = 'DELETE') THEN
PERFORM public.actualizar_estadisticas_usuario(OLD.usuario_origen_id);
PERFORM public.actualizar_estadisticas_usuario(OLD.usuario_destino_id);
RETURN OLD;
ELSE
PERFORM public.actualizar_estadisticas_usuario(NEW.usuario_origen_id);
PERFORM public.actualizar_estadisticas_usuario(NEW.usuario_destino_id);
RETURN NEW;
END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.tr_participantes_estadisticas()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
IF (TG_OP = 'DELETE') THEN
PERFORM public.actualizar_estadisticas_usuario(OLD.usuario_id);
RETURN OLD;
ELSE
PERFORM public.actualizar_estadisticas_usuario(NEW.usuario_id);
RETURN NEW;
END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.tr_planes_estadisticas()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
r_participante RECORD;
BEGIN
IF (OLD.estado != 'finalizado' AND NEW.estado = 'finalizado') THEN
FOR r_participante IN
SELECT usuario_id FROM public.participantes WHERE plan_id = NEW.id AND estado = 'aceptado'
LOOP
PERFORM public.actualizar_estadisticas_usuario(r_participante.usuario_id);
END LOOP;
END IF;
RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.tr_registrar_en_historial()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- Solo cuando el estado cambia a 'finalizado'
  IF (OLD.estado != 'finalizado' AND NEW.estado = 'finalizado') THEN
    INSERT INTO public.historial_planes (usuario_id, plan_id, titulo_plan, fecha_evento_original)
    SELECT usuario_id, NEW.id, NEW.titulo, NEW.fecha_evento
    FROM public.participantes
    WHERE plan_id = NEW.id AND estado = 'aceptado';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.tr_valoraciones_estadisticas()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
IF (TG_OP = 'DELETE') THEN
PERFORM public.actualizar_estadisticas_usuario(OLD.evaluado_id);
RETURN OLD;
ELSE
PERFORM public.actualizar_estadisticas_usuario(NEW.evaluado_id);
RETURN NEW;
END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.user_can_view_plan(p_plan_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_plan public.planes%ROWTYPE;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN false;
    END IF;

    SELECT * INTO v_plan FROM public.planes WHERE id = p_plan_id;
    IF NOT FOUND THEN
        RETURN false;
    END IF;

    -- Chats directos / grupos: solo miembros (o creador)
    IF COALESCE(v_plan.is_direct_chat, false) OR COALESCE(v_plan.is_group_chat, false) THEN
        RETURN v_plan.creador_id = p_user_id
            OR EXISTS (
                SELECT 1 FROM public.participantes p
                WHERE p.plan_id = p_plan_id AND p.usuario_id = p_user_id
            );
    END IF;

    IF v_plan.creador_id = p_user_id THEN
        RETURN true;
    END IF;

    -- Owner: ve todos los planes de meetup para moderar
    IF EXISTS (
        SELECT 1 FROM public.perfiles pf
        WHERE pf.id = p_user_id
          AND pf.rol = 'owner'
          AND COALESCE(pf.baneado, false) = false
    ) THEN
        RETURN true;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.participantes p
        WHERE p.plan_id = p_plan_id AND p.usuario_id = p_user_id
    ) THEN
        RETURN true;
    END IF;

    IF public.user_has_plan_invite(p_plan_id, p_user_id) THEN
        RETURN true;
    END IF;

    IF COALESCE(v_plan.modo_privado, false) THEN
        RETURN false;
    END IF;

    IF COALESCE(v_plan.solo_amigos, false) THEN
        RETURN public.users_are_friends(v_plan.creador_id, p_user_id);
    END IF;

    RETURN true;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.user_has_plan_invite(p_plan_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF to_regclass('public.invitaciones_planes') IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.invitaciones_planes inv
            WHERE inv.plan_id = p_plan_id
              AND inv.invitado_id = p_user_id
              AND inv.estado = 'pendiente'
        ) THEN
            RETURN true;
        END IF;
    END IF;

    IF to_regclass('public.plan_invitaciones') IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.plan_invitaciones inv
            WHERE inv.plan_id = p_plan_id
              AND inv.invitado_id = p_user_id
              AND inv.estado = 'pendiente'
        ) THEN
            RETURN true;
        END IF;
    END IF;

    RETURN false;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.users_are_friends(a uuid, b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.amistades am
        WHERE am.estado = 'aceptado'
          AND (
              (am.usuario_origen_id = a AND am.usuario_destino_id = b)
              OR (am.usuario_origen_id = b AND am.usuario_destino_id = a)
          )
    );
$function$
;

CREATE OR REPLACE FUNCTION public.usuario_es_miembro_del_plan(p_plan_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$SELECT EXISTS (
    SELECT 1 FROM public.participantes p
    WHERE p.plan_id = p_plan_id AND p.usuario_id = auth.uid()
  );$function$
;

CREATE OR REPLACE FUNCTION public.usuario_pertenece_al_plan(p_plan_id uuid, p_usuario_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
select exists (
select 1
from public.planes p
where p.id = p_plan_id
and p.creador_id = p_usuario_id
)
or exists (
select 1
from public.participantes pa
where pa.plan_id = p_plan_id
and pa.usuario_id = p_usuario_id
and pa.estado::text = 'aceptado'
);
$function$
;

CREATE OR REPLACE FUNCTION public.validar_valoracion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
-- Solo integrantes confirmados del plan pueden valorar.
if not public.usuario_pertenece_al_plan(
new.plan_id,
new.evaluador_id
) then
raise exception
'El evaluador no pertenece al plan o no tiene participación aceptada.';
end if;

-- Solo se puede valorar a integrantes confirmados.
if not public.usuario_pertenece_al_plan(
new.plan_id,
new.evaluado_id
) then
raise exception
'La persona evaluada no pertenece al plan o no tiene participación aceptada.';
end if;

-- Normalización defensiva.
new.aspectos_positivos :=
coalesce(new.aspectos_positivos, '{}'::text[]);

new.aspectos_negativos :=
coalesce(new.aspectos_negativos, '{}'::text[]);

new.motivos_seguridad :=
coalesce(new.motivos_seguridad, '{}'::text[]);

new.actualizado_en := now();

return new;
end;
$function$
;

-- ---------------------------------------------------------------------------
-- CHECKS AND FOREIGN KEYS
-- ---------------------------------------------------------------------------

alter table only public.ai_search_usage add constraint ai_search_usage_request_count_check CHECK (request_count >= 0);

alter table only public.ai_search_usage add constraint ai_search_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table only public.amistades add constraint amistades_no_autoamistad CHECK (usuario_origen_id <> usuario_destino_id);

alter table only public.amistades add constraint amistades_destino_fkey FOREIGN KEY (usuario_destino_id) REFERENCES perfiles(id) ON DELETE CASCADE;

alter table only public.amistades add constraint amistades_origen_fkey FOREIGN KEY (usuario_origen_id) REFERENCES perfiles(id) ON DELETE CASCADE;

alter table only public.analytics_events add constraint analytics_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table only public.bloqueos add constraint check_no_autobloqueo CHECK (bloqueador_id <> bloqueado_id);

alter table only public.bloqueos add constraint bloqueos_bloqueado_fk FOREIGN KEY (bloqueado_id) REFERENCES perfiles(id) ON DELETE CASCADE;

alter table only public.bloqueos add constraint bloqueos_bloqueador_fk FOREIGN KEY (bloqueador_id) REFERENCES perfiles(id) ON DELETE CASCADE;

alter table only public.chats_directos_ocultos add constraint chats_directos_ocultos_no_self CHECK (usuario_id <> peer_id);

alter table only public.chats_directos_ocultos add constraint chats_directos_ocultos_peer_id_fkey FOREIGN KEY (peer_id) REFERENCES perfiles(id) ON DELETE CASCADE;

alter table only public.chats_directos_ocultos add constraint chats_directos_ocultos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES perfiles(id) ON DELETE CASCADE;

alter table only public.estadisticas_usuario add constraint estadisticas_contadores_no_negativos_check CHECK (numero_valoraciones >= 0 AND numero_asistencias_confirmadas >= 0 AND numero_planes_realizados >= 0 AND numero_amistades >= 0 AND numero_reportes >= 0 AND votos_aspecto_positivo >= 0 AND votos_aspecto_negativo >= 0);

alter table only public.estadisticas_usuario add constraint estadisticas_porcentaje_repetiria_check CHECK (porcentaje_repetiria >= 0::numeric AND porcentaje_repetiria <= 100::numeric);

alter table only public.estadisticas_usuario add constraint estadisticas_valoracion_media_check CHECK (valoracion_media >= 0::numeric AND valoracion_media <= 5::numeric);

alter table only public.estadisticas_usuario add constraint estadisticas_usuario_fk FOREIGN KEY (usuario_id) REFERENCES perfiles(id) ON DELETE CASCADE;

alter table only public.expulsiones_plan add constraint expulsiones_plan_expulsado_por_fkey FOREIGN KEY (expulsado_por) REFERENCES perfiles(id) ON DELETE CASCADE;

alter table only public.expulsiones_plan add constraint expulsiones_plan_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES planes(id) ON DELETE CASCADE;

alter table only public.expulsiones_plan add constraint expulsiones_plan_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES perfiles(id) ON DELETE CASCADE;

alter table only public.historial_planes add constraint historial_planes_plan_fkey FOREIGN KEY (plan_id) REFERENCES planes(id) ON DELETE CASCADE;

alter table only public.historial_planes add constraint historial_planes_usuario_fkey FOREIGN KEY (usuario_id) REFERENCES perfiles(id) ON DELETE CASCADE;

alter table only public.invitaciones_planes add constraint inv_planes_no_autoinvitacion CHECK (invitador_id <> invitado_id);

alter table only public.invitaciones_planes add constraint invitaciones_planes_tipo_check CHECK (tipo = ANY (ARRAY['plan'::text, 'grupo'::text]));

alter table only public.invitaciones_planes add constraint inv_planes_invitado_fkey FOREIGN KEY (invitado_id) REFERENCES perfiles(id) ON DELETE CASCADE;

alter table only public.invitaciones_planes add constraint inv_planes_invitador_fkey FOREIGN KEY (invitador_id) REFERENCES perfiles(id) ON DELETE CASCADE;

alter table only public.invitaciones_planes add constraint inv_planes_plan_fkey FOREIGN KEY (plan_id) REFERENCES planes(id) ON DELETE CASCADE;

alter table only public.mensaje_reacciones add constraint mensaje_reacciones_mensaje_id_fkey FOREIGN KEY (mensaje_id) REFERENCES mensajes(id) ON DELETE CASCADE;

alter table only public.mensaje_reacciones add constraint mensaje_reacciones_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table only public.mensajes add constraint mensajes_emisor_fkey FOREIGN KEY (emisor_id) REFERENCES perfiles(id) ON DELETE CASCADE;

alter table only public.mensajes add constraint mensajes_plan_fkey FOREIGN KEY (plan_id) REFERENCES planes(id) ON DELETE CASCADE;

alter table only public.mensajes add constraint mensajes_receptor_fkey FOREIGN KEY (receptor_id) REFERENCES perfiles(id) ON DELETE SET NULL;

alter table only public.mensajes_soporte add constraint mensajes_soporte_estado_check CHECK (estado = ANY (ARRAY['abierto'::text, 'en_revision'::text, 'resuelto'::text, 'descartado'::text]));

alter table only public.mensajes_soporte add constraint mensajes_soporte_tipo_check CHECK (tipo = ANY (ARRAY['contacto'::text, 'problema'::text, 'idea'::text, 'denuncia_general'::text]));

alter table only public.mensajes_soporte add constraint mensajes_soporte_revisado_por_fkey FOREIGN KEY (revisado_por) REFERENCES perfiles(id) ON DELETE SET NULL;

alter table only public.mensajes_soporte add constraint mensajes_soporte_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES perfiles(id) ON DELETE CASCADE;

alter table only public.participantes add constraint participantes_estado_check CHECK (estado = ANY (ARRAY['aceptado'::tipo_estado_participante, 'pendiente'::tipo_estado_participante, 'lista_espera'::tipo_estado_participante]));

alter table only public.participantes add constraint participantes_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES planes(id) ON DELETE CASCADE;

alter table only public.participantes add constraint participantes_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES perfiles(id) ON DELETE CASCADE;

alter table only public.perfiles add constraint perfiles_fecha_nacimiento_check CHECK (fecha_nacimiento <= (CURRENT_DATE - '18 years'::interval));

alter table only public.perfiles add constraint perfiles_nombre_usuario_check CHECK (length(nombre_usuario) >= 3 AND length(nombre_usuario) <= 20);

alter table only public.perfiles add constraint perfiles_rol_check CHECK (rol = ANY (ARRAY['user'::text, 'admin'::text, 'owner'::text]));

alter table only public.perfiles add constraint perfiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table only public.plan_invitaciones add constraint check_no_auto_invitacion CHECK (invitador_id <> invitado_id);

alter table only public.plan_invitaciones add constraint plan_invitaciones_estado_check CHECK (estado = ANY (ARRAY['pendiente'::text, 'aceptado'::text, 'rechazado'::text]));

alter table only public.plan_invitaciones add constraint plan_invitaciones_tipo_check CHECK (tipo = ANY (ARRAY['plan'::text, 'grupo'::text]));

alter table only public.planes add constraint planes_maximo_participantes_check CHECK (maximo_participantes > 0);

alter table only public.planes add constraint planes_min_max_participantes_check CHECK (minimo_participantes >= 2 AND maximo_participantes >= minimo_participantes);

alter table only public.planes add constraint planes_creador_id_fkey FOREIGN KEY (creador_id) REFERENCES perfiles(id) ON DELETE CASCADE;

alter table only public.planes_guardados add constraint planes_guardados_plan_fkey FOREIGN KEY (plan_id) REFERENCES planes(id) ON DELETE CASCADE;

alter table only public.planes_guardados add constraint planes_guardados_usuario_fkey FOREIGN KEY (usuario_id) REFERENCES perfiles(id) ON DELETE CASCADE;

alter table only public.push_chat_mutes add constraint push_chat_mutes_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES planes(id) ON DELETE CASCADE;

alter table only public.push_chat_mutes add constraint push_chat_mutes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table only public.push_dispatch_usage add constraint push_dispatch_usage_request_count_check CHECK (request_count >= 0);

alter table only public.push_dispatch_usage add constraint push_dispatch_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table only public.push_message_deliveries add constraint push_message_deliveries_attempts_check CHECK (attempts >= 1);

alter table only public.push_message_deliveries add constraint push_message_deliveries_status_check CHECK (status = ANY (ARRAY['processing'::text, 'accepted'::text, 'failed'::text]));

alter table only public.push_message_deliveries add constraint push_message_deliveries_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table only public.push_message_dispatches add constraint push_message_dispatches_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table only public.push_notification_outbox add constraint push_notification_outbox_attempts_check CHECK (attempts >= 0);

alter table only public.push_notification_outbox add constraint push_notification_outbox_event_type_check CHECK (event_type = ANY (ARRAY['plan_join_accepted'::text, 'plan_join_rejected'::text]));

alter table only public.push_notification_outbox add constraint push_notification_outbox_status_check CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'sent'::text, 'failed'::text]));

alter table only public.push_notification_outbox add constraint push_notification_outbox_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table only public.push_notification_outbox add constraint push_notification_outbox_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table only public.push_tokens add constraint push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table only public.reportes_planes add constraint reportes_planes_estado_check CHECK (estado = ANY (ARRAY['abierto'::text, 'en_revision'::text, 'resuelto'::text, 'descartado'::text]));

alter table only public.reportes_planes add constraint reportes_planes_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES planes(id) ON DELETE SET NULL;

alter table only public.reportes_planes add constraint reportes_planes_reportador_id_fkey FOREIGN KEY (reportador_id) REFERENCES perfiles(id) ON DELETE CASCADE;

alter table only public.reportes_planes add constraint reportes_planes_revisado_por_fkey FOREIGN KEY (revisado_por) REFERENCES perfiles(id) ON DELETE SET NULL;

alter table only public.reportes_usuarios add constraint reportes_usuarios_estado_check CHECK (estado = ANY (ARRAY['abierto'::text, 'en_revision'::text, 'resuelto'::text, 'descartado'::text]));

alter table only public.reportes_usuarios add constraint reportes_usuarios_denunciado_id_fkey FOREIGN KEY (denunciado_id) REFERENCES perfiles(id) ON DELETE CASCADE;

alter table only public.reportes_usuarios add constraint reportes_usuarios_reportador_id_fkey FOREIGN KEY (reportador_id) REFERENCES perfiles(id) ON DELETE CASCADE;

alter table only public.reportes_usuarios add constraint reportes_usuarios_revisado_por_fkey FOREIGN KEY (revisado_por) REFERENCES perfiles(id) ON DELETE SET NULL;

alter table only public.valoraciones add constraint val_no_autoevaluacion CHECK (evaluador_id <> evaluado_id);

alter table only public.valoraciones add constraint valoraciones_aspectos_negativos_check CHECK (cardinality(COALESCE(aspectos_negativos, '{}'::text[])) <= 2 AND COALESCE(aspectos_negativos, '{}'::text[]) <@ ARRAY['impuntual'::text, 'irrespetuoso'::text, 'frio'::text, 'poco_participativo'::text, 'incomodo'::text]);

alter table only public.valoraciones add constraint valoraciones_aspectos_positivos_check CHECK (cardinality(COALESCE(aspectos_positivos, '{}'::text[])) <= 2 AND COALESCE(aspectos_positivos, '{}'::text[]) <@ ARRAY['agradable'::text, 'puntual'::text, 'respetuoso'::text, 'cercano'::text, 'divertido'::text, 'social'::text]);

alter table only public.valoraciones add constraint valoraciones_evaluador_evaluado_distintos CHECK (evaluador_id <> evaluado_id);

alter table only public.valoraciones add constraint valoraciones_motivos_seguridad_check CHECK (cardinality(motivos_seguridad) <= 1 AND motivos_seguridad <@ ARRAY['fue_irrespetuoso'::text, 'informacion_falsa_perfil'::text, 'hizo_sentir_incomodo'::text, 'otro'::text] AND array_text_sin_duplicados(motivos_seguridad));

alter table only public.valoraciones add constraint valoraciones_repetiria_check CHECK (repetiria_experiencia IS NULL OR (repetiria_experiencia = ANY (ARRAY['si'::text, 'indiferente'::text, 'no'::text])));

alter table only public.valoraciones add constraint valoraciones_respuestas_coherentes_check CHECK (asistencia IS NOT NULL AND (asistencia = true AND puntuacion_general >= 1 AND puntuacion_general <= 5 AND repetiria_experiencia IS NOT NULL OR asistencia = false AND puntuacion_general IS NULL AND repetiria_experiencia IS NULL AND cardinality(aspectos_positivos) = 0 AND cardinality(aspectos_negativos) = 0) AND (incidencia_seguridad = false AND cardinality(motivos_seguridad) = 0 AND detalle_otro_seguridad IS NULL OR incidencia_seguridad = true AND cardinality(motivos_seguridad) = 1 AND (motivos_seguridad[1] = 'otro'::text AND NULLIF(TRIM(BOTH FROM detalle_otro_seguridad), ''::text) IS NOT NULL OR motivos_seguridad[1] <> 'otro'::text AND detalle_otro_seguridad IS NULL)));

alter table only public.valoraciones add constraint val_evaluado_fk FOREIGN KEY (evaluado_id) REFERENCES perfiles(id) ON DELETE CASCADE;

alter table only public.valoraciones add constraint val_evaluador_fk FOREIGN KEY (evaluador_id) REFERENCES perfiles(id) ON DELETE CASCADE;

alter table only public.valoraciones add constraint val_plan_fk FOREIGN KEY (plan_id) REFERENCES planes(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------

CREATE INDEX idx_amistades_origen_creado ON public.amistades USING btree (usuario_origen_id, creado_en DESC);

CREATE INDEX analytics_events_created_idx ON public.analytics_events USING btree (created_at DESC);

CREATE INDEX analytics_events_name_idx ON public.analytics_events USING btree (event_name);

CREATE INDEX idx_bloqueos_bloqueador_creado ON public.bloqueos USING btree (bloqueador_id, creado_en DESC);

CREATE INDEX idx_chats_directos_ocultos_usuario ON public.chats_directos_ocultos USING btree (usuario_id);

CREATE INDEX idx_expulsiones_usuario ON public.expulsiones_plan USING btree (usuario_id);

CREATE INDEX idx_historial_usuario ON public.historial_planes USING btree (usuario_id);

CREATE INDEX mensaje_reacciones_mensaje_idx ON public.mensaje_reacciones USING btree (mensaje_id);

CREATE INDEX idx_mensajes_plan ON public.mensajes USING btree (plan_id);

CREATE INDEX mensajes_directos_emisor_receptor_ultimo_idx ON public.mensajes USING btree (emisor_id, receptor_id, creado_en DESC) WHERE ((plan_id IS NULL) AND (receptor_id IS NOT NULL));

CREATE INDEX mensajes_directos_receptor_emisor_ultimo_idx ON public.mensajes USING btree (receptor_id, emisor_id, creado_en DESC) WHERE ((plan_id IS NULL) AND (receptor_id IS NOT NULL));

CREATE INDEX mensajes_plan_ultimo_idx ON public.mensajes USING btree (plan_id, creado_en DESC) WHERE (plan_id IS NOT NULL);

CREATE INDEX idx_mensajes_soporte_estado ON public.mensajes_soporte USING btree (estado, creado_en DESC);

CREATE INDEX idx_mensajes_soporte_usuario ON public.mensajes_soporte USING btree (usuario_id, creado_en DESC);

CREATE INDEX idx_participantes_plan ON public.participantes USING btree (plan_id, estado);

CREATE INDEX idx_participantes_plan_usuario_estado ON public.participantes USING btree (plan_id, usuario_id, estado);

CREATE INDEX idx_participantes_waitlist ON public.participantes USING btree (plan_id, estado, created_at);

CREATE INDEX idx_perfiles_baneado ON public.perfiles USING btree (baneado) WHERE (baneado = true);

CREATE INDEX idx_perfiles_rol ON public.perfiles USING btree (rol) WHERE (rol = ANY (ARRAY['admin'::text, 'owner'::text]));

CREATE UNIQUE INDEX perfiles_nombre_usuario_lower_unique ON public.perfiles USING btree (lower(nombre_usuario)) WHERE ((nombre_usuario IS NOT NULL) AND (btrim(nombre_usuario) <> ''::text));

CREATE INDEX idx_plan_invitaciones_invitado ON public.plan_invitaciones USING btree (invitado_id, estado);

CREATE INDEX idx_planes_categoria_estado ON public.planes USING btree (categoria, estado);

CREATE INDEX idx_planes_coordenadas ON public.planes USING btree (latitud, longitud);

CREATE INDEX idx_planes_fecha_evento ON public.planes USING btree (fecha_evento);

CREATE INDEX idx_planes_solo_chicas ON public.planes USING btree (solo_chicas) WHERE (solo_chicas = true);

CREATE INDEX push_chat_mutes_plan_id_idx ON public.push_chat_mutes USING btree (plan_id);

CREATE INDEX push_message_deliveries_sender_idx ON public.push_message_deliveries USING btree (sender_id, updated_at DESC);

CREATE INDEX push_message_dispatches_sender_idx ON public.push_message_dispatches USING btree (sender_id, dispatched_at DESC);

CREATE INDEX push_notification_outbox_pending_idx ON public.push_notification_outbox USING btree (status, available_at, created_at);

CREATE INDEX push_tokens_user_id_idx ON public.push_tokens USING btree (user_id);

CREATE INDEX idx_reportes_planes_estado ON public.reportes_planes USING btree (estado, creado_en DESC);

CREATE INDEX idx_reportes_planes_reportador_creado ON public.reportes_planes USING btree (reportador_id, creado_en DESC);

CREATE INDEX idx_reportes_usuarios_estado ON public.reportes_usuarios USING btree (estado, creado_en DESC);

CREATE INDEX idx_reportes_usuarios_reportador_creado ON public.reportes_usuarios USING btree (reportador_id, creado_en DESC);

CREATE INDEX idx_valoraciones_evaluado ON public.valoraciones USING btree (evaluado_id);

CREATE INDEX idx_valoraciones_evaluado_asistencia ON public.valoraciones USING btree (evaluado_id, asistencia);

CREATE INDEX idx_valoraciones_evaluador ON public.valoraciones USING btree (evaluador_id);

CREATE INDEX idx_valoraciones_evaluador_plan ON public.valoraciones USING btree (evaluador_id, plan_id);

CREATE INDEX idx_valoraciones_plan ON public.valoraciones USING btree (plan_id);

-- ---------------------------------------------------------------------------
-- COMMENTS
-- ---------------------------------------------------------------------------

comment on column perfiles.notificaciones_push is 'Si false, no se envían push a este usuario (el cliente también deja de registrar token).';

comment on column perfiles.notif_messages is 'Chats de plan y DMs.';

comment on column perfiles.notif_social is 'Amistades, uniones, invitaciones, valoraciones recibidas.';

comment on column perfiles.notif_reminders is 'Recordatorios locales (cliente). Columna reservada / coherencia de prefs.';

comment on column planes.solo_amigos is 'Si true, el plan solo aparece en el feed a amigos del creador (y participantes/invitados).';

comment on column planes.modo_privado is 'Si true, el plan solo aparece a invitados y participantes (no en el feed público).';

-- ---------------------------------------------------------------------------
-- TRIGGERS
-- ---------------------------------------------------------------------------

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();

CREATE TRIGGER trg_amistades_stats AFTER INSERT OR DELETE OR UPDATE ON amistades FOR EACH ROW EXECUTE FUNCTION on_amistad_change();

CREATE TRIGGER trg_friend_request_daily_limit BEFORE INSERT OR UPDATE OF estado ON amistades FOR EACH ROW EXECUTE FUNCTION enforce_friend_request_daily_limit();

CREATE TRIGGER trg_reject_if_banned BEFORE INSERT OR UPDATE ON amistades FOR EACH ROW EXECUTE FUNCTION reject_if_banned();

CREATE TRIGGER trg_touch_amistades BEFORE UPDATE ON amistades FOR EACH ROW EXECUTE FUNCTION touch_actualizado_en();

CREATE TRIGGER trg_block_daily_limit BEFORE INSERT ON bloqueos FOR EACH ROW EXECUTE FUNCTION enforce_block_daily_limit();

CREATE TRIGGER trg_reject_if_banned BEFORE INSERT OR UPDATE ON expulsiones_plan FOR EACH ROW EXECUTE FUNCTION reject_if_banned();

CREATE TRIGGER trg_historial_stats AFTER INSERT OR DELETE ON historial_planes FOR EACH ROW EXECUTE FUNCTION on_historial_change();

CREATE TRIGGER trg_reject_if_banned BEFORE INSERT OR UPDATE ON historial_planes FOR EACH ROW EXECUTE FUNCTION reject_if_banned();

CREATE TRIGGER trg_reject_if_banned BEFORE INSERT OR UPDATE ON invitaciones_planes FOR EACH ROW EXECUTE FUNCTION reject_if_banned();

CREATE TRIGGER trg_reject_if_banned BEFORE INSERT OR UPDATE ON mensajes FOR EACH ROW EXECUTE FUNCTION reject_if_banned();

CREATE TRIGGER trg_protect_mensajes_soporte BEFORE UPDATE ON mensajes_soporte FOR EACH ROW EXECUTE FUNCTION protect_mensajes_soporte_cols();

CREATE TRIGGER trg_reject_if_banned BEFORE INSERT OR UPDATE ON mensajes_soporte FOR EACH ROW EXECUTE FUNCTION reject_if_banned();

CREATE TRIGGER queue_plan_join_decision_push_delete AFTER DELETE ON participantes FOR EACH ROW EXECUTE FUNCTION queue_plan_join_decision_push();

CREATE TRIGGER queue_plan_join_decision_push_update AFTER UPDATE OF estado ON participantes FOR EACH ROW WHEN (old.estado IS DISTINCT FROM new.estado) EXECUTE FUNCTION queue_plan_join_decision_push();

CREATE TRIGGER trg_enforce_active_plan_limit BEFORE INSERT OR UPDATE OF estado ON participantes FOR EACH ROW EXECUTE FUNCTION enforce_active_plan_limit();

CREATE TRIGGER trg_enforce_plan_join_rules BEFORE INSERT OR UPDATE OF estado ON participantes FOR EACH ROW EXECUTE FUNCTION enforce_plan_join_rules();

CREATE TRIGGER trg_participantes_badge_stats AFTER INSERT OR DELETE OR UPDATE OF estado, plan_id, usuario_id ON participantes FOR EACH ROW EXECUTE FUNCTION on_participante_badge_stats();

CREATE TRIGGER trg_reject_if_banned BEFORE INSERT OR UPDATE ON participantes FOR EACH ROW EXECUTE FUNCTION reject_if_banned();

CREATE TRIGGER trg_touch_participantes BEFORE UPDATE ON participantes FOR EACH ROW EXECUTE FUNCTION touch_actualizado_en();

CREATE TRIGGER trigger_revisar_espera AFTER DELETE OR UPDATE ON participantes FOR EACH ROW EXECUTE FUNCTION procesar_lista_espera();

CREATE TRIGGER protect_account_control_columns_trigger BEFORE INSERT OR UPDATE ON perfiles FOR EACH ROW EXECUTE FUNCTION protect_account_control_columns();

CREATE TRIGGER trg_protect_perfiles_moderation BEFORE UPDATE ON perfiles FOR EACH ROW EXECUTE FUNCTION protect_perfiles_moderation_cols();

CREATE TRIGGER trg_protect_username_change BEFORE UPDATE OF nombre_usuario ON perfiles FOR EACH ROW EXECUTE FUNCTION protect_username_change();

CREATE TRIGGER trg_reject_if_banned BEFORE INSERT OR UPDATE ON perfiles FOR EACH ROW EXECUTE FUNCTION reject_if_banned();

CREATE TRIGGER trg_touch_perfiles BEFORE UPDATE ON perfiles FOR EACH ROW EXECUTE FUNCTION touch_actualizado_en();

CREATE TRIGGER trg_planes_creados_stats AFTER INSERT OR DELETE OR UPDATE OF creador_id, categoria ON planes FOR EACH ROW EXECUTE FUNCTION on_plan_creador_change();

CREATE TRIGGER trg_reject_if_banned BEFORE INSERT OR UPDATE ON planes FOR EACH ROW EXECUTE FUNCTION reject_if_banned();

CREATE TRIGGER trg_touch_planes BEFORE UPDATE ON planes FOR EACH ROW EXECUTE FUNCTION touch_actualizado_en();

CREATE TRIGGER trg_reject_if_banned BEFORE INSERT OR UPDATE ON planes_guardados FOR EACH ROW EXECUTE FUNCTION reject_if_banned();

CREATE TRIGGER trg_plan_report_daily_limit BEFORE INSERT ON reportes_planes FOR EACH ROW EXECUTE FUNCTION enforce_plan_report_daily_limit();

CREATE TRIGGER trg_reject_if_banned BEFORE INSERT OR UPDATE ON reportes_planes FOR EACH ROW EXECUTE FUNCTION reject_if_banned();

CREATE TRIGGER trg_reject_if_banned BEFORE INSERT OR UPDATE ON reportes_usuarios FOR EACH ROW EXECUTE FUNCTION reject_if_banned();

CREATE TRIGGER trg_user_report_daily_limit BEFORE INSERT ON reportes_usuarios FOR EACH ROW EXECUTE FUNCTION enforce_user_report_daily_limit();

CREATE TRIGGER trg_reject_if_banned BEFORE INSERT OR UPDATE ON valoraciones FOR EACH ROW EXECUTE FUNCTION reject_if_banned();

CREATE TRIGGER trg_touch_valoraciones BEFORE UPDATE ON valoraciones FOR EACH ROW EXECUTE FUNCTION touch_actualizado_en();

CREATE TRIGGER trg_valoraciones_stats AFTER INSERT OR DELETE OR UPDATE ON valoraciones FOR EACH ROW EXECUTE FUNCTION on_valoracion_change();

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------

alter table public.ai_search_usage enable row level security;

alter table public.amistades enable row level security;

alter table public.analytics_events enable row level security;

alter table public.bloqueos enable row level security;

alter table public.chats_directos_ocultos enable row level security;

alter table public.estadisticas_usuario enable row level security;

alter table public.expulsiones_plan enable row level security;

alter table public.historial_planes enable row level security;

alter table public.invitaciones_planes enable row level security;

alter table public.mensaje_reacciones enable row level security;

alter table public.mensajes enable row level security;

alter table public.mensajes_soporte enable row level security;

alter table public.participantes enable row level security;

alter table public.perfiles enable row level security;

alter table public.plan_invitaciones enable row level security;

alter table public.planes enable row level security;

alter table public.planes_guardados enable row level security;

alter table public.push_chat_mutes enable row level security;

alter table public.push_dispatch_usage enable row level security;

alter table public.push_message_deliveries enable row level security;

alter table public.push_message_dispatches enable row level security;

alter table public.push_notification_outbox enable row level security;

alter table public.push_tokens enable row level security;

alter table public.reportes_planes enable row level security;

alter table public.reportes_usuarios enable row level security;

alter table public.valoraciones enable row level security;

-- ---------------------------------------------------------------------------
-- POLICIES
-- ---------------------------------------------------------------------------

create policy nexo_active_users_only on public.ai_search_usage as restrictive for all to authenticated using (is_requesting_user_active()) with check (is_requesting_user_active());

create policy amistades_delete on public.amistades as permissive for delete to authenticated using (((usuario_origen_id = auth.uid()) OR (usuario_destino_id = auth.uid())));

create policy amistades_insert on public.amistades as permissive for insert to authenticated with check ((usuario_origen_id = auth.uid()));

create policy amistades_select on public.amistades as permissive for select to authenticated using (((usuario_origen_id = auth.uid()) OR (usuario_destino_id = auth.uid())));

create policy amistades_update on public.amistades as permissive for update to authenticated using (((usuario_origen_id = auth.uid()) OR (usuario_destino_id = auth.uid()))) with check (((usuario_origen_id = auth.uid()) OR (usuario_destino_id = auth.uid())));

create policy nexo_active_users_only on public.amistades as restrictive for all to authenticated using (is_requesting_user_active()) with check (is_requesting_user_active());

create policy analytics_insert_own on public.analytics_events as permissive for insert to authenticated with check (((user_id IS NULL) OR (user_id = auth.uid())));

create policy analytics_select_staff on public.analytics_events as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM perfiles p
  WHERE ((p.id = auth.uid()) AND (p.rol = ANY (ARRAY['owner'::text, 'admin'::text])) AND (COALESCE(p.baneado, false) = false)))));

create policy nexo_active_users_only on public.analytics_events as restrictive for all to authenticated using (is_requesting_user_active()) with check (is_requesting_user_active());

create policy "Eliminar mis bloqueos" on public.bloqueos as permissive for delete to public using ((auth.uid() = bloqueador_id));

create policy "Insertar mis bloqueos" on public.bloqueos as permissive for insert to public with check ((auth.uid() = bloqueador_id));

create policy "Ver bloqueos propios" on public.bloqueos as permissive for select to public using ((auth.uid() = bloqueador_id));

create policy nexo_active_users_only on public.bloqueos as restrictive for all to authenticated using (is_requesting_user_active()) with check (is_requesting_user_active());

create policy chats_ocultos_delete_own on public.chats_directos_ocultos as permissive for delete to authenticated using ((usuario_id = auth.uid()));

create policy chats_ocultos_insert_own on public.chats_directos_ocultos as permissive for insert to authenticated with check ((usuario_id = auth.uid()));

create policy chats_ocultos_select_own on public.chats_directos_ocultos as permissive for select to authenticated using ((usuario_id = auth.uid()));

create policy chats_ocultos_update_own on public.chats_directos_ocultos as permissive for update to authenticated using ((usuario_id = auth.uid())) with check ((usuario_id = auth.uid()));

create policy nexo_active_users_only on public.chats_directos_ocultos as restrictive for all to authenticated using (is_requesting_user_active()) with check (is_requesting_user_active());

create policy estadisticas_select_autenticados on public.estadisticas_usuario as permissive for select to authenticated using (true);

create policy estadisticas_select_public on public.estadisticas_usuario as permissive for select to authenticated using (true);

create policy nexo_active_users_only on public.estadisticas_usuario as restrictive for all to authenticated using (is_requesting_user_active()) with check (is_requesting_user_active());

create policy expulsiones_insert_creator on public.expulsiones_plan as permissive for insert to authenticated with check (((expulsado_por = auth.uid()) AND (EXISTS ( SELECT 1
   FROM planes p
  WHERE ((p.id = expulsiones_plan.plan_id) AND (p.creador_id = auth.uid()))))));

create policy expulsiones_select_authenticated on public.expulsiones_plan as permissive for select to authenticated using (true);

create policy nexo_active_users_only on public.expulsiones_plan as restrictive for all to authenticated using (is_requesting_user_active()) with check (is_requesting_user_active());

create policy historial_insert_own on public.historial_planes as permissive for insert to authenticated with check ((usuario_id = auth.uid()));

create policy historial_select_own on public.historial_planes as permissive for select to authenticated using ((usuario_id = auth.uid()));

create policy nexo_active_users_only on public.historial_planes as restrictive for all to authenticated using (is_requesting_user_active()) with check (is_requesting_user_active());

create policy inv_planes_delete on public.invitaciones_planes as permissive for delete to authenticated using (((invitador_id = auth.uid()) OR (invitado_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM planes p
  WHERE ((p.id = invitaciones_planes.plan_id) AND (p.creador_id = auth.uid()))))));

create policy inv_planes_insert on public.invitaciones_planes as permissive for insert to authenticated with check ((invitador_id = auth.uid()));

create policy inv_planes_select on public.invitaciones_planes as permissive for select to authenticated using (((invitador_id = auth.uid()) OR (invitado_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM planes p
  WHERE ((p.id = invitaciones_planes.plan_id) AND (p.creador_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM participantes part
  WHERE ((part.plan_id = invitaciones_planes.plan_id) AND (part.usuario_id = auth.uid()) AND (part.estado = 'aceptado'::tipo_estado_participante))))));

create policy inv_planes_update on public.invitaciones_planes as permissive for update to authenticated using (((invitado_id = auth.uid()) OR (invitador_id = auth.uid()))) with check (((invitado_id = auth.uid()) OR (invitador_id = auth.uid())));

create policy nexo_active_users_only on public.invitaciones_planes as restrictive for all to authenticated using (is_requesting_user_active()) with check (is_requesting_user_active());

create policy nexo_active_users_only on public.mensaje_reacciones as restrictive for all to authenticated using (is_requesting_user_active()) with check (is_requesting_user_active());

create policy reacciones_delete_own on public.mensaje_reacciones as permissive for delete to authenticated using ((usuario_id = auth.uid()));

create policy reacciones_insert_own on public.mensaje_reacciones as permissive for insert to authenticated with check ((usuario_id = auth.uid()));

create policy reacciones_select on public.mensaje_reacciones as permissive for select to authenticated using (true);

create policy reacciones_update_own on public.mensaje_reacciones as permissive for update to authenticated using ((usuario_id = auth.uid())) with check ((usuario_id = auth.uid()));

create policy mensajes_delete on public.mensajes as permissive for delete to authenticated using (((emisor_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM planes p
  WHERE ((p.id = mensajes.plan_id) AND (p.creador_id = auth.uid()))))));

create policy mensajes_insert on public.mensajes as permissive for insert to authenticated with check (((emisor_id = auth.uid()) AND (((plan_id IS NULL) AND (receptor_id IS NOT NULL)) OR ((plan_id IS NOT NULL) AND ((EXISTS ( SELECT 1
   FROM participantes pa
  WHERE ((pa.plan_id = mensajes.plan_id) AND (pa.usuario_id = auth.uid()) AND (pa.estado = 'aceptado'::tipo_estado_participante)))) OR (EXISTS ( SELECT 1
   FROM planes p
  WHERE ((p.id = mensajes.plan_id) AND (p.creador_id = auth.uid())))))))));

create policy mensajes_select on public.mensajes as permissive for select to authenticated using (((emisor_id = auth.uid()) OR (receptor_id = auth.uid()) OR ((plan_id IS NOT NULL) AND ((EXISTS ( SELECT 1
   FROM participantes pa
  WHERE ((pa.plan_id = mensajes.plan_id) AND (pa.usuario_id = auth.uid()) AND (pa.estado = 'aceptado'::tipo_estado_participante)))) OR (EXISTS ( SELECT 1
   FROM planes p
  WHERE ((p.id = mensajes.plan_id) AND (p.creador_id = auth.uid()))))))));

create policy nexo_active_users_only on public.mensajes as restrictive for all to authenticated using (is_requesting_user_active()) with check (is_requesting_user_active());

create policy mensajes_soporte_delete_staff on public.mensajes_soporte as permissive for delete to authenticated using (is_staff());

create policy mensajes_soporte_insert_own on public.mensajes_soporte as permissive for insert to authenticated with check (((usuario_id = auth.uid()) AND not_banned()));

create policy mensajes_soporte_select_own on public.mensajes_soporte as permissive for select to authenticated using (((usuario_id = auth.uid()) OR is_staff()));

create policy mensajes_soporte_update_staff on public.mensajes_soporte as permissive for update to authenticated using (is_staff()) with check (is_staff());

create policy nexo_active_users_only on public.mensajes_soporte as restrictive for all to authenticated using (is_requesting_user_active()) with check (is_requesting_user_active());

create policy "Bloqueo union planes" on public.participantes as restrictive for insert to public with check ((NOT (EXISTS ( SELECT 1
   FROM (planes p
     JOIN bloqueos b ON ((((b.bloqueador_id = p.creador_id) AND (b.bloqueado_id = auth.uid())) OR ((b.bloqueador_id = auth.uid()) AND (b.bloqueado_id = p.creador_id)))))
  WHERE (p.id = participantes.plan_id)))));

create policy nexo_active_users_only on public.participantes as restrictive for all to authenticated using (is_requesting_user_active()) with check (is_requesting_user_active());

create policy participantes_delete on public.participantes as permissive for delete to authenticated using (((usuario_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM planes p
  WHERE ((p.id = participantes.plan_id) AND (p.creador_id = auth.uid()))))));

create policy participantes_insert_own on public.participantes as permissive for insert to authenticated with check ((usuario_id = auth.uid()));

create policy participantes_select on public.participantes as permissive for select to authenticated using (true);

create policy participantes_update on public.participantes as permissive for update to authenticated using (((usuario_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM planes p
  WHERE ((p.id = participantes.plan_id) AND (p.creador_id = auth.uid())))))) with check (((usuario_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM planes p
  WHERE ((p.id = participantes.plan_id) AND (p.creador_id = auth.uid()))))));

create policy nexo_active_profile_delete on public.perfiles as restrictive for delete to authenticated using (is_requesting_user_active());

create policy nexo_active_profile_insert on public.perfiles as restrictive for insert to authenticated with check ((is_requesting_user_active() AND (id = auth.uid())));

create policy nexo_active_profile_select on public.perfiles as restrictive for select to authenticated using ((is_requesting_user_active() OR (id = auth.uid())));

create policy nexo_active_profile_update on public.perfiles as restrictive for update to authenticated using (is_requesting_user_active()) with check (is_requesting_user_active());

create policy perfiles_delete_own on public.perfiles as permissive for delete to authenticated using ((id = auth.uid()));

create policy perfiles_insert_own on public.perfiles as permissive for insert to authenticated with check ((id = auth.uid()));

create policy perfiles_select on public.perfiles as permissive for select to authenticated using (true);

create policy perfiles_update_own on public.perfiles as permissive for update to authenticated using ((id = auth.uid())) with check ((id = auth.uid()));

create policy nexo_active_users_only on public.plan_invitaciones as restrictive for all to authenticated using (is_requesting_user_active()) with check (is_requesting_user_active());

create policy plan_invitaciones_select on public.plan_invitaciones as permissive for select to authenticated using (((invitador_id = auth.uid()) OR (invitado_id = auth.uid())));

create policy plan_invitaciones_update_invitado on public.plan_invitaciones as permissive for update to authenticated using ((invitado_id = auth.uid())) with check ((invitado_id = auth.uid()));

create policy "Ocultar planes bloqueados" on public.planes as restrictive for select to public using ((NOT (EXISTS ( SELECT 1
   FROM bloqueos b
  WHERE (((b.bloqueador_id = planes.creador_id) AND (b.bloqueado_id = auth.uid())) OR ((b.bloqueador_id = auth.uid()) AND (b.bloqueado_id = planes.creador_id)))))));

create policy nexo_active_users_only on public.planes as restrictive for all to authenticated using (is_requesting_user_active()) with check (is_requesting_user_active());

create policy planes_delete_own on public.planes as permissive for delete to authenticated using ((creador_id = auth.uid()));

create policy planes_insert_own on public.planes as permissive for insert to authenticated with check ((creador_id = auth.uid()));

create policy planes_select on public.planes as permissive for select to authenticated using (((creador_id = auth.uid()) OR user_can_view_plan(id, auth.uid())));

create policy planes_update_own on public.planes as permissive for update to authenticated using ((creador_id = auth.uid())) with check ((creador_id = auth.uid()));

create policy "Bloqueo guardar planes" on public.planes_guardados as restrictive for insert to public with check ((NOT (EXISTS ( SELECT 1
   FROM (planes p
     JOIN bloqueos b ON ((((b.bloqueador_id = p.creador_id) AND (b.bloqueado_id = auth.uid())) OR ((b.bloqueador_id = auth.uid()) AND (b.bloqueado_id = p.creador_id)))))
  WHERE (p.id = planes_guardados.plan_id)))));

create policy nexo_active_users_only on public.planes_guardados as restrictive for all to authenticated using (is_requesting_user_active()) with check (is_requesting_user_active());

create policy planes_guardados_delete_own on public.planes_guardados as permissive for delete to authenticated using ((usuario_id = auth.uid()));

create policy planes_guardados_insert_own on public.planes_guardados as permissive for insert to authenticated with check ((usuario_id = auth.uid()));

create policy planes_guardados_select_own on public.planes_guardados as permissive for select to authenticated using ((usuario_id = auth.uid()));

create policy nexo_active_users_only on public.push_chat_mutes as restrictive for all to authenticated using (is_requesting_user_active()) with check (is_requesting_user_active());

create policy push_chat_mutes_delete_own on public.push_chat_mutes as permissive for delete to public using ((auth.uid() = user_id));

create policy push_chat_mutes_insert_own on public.push_chat_mutes as permissive for insert to public with check ((auth.uid() = user_id));

create policy push_chat_mutes_select_own on public.push_chat_mutes as permissive for select to public using ((auth.uid() = user_id));

create policy nexo_active_users_only on public.push_dispatch_usage as restrictive for all to authenticated using (is_requesting_user_active()) with check (is_requesting_user_active());

create policy nexo_active_users_only on public.push_message_deliveries as restrictive for all to authenticated using (is_requesting_user_active()) with check (is_requesting_user_active());

create policy nexo_active_users_only on public.push_message_dispatches as restrictive for all to authenticated using (is_requesting_user_active()) with check (is_requesting_user_active());

create policy nexo_active_users_only on public.push_notification_outbox as restrictive for all to authenticated using (is_requesting_user_active()) with check (is_requesting_user_active());

create policy nexo_active_users_only on public.push_tokens as restrictive for all to authenticated using (is_requesting_user_active()) with check (is_requesting_user_active());

create policy push_tokens_delete_own on public.push_tokens as permissive for delete to public using ((auth.uid() = user_id));

create policy push_tokens_insert_own on public.push_tokens as permissive for insert to public with check ((auth.uid() = user_id));

create policy push_tokens_select_own on public.push_tokens as permissive for select to public using ((auth.uid() = user_id));

create policy push_tokens_update_own on public.push_tokens as permissive for update to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));

create policy nexo_active_users_only on public.reportes_planes as restrictive for all to authenticated using (is_requesting_user_active()) with check (is_requesting_user_active());

create policy reportes_insert_own on public.reportes_planes as permissive for insert to authenticated with check (((reportador_id = auth.uid()) AND not_banned()));

create policy reportes_planes_delete_staff on public.reportes_planes as permissive for delete to authenticated using (is_staff());

create policy reportes_select_own on public.reportes_planes as permissive for select to authenticated using ((reportador_id = auth.uid()));

create policy reportes_select_staff on public.reportes_planes as permissive for select to authenticated using (is_staff());

create policy reportes_update_staff on public.reportes_planes as permissive for update to authenticated using (is_staff()) with check (is_staff());

create policy nexo_active_users_only on public.reportes_usuarios as restrictive for all to authenticated using (is_requesting_user_active()) with check (is_requesting_user_active());

create policy reportes_usuarios_delete_staff on public.reportes_usuarios as permissive for delete to authenticated using (is_staff());

create policy reportes_usuarios_insert_own on public.reportes_usuarios as permissive for insert to authenticated with check (((reportador_id = auth.uid()) AND not_banned()));

create policy reportes_usuarios_select_own on public.reportes_usuarios as permissive for select to authenticated using ((reportador_id = auth.uid()));

create policy reportes_usuarios_select_staff on public.reportes_usuarios as permissive for select to authenticated using (is_staff());

create policy reportes_usuarios_update_staff on public.reportes_usuarios as permissive for update to authenticated using (is_staff()) with check (is_staff());

create policy nexo_active_users_only on public.valoraciones as restrictive for all to authenticated using (is_requesting_user_active()) with check (is_requesting_user_active());

create policy valoraciones_delete_propias on public.valoraciones as permissive for delete to authenticated using ((evaluador_id = ( SELECT auth.uid() AS uid)));

create policy valoraciones_insert_own on public.valoraciones as permissive for insert to authenticated with check (((evaluador_id = auth.uid()) AND (evaluador_id <> evaluado_id)));

create policy valoraciones_insert_propias on public.valoraciones as permissive for insert to authenticated with check ((evaluador_id = ( SELECT auth.uid() AS uid)));

create policy valoraciones_select on public.valoraciones as permissive for select to authenticated using (((evaluador_id = auth.uid()) OR (evaluado_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM participantes p
  WHERE ((p.plan_id = valoraciones.plan_id) AND (p.usuario_id = auth.uid()) AND (p.estado = 'aceptado'::tipo_estado_participante))))));

create policy valoraciones_select_propias on public.valoraciones as permissive for select to authenticated using ((evaluador_id = ( SELECT auth.uid() AS uid)));

create policy valoraciones_update_own on public.valoraciones as permissive for update to authenticated using ((evaluador_id = auth.uid())) with check ((evaluador_id = auth.uid()));

create policy valoraciones_update_propias on public.valoraciones as permissive for update to authenticated using ((evaluador_id = ( SELECT auth.uid() AS uid))) with check ((evaluador_id = ( SELECT auth.uid() AS uid)));

create policy "Authenticated users update plan images" on storage.objects as permissive for update to authenticated using ((bucket_id = 'imagenes-planes'::text)) with check ((bucket_id = 'imagenes-planes'::text));

create policy "Authenticated users upload chat files" on storage.objects as permissive for insert to authenticated with check ((bucket_id = 'chat-files'::text));

create policy "Authenticated users view chat files" on storage.objects as permissive for select to authenticated using ((bucket_id = 'chat-files'::text));

create policy "Authenticated users view plan images" on storage.objects as permissive for select to authenticated using ((bucket_id = 'imagenes-planes'::text));

create policy "Permitir actualizar avatares" on storage.objects as permissive for update to authenticated using ((bucket_id = 'avatars'::text)) with check ((bucket_id = 'avatars'::text));

create policy "Permitir subida de avatares" on storage.objects as permissive for insert to authenticated with check ((bucket_id = 'avatars'::text));

create policy "Permitir ver avatares" on storage.objects as permissive for select to public using ((bucket_id = 'avatars'::text));

create policy "Subir uur343_0" on storage.objects as permissive for insert to authenticated with check ((bucket_id = 'imagenes-planes'::text));

create policy "authenticated see images 1oj01fe_0" on storage.objects as permissive for select to authenticated using ((bucket_id = 'avatars'::text));

create policy avatars_groups_insert on storage.objects as permissive for insert to authenticated with check (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = 'groups'::text)));

create policy avatars_groups_update on storage.objects as permissive for update to authenticated using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = 'groups'::text)));

create policy avatars_plan_covers_insert on storage.objects as permissive for insert to authenticated with check (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = 'plan-covers'::text)));

create policy avatars_plan_covers_select on storage.objects as permissive for select to public using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = 'plan-covers'::text)));

create policy avatars_plan_covers_update on storage.objects as permissive for update to authenticated using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = 'plan-covers'::text)));

create policy chat_files_insert_authenticated on storage.objects as permissive for insert to authenticated with check ((bucket_id = 'chat-files'::text));

create policy chat_files_select_public on storage.objects as permissive for select to public using ((bucket_id = 'chat-files'::text));

create policy "ver uur343_0" on storage.objects as permissive for select to public using ((bucket_id = 'imagenes-planes'::text));

-- ---------------------------------------------------------------------------
-- TABLE GRANTS
-- ---------------------------------------------------------------------------

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.ai_search_usage to service_role;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.amistades to anon;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.amistades to authenticated;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.amistades to service_role;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.analytics_events to anon;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.analytics_events to authenticated;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.analytics_events to service_role;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.bloqueos to anon;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.bloqueos to authenticated;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.bloqueos to service_role;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.chats_directos_ocultos to anon;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.chats_directos_ocultos to authenticated;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.chats_directos_ocultos to service_role;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.estadisticas_usuario to anon;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.estadisticas_usuario to authenticated;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.estadisticas_usuario to service_role;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.expulsiones_plan to anon;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.expulsiones_plan to authenticated;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.expulsiones_plan to service_role;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.historial_planes to anon;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.historial_planes to authenticated;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.historial_planes to service_role;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.invitaciones_planes to anon;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.invitaciones_planes to authenticated;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.invitaciones_planes to service_role;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.mensaje_reacciones to anon;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.mensaje_reacciones to authenticated;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.mensaje_reacciones to service_role;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.mensajes to anon;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.mensajes to authenticated;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.mensajes to service_role;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.mensajes_soporte to anon;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.mensajes_soporte to authenticated;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.mensajes_soporte to service_role;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.participantes to anon;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.participantes to authenticated;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.participantes to service_role;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.perfiles to anon;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.perfiles to authenticated;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.perfiles to service_role;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.plan_invitaciones to anon;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.plan_invitaciones to authenticated;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.plan_invitaciones to service_role;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.planes to anon;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.planes to authenticated;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.planes to service_role;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.planes_guardados to anon;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.planes_guardados to authenticated;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.planes_guardados to service_role;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.push_chat_mutes to anon;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.push_chat_mutes to authenticated;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.push_chat_mutes to service_role;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.push_dispatch_usage to service_role;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.push_message_deliveries to service_role;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.push_message_dispatches to service_role;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.push_notification_outbox to service_role;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.push_tokens to anon;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.push_tokens to authenticated;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.push_tokens to service_role;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.reportes_planes to anon;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.reportes_planes to authenticated;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.reportes_planes to service_role;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.reportes_usuarios to anon;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.reportes_usuarios to authenticated;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.reportes_usuarios to service_role;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.valoraciones to anon;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.valoraciones to authenticated;

grant delete, insert, maintain, references, select, trigger, truncate, update on table public.valoraciones to service_role;

-- ---------------------------------------------------------------------------
-- FUNCTION GRANTS
-- ---------------------------------------------------------------------------

grant execute on function public.actualizar_estadisticas_tras_valoracion() to public;

grant execute on function public.actualizar_estadisticas_tras_valoracion() to anon;

grant execute on function public.actualizar_estadisticas_tras_valoracion() to authenticated;

grant execute on function public.actualizar_estadisticas_tras_valoracion() to service_role;

grant execute on function public.actualizar_estadisticas_usuario() to public;

grant execute on function public.actualizar_estadisticas_usuario() to anon;

grant execute on function public.actualizar_estadisticas_usuario() to authenticated;

grant execute on function public.actualizar_estadisticas_usuario() to service_role;

grant execute on function public.actualizar_estadisticas_usuario(v_usuario uuid) to public;

grant execute on function public.actualizar_estadisticas_usuario(v_usuario uuid) to anon;

grant execute on function public.actualizar_estadisticas_usuario(v_usuario uuid) to authenticated;

grant execute on function public.actualizar_estadisticas_usuario(v_usuario uuid) to service_role;

grant execute on function public.actualizar_timestamp() to public;

grant execute on function public.actualizar_timestamp() to anon;

grant execute on function public.actualizar_timestamp() to authenticated;

grant execute on function public.actualizar_timestamp() to service_role;

grant execute on function public.admin_ban_user(target_id uuid, motivo text, banned boolean) to anon;

grant execute on function public.admin_ban_user(target_id uuid, motivo text, banned boolean) to authenticated;

grant execute on function public.admin_ban_user(target_id uuid, motivo text, banned boolean) to service_role;

grant execute on function public.admin_delete_inbox_item(item_kind text, item_id uuid) to anon;

grant execute on function public.admin_delete_inbox_item(item_kind text, item_id uuid) to authenticated;

grant execute on function public.admin_delete_inbox_item(item_kind text, item_id uuid) to service_role;

grant execute on function public.admin_delete_plan(target_plan_id uuid) to anon;

grant execute on function public.admin_delete_plan(target_plan_id uuid) to authenticated;

grant execute on function public.admin_delete_plan(target_plan_id uuid) to service_role;

grant execute on function public.admin_delete_user(target_id uuid) to anon;

grant execute on function public.admin_delete_user(target_id uuid) to authenticated;

grant execute on function public.admin_delete_user(target_id uuid) to service_role;

grant execute on function public.admin_moderation_counts() to anon;

grant execute on function public.admin_moderation_counts() to authenticated;

grant execute on function public.admin_moderation_counts() to service_role;

grant execute on function public.admin_set_report_estado(report_kind text, report_id uuid, nuevo_estado text, notas text) to anon;

grant execute on function public.admin_set_report_estado(report_kind text, report_id uuid, nuevo_estado text, notas text) to authenticated;

grant execute on function public.admin_set_report_estado(report_kind text, report_id uuid, nuevo_estado text, notas text) to service_role;

grant execute on function public.admin_set_ticket_estado(ticket_id uuid, nuevo_estado text, notas text) to anon;

grant execute on function public.admin_set_ticket_estado(ticket_id uuid, nuevo_estado text, notas text) to authenticated;

grant execute on function public.admin_set_ticket_estado(ticket_id uuid, nuevo_estado text, notas text) to service_role;

grant execute on function public.archive_all_ended_plans() to anon;

grant execute on function public.archive_all_ended_plans() to authenticated;

grant execute on function public.archive_all_ended_plans() to service_role;

grant execute on function public.archive_ended_plan(p_plan_id uuid) to anon;

grant execute on function public.archive_ended_plan(p_plan_id uuid) to authenticated;

grant execute on function public.archive_ended_plan(p_plan_id uuid) to service_role;

grant execute on function public.array_text_sin_duplicados(valores text[]) to public;

grant execute on function public.array_text_sin_duplicados(valores text[]) to anon;

grant execute on function public.array_text_sin_duplicados(valores text[]) to authenticated;

grant execute on function public.array_text_sin_duplicados(valores text[]) to service_role;

grant execute on function public.borrar_propia_cuenta() to anon;

grant execute on function public.borrar_propia_cuenta() to authenticated;

grant execute on function public.borrar_propia_cuenta() to service_role;

grant execute on function public.change_username(new_name text) to anon;

grant execute on function public.change_username(new_name text) to authenticated;

grant execute on function public.change_username(new_name text) to service_role;

grant execute on function public.claim_push_message(p_message_id text, p_sender_id uuid) to service_role;

grant execute on function public.claim_push_message_delivery(p_message_id text, p_sender_id uuid, p_push_token text) to service_role;

grant execute on function public.claim_push_outbox_event(p_event_id uuid) to service_role;

grant execute on function public.complete_push_message_delivery(p_message_id text, p_sender_id uuid, p_push_token text, p_succeeded boolean, p_ticket_id text, p_error text) to service_role;

grant execute on function public.complete_push_outbox_event(p_event_id uuid, p_succeeded boolean, p_ticket_ids jsonb, p_error text) to service_role;

grant execute on function public.consume_ai_search_quota() to authenticated;

grant execute on function public.consume_ai_search_quota() to service_role;

grant execute on function public.consume_push_dispatch_quota(p_user_id uuid) to service_role;

grant execute on function public.count_user_active_plans(p_user_id uuid) to public;

grant execute on function public.count_user_active_plans(p_user_id uuid) to anon;

grant execute on function public.count_user_active_plans(p_user_id uuid) to authenticated;

grant execute on function public.count_user_active_plans(p_user_id uuid) to service_role;

grant execute on function public.crear_estadisticas_iniciales() to public;

grant execute on function public.crear_estadisticas_iniciales() to anon;

grant execute on function public.crear_estadisticas_iniciales() to authenticated;

grant execute on function public.crear_estadisticas_iniciales() to service_role;

grant execute on function public.crear_estadisticas_para_perfil() to public;

grant execute on function public.crear_estadisticas_para_perfil() to anon;

grant execute on function public.crear_estadisticas_para_perfil() to authenticated;

grant execute on function public.crear_estadisticas_para_perfil() to service_role;

grant execute on function public.create_meetup_plan(p_payload jsonb) to anon;

grant execute on function public.create_meetup_plan(p_payload jsonb) to authenticated;

grant execute on function public.create_meetup_plan(p_payload jsonb) to service_role;

grant execute on function public.current_user_banned() to anon;

grant execute on function public.current_user_banned() to authenticated;

grant execute on function public.current_user_banned() to service_role;

grant execute on function public.day_start_madrid() to public;

grant execute on function public.day_start_madrid() to anon;

grant execute on function public.day_start_madrid() to authenticated;

grant execute on function public.day_start_madrid() to service_role;

grant execute on function public.delete_own_account() to anon;

grant execute on function public.delete_own_account() to authenticated;

grant execute on function public.delete_own_account() to service_role;

grant execute on function public.enforce_active_plan_limit() to public;

grant execute on function public.enforce_active_plan_limit() to anon;

grant execute on function public.enforce_active_plan_limit() to authenticated;

grant execute on function public.enforce_active_plan_limit() to service_role;

grant execute on function public.enforce_block_daily_limit() to public;

grant execute on function public.enforce_block_daily_limit() to anon;

grant execute on function public.enforce_block_daily_limit() to authenticated;

grant execute on function public.enforce_block_daily_limit() to service_role;

grant execute on function public.enforce_friend_request_daily_limit() to public;

grant execute on function public.enforce_friend_request_daily_limit() to anon;

grant execute on function public.enforce_friend_request_daily_limit() to authenticated;

grant execute on function public.enforce_friend_request_daily_limit() to service_role;

grant execute on function public.enforce_plan_join_rules() to public;

grant execute on function public.enforce_plan_join_rules() to anon;

grant execute on function public.enforce_plan_join_rules() to authenticated;

grant execute on function public.enforce_plan_join_rules() to service_role;

grant execute on function public.enforce_plan_report_daily_limit() to public;

grant execute on function public.enforce_plan_report_daily_limit() to anon;

grant execute on function public.enforce_plan_report_daily_limit() to authenticated;

grant execute on function public.enforce_plan_report_daily_limit() to service_role;

grant execute on function public.enforce_user_report_daily_limit() to public;

grant execute on function public.enforce_user_report_daily_limit() to anon;

grant execute on function public.enforce_user_report_daily_limit() to authenticated;

grant execute on function public.enforce_user_report_daily_limit() to service_role;

grant execute on function public.evaluar_insignias_usuario() to public;

grant execute on function public.evaluar_insignias_usuario() to anon;

grant execute on function public.evaluar_insignias_usuario() to authenticated;

grant execute on function public.evaluar_insignias_usuario() to service_role;

grant execute on function public.get_badge_stats(p_user_id uuid) to public;

grant execute on function public.get_badge_stats(p_user_id uuid) to anon;

grant execute on function public.get_badge_stats(p_user_id uuid) to authenticated;

grant execute on function public.get_badge_stats(p_user_id uuid) to service_role;

grant execute on function public.get_chat_summaries(p_plan_read_at jsonb, p_direct_read_at jsonb) to authenticated;

grant execute on function public.get_chat_summaries(p_plan_read_at jsonb, p_direct_read_at jsonb) to service_role;

grant execute on function public.get_due_push_outbox_event_ids(p_limit integer) to service_role;

grant execute on function public.get_login_email_by_username(p_username text) to service_role;

grant execute on function public.get_user_public_stats(p_user_id uuid) to anon;

grant execute on function public.get_user_public_stats(p_user_id uuid) to authenticated;

grant execute on function public.get_user_public_stats(p_user_id uuid) to service_role;

grant execute on function public.guardar_valoracion(p_plan_id uuid, p_evaluado_id uuid, p_asistencia boolean, p_puntuacion_general integer, p_repetiria_experiencia text, p_aspectos_positivos jsonb, p_aspectos_negativos jsonb) to anon;

grant execute on function public.guardar_valoracion(p_plan_id uuid, p_evaluado_id uuid, p_asistencia boolean, p_puntuacion_general integer, p_repetiria_experiencia text, p_aspectos_positivos jsonb, p_aspectos_negativos jsonb) to authenticated;

grant execute on function public.guardar_valoracion(p_plan_id uuid, p_evaluado_id uuid, p_asistencia boolean, p_puntuacion_general integer, p_repetiria_experiencia text, p_aspectos_positivos jsonb, p_aspectos_negativos jsonb) to service_role;

grant execute on function public.handle_new_user() to public;

grant execute on function public.handle_new_user() to anon;

grant execute on function public.handle_new_user() to authenticated;

grant execute on function public.handle_new_user() to service_role;

grant execute on function public.handle_nuevo_usuario() to public;

grant execute on function public.handle_nuevo_usuario() to anon;

grant execute on function public.handle_nuevo_usuario() to authenticated;

grant execute on function public.handle_nuevo_usuario() to service_role;

grant execute on function public.invoke_push_outbox_dispatcher() to service_role;

grant execute on function public.is_email_taken(check_email text) to service_role;

grant execute on function public.is_owner() to anon;

grant execute on function public.is_owner() to authenticated;

grant execute on function public.is_owner() to service_role;

grant execute on function public.is_requesting_user_active() to authenticated;

grant execute on function public.is_requesting_user_active() to service_role;

grant execute on function public.is_staff() to anon;

grant execute on function public.is_staff() to authenticated;

grant execute on function public.is_staff() to service_role;

grant execute on function public.is_username_taken(check_name text, exclude_id uuid) to anon;

grant execute on function public.is_username_taken(check_name text, exclude_id uuid) to authenticated;

grant execute on function public.is_username_taken(check_name text, exclude_id uuid) to service_role;

grant execute on function public.nombre_usuario_ya_tomado(check_name text, exclude_id uuid) to anon;

grant execute on function public.nombre_usuario_ya_tomado(check_name text, exclude_id uuid) to authenticated;

grant execute on function public.nombre_usuario_ya_tomado(check_name text, exclude_id uuid) to service_role;

grant execute on function public.not_banned() to anon;

grant execute on function public.not_banned() to authenticated;

grant execute on function public.not_banned() to service_role;

grant execute on function public.on_amistad_change() to public;

grant execute on function public.on_amistad_change() to anon;

grant execute on function public.on_amistad_change() to authenticated;

grant execute on function public.on_amistad_change() to service_role;

grant execute on function public.on_historial_change() to public;

grant execute on function public.on_historial_change() to anon;

grant execute on function public.on_historial_change() to authenticated;

grant execute on function public.on_historial_change() to service_role;

grant execute on function public.on_participante_badge_stats() to public;

grant execute on function public.on_participante_badge_stats() to anon;

grant execute on function public.on_participante_badge_stats() to authenticated;

grant execute on function public.on_participante_badge_stats() to service_role;

grant execute on function public.on_plan_creador_change() to public;

grant execute on function public.on_plan_creador_change() to anon;

grant execute on function public.on_plan_creador_change() to authenticated;

grant execute on function public.on_plan_creador_change() to service_role;

grant execute on function public.on_valoracion_change() to public;

grant execute on function public.on_valoracion_change() to anon;

grant execute on function public.on_valoracion_change() to authenticated;

grant execute on function public.on_valoracion_change() to service_role;

grant execute on function public.plan_is_feed_public(p_plan_id uuid) to public;

grant execute on function public.plan_is_feed_public(p_plan_id uuid) to anon;

grant execute on function public.plan_is_feed_public(p_plan_id uuid) to authenticated;

grant execute on function public.plan_is_feed_public(p_plan_id uuid) to service_role;

grant execute on function public.procesar_lista_espera() to public;

grant execute on function public.procesar_lista_espera() to anon;

grant execute on function public.procesar_lista_espera() to authenticated;

grant execute on function public.procesar_lista_espera() to service_role;

grant execute on function public.promote_waitlist(p_plan_id uuid) to public;

grant execute on function public.promote_waitlist(p_plan_id uuid) to anon;

grant execute on function public.promote_waitlist(p_plan_id uuid) to authenticated;

grant execute on function public.promote_waitlist(p_plan_id uuid) to service_role;

grant execute on function public.protect_account_control_columns() to service_role;

grant execute on function public.protect_mensajes_soporte_cols() to public;

grant execute on function public.protect_mensajes_soporte_cols() to anon;

grant execute on function public.protect_mensajes_soporte_cols() to authenticated;

grant execute on function public.protect_mensajes_soporte_cols() to service_role;

grant execute on function public.protect_perfiles_moderation_cols() to public;

grant execute on function public.protect_perfiles_moderation_cols() to anon;

grant execute on function public.protect_perfiles_moderation_cols() to authenticated;

grant execute on function public.protect_perfiles_moderation_cols() to service_role;

grant execute on function public.protect_username_change() to public;

grant execute on function public.protect_username_change() to anon;

grant execute on function public.protect_username_change() to authenticated;

grant execute on function public.protect_username_change() to service_role;

grant execute on function public.purge_expired_plan_chats() to anon;

grant execute on function public.purge_expired_plan_chats() to authenticated;

grant execute on function public.purge_expired_plan_chats() to service_role;

grant execute on function public.purge_past_saved_plans() to anon;

grant execute on function public.purge_past_saved_plans() to authenticated;

grant execute on function public.purge_past_saved_plans() to service_role;

grant execute on function public.queue_plan_join_decision_push() to service_role;

grant execute on function public.recalcular_badge_categorias(p_usuario uuid) to public;

grant execute on function public.recalcular_badge_categorias(p_usuario uuid) to anon;

grant execute on function public.recalcular_badge_categorias(p_usuario uuid) to authenticated;

grant execute on function public.recalcular_badge_categorias(p_usuario uuid) to service_role;

grant execute on function public.recalcular_estadisticas_usuario(p_usuario_id uuid) to anon;

grant execute on function public.recalcular_estadisticas_usuario(p_usuario_id uuid) to authenticated;

grant execute on function public.recalcular_estadisticas_usuario(p_usuario_id uuid) to service_role;

grant execute on function public.recalcular_estadisticas_valoraciones(p_usuario uuid) to public;

grant execute on function public.recalcular_estadisticas_valoraciones(p_usuario uuid) to anon;

grant execute on function public.recalcular_estadisticas_valoraciones(p_usuario uuid) to authenticated;

grant execute on function public.recalcular_estadisticas_valoraciones(p_usuario uuid) to service_role;

grant execute on function public.recalcular_numero_amistades(p_usuario uuid) to public;

grant execute on function public.recalcular_numero_amistades(p_usuario uuid) to anon;

grant execute on function public.recalcular_numero_amistades(p_usuario uuid) to authenticated;

grant execute on function public.recalcular_numero_amistades(p_usuario uuid) to service_role;

grant execute on function public.recalcular_personas_distintas(p_usuario uuid) to public;

grant execute on function public.recalcular_personas_distintas(p_usuario uuid) to anon;

grant execute on function public.recalcular_personas_distintas(p_usuario uuid) to authenticated;

grant execute on function public.recalcular_personas_distintas(p_usuario uuid) to service_role;

grant execute on function public.recalcular_planes_creados(p_usuario uuid) to public;

grant execute on function public.recalcular_planes_creados(p_usuario uuid) to anon;

grant execute on function public.recalcular_planes_creados(p_usuario uuid) to authenticated;

grant execute on function public.recalcular_planes_creados(p_usuario uuid) to service_role;

grant execute on function public.reject_if_banned() to public;

grant execute on function public.reject_if_banned() to anon;

grant execute on function public.reject_if_banned() to authenticated;

grant execute on function public.reject_if_banned() to service_role;

grant execute on function public.touch_actualizado_en() to public;

grant execute on function public.touch_actualizado_en() to anon;

grant execute on function public.touch_actualizado_en() to authenticated;

grant execute on function public.touch_actualizado_en() to service_role;

grant execute on function public.tr_amistades_estadisticas() to public;

grant execute on function public.tr_amistades_estadisticas() to anon;

grant execute on function public.tr_amistades_estadisticas() to authenticated;

grant execute on function public.tr_amistades_estadisticas() to service_role;

grant execute on function public.tr_participantes_estadisticas() to public;

grant execute on function public.tr_participantes_estadisticas() to anon;

grant execute on function public.tr_participantes_estadisticas() to authenticated;

grant execute on function public.tr_participantes_estadisticas() to service_role;

grant execute on function public.tr_planes_estadisticas() to public;

grant execute on function public.tr_planes_estadisticas() to anon;

grant execute on function public.tr_planes_estadisticas() to authenticated;

grant execute on function public.tr_planes_estadisticas() to service_role;

grant execute on function public.tr_registrar_en_historial() to public;

grant execute on function public.tr_registrar_en_historial() to anon;

grant execute on function public.tr_registrar_en_historial() to authenticated;

grant execute on function public.tr_registrar_en_historial() to service_role;

grant execute on function public.tr_valoraciones_estadisticas() to public;

grant execute on function public.tr_valoraciones_estadisticas() to anon;

grant execute on function public.tr_valoraciones_estadisticas() to authenticated;

grant execute on function public.tr_valoraciones_estadisticas() to service_role;

grant execute on function public.user_can_view_plan(p_plan_id uuid, p_user_id uuid) to public;

grant execute on function public.user_can_view_plan(p_plan_id uuid, p_user_id uuid) to anon;

grant execute on function public.user_can_view_plan(p_plan_id uuid, p_user_id uuid) to authenticated;

grant execute on function public.user_can_view_plan(p_plan_id uuid, p_user_id uuid) to service_role;

grant execute on function public.user_has_plan_invite(p_plan_id uuid, p_user_id uuid) to public;

grant execute on function public.user_has_plan_invite(p_plan_id uuid, p_user_id uuid) to anon;

grant execute on function public.user_has_plan_invite(p_plan_id uuid, p_user_id uuid) to authenticated;

grant execute on function public.user_has_plan_invite(p_plan_id uuid, p_user_id uuid) to service_role;

grant execute on function public.users_are_friends(a uuid, b uuid) to public;

grant execute on function public.users_are_friends(a uuid, b uuid) to anon;

grant execute on function public.users_are_friends(a uuid, b uuid) to authenticated;

grant execute on function public.users_are_friends(a uuid, b uuid) to service_role;

grant execute on function public.usuario_es_miembro_del_plan(p_plan_id uuid) to public;

grant execute on function public.usuario_es_miembro_del_plan(p_plan_id uuid) to anon;

grant execute on function public.usuario_es_miembro_del_plan(p_plan_id uuid) to authenticated;

grant execute on function public.usuario_es_miembro_del_plan(p_plan_id uuid) to service_role;

grant execute on function public.usuario_pertenece_al_plan(p_plan_id uuid, p_usuario_id uuid) to anon;

grant execute on function public.usuario_pertenece_al_plan(p_plan_id uuid, p_usuario_id uuid) to authenticated;

grant execute on function public.usuario_pertenece_al_plan(p_plan_id uuid, p_usuario_id uuid) to service_role;

grant execute on function public.validar_valoracion() to public;

grant execute on function public.validar_valoracion() to anon;

grant execute on function public.validar_valoracion() to authenticated;

grant execute on function public.validar_valoracion() to service_role;

-- ---------------------------------------------------------------------------
-- STORAGE BUCKETS
-- ---------------------------------------------------------------------------

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types) values ('avatars','avatars','t',2097152,'{image/jpeg,image/png,image/webp,image/gif}'::text[]) on conflict (id) do update set name=excluded.name, public=excluded.public, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types) values ('chat-files','chat-files','f',10485760,null) on conflict (id) do update set name=excluded.name, public=excluded.public, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types) values ('imagenes-planes','imagenes-planes','t',3145728,'{image/jpeg,image/png,image/webp,image/gif}'::text[]) on conflict (id) do update set name=excluded.name, public=excluded.public, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- REALTIME PUBLICATION
-- ---------------------------------------------------------------------------

do $realtime$ begin if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='mensaje_reacciones') then alter publication supabase_realtime add table public.mensaje_reacciones; end if; end $realtime$;

do $realtime$ begin if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='mensajes') then alter publication supabase_realtime add table public.mensajes; end if; end $realtime$;

reset search_path;


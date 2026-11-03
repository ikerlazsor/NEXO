-- El enlace compartido debe abrir el plan (lectura).
-- modo_privado / solo_amigos siguen ocultándolo del feed; el UUID actúa como invitación de vista.
-- Chats DM / grupo: siguen solo para miembros.

CREATE OR REPLACE FUNCTION public.user_can_view_plan(p_plan_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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

    IF v_plan.categoria IN ('Grupo', 'Chat') THEN
        RETURN v_plan.creador_id = p_user_id
            OR EXISTS (
                SELECT 1 FROM public.participantes p
                WHERE p.plan_id = p_plan_id AND p.usuario_id = p_user_id
            );
    END IF;

    IF v_plan.creador_id = p_user_id THEN
        RETURN true;
    END IF;

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

    -- Meetup (incl. privado / solo amigos): quien tiene el id puede verlo.
    -- El feed sigue filtrando con canSeePlanInFeed / get_guest_feed.
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_guest_plan(p_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    result jsonb;
BEGIN
    IF p_plan_id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT jsonb_build_object(
        'plan', jsonb_build_object(
            'id', pl.id,
            'titulo', pl.titulo,
            'imagen_url', pl.imagen_url,
            'imagenes_url', coalesce(pl.imagenes_url, '{}'::text[]),
            'recurrencia', pl.recurrencia,
            'es_organizador', coalesce(creator.es_organizador, false),
            'categoria', pl.categoria,
            'tipo_deporte', pl.tipo_deporte,
            'solo_chicas', pl.solo_chicas,
            'modo_privado', pl.modo_privado,
            'fecha_evento', pl.fecha_evento,
            'nombre_ubicacion', pl.nombre_ubicacion,
            'latitud', pl.latitud,
            'longitud', pl.longitud,
            'maximo_participantes', pl.maximo_participantes,
            'creador_id', pl.creador_id,
            'requiere_aprobacion', pl.requiere_aprobacion,
            'descripcion', pl.descripcion,
            'chat_eliminado_en', pl.chat_eliminado_en
        ),
        'creator', jsonb_build_object(
            'id', creator.id,
            'nombre', creator.nombre,
            'nombre_usuario', creator.nombre_usuario,
            'avatar_url', creator.avatar_url,
            'es_organizador', creator.es_organizador,
            'isCreator', true
        ),
        'joinedCount', (
            SELECT count(*)::integer
            FROM public.participantes AS part
            WHERE part.plan_id = pl.id
              AND part.estado = 'aceptado'
              AND (
                  coalesce(creator.es_organizador, false) = false
                  OR part.usuario_id <> pl.creador_id
              )
        ),
        'participants', (
            SELECT coalesce(jsonb_agg(cards.card ORDER BY cards.ord, cards.nombre), '[]'::jsonb)
            FROM (
                SELECT
                    0 AS ord,
                    c.nombre,
                    jsonb_build_object(
                        'id', c.id,
                        'nombre', c.nombre,
                        'nombre_usuario', c.nombre_usuario,
                        'avatar_url', c.avatar_url,
                        'es_organizador', c.es_organizador,
                        'isCreator', true
                    ) AS card
                FROM public.perfiles AS c
                WHERE c.id = pl.creador_id
                  AND coalesce(c.baneado, false) = false
                  AND coalesce(c.es_organizador, false) = false
                UNION ALL
                SELECT
                    1,
                    p.nombre,
                    jsonb_build_object(
                        'id', p.id,
                        'nombre', p.nombre,
                        'nombre_usuario', p.nombre_usuario,
                        'avatar_url', p.avatar_url,
                        'es_organizador', p.es_organizador,
                        'isCreator', false
                    )
                FROM public.participantes AS part
                JOIN public.perfiles AS p ON p.id = part.usuario_id
                WHERE part.plan_id = pl.id
                  AND part.estado = 'aceptado'
                  AND part.usuario_id <> pl.creador_id
                  AND coalesce(p.baneado, false) = false
            ) AS cards
        )
    )
    INTO result
    FROM public.planes AS pl
    JOIN public.perfiles AS creator ON creator.id = pl.creador_id
    WHERE pl.id = p_plan_id
      -- Privado / solo amigos: el feed no los lista, pero el enlace directo sí.
      AND coalesce(pl.is_direct_chat, false) = false
      AND coalesce(pl.is_group_chat, false) = false
      AND pl.categoria NOT IN ('Grupo', 'Chat')
      AND pl.estado <> 'cancelado'
      AND coalesce(creator.baneado, false) = false;

    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_guest_plan(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guest_plan(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_can_view_plan(uuid, uuid) TO authenticated;

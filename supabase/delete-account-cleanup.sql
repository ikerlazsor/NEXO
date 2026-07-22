-- ============================================================
-- Eliminar cuenta: compatible con el esquema real de Nexo
-- Ejecutar ENTERO en Supabase SQL Editor
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_own_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    uid uuid := auth.uid();
    plan_row record;
    has_col boolean;
    has_table boolean;
BEGIN
    IF uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated';
    END IF;

    -- Participaciones del usuario
    DELETE FROM public.participantes WHERE usuario_id = uid;

    -- Planes creados por el usuario (y datos asociados)
    FOR plan_row IN SELECT id FROM public.planes WHERE creador_id = uid LOOP
        DELETE FROM public.mensajes WHERE plan_id = plan_row.id;

        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'invitaciones_planes'
        ) THEN
            DELETE FROM public.invitaciones_planes WHERE plan_id = plan_row.id;
        END IF;

        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'plan_invitaciones'
        ) THEN
            DELETE FROM public.plan_invitaciones WHERE plan_id = plan_row.id;
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

    -- Amistades
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'amistades' AND column_name = 'usuario_origen_id'
    ) INTO has_col;
    IF has_col THEN
        DELETE FROM public.amistades
        WHERE usuario_origen_id = uid OR usuario_destino_id = uid;
    ELSE
        DELETE FROM public.amistades
        WHERE usuario_id = uid OR amigo_id = uid;
    END IF;

    -- Bloqueos
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'bloqueos' AND column_name = 'usuario_origen_id'
    ) INTO has_col;
    IF has_col THEN
        DELETE FROM public.bloqueos
        WHERE usuario_origen_id = uid OR usuario_destino_id = uid;
    ELSE
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'bloqueos' AND column_name = 'bloqueador_id'
        ) INTO has_col;
        IF has_col THEN
            DELETE FROM public.bloqueos
            WHERE bloqueador_id = uid OR bloqueado_id = uid;
        END IF;
    END IF;

    DELETE FROM public.planes_guardados WHERE usuario_id = uid;
    DELETE FROM public.historial_planes WHERE usuario_id = uid;
    DELETE FROM public.valoraciones WHERE evaluador_id = uid OR evaluado_id = uid;

    -- Invitaciones: invitador_id / invitado_id (esquema real)
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
            WHERE invitador_id = uid OR invitado_id = uid;
        ELSE
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'invitaciones_planes'
                  AND column_name = 'emisor_id'
            ) INTO has_col;
            IF has_col THEN
                DELETE FROM public.invitaciones_planes
                WHERE emisor_id = uid OR receptor_id = uid;
            END IF;
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'plan_invitaciones'
    ) THEN
        DELETE FROM public.plan_invitaciones
        WHERE invitador_id = uid OR invitado_id = uid;
    END IF;

    -- Reportes / soporte
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'reportes_planes'
    ) THEN
        DELETE FROM public.reportes_planes WHERE reportador_id = uid;
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'reportes_usuarios'
    ) THEN
        DELETE FROM public.reportes_usuarios
        WHERE reportador_id = uid OR denunciado_id = uid;
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'mensajes_soporte'
    ) THEN
        DELETE FROM public.mensajes_soporte WHERE usuario_id = uid;
    END IF;

    -- Mensajes directos / del usuario (emisor_id o usuario_id)
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
            WHERE emisor_id = uid OR receptor_id = uid;
        ELSE
            DELETE FROM public.mensajes WHERE emisor_id = uid;
        END IF;
    ELSE
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'mensajes' AND column_name = 'usuario_id'
        ) INTO has_col;
        IF has_col THEN
            DELETE FROM public.mensajes WHERE usuario_id = uid;
        END IF;
    END IF;

    DELETE FROM public.estadisticas_usuario WHERE usuario_id = uid;
    DELETE FROM public.perfiles WHERE id = uid;
    DELETE FROM auth.users WHERE id = uid;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_own_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;

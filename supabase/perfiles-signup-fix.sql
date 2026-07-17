-- ============================================================
-- NEXO · Reset completo de triggers + RLS para el esquema nuevo
-- Ejecutar ENTERO en el SQL Editor de Supabase.
--
-- Arregla:
--   1. "Database error saving new user" al registrarse
--      → triggers antiguos insertan columnas que ya no existen
--        (ej: column "tags" of relation "perfiles" does not exist).
--   2. Error al crear planes
--      → trigger antiguo de estadísticas usa column "puntualidad".
--   3. RLS sin políticas permisivas en las tablas principales.
--
-- Es idempotente: puede ejecutarse varias veces sin problema.
-- ============================================================


-- ============================================================
-- 0. LIMPIEZA: eliminar TODOS los triggers de usuario antiguos
--    (en auth.users y en las tablas de public). Los triggers
--    internos de las FKs no se tocan. Después recreamos solo
--    los correctos para el esquema nuevo.
-- ============================================================
DO $$
DECLARE
    trg record;
BEGIN
    FOR trg IN
        SELECT t.tgname, n.nspname, c.relname
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE NOT t.tgisinternal
          AND (
                (n.nspname = 'auth' AND c.relname = 'users')
             OR n.nspname = 'public'
          )
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I.%I',
                       trg.tgname, trg.nspname, trg.relname);
        RAISE NOTICE 'Trigger eliminado: % en %.%', trg.tgname, trg.nspname, trg.relname;
    END LOOP;
END;
$$;


-- ============================================================
-- 1. TRIGGER: crear perfil + estadísticas al registrarse
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();


-- ============================================================
-- 2. TRIGGER: mantener actualizado_en al modificar filas
-- ============================================================
CREATE OR REPLACE FUNCTION public.touch_actualizado_en()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.actualizado_en := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_touch_perfiles
    BEFORE UPDATE ON public.perfiles
    FOR EACH ROW EXECUTE FUNCTION public.touch_actualizado_en();

CREATE TRIGGER trg_touch_planes
    BEFORE UPDATE ON public.planes
    FOR EACH ROW EXECUTE FUNCTION public.touch_actualizado_en();

CREATE TRIGGER trg_touch_participantes
    BEFORE UPDATE ON public.participantes
    FOR EACH ROW EXECUTE FUNCTION public.touch_actualizado_en();

CREATE TRIGGER trg_touch_amistades
    BEFORE UPDATE ON public.amistades
    FOR EACH ROW EXECUTE FUNCTION public.touch_actualizado_en();

CREATE TRIGGER trg_touch_valoraciones
    BEFORE UPDATE ON public.valoraciones
    FOR EACH ROW EXECUTE FUNCTION public.touch_actualizado_en();


-- ============================================================
-- 3. TRIGGERS DE ESTADÍSTICAS (esquema nuevo, sin "puntualidad")
-- ============================================================

-- Recalcula las estadísticas de valoraciones de un usuario evaluado
CREATE OR REPLACE FUNCTION public.recalcular_estadisticas_valoraciones(p_usuario uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_media numeric;
    v_total integer;
    v_repetiria numeric;
    v_asistencias integer;
    v_pos text; v_pos_votos integer;
    v_neg text; v_neg_votos integer;
BEGIN
    INSERT INTO public.estadisticas_usuario (usuario_id)
    VALUES (p_usuario)
    ON CONFLICT (usuario_id) DO NOTHING;

    SELECT COALESCE(ROUND(AVG(puntuacion_general)::numeric, 2), 0),
           COUNT(*) FILTER (WHERE puntuacion_general IS NOT NULL),
           COALESCE(ROUND(
               100.0 * COUNT(*) FILTER (WHERE repetiria_experiencia = 'si')
               / NULLIF(COUNT(*) FILTER (WHERE repetiria_experiencia IS NOT NULL), 0)
           , 2), 0),
           COUNT(*) FILTER (WHERE asistencia = true)
      INTO v_media, v_total, v_repetiria, v_asistencias
      FROM public.valoraciones
     WHERE evaluado_id = p_usuario;

    SELECT a, c INTO v_pos, v_pos_votos FROM (
        SELECT unnest(aspectos_positivos) AS a, COUNT(*) AS c
          FROM public.valoraciones
         WHERE evaluado_id = p_usuario
         GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1
    ) s;

    SELECT a, c INTO v_neg, v_neg_votos FROM (
        SELECT unnest(aspectos_negativos) AS a, COUNT(*) AS c
          FROM public.valoraciones
         WHERE evaluado_id = p_usuario
         GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1
    ) s;

    UPDATE public.estadisticas_usuario SET
        valoracion_media               = LEAST(5, GREATEST(0, v_media)),
        numero_valoraciones            = v_total,
        porcentaje_repetiria           = v_repetiria,
        numero_asistencias_confirmadas = v_asistencias,
        aspecto_positivo_mas_votado    = v_pos,
        votos_aspecto_positivo         = COALESCE(v_pos_votos, 0),
        aspecto_negativo_mas_votado    = v_neg,
        votos_aspecto_negativo         = COALESCE(v_neg_votos, 0),
        actualizado_en                 = now()
    WHERE usuario_id = p_usuario;
END;
$$;

CREATE OR REPLACE FUNCTION public.on_valoracion_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM public.recalcular_estadisticas_valoraciones(NEW.evaluado_id);
    END IF;
    IF TG_OP IN ('DELETE', 'UPDATE') THEN
        PERFORM public.recalcular_estadisticas_valoraciones(OLD.evaluado_id);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_valoraciones_stats
    AFTER INSERT OR UPDATE OR DELETE ON public.valoraciones
    FOR EACH ROW EXECUTE FUNCTION public.on_valoracion_change();

-- Número de amistades aceptadas
CREATE OR REPLACE FUNCTION public.recalcular_numero_amistades(p_usuario uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.on_amistad_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

CREATE TRIGGER trg_amistades_stats
    AFTER INSERT OR UPDATE OR DELETE ON public.amistades
    FOR EACH ROW EXECUTE FUNCTION public.on_amistad_change();

-- Número de planes realizados (desde historial_planes)
CREATE OR REPLACE FUNCTION public.on_historial_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_usuario uuid := COALESCE(NEW.usuario_id, OLD.usuario_id);
BEGIN
    IF to_regprocedure('public.recalcular_badge_categorias(uuid)') IS NOT NULL THEN
        PERFORM public.recalcular_badge_categorias(v_usuario);
    ELSE
        INSERT INTO public.estadisticas_usuario (usuario_id)
        VALUES (v_usuario)
        ON CONFLICT (usuario_id) DO NOTHING;

        UPDATE public.estadisticas_usuario SET
            numero_planes_realizados = (
                SELECT COUNT(*) FROM public.historial_planes WHERE usuario_id = v_usuario
            ),
            actualizado_en = now()
        WHERE usuario_id = v_usuario;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_historial_stats
    AFTER INSERT OR DELETE ON public.historial_planes
    FOR EACH ROW EXECUTE FUNCTION public.on_historial_change();


-- ============================================================
-- 4. BORRADO EN CASCADA (FKs)
-- ============================================================
ALTER TABLE public.perfiles
    DROP CONSTRAINT IF EXISTS perfiles_id_fkey,
    ADD CONSTRAINT perfiles_id_fkey
        FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.participantes
    DROP CONSTRAINT IF EXISTS participantes_plan_id_fkey,
    ADD CONSTRAINT participantes_plan_id_fkey
        FOREIGN KEY (plan_id) REFERENCES public.planes(id) ON DELETE CASCADE;

ALTER TABLE public.mensajes
    DROP CONSTRAINT IF EXISTS mensajes_plan_fkey,
    ADD CONSTRAINT mensajes_plan_fkey
        FOREIGN KEY (plan_id) REFERENCES public.planes(id) ON DELETE CASCADE;

ALTER TABLE public.invitaciones_planes
    DROP CONSTRAINT IF EXISTS inv_planes_plan_fkey,
    ADD CONSTRAINT inv_planes_plan_fkey
        FOREIGN KEY (plan_id) REFERENCES public.planes(id) ON DELETE CASCADE;

ALTER TABLE public.planes_guardados
    DROP CONSTRAINT IF EXISTS planes_guardados_plan_fkey,
    ADD CONSTRAINT planes_guardados_plan_fkey
        FOREIGN KEY (plan_id) REFERENCES public.planes(id) ON DELETE CASCADE;

ALTER TABLE public.historial_planes
    DROP CONSTRAINT IF EXISTS historial_planes_plan_fkey,
    ADD CONSTRAINT historial_planes_plan_fkey
        FOREIGN KEY (plan_id) REFERENCES public.planes(id) ON DELETE CASCADE;

ALTER TABLE public.valoraciones
    DROP CONSTRAINT IF EXISTS val_plan_fk,
    ADD CONSTRAINT val_plan_fk
        FOREIGN KEY (plan_id) REFERENCES public.planes(id) ON DELETE CASCADE;


-- ============================================================
-- 5. POLÍTICAS RLS
--    (las RESTRICTIVE de bloqueos existentes siguen encima)
-- ============================================================

-- ---------- perfiles ----------
ALTER TABLE public.perfiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "perfiles_read_authenticated" ON public.perfiles;
DROP POLICY IF EXISTS "perfiles_select" ON public.perfiles;
CREATE POLICY "perfiles_select" ON public.perfiles
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "perfiles_insert_own" ON public.perfiles;
CREATE POLICY "perfiles_insert_own" ON public.perfiles
    FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "perfiles_update_own" ON public.perfiles;
CREATE POLICY "perfiles_update_own" ON public.perfiles
    FOR UPDATE TO authenticated
    USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "perfiles_delete_own" ON public.perfiles;
CREATE POLICY "perfiles_delete_own" ON public.perfiles
    FOR DELETE TO authenticated USING (id = auth.uid());

-- ---------- planes ----------
ALTER TABLE public.planes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "planes_select" ON public.planes;
CREATE POLICY "planes_select" ON public.planes
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "planes_insert_own" ON public.planes;
CREATE POLICY "planes_insert_own" ON public.planes
    FOR INSERT TO authenticated WITH CHECK (creador_id = auth.uid());

DROP POLICY IF EXISTS "planes_update_own" ON public.planes;
CREATE POLICY "planes_update_own" ON public.planes
    FOR UPDATE TO authenticated
    USING (creador_id = auth.uid()) WITH CHECK (creador_id = auth.uid());

DROP POLICY IF EXISTS "planes_delete_own" ON public.planes;
CREATE POLICY "planes_delete_own" ON public.planes
    FOR DELETE TO authenticated USING (creador_id = auth.uid());

-- ---------- participantes ----------
ALTER TABLE public.participantes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "participantes_select" ON public.participantes;
CREATE POLICY "participantes_select" ON public.participantes
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "participantes_insert_own" ON public.participantes;
CREATE POLICY "participantes_insert_own" ON public.participantes
    FOR INSERT TO authenticated WITH CHECK (usuario_id = auth.uid());

DROP POLICY IF EXISTS "participantes_update" ON public.participantes;
CREATE POLICY "participantes_update" ON public.participantes
    FOR UPDATE TO authenticated
    USING (
        usuario_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.planes p
            WHERE p.id = participantes.plan_id AND p.creador_id = auth.uid()
        )
    )
    WITH CHECK (
        usuario_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.planes p
            WHERE p.id = participantes.plan_id AND p.creador_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "participantes_delete" ON public.participantes;
CREATE POLICY "participantes_delete" ON public.participantes
    FOR DELETE TO authenticated
    USING (
        usuario_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.planes p
            WHERE p.id = participantes.plan_id AND p.creador_id = auth.uid()
        )
    );

-- ---------- amistades ----------
ALTER TABLE public.amistades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "amistades_select" ON public.amistades;
CREATE POLICY "amistades_select" ON public.amistades
    FOR SELECT TO authenticated
    USING (usuario_origen_id = auth.uid() OR usuario_destino_id = auth.uid());

DROP POLICY IF EXISTS "amistades_insert" ON public.amistades;
CREATE POLICY "amistades_insert" ON public.amistades
    FOR INSERT TO authenticated WITH CHECK (usuario_origen_id = auth.uid());

DROP POLICY IF EXISTS "amistades_update" ON public.amistades;
CREATE POLICY "amistades_update" ON public.amistades
    FOR UPDATE TO authenticated
    USING (usuario_origen_id = auth.uid() OR usuario_destino_id = auth.uid())
    WITH CHECK (usuario_origen_id = auth.uid() OR usuario_destino_id = auth.uid());

DROP POLICY IF EXISTS "amistades_delete" ON public.amistades;
CREATE POLICY "amistades_delete" ON public.amistades
    FOR DELETE TO authenticated
    USING (usuario_origen_id = auth.uid() OR usuario_destino_id = auth.uid());

-- ---------- mensajes ----------
ALTER TABLE public.mensajes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mensajes_select" ON public.mensajes;
CREATE POLICY "mensajes_select" ON public.mensajes
    FOR SELECT TO authenticated
    USING (
        emisor_id = auth.uid()
        OR receptor_id = auth.uid()
        OR (
            plan_id IS NOT NULL
            AND (
                EXISTS (
                    SELECT 1 FROM public.participantes pa
                    WHERE pa.plan_id = mensajes.plan_id
                      AND pa.usuario_id = auth.uid()
                      AND pa.estado = 'aceptado'
                )
                OR EXISTS (
                    SELECT 1 FROM public.planes p
                    WHERE p.id = mensajes.plan_id AND p.creador_id = auth.uid()
                )
            )
        )
    );

DROP POLICY IF EXISTS "mensajes_insert" ON public.mensajes;
CREATE POLICY "mensajes_insert" ON public.mensajes
    FOR INSERT TO authenticated
    WITH CHECK (
        emisor_id = auth.uid()
        AND (
            (plan_id IS NULL AND receptor_id IS NOT NULL)
            OR (
                plan_id IS NOT NULL
                AND (
                    EXISTS (
                        SELECT 1 FROM public.participantes pa
                        WHERE pa.plan_id = mensajes.plan_id
                          AND pa.usuario_id = auth.uid()
                          AND pa.estado = 'aceptado'
                    )
                    OR EXISTS (
                        SELECT 1 FROM public.planes p
                        WHERE p.id = mensajes.plan_id AND p.creador_id = auth.uid()
                    )
                )
            )
        )
    );

DROP POLICY IF EXISTS "mensajes_delete" ON public.mensajes;
CREATE POLICY "mensajes_delete" ON public.mensajes
    FOR DELETE TO authenticated
    USING (
        emisor_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.planes p
            WHERE p.id = mensajes.plan_id AND p.creador_id = auth.uid()
        )
    );

-- ---------- invitaciones_planes ----------
ALTER TABLE public.invitaciones_planes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inv_planes_select" ON public.invitaciones_planes;
CREATE POLICY "inv_planes_select" ON public.invitaciones_planes
    FOR SELECT TO authenticated
    USING (invitador_id = auth.uid() OR invitado_id = auth.uid());

DROP POLICY IF EXISTS "inv_planes_insert" ON public.invitaciones_planes;
CREATE POLICY "inv_planes_insert" ON public.invitaciones_planes
    FOR INSERT TO authenticated WITH CHECK (invitador_id = auth.uid());

DROP POLICY IF EXISTS "inv_planes_update" ON public.invitaciones_planes;
CREATE POLICY "inv_planes_update" ON public.invitaciones_planes
    FOR UPDATE TO authenticated
    USING (invitado_id = auth.uid() OR invitador_id = auth.uid())
    WITH CHECK (invitado_id = auth.uid() OR invitador_id = auth.uid());

DROP POLICY IF EXISTS "inv_planes_delete" ON public.invitaciones_planes;
CREATE POLICY "inv_planes_delete" ON public.invitaciones_planes
    FOR DELETE TO authenticated
    USING (invitador_id = auth.uid() OR invitado_id = auth.uid());

-- ---------- planes_guardados ----------
ALTER TABLE public.planes_guardados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "planes_guardados_select_own" ON public.planes_guardados;
CREATE POLICY "planes_guardados_select_own" ON public.planes_guardados
    FOR SELECT TO authenticated USING (usuario_id = auth.uid());

DROP POLICY IF EXISTS "planes_guardados_insert_own" ON public.planes_guardados;
CREATE POLICY "planes_guardados_insert_own" ON public.planes_guardados
    FOR INSERT TO authenticated WITH CHECK (usuario_id = auth.uid());

DROP POLICY IF EXISTS "planes_guardados_delete_own" ON public.planes_guardados;
CREATE POLICY "planes_guardados_delete_own" ON public.planes_guardados
    FOR DELETE TO authenticated USING (usuario_id = auth.uid());

-- ---------- historial_planes ----------
ALTER TABLE public.historial_planes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "historial_select_own" ON public.historial_planes;
CREATE POLICY "historial_select_own" ON public.historial_planes
    FOR SELECT TO authenticated USING (usuario_id = auth.uid());

DROP POLICY IF EXISTS "historial_insert_own" ON public.historial_planes;
CREATE POLICY "historial_insert_own" ON public.historial_planes
    FOR INSERT TO authenticated WITH CHECK (usuario_id = auth.uid());

-- Insignias: la app usa lib/badges.ts + estadisticas_usuario (materializadas).
-- Las tablas insignias / usuario_insignias se eliminan con badge-legacy-cleanup.sql.


-- ============================================================
-- 6. REALTIME para el chat
-- ============================================================
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.mensajes;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;

-- ============================================================
-- 7. REPORTES DE PLANES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.reportes_planes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id uuid NOT NULL REFERENCES public.planes(id) ON DELETE CASCADE,
    reportador_id uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
    motivo text NOT NULL DEFAULT 'otro',
    creado_en timestamptz NOT NULL DEFAULT now(),
    UNIQUE (plan_id, reportador_id)
);

ALTER TABLE public.reportes_planes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reportes_insert_own" ON public.reportes_planes;
CREATE POLICY "reportes_insert_own" ON public.reportes_planes
    FOR INSERT TO authenticated WITH CHECK (reportador_id = auth.uid());

DROP POLICY IF EXISTS "reportes_select_own" ON public.reportes_planes;
CREATE POLICY "reportes_select_own" ON public.reportes_planes
    FOR SELECT TO authenticated USING (reportador_id = auth.uid());

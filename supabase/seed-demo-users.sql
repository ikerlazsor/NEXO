-- ============================================================
-- NEXO · Seed demo para amigos (10 perfiles + 4 planes en feed)
-- Ejecutar ENTERO en Supabase → SQL Editor → Run.
--
-- Contraseña de todas las cuentas demo: Demo1234!
--
--   carlos.demo@nexo.test
--   lucia.demo@nexo.test
--   ana.demo@nexo.test
--   mario.demo@nexo.test
--   tomas.demo@nexo.test
--   carla.demo@nexo.test
--   vanesa.demo@nexo.test
--   maria.demo@nexo.test
--   selena.demo@nexo.test
--   antonio.demo@nexo.test
--
-- Feed: 4 planes públicos
--   1) HOY (~23:30 del día actual → badge "hoy")
--   2) COMPLETO (cupo lleno)
--   3) Pádel (mañana)
--   4) Picnic (en 3 días)
-- Idempotente: borra demos @nexo.test anteriores.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.recalcular_personas_distintas(p_usuario uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

DO $$
DECLARE
    u uuid[] := ARRAY[
        'a1111111-1111-4111-8111-111111111111'::uuid, -- Carlos
        'a2222222-2222-4222-8222-222222222222'::uuid, -- Lucía
        'a3333333-3333-4333-8333-333333333333'::uuid, -- Ana
        'a4444444-4444-4444-8444-444444444444'::uuid, -- Mario
        'a5555555-5555-4555-8555-555555555555'::uuid, -- Tomás
        'a6666666-6666-4666-8666-666666666666'::uuid, -- Carla
        'a7777777-7777-4777-8777-777777777777'::uuid, -- Vanesa
        'a8888888-8888-4888-8888-888888888888'::uuid, -- María
        'a9999999-9999-4999-8999-999999999999'::uuid, -- Selena
        'aa101010-1010-4101-8101-101010101010'::uuid  -- Antonio
    ];
    emails text[] := ARRAY[
        'carlos.demo@nexo.test',
        'lucia.demo@nexo.test',
        'ana.demo@nexo.test',
        'mario.demo@nexo.test',
        'tomas.demo@nexo.test',
        'carla.demo@nexo.test',
        'vanesa.demo@nexo.test',
        'maria.demo@nexo.test',
        'selena.demo@nexo.test',
        'antonio.demo@nexo.test'
    ];
    nombres text[] := ARRAY[
        'Carlos', 'Lucía', 'Ana', 'Mario', 'Tomás',
        'Carla', 'Vanesa', 'María', 'Selena', 'Antonio'
    ];
    handles text[] := ARRAY[
        'carlos_m', 'lucia_r', 'ana_g', 'mario_p', 'tomas_v',
        'carla_s', 'vanesa_l', 'maria_c', 'selena_n', 'antonio_f'
    ];
    generos text[] := ARRAY[
        'masculino', 'femenino', 'femenino', 'masculino', 'masculino',
        'femenino', 'femenino', 'femenino', 'femenino', 'masculino'
    ];
    bios text[] := ARRAY[
        'Ingeniero de día y foodie de noche. Me encantan las tapas y conocer gente nueva.',
        'Arquitecta. Cafés, cine y paseos sin prisa. Siempre abierta a planes espontáneos.',
        'Estudiante de diseño. Museos, picnic y buena conversación.',
        'Profe de edu. física. Fútbol, pádel y afters improvisados.',
        'Periodista. Running, vermut y planes al aire libre.',
        'Marketing. Terraza, conciertos y cero drama.',
        'Enfermera. Yoga, brunch y quedadas tranquilas.',
        'Abogada. Teatro, buena comida y planes culturales.',
        'Fotógrafa freelance. Miradores, viajes cortos y estética.',
        'Chef. Cocina, mercados y planes foodie con amigos.'
    ];
    -- Media objetivo, % repetiría, planes hechos, aspecto +, aspecto -
    ratings numeric[] := ARRAY[4.70, 4.90, 4.40, 4.20, 4.50, 4.60, 4.30, 4.80, 4.55, 4.75];
    pct_rep int[] := ARRAY[92, 97, 88, 84, 90, 93, 86, 95, 91, 94];
    planes_hechos int[] := ARRAY[14, 18, 11, 16, 13, 15, 10, 17, 12, 19];
    aspecto_pos text[] := ARRAY[
        'agradable', 'social', 'divertido', 'puntual', 'cercano',
        'divertido', 'respetuoso', 'agradable', 'social', 'cercano'
    ];
    aspecto_neg text[] := ARRAY[
        'impuntual', NULL, 'poco_participativo', 'frio', NULL,
        NULL, 'impuntual', NULL, 'poco_participativo', NULL
    ];
    v_pwd text;
    i int;
    j int;
    k int;
    r record;
    pid uuid;
    plan_ids uuid[] := ARRAY[]::uuid[];
    today_start timestamptz := date_trunc('day', now());
    v_hoy timestamptz;
    demo_ids uuid[];
    evaluador uuid;
    evaluado uuid;
    score int;
    pos_arr text[];
    neg_arr text[];
BEGIN
    v_pwd := crypt('Demo1234!', gen_salt('bf'));
    demo_ids := u;

    -- Badge "hoy": mismo día civil, casi al final (~23:30) → queda casi todo el día
    v_hoy := today_start + interval '23 hours 30 minutes';
    IF v_hoy <= now() + interval '45 minutes' THEN
        -- Si se ejecuta muy tarde, mañana 23:30 (no tendrá badge hoy)
        v_hoy := today_start + interval '1 day' + interval '23 hours 30 minutes';
    END IF;

    FOR r IN SELECT id FROM auth.users WHERE lower(email) LIKE '%@nexo.test'
    LOOP
        IF NOT (r.id = ANY (demo_ids)) THEN
            demo_ids := array_append(demo_ids, r.id);
        END IF;
    END LOOP;

    SET LOCAL session_replication_role = replica;

    DELETE FROM public.mensajes
    WHERE emisor_id = ANY (demo_ids)
       OR receptor_id = ANY (demo_ids)
       OR plan_id IN (SELECT id FROM public.planes WHERE creador_id = ANY (demo_ids));

    DELETE FROM public.valoraciones
    WHERE evaluador_id = ANY (demo_ids) OR evaluado_id = ANY (demo_ids);

    DELETE FROM public.planes_guardados
    WHERE usuario_id = ANY (demo_ids)
       OR plan_id IN (SELECT id FROM public.planes WHERE creador_id = ANY (demo_ids));

    DELETE FROM public.historial_planes
    WHERE usuario_id = ANY (demo_ids)
       OR plan_id IN (SELECT id FROM public.planes WHERE creador_id = ANY (demo_ids));

    DELETE FROM public.participantes
    WHERE usuario_id = ANY (demo_ids)
       OR plan_id IN (SELECT id FROM public.planes WHERE creador_id = ANY (demo_ids));

    DELETE FROM public.amistades
    WHERE usuario_origen_id = ANY (demo_ids) OR usuario_destino_id = ANY (demo_ids);

    DELETE FROM public.planes WHERE creador_id = ANY (demo_ids);
    DELETE FROM public.planes WHERE id::text LIKE 'd1000001%' OR id::text LIKE 'c1000000%';

    DELETE FROM public.estadisticas_usuario WHERE usuario_id = ANY (demo_ids);
    DELETE FROM auth.identities WHERE user_id = ANY (demo_ids);
    DELETE FROM public.perfiles WHERE id = ANY (demo_ids);
    DELETE FROM auth.users WHERE id = ANY (demo_ids);

    SET LOCAL session_replication_role = DEFAULT;

    -- ---------- 10 usuarios ----------
    FOR i IN 1..10 LOOP
        INSERT INTO auth.users (
            instance_id, id, aud, role, email, encrypted_password,
            email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
            created_at, updated_at, confirmation_token, recovery_token,
            email_change_token_new, email_change
        ) VALUES (
            '00000000-0000-0000-0000-000000000000', u[i],
            'authenticated', 'authenticated',
            emails[i], v_pwd, now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object(
                'nombre', nombres[i],
                'nombre_usuario', handles[i],
                'registro_completado', true,
                'onboarding_completed', true,
                'avatar_url', 'https://i.pravatar.cc/400?u=nexo-' || handles[i]
            ),
            now() - ((160 - i * 9) || ' days')::interval,
            now(), '', '', '', ''
        );

        INSERT INTO auth.identities (
            id, user_id, identity_data, provider, provider_id,
            last_sign_in_at, created_at, updated_at
        ) VALUES (
            gen_random_uuid(), u[i],
            jsonb_build_object('sub', u[i]::text, 'email', emails[i], 'email_verified', true),
            'email', u[i]::text, now(), now(), now()
        );

        UPDATE public.perfiles SET
            nombre = nombres[i],
            nombre_usuario = handles[i],
            descripcion = bios[i],
            genero = generos[i]::public.tipo_genero,
            fecha_nacimiento = (date '1994-03-12' + ((i - 1) * 211)),
            ambientes_preferidos = CASE i
                WHEN 1 THEN ARRAY['Foodie', 'Deportista', 'De terraceo']::text[]
                WHEN 2 THEN ARRAY['Viajero', 'Foodie', 'Lectura']::text[]
                WHEN 3 THEN ARRAY['Tranquilo', 'Foodie', 'Más de día']::text[]
                WHEN 4 THEN ARRAY['Deportista', 'Aventurero', 'Fiestero']::text[]
                WHEN 5 THEN ARRAY['Deportista', 'Viajero', 'Más de día']::text[]
                WHEN 6 THEN ARRAY['Fiestero', 'Foodie', 'Más de noche']::text[]
                WHEN 7 THEN ARRAY['Yoga', 'Tranquilo', 'Foodie']::text[]
                WHEN 8 THEN ARRAY['Lectura', 'Foodie', 'De terraceo']::text[]
                WHEN 9 THEN ARRAY['Viajero', 'Aventurero', 'Foodie']::text[]
                ELSE ARRAY['Foodie', 'De terraceo', 'Más de noche']::text[]
            END,
            etiquetas = CASE i
                WHEN 1 THEN ARRAY['Foodie', 'Deportista', 'De terraceo']::text[]
                WHEN 2 THEN ARRAY['Viajero', 'Foodie', 'Lectura']::text[]
                WHEN 3 THEN ARRAY['Tranquilo', 'Foodie', 'Más de día']::text[]
                WHEN 4 THEN ARRAY['Deportista', 'Aventurero', 'Fiestero']::text[]
                WHEN 5 THEN ARRAY['Deportista', 'Viajero', 'Más de día']::text[]
                WHEN 6 THEN ARRAY['Fiestero', 'Foodie', 'Más de noche']::text[]
                WHEN 7 THEN ARRAY['Yoga', 'Tranquilo', 'Foodie']::text[]
                WHEN 8 THEN ARRAY['Lectura', 'Foodie', 'De terraceo']::text[]
                WHEN 9 THEN ARRAY['Viajero', 'Aventurero', 'Foodie']::text[]
                ELSE ARRAY['Foodie', 'De terraceo', 'Más de noche']::text[]
            END,
            habitos_consumo = CASE
                WHEN i IN (1, 4, 6, 10) THEN '{"bebida":"si","tabaco":"no"}'::jsonb
                WHEN i IN (2, 7, 8) THEN '{"bebida":"ocasional","tabaco":"no"}'::jsonb
                ELSE '{"bebida":"ocasional","tabaco":"ocasional"}'::jsonb
            END,
            perfil_gustos = '{"privacidad":{"mostrar_edad":true,"mostrar_genero":true,"mostrar_bebida":true,"mostrar_tabaco":true,"mostrar_aficiones":true}}'::jsonb,
            registro_completado = true,
            avatar_url = 'https://i.pravatar.cc/400?u=nexo-' || handles[i]
        WHERE id = u[i];
    END LOOP;

    -- Amigos entre casi todos
    FOR i IN 1..10 LOOP
        FOR j IN (i + 1)..10 LOOP
            INSERT INTO public.amistades (usuario_origen_id, usuario_destino_id, estado)
            VALUES (u[i], u[j], 'aceptado')
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;

    -- ---------- Planes PASADOS (historial + valoraciones) ----------
    FOR i IN 1..10 LOOP
        pid := ('c1000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
        plan_ids := array_append(plan_ids, pid);
        INSERT INTO public.planes (
            id, titulo, descripcion, categoria, tipo_deporte, creador_id,
            fecha_evento, maximo_participantes, minimo_participantes, imagen_url,
            nombre_ubicacion, latitud, longitud,
            requiere_aprobacion, solo_chicas, solo_amigos, modo_privado
        ) VALUES (
            pid,
            CASE i
                WHEN 1 THEN 'Tapas en La Latina'
                WHEN 2 THEN 'Partido de fútbol 7'
                WHEN 3 THEN 'Cine + cañas'
                WHEN 4 THEN 'Picnic en Retiro'
                WHEN 5 THEN 'Café y estudio'
                WHEN 6 THEN 'Concierto en sala'
                WHEN 7 THEN 'Running atardecer'
                WHEN 8 THEN 'Noche de juegos de mesa'
                WHEN 9 THEN 'Vermut del domingo'
                ELSE 'Pádel dobles'
            END,
            'Plan pasado demo — historial y valoraciones.',
            CASE i
                WHEN 1 THEN 'FOODIES'
                WHEN 2 THEN 'DEPORTES'
                WHEN 3 THEN 'SHOWTIME'
                WHEN 4 THEN 'AIRE_LIBRE'
                WHEN 5 THEN 'DESCUBRIR'
                WHEN 6 THEN 'SHOWTIME'
                WHEN 7 THEN 'DEPORTES'
                WHEN 8 THEN 'VIBES'
                WHEN 9 THEN 'FOODIES'
                ELSE 'DEPORTES'
            END,
            CASE i
                WHEN 1 THEN 'tapas'
                WHEN 2 THEN 'futbol'
                WHEN 3 THEN 'cine'
                WHEN 4 THEN 'picnic'
                WHEN 5 THEN 'estudio'
                WHEN 6 THEN 'concierto'
                WHEN 7 THEN 'running'
                WHEN 8 THEN 'juegos_mesa'
                WHEN 9 THEN 'tapas'
                ELSE 'padel'
            END,
            u[((i - 1) % 10) + 1],
            now() - ((40 - i * 3) || ' days')::interval - interval '3 hours',
            8,
            2,
            CASE i
                WHEN 1 THEN 'nexo_cover:FOODIES:tapas:0'
                WHEN 2 THEN 'nexo_cover:DEPORTES:futbol:0'
                WHEN 3 THEN 'nexo_cover:SHOWTIME:cine:0'
                WHEN 4 THEN 'nexo_cover:AIRE_LIBRE:picnic:0'
                WHEN 5 THEN 'nexo_cover:DESCUBRIR:estudio:0'
                WHEN 6 THEN 'nexo_cover:SHOWTIME:concierto:1'
                WHEN 7 THEN 'nexo_cover:DEPORTES:running:0'
                WHEN 8 THEN 'nexo_cover:VIBES:juegos_mesa:0'
                WHEN 9 THEN 'nexo_cover:FOODIES:tapas:1'
                ELSE 'nexo_cover:DEPORTES:padel:0'
            END,
            CASE i
                WHEN 1 THEN 'La Latina'
                WHEN 2 THEN 'Polideportivo Sur'
                WHEN 3 THEN 'Yelmo Ideal'
                WHEN 4 THEN 'Parque del Retiro'
                WHEN 5 THEN 'Café Central'
                WHEN 6 THEN 'Sala El Sol'
                WHEN 7 THEN 'Madrid Río'
                WHEN 8 THEN 'Malasaña'
                WHEN 9 THEN 'Bar El Rincón'
                ELSE 'Club Pádel Chamberí'
            END,
            40.4168 + (i * 0.002), -3.7038 - (i * 0.001),
            false, false, false, false
        ) ON CONFLICT (id) DO NOTHING;

        FOR j IN 0..5 LOOP
            INSERT INTO public.participantes (plan_id, usuario_id, estado)
            VALUES (pid, u[((i + j - 1) % 10) + 1], 'aceptado')
            ON CONFLICT DO NOTHING;

            INSERT INTO public.historial_planes (usuario_id, plan_id, creado_en)
            VALUES (
                u[((i + j - 1) % 10) + 1],
                pid,
                now() - ((40 - i * 3) || ' days')::interval
            )
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;

    -- Valoraciones cruzadas con aspectos + / −
    FOR i IN 1..10 LOOP
        evaluado := u[i];
        FOR j IN 1..7 LOOP
            evaluador := u[((i + j - 1) % 10) + 1];
            IF evaluador = evaluado THEN
                CONTINUE;
            END IF;
            score := GREATEST(3, LEAST(5, round(ratings[i])::int + ((j % 3) - 1)));
            pos_arr := CASE (j % 4)
                WHEN 0 THEN ARRAY[aspecto_pos[i], 'social']
                WHEN 1 THEN ARRAY[aspecto_pos[i], 'divertido']
                WHEN 2 THEN ARRAY['agradable', 'puntual']
                ELSE ARRAY['cercano', 'respetuoso']
            END;
            IF aspecto_neg[i] IS NOT NULL AND j IN (1, 4) AND score <= 4 THEN
                neg_arr := ARRAY[aspecto_neg[i]];
            ELSE
                neg_arr := '{}';
            END IF;

            INSERT INTO public.valoraciones (
                plan_id, evaluador_id, evaluado_id, asistencia, puntuacion_general,
                repetiria_experiencia, aspectos_positivos, aspectos_negativos
            ) VALUES (
                plan_ids[((j - 1) % array_length(plan_ids, 1)) + 1],
                evaluador,
                evaluado,
                true,
                score,
                CASE
                    WHEN ratings[i] >= 4.5 AND j <> 2 THEN 'si'
                    WHEN j = 2 AND ratings[i] < 4.4 THEN 'no'
                    WHEN j = 5 THEN 'indiferente'
                    ELSE 'si'
                END,
                pos_arr,
                neg_arr
            ) ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;

    -- ---------- 4 PLANES EN FEED ----------
    INSERT INTO public.planes (
        id, titulo, descripcion, categoria, tipo_deporte, creador_id,
        fecha_evento, maximo_participantes, minimo_participantes, imagen_url,
        nombre_ubicacion, latitud, longitud,
        requiere_aprobacion, solo_chicas, solo_amigos, modo_privado
    ) VALUES
        -- 1) HOY (~23:30) — badge hoy, casi 24h si se ejecuta de mañana
        (
            'd1000001-0001-4001-8001-000000000001',
            'Cañas esta noche en Malasaña',
            'Plan de hoy: terraza, cañas y buena conversación. Ambiente relajado, ven cuando puedas.',
            'FOODIES', 'tapas', u[1],
            v_hoy, 8, 2, 'nexo_cover:FOODIES:tapas:0',
            'Malasaña · Plaza de San Ildefonso', 40.4258, -3.7039,
            false, false, false, false
        ),
        -- 2) COMPLETO
        (
            'd1000001-0001-4001-8001-000000000002',
            'Fútbol 7 — cupo completo',
            'Partido amistoso nivel medio. Ya estamos completos; mira lista de espera si te apuntas.',
            'DEPORTES', 'futbol', u[4],
            today_start + interval '2 days' + interval '19 hours', 6, 2,
            'nexo_cover:DEPORTES:futbol:0',
            'Polideportivo Vallecas', 40.393, -3.652,
            false, false, false, false
        ),
        -- 3) Pádel mañana
        (
            'd1000001-0001-4001-8001-000000000003',
            'Pádel dobles mañana',
            'Dos pistas, nivel intermedio. Luego vermut cerca del club.',
            'DEPORTES', 'padel', u[5],
            today_start + interval '1 day' + interval '18 hours', 4, 2,
            'nexo_cover:DEPORTES:padel:0',
            'Club Pádel Chamberí', 40.435, -3.704,
            false, false, false, false
        ),
        -- 4) Picnic
        (
            'd1000001-0001-4001-8001-000000000004',
            'Picnic en el Retiro',
            'Mantas, snacks y playlist chill. Ideal para conocer gente nueva un domingo.',
            'AIRE_LIBRE', 'picnic', u[2],
            today_start + interval '3 days' + interval '12 hours', 10, 2,
            'nexo_cover:AIRE_LIBRE:picnic:0',
            'Parque del Retiro · Estanque', 40.417, -3.683,
            false, false, false, false
        )
    ON CONFLICT (id) DO UPDATE SET
        titulo = EXCLUDED.titulo,
        descripcion = EXCLUDED.descripcion,
        fecha_evento = EXCLUDED.fecha_evento,
        maximo_participantes = EXCLUDED.maximo_participantes,
        creador_id = EXCLUDED.creador_id,
        imagen_url = EXCLUDED.imagen_url,
        nombre_ubicacion = EXCLUDED.nombre_ubicacion;

    -- Participantes feed
    INSERT INTO public.participantes (plan_id, usuario_id, estado) VALUES
        -- Hoy cañas 5/8
        ('d1000001-0001-4001-8001-000000000001', u[1], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000001', u[2], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000001', u[6], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000001', u[8], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000001', u[10], 'aceptado'),
        -- Fútbol COMPLETO 6/6 + 1 espera
        ('d1000001-0001-4001-8001-000000000002', u[4], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000002', u[1], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000002', u[5], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000002', u[9], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000002', u[3], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000002', u[7], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000002', u[2], 'lista_espera'),
        -- Pádel 3/4
        ('d1000001-0001-4001-8001-000000000003', u[5], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000003', u[4], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000003', u[10], 'aceptado'),
        -- Picnic 6/10
        ('d1000001-0001-4001-8001-000000000004', u[2], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000004', u[3], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000004', u[6], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000004', u[7], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000004', u[8], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000004', u[9], 'aceptado')
    ON CONFLICT DO NOTHING;

    -- ---------- Chats de plan (conversaciones naturales) ----------
    -- Plan HOY
    INSERT INTO public.mensajes (plan_id, emisor_id, receptor_id, contenido, tipo, creado_en) VALUES
        ('d1000001-0001-4001-8001-000000000001', u[1], NULL, '¡Hecho el plan! Cañas esta noche en Malasaña 🍻', 'texto', now() - interval '5 hours'),
        ('d1000001-0001-4001-8001-000000000001', u[2], NULL, 'Yo voy! ¿Quedamos en la plaza a esa hora?', 'texto', now() - interval '4 hours 50 minutes'),
        ('d1000001-0001-4001-8001-000000000001', u[1], NULL, 'Sí, San Ildefonso. Si hay cola nos vamos al de al lado.', 'texto', now() - interval '4 hours 40 minutes'),
        ('d1000001-0001-4001-8001-000000000001', u[6], NULL, 'Apuntadme. ¿Llevo patatas o algo?', 'texto', now() - interval '4 hours'),
        ('d1000001-0001-4001-8001-000000000001', u[8], NULL, 'Yo también. Me viene genial después de currar.', 'texto', now() - interval '3 hours 20 minutes'),
        ('d1000001-0001-4001-8001-000000000001', u[10], NULL, 'Si queréis puedo reservar mesa por si se llena.', 'texto', now() - interval '2 hours 50 minutes'),
        ('d1000001-0001-4001-8001-000000000001', u[1], NULL, 'Antonio crack. Reserva para 6–8 por si se anima más gente.', 'texto', now() - interval '2 hours 40 minutes'),
        ('d1000001-0001-4001-8001-000000000001', u[2], NULL, 'Perfecto. Yo llego puntual, prometido 😄', 'texto', now() - interval '2 hours'),
        ('d1000001-0001-4001-8001-000000000001', u[6], NULL, '¿Alguien viene en metro? Yo bajo en Tribunal.', 'texto', now() - interval '90 minutes'),
        ('d1000001-0001-4001-8001-000000000001', u[8], NULL, 'Yo también Tribunal. Quedamos abajo y vamos juntos?', 'texto', now() - interval '80 minutes'),
        ('d1000001-0001-4001-8001-000000000001', u[6], NULL, 'Dale!', 'texto', now() - interval '75 minutes'),
        ('d1000001-0001-4001-8001-000000000001', u[10], NULL, 'Mesa confirmada. Hasta luego!', 'texto', now() - interval '40 minutes'),
        ('d1000001-0001-4001-8001-000000000001', u[1], NULL, 'Top. Os escribo cuando esté llegando.', 'texto', now() - interval '25 minutes');

    -- Plan COMPLETO fútbol
    INSERT INTO public.mensajes (plan_id, emisor_id, receptor_id, contenido, tipo, creado_en) VALUES
        ('d1000001-0001-4001-8001-000000000002', u[4], NULL, 'Partido el jueves 19:00. Nivel medio, nada de agresividad.', 'texto', now() - interval '2 days'),
        ('d1000001-0001-4001-8001-000000000002', u[1], NULL, 'Yo de defensa. Apuntadme.', 'texto', now() - interval '2 days' + interval '12 minutes'),
        ('d1000001-0001-4001-8001-000000000002', u[5], NULL, 'Voy de portero si hace falta.', 'texto', now() - interval '47 hours'),
        ('d1000001-0001-4001-8001-000000000002', u[9], NULL, 'Yo ataque. ¿Hay chalecos?', 'texto', now() - interval '46 hours'),
        ('d1000001-0001-4001-8001-000000000002', u[4], NULL, 'Llevo chalecos y balón. Solo faltan botas.', 'texto', now() - interval '45 hours'),
        ('d1000001-0001-4001-8001-000000000002', u[3], NULL, 'Me uno! Primera vez en Nexo y con ganas.', 'texto', now() - interval '30 hours'),
        ('d1000001-0001-4001-8001-000000000002', u[7], NULL, 'Última plaza? Si cabe yo también.', 'texto', now() - interval '28 hours'),
        ('d1000001-0001-4001-8001-000000000002', u[4], NULL, 'Completo! Lucía queda en lista de espera.', 'texto', now() - interval '20 hours'),
        ('d1000001-0001-4001-8001-000000000002', u[2], NULL, 'Ok, avísame si alguien cae 🙏', 'texto', now() - interval '19 hours'),
        ('d1000001-0001-4001-8001-000000000002', u[5], NULL, 'Quedamos 10 min antes en la puerta del poli.', 'texto', now() - interval '12 hours'),
        ('d1000001-0001-4001-8001-000000000002', u[1], NULL, 'Hecho. ¿Alguien acerca coche?', 'texto', now() - interval '10 hours'),
        ('d1000001-0001-4001-8001-000000000002', u[9], NULL, 'Yo puedo llevar a 2 desde Atocha.', 'texto', now() - interval '9 hours'),
        ('d1000001-0001-4001-8001-000000000002', u[3], NULL, 'Yo me apunto al coche de Selena!', 'texto', now() - interval '8 hours'),
        ('d1000001-0001-4001-8001-000000000002', u[4], NULL, 'Perfecto equipo. Nos vemos ahí ⚽', 'texto', now() - interval '3 hours');

    -- Pádel
    INSERT INTO public.mensajes (plan_id, emisor_id, receptor_id, contenido, tipo, creado_en) VALUES
        ('d1000001-0001-4001-8001-000000000003', u[5], NULL, 'Pádel mañana 18:00. Queda 1 plaza.', 'texto', now() - interval '26 hours'),
        ('d1000001-0001-4001-8001-000000000003', u[4], NULL, 'Yo estoy. Nivel medio ok?', 'texto', now() - interval '25 hours'),
        ('d1000001-0001-4001-8001-000000000003', u[5], NULL, 'Sí, nada pro. Luego vermut.', 'texto', now() - interval '24 hours 50 minutes'),
        ('d1000001-0001-4001-8001-000000000003', u[10], NULL, 'Me apunto. Llevo pelotas nuevas.', 'texto', now() - interval '20 hours'),
        ('d1000001-0001-4001-8001-000000000003', u[5], NULL, 'Genial Antonio. Parejas: yo+Mario / Tomás+Antonio?', 'texto', now() - interval '18 hours'),
        ('d1000001-0001-4001-8001-000000000003', u[4], NULL, 'Me vale.', 'texto', now() - interval '17 hours'),
        ('d1000001-0001-4001-8001-000000000003', u[10], NULL, 'Perfecto. ¿Alquilamos raquetas o traéis?', 'texto', now() - interval '10 hours'),
        ('d1000001-0001-4001-8001-000000000003', u[5], NULL, 'Yo llevo la mía. En recepción hay alquiler barato.', 'texto', now() - interval '9 hours'),
        ('d1000001-0001-4001-8001-000000000003', u[4], NULL, 'Yo también llevo. Nos vemos en recepción 10 min antes.', 'texto', now() - interval '4 hours'),
        ('d1000001-0001-4001-8001-000000000003', u[10], NULL, 'Dale. Después proponed sitio de vermut 😄', 'texto', now() - interval '2 hours');

    -- Picnic
    INSERT INTO public.mensajes (plan_id, emisor_id, receptor_id, contenido, tipo, creado_en) VALUES
        ('d1000001-0001-4001-8001-000000000004', u[2], NULL, 'Picnic el domingo cerca del estanque. Traed manta si podéis!', 'texto', now() - interval '3 days'),
        ('d1000001-0001-4001-8001-000000000004', u[3], NULL, 'Qué mono. Yo llevo frutas y zumos.', 'texto', now() - interval '3 days' + interval '20 minutes'),
        ('d1000001-0001-4001-8001-000000000004', u[6], NULL, 'Yo croissants y café termos.', 'texto', now() - interval '2 days 12 hours'),
        ('d1000001-0001-4001-8001-000000000004', u[7], NULL, 'Llevo una manta grande y altavoz bajito.', 'texto', now() - interval '2 days'),
        ('d1000001-0001-4001-8001-000000000004', u[8], NULL, 'Yo quesos y pan. Qué ganas.', 'texto', now() - interval '40 hours'),
        ('d1000001-0001-4001-8001-000000000004', u[9], NULL, 'Yo cámara + postre. Site: ¿lado del monumento?', 'texto', now() - interval '30 hours'),
        ('d1000001-0001-4001-8001-000000000004', u[2], NULL, 'Sí, hierba a la derecha del estanque mirando al monumento.', 'texto', now() - interval '29 hours'),
        ('d1000001-0001-4001-8001-000000000004', u[3], NULL, 'Si llueve movemos a un café cercano?', 'texto', now() - interval '20 hours'),
        ('d1000001-0001-4001-8001-000000000004', u[2], NULL, 'Plan B: Café del Retiro. Pero la previsión es buena.', 'texto', now() - interval '19 hours'),
        ('d1000001-0001-4001-8001-000000000004', u[6], NULL, 'Yo llego en bici. Os mando ubicación cuando esté.', 'texto', now() - interval '12 hours'),
        ('d1000001-0001-4001-8001-000000000004', u[7], NULL, 'Playlist colaborativa? Paso link luego.', 'texto', now() - interval '8 hours'),
        ('d1000001-0001-4001-8001-000000000004', u[8], NULL, 'Sííí. Nada de reggaeton a todo volumen please 😂', 'texto', now() - interval '7 hours'),
        ('d1000001-0001-4001-8001-000000000004', u[9], NULL, 'Chill indie + bossa. Hecho.', 'texto', now() - interval '5 hours'),
        ('d1000001-0001-4001-8001-000000000004', u[2], NULL, 'Equipo soñado. Nos vemos domingo ☀️', 'texto', now() - interval '90 minutes');

    -- Chats directos entre algunos pares
    FOR i IN 1..10 LOOP
        FOR j IN 1..5 LOOP
            INSERT INTO public.mensajes (plan_id, emisor_id, receptor_id, contenido, tipo, creado_en)
            VALUES (
                NULL, u[i], u[(i % 10) + 1],
                CASE (j % 5)
                    WHEN 0 THEN 'Ey! ¿Vienes al plan de esta semana?'
                    WHEN 1 THEN 'Sí, me apunto seguro'
                    WHEN 2 THEN '¿Quedamos antes un café?'
                    WHEN 3 THEN 'He visto el picnic, tiene muy buena pinta'
                    ELSE 'Hablamos luego!'
                END,
                'texto',
                now() - ((i * 8 + j) || ' hours')::interval
            );
            INSERT INTO public.mensajes (plan_id, emisor_id, receptor_id, contenido, tipo, creado_en)
            VALUES (
                NULL, u[(i % 10) + 1], u[i],
                CASE (j % 4)
                    WHEN 0 THEN 'Dale, me va bien'
                    WHEN 1 THEN 'Aviso si llego tarde'
                    WHEN 2 THEN 'Guay 🔥'
                    ELSE 'Nos vemos!'
                END,
                'texto',
                now() - ((i * 8 + j) || ' hours')::interval + interval '4 minutes'
            );
        END LOOP;
    END LOOP;

    -- Guardados
    INSERT INTO public.planes_guardados (usuario_id, plan_id) VALUES
        (u[3], 'd1000001-0001-4001-8001-000000000001'),
        (u[7], 'd1000001-0001-4001-8001-000000000001'),
        (u[2], 'd1000001-0001-4001-8001-000000000002'),
        (u[6], 'd1000001-0001-4001-8001-000000000003'),
        (u[1], 'd1000001-0001-4001-8001-000000000004'),
        (u[4], 'd1000001-0001-4001-8001-000000000004'),
        (u[10], 'd1000001-0001-4001-8001-000000000004')
    ON CONFLICT DO NOTHING;

    -- Stats
    FOR i IN 1..10 LOOP
        INSERT INTO public.estadisticas_usuario (usuario_id) VALUES (u[i])
        ON CONFLICT (usuario_id) DO NOTHING;

        BEGIN
            PERFORM public.recalcular_estadisticas_valoraciones(u[i]);
            PERFORM public.recalcular_numero_amistades(u[i]);
            PERFORM public.recalcular_personas_distintas(u[i]);
        EXCEPTION WHEN undefined_function THEN
            NULL;
        END;

        UPDATE public.estadisticas_usuario SET
            valoracion_media = ratings[i],
            numero_valoraciones = 8 + i,
            numero_evaluadores_distintos = 7,
            porcentaje_repetiria = pct_rep[i],
            porcentaje_asistencia = 96 + (i % 4),
            numero_planes_realizados = planes_hechos[i],
            numero_amistades = 9,
            planes_tapas = 6 + (i % 6),
            planes_deporte = 5 + ((i + 1) % 7),
            planes_fiesta = 4 + (i % 5),
            planes_estudio = 3 + ((i + 2) % 4),
            planes_solo_chicas = CASE WHEN generos[i] = 'femenino' THEN 4 + (i % 3) ELSE 0 END,
            categorias_probadas = 5,
            planes_creados = 3 + (i % 4),
            personas_distintas = 12 + i,
            aspecto_positivo_mas_votado = aspecto_pos[i],
            votos_aspecto_positivo = 5 + (i % 4),
            aspecto_negativo_mas_votado = aspecto_neg[i],
            votos_aspecto_negativo = CASE WHEN aspecto_neg[i] IS NULL THEN 0 ELSE 1 + (i % 2) END,
            actualizado_en = now()
        WHERE usuario_id = u[i];
    END LOOP;

    -- Lucía y Antonio un poco más “top”
    UPDATE public.estadisticas_usuario SET
        planes_tapas = 18,
        planes_deporte = 14,
        planes_fiesta = 12,
        planes_creados = 8,
        categorias_probadas = 6,
        numero_planes_realizados = 22
    WHERE usuario_id IN (u[2], u[10]);

    RAISE NOTICE 'Seed listo: 10 perfiles + 4 planes feed. Pass: Demo1234! Hoy=%', v_hoy;
END $$;

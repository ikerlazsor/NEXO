-- ============================================================
-- NEXO · Seed demo ampliado (10 cuentas + muchos planes/chats)
-- Ejecutar ENTERO en Supabase SQL Editor.
-- Contraseña de todas: Demo1234!
--
--   lucia.demo@nexo.test   → ~5.0
--   marco.demo@nexo.test   → ~4.6
--   sofia.demo@nexo.test   → ~4.2
--   diego.demo@nexo.test   → ~3.8
--   emma.demo@nexo.test    → ~3.4
--   nora.demo@nexo.test    → ~4.8
--   alex.demo@nexo.test    → ~4.4
--   carmen.demo@nexo.test  → ~4.0
--   pablo.demo@nexo.test   → ~3.6
--   laura.demo@nexo.test   → ~4.9
--
-- Idempotente: borra demos @nexo.test anteriores.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Evita el error FK al borrar usuarios (trigger de participantes)
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
    -- Si el perfil ya no existe (borrado en cascada), no insertar stats
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
        'a1111111-1111-4111-8111-111111111111'::uuid,
        'a2222222-2222-4222-8222-222222222222'::uuid,
        'a3333333-3333-4333-8333-333333333333'::uuid,
        'a4444444-4444-4444-8444-444444444444'::uuid,
        'a5555555-5555-4555-8555-555555555555'::uuid,
        'a6666666-6666-4666-8666-666666666666'::uuid,
        'a7777777-7777-4777-8777-777777777777'::uuid,
        'a8888888-8888-4888-8888-888888888888'::uuid,
        'a9999999-9999-4999-8999-999999999999'::uuid,
        'aa101010-1010-4101-8101-101010101010'::uuid
    ];
    emails text[] := ARRAY[
        'lucia.demo@nexo.test',
        'marco.demo@nexo.test',
        'sofia.demo@nexo.test',
        'diego.demo@nexo.test',
        'emma.demo@nexo.test',
        'nora.demo@nexo.test',
        'alex.demo@nexo.test',
        'carmen.demo@nexo.test',
        'pablo.demo@nexo.test',
        'laura.demo@nexo.test'
    ];
    nombres text[] := ARRAY[
        'Lucía', 'Marco', 'Sofía', 'Diego', 'Emma',
        'Nora', 'Alex', 'Carmen', 'Pablo', 'Laura'
    ];
    handles text[] := ARRAY[
        'lucia_demo', 'marco_demo', 'sofia_demo', 'diego_demo', 'emma_demo',
        'nora_demo', 'alex_demo', 'carmen_demo', 'pablo_demo', 'laura_demo'
    ];
    generos text[] := ARRAY[
        'femenino', 'masculino', 'femenino', 'masculino', 'femenino',
        'femenino', 'masculino', 'femenino', 'masculino', 'femenino'
    ];
    bios text[] := ARRAY[
        'Me encantan los planes espontáneos y conocer gente nueva.',
        'Deporte, tapas y buena conversación.',
        'Cine, museos y cafés con vistas.',
        'Quedadas de fútbol y afters improvisados.',
        'Senderismo, picnic y planes chill.',
        'Fiestas, conciertos y cero drama.',
        'Running por la mañana y vermut por la tarde.',
        'Cultura, teatro y buen rollo.',
        'Pádel, gaming y pizza.',
        'Viajes cortos y planes foodie.'
    ];
    ratings numeric[] := ARRAY[5.00, 4.60, 4.20, 3.80, 3.40, 4.80, 4.40, 4.00, 3.60, 4.90];
    v_pwd text;
    i int;
    j int;
    r record;
    pid uuid;
    plan_ids uuid[] := ARRAY[]::uuid[];
    today_start timestamptz := date_trunc('day', now());
    v_hoy timestamptz;
    demo_ids uuid[];
BEGIN
    v_pwd := crypt('Demo1234!', gen_salt('bf'));
    demo_ids := u;
    -- Planes "hoy" siempre futuros y del día actual (diseño oro del feed)
    v_hoy := LEAST(
        GREATEST(now() + interval '2 hours', today_start + interval '14 hours'),
        today_start + interval '23 hours'
    );
    IF v_hoy <= now() THEN
        v_hoy := now() + interval '30 minutes';
    END IF;

    -- Incluir cualquier @nexo.test ya existente
    FOR r IN SELECT id FROM auth.users WHERE lower(email) LIKE '%@nexo.test'
    LOOP
        IF NOT (r.id = ANY (demo_ids)) THEN
            demo_ids := array_append(demo_ids, r.id);
        END IF;
    END LOOP;

    -- Limpieza sin disparar triggers rotos (orden seguro)
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
    -- planes demo con ids fijos
    DELETE FROM public.planes WHERE id::text LIKE 'd1000001%' OR id::text LIKE 'c1000000%';

    DELETE FROM public.estadisticas_usuario WHERE usuario_id = ANY (demo_ids);
    DELETE FROM auth.identities WHERE user_id = ANY (demo_ids);
    DELETE FROM public.perfiles WHERE id = ANY (demo_ids);
    DELETE FROM auth.users WHERE id = ANY (demo_ids);

    SET LOCAL session_replication_role = DEFAULT;

    -- Crear 10 usuarios
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
            now() - ((130 - i * 8) || ' days')::interval,
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
            fecha_nacimiento = (date '1996-01-01' + (i * 137)),
            ambientes_preferidos = CASE
                WHEN generos[i] = 'femenino' THEN ARRAY['Viajero', 'Foodie', 'Fiestero']
                ELSE ARRAY['Deportista', 'Aventurero', 'Tranquilo']
            END,
            etiquetas = CASE
                WHEN generos[i] = 'femenino' THEN ARRAY['Viajero', 'Foodie', 'Fiestero']
                ELSE ARRAY['Deportista', 'Aventurero', 'Tranquilo']
            END,
            habitos_consumo = '{"bebida":"ocasional","tabaco":"no"}'::jsonb,
            perfil_gustos = '{"privacidad":{"mostrar_edad":true,"mostrar_genero":true,"mostrar_bebida":true,"mostrar_tabaco":true,"mostrar_aficiones":true}}'::jsonb,
            registro_completado = true,
            avatar_url = 'https://i.pravatar.cc/400?u=nexo-' || handles[i]
        WHERE id = u[i];
    END LOOP;

    -- Amistades: casi todos amigos entre sí
    FOR i IN 1..10 LOOP
        FOR j IN (i + 1)..10 LOOP
            INSERT INTO public.amistades (usuario_origen_id, usuario_destino_id, estado)
            VALUES (u[i], u[j], 'aceptado')
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;

    -- Lucía: solicitudes recibidas + enviadas (y deja de ser amiga de esos)
    DELETE FROM public.amistades
    WHERE (usuario_origen_id = u[1] AND usuario_destino_id IN (u[2], u[3], u[4], u[5], u[9]))
       OR (usuario_destino_id = u[1] AND usuario_origen_id IN (u[2], u[3], u[4], u[5], u[9]));

    INSERT INTO public.amistades (usuario_origen_id, usuario_destino_id, estado) VALUES
        (u[2], u[1], 'pendiente'),  -- Marco → Lucía (recibida)
        (u[3], u[1], 'pendiente'),  -- Sofía → Lucía (recibida)
        (u[9], u[1], 'pendiente'),  -- Pablo → Lucía (recibida)
        (u[1], u[4], 'pendiente'),  -- Lucía → Diego (enviada)
        (u[1], u[5], 'pendiente')   -- Lucía → Emma (enviada)
    ON CONFLICT DO NOTHING;

    -- ---------- Planes pasados (historial + valoraciones) ----------
    FOR i IN 1..8 LOOP
        pid := ('c1000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
        plan_ids := array_append(plan_ids, pid);
        INSERT INTO public.planes (
            id, titulo, descripcion, categoria, tipo_deporte, creador_id,
            fecha_evento, maximo_participantes, imagen_url,
            nombre_ubicacion, latitud, longitud,
            requiere_aprobacion, solo_chicas, solo_amigos, modo_privado
        ) VALUES (
            pid,
            CASE i
                WHEN 1 THEN 'Tapas en el centro'
                WHEN 2 THEN 'Partido de fútbol 7'
                WHEN 3 THEN 'Cine + cañas'
                WHEN 4 THEN 'Picnic en el parque'
                WHEN 5 THEN 'Café y estudio'
                WHEN 6 THEN 'Concierto improvisado'
                WHEN 7 THEN 'Running atardecer'
                ELSE 'Noche de juegos de mesa'
            END,
            'Plan demo pasado para valoraciones e historial.',
            CASE i
                WHEN 1 THEN 'FOODIES'
                WHEN 2 THEN 'DEPORTES'
                WHEN 3 THEN 'SHOWTIME'
                WHEN 4 THEN 'AIRE_LIBRE'
                WHEN 5 THEN 'DESCUBRIR'
                WHEN 6 THEN 'SHOWTIME'
                WHEN 7 THEN 'DEPORTES'
                ELSE 'VIBES'
            END,
            CASE i
                WHEN 1 THEN 'tapas'
                WHEN 2 THEN 'futbol'
                WHEN 3 THEN 'cine'
                WHEN 4 THEN 'picnic'
                WHEN 5 THEN 'estudio'
                WHEN 6 THEN 'concierto'
                WHEN 7 THEN 'running'
                ELSE 'juegos_mesa'
            END,
            u[((i - 1) % 10) + 1],
            now() - ((25 - i) || ' days')::interval,
            10,
            CASE i
                WHEN 1 THEN 'nexo_cover:FOODIES:tapas:0'
                WHEN 2 THEN 'nexo_cover:DEPORTES:futbol:0'
                WHEN 3 THEN 'nexo_cover:SHOWTIME:cine:0'
                WHEN 4 THEN 'nexo_cover:AIRE_LIBRE:picnic:0'
                WHEN 5 THEN 'nexo_cover:DESCUBRIR:estudio:0'
                WHEN 6 THEN 'nexo_cover:SHOWTIME:concierto:1'
                WHEN 7 THEN 'nexo_cover:DEPORTES:running:0'
                ELSE 'nexo_cover:VIBES:juegos_mesa:0'
            END,
            'Madrid centro', 40.4168, -3.7038,
            false, false, false, false
        ) ON CONFLICT (id) DO NOTHING;

        -- 5 participantes por plan pasado
        FOR j IN 0..4 LOOP
            INSERT INTO public.participantes (plan_id, usuario_id, estado)
            VALUES (pid, u[((i + j - 1) % 10) + 1], 'aceptado')
            ON CONFLICT DO NOTHING;

            INSERT INTO public.historial_planes (usuario_id, plan_id, creado_en)
            VALUES (u[((i + j - 1) % 10) + 1], pid, now() - ((25 - i) || ' days')::interval)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;

    -- Valoraciones cruzadas (medias aproximadas forzadas luego en stats)
    FOR i IN 1..10 LOOP
        FOR j IN 1..5 LOOP
            INSERT INTO public.valoraciones (
                plan_id, evaluador_id, evaluado_id, asistencia, puntuacion_general,
                repetiria_experiencia, aspectos_positivos, aspectos_negativos
            ) VALUES (
                plan_ids[((j - 1) % array_length(plan_ids, 1)) + 1],
                u[((i + j) % 10) + 1],
                u[i],
                true,
                GREATEST(3, LEAST(5, round(ratings[i])::int + ((j % 3) - 1))),
                CASE WHEN ratings[i] >= 4 THEN 'si' ELSE CASE WHEN j = 1 THEN 'no' ELSE 'si' END END,
                ARRAY['agradable', 'social'],
                '{}'
            ) ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;

    -- ---------- Planes FUTUROS (feed) ----------
    -- Hoy (varios)
    INSERT INTO public.planes (
        id, titulo, descripcion, categoria, tipo_deporte, creador_id,
        fecha_evento, maximo_participantes, imagen_url,
        nombre_ubicacion, latitud, longitud,
        requiere_aprobacion, solo_chicas, solo_amigos, modo_privado
    ) VALUES
        ('d1000001-0001-4001-8001-000000000001', 'Café esta tarde', 'Hoy: café improvisado.', 'FOODIES', 'cafe', u[1],
         v_hoy, 6, 'nexo_cover:FOODIES:cafe:0',
         'Malasaña', 40.426, -3.704, false, false, false, false),
        ('d1000001-0001-4001-8001-000000000002', 'Pádel hoy', 'Hoy por la noche, dobles.', 'DEPORTES', 'padel', u[2],
         v_hoy + interval '2 hours', 4, 'nexo_cover:DEPORTES:padel:0',
         'Club Pádel', 40.45, -3.69, false, false, false, false),
        ('d1000001-0001-4001-8001-000000000003', 'Cine hoy', 'Peli de estreno.', 'SHOWTIME', 'cine', u[3],
         v_hoy + interval '3 hours', 5, 'nexo_cover:SHOWTIME:cine:1',
         'Yelmo Luxury', 40.42, -3.70, false, false, false, false),
        -- LLENOS
        ('d1000001-0001-4001-8001-000000000004', 'Vermut completo', 'Plan LLENO — lista de espera mental.', 'FOODIES', 'tapas', u[6],
         today_start + interval '2 days' + interval '13 hours', 4, 'nexo_cover:FOODIES:tapas:1',
         'Bar El Rincón', 40.41, -3.70, false, false, false, false),
        ('d1000001-0001-4001-8001-000000000005', 'Fútbol completo', 'Ya no caben más.', 'DEPORTES', 'futbol', u[4],
         today_start + interval '3 days' + interval '19 hours', 6, 'nexo_cover:DEPORTES:futbol:1',
         'Polideportivo Sur', 40.39, -3.70, false, false, false, false),
        -- Esta semana / próximos
        ('d1000001-0001-4001-8001-000000000006', 'Senderismo domingo', 'Ruta fácil 8 km.', 'AIRE_LIBRE', 'senderismo', u[5],
         today_start + interval '4 days' + interval '9 hours', 12, 'nexo_cover:AIRE_LIBRE:senderismo:0',
         'Casa de Campo', 40.40, -3.75, false, false, false, false),
        ('d1000001-0001-4001-8001-000000000007', 'Museo + vermú', 'Exposición nueva.', 'DESCUBRIR', 'museo', u[8],
         today_start + interval '5 days' + interval '12 hours', 8, 'nexo_cover:DESCUBRIR:museo:0',
         'Reina Sofía', 40.408, -3.694, false, false, false, false),
        ('d1000001-0001-4001-8001-000000000008', 'Noche gaming', 'FIFA + snacks.', 'VIBES', 'gaming', u[9],
         today_start + interval '2 days' + interval '22 hours', 8, 'nexo_cover:VIBES:gaming:0',
         'Local gaming', 40.43, -3.70, false, false, false, false),
        ('d1000001-0001-4001-8001-000000000009', 'Comida de domingo', 'Arroz para compartir.', 'FOODIES', 'comer', u[10],
         today_start + interval '6 days' + interval '14 hours', 7, 'nexo_cover:FOODIES:comer:0',
         'Lavapiés', 40.409, -3.700, false, false, false, false),
        ('d1000001-0001-4001-8001-000000000010', 'Baloncesto 3x3', 'Nivel medio.', 'DEPORTES', 'baloncesto', u[7],
         today_start + interval '1 day' + interval '18 hours', 6, 'nexo_cover:DEPORTES:baloncesto:0',
         'Cancha Retiro', 40.415, -3.684, false, false, false, false),
        ('d1000001-0001-4001-8001-000000000011', 'Teatro off', 'Entradas baratas.', 'SHOWTIME', 'teatro', u[8],
         today_start + interval '7 days' + interval '20 hours', 6, 'nexo_cover:SHOWTIME:teatro:0',
         'Teatro del Barrio', 40.41, -3.70, false, false, true, false),
        ('d1000001-0001-4001-8001-000000000012', 'Playa urbana', 'Toalla y buena música.', 'AIRE_LIBRE', 'playa', u[5],
         today_start + interval '8 days' + interval '11 hours', 10, 'nexo_cover:AIRE_LIBRE:playa:0',
         'Madrid Río', 40.40, -3.72, false, false, false, false),
        ('d1000001-0001-4001-8001-000000000013', 'Intercambio idiomas', 'EN/ES café.', 'DESCUBRIR', 'idiomas', u[3],
         today_start + interval '3 days' + interval '18 hours', 10, 'nexo_cover:DESCUBRIR:idiomas:0',
         'Café Central', 40.416, -3.707, false, false, false, false),
        ('d1000001-0001-4001-8001-000000000014', 'Fiesta terraza', 'Solo buena vibra.', 'VIBES', 'fiesta', u[6],
         today_start + interval '9 days' + interval '22 hours', 15, 'nexo_cover:VIBES:fiesta:0',
         'Azotea', 40.42, -3.70, false, false, false, false),
        ('d1000001-0001-4001-8001-000000000015', 'Cenita improvisada', 'Sitio por decidir.', 'FOODIES', 'cenar', u[1],
         today_start + interval '1 day' + interval '21 hours', 5, 'nexo_cover:FOODIES:cenar:0',
         'Chamberí', 40.434, -3.703, true, false, false, false),
        ('d1000001-0001-4001-8001-000000000016', 'Mirador atardecer', 'Fotos y picnic light.', 'AIRE_LIBRE', 'mirador', u[10],
         today_start + interval '2 days' + interval '19 hours', 8, 'nexo_cover:AIRE_LIBRE:mirador:0',
         'Templo Debod', 40.424, -3.718, false, false, false, false),
        -- LLENO pequeño
        ('d1000001-0001-4001-8001-000000000017', 'Estudio exprés', 'Cupos llenos.', 'DESCUBRIR', 'estudio', u[3],
         today_start + interval '1 day' + interval '16 hours', 3, 'nexo_cover:DESCUBRIR:estudio:1',
         'Biblioteca', 40.42, -3.70, false, false, false, false),
        ('d1000001-0001-4001-8001-000000000018', 'Compras vintage', 'Rastro + brunch.', 'VIBES', 'compras', u[8],
         today_start + interval '10 days' + interval '11 hours', 6, 'nexo_cover:VIBES:compras:0',
         'El Rastro', 40.408, -3.707, false, false, false, false)
    ON CONFLICT (id) DO NOTHING;

    -- Participantes futuros (llenos = max alcanzado)
    -- Hoy café: 3/6
    INSERT INTO public.participantes (plan_id, usuario_id, estado) VALUES
        ('d1000001-0001-4001-8001-000000000001', u[1], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000001', u[3], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000001', u[6], 'aceptado'),
        -- Pádel hoy 3/4
        ('d1000001-0001-4001-8001-000000000002', u[2], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000002', u[4], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000002', u[7], 'aceptado'),
        -- Cine hoy 2/5
        ('d1000001-0001-4001-8001-000000000003', u[3], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000003', u[8], 'aceptado'),
        -- Vermut LLENO 4/4
        ('d1000001-0001-4001-8001-000000000004', u[6], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000004', u[1], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000004', u[3], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000004', u[10], 'aceptado'),
        -- Fútbol LLENO 6/6
        ('d1000001-0001-4001-8001-000000000005', u[4], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000005', u[2], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000005', u[7], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000005', u[9], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000005', u[1], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000005', u[5], 'aceptado'),
        -- Senderismo 5/12
        ('d1000001-0001-4001-8001-000000000006', u[5], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000006', u[2], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000006', u[3], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000006', u[7], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000006', u[10], 'aceptado'),
        -- Museo 3/8
        ('d1000001-0001-4001-8001-000000000007', u[8], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000007', u[3], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000007', u[6], 'aceptado'),
        -- Gaming 4/8
        ('d1000001-0001-4001-8001-000000000008', u[9], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000008', u[4], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000008', u[2], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000008', u[7], 'aceptado'),
        -- Comida 2/7
        ('d1000001-0001-4001-8001-000000000009', u[10], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000009', u[1], 'aceptado'),
        -- Basket 4/6
        ('d1000001-0001-4001-8001-000000000010', u[7], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000010', u[2], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000010', u[4], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000010', u[9], 'aceptado'),
        -- Teatro 2/6
        ('d1000001-0001-4001-8001-000000000011', u[8], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000011', u[3], 'aceptado'),
        -- Playa 3/10
        ('d1000001-0001-4001-8001-000000000012', u[5], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000012', u[6], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000012', u[10], 'aceptado'),
        -- Idiomas 4/10
        ('d1000001-0001-4001-8001-000000000013', u[3], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000013', u[1], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000013', u[8], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000013', u[7], 'aceptado'),
        -- Fiesta 6/15
        ('d1000001-0001-4001-8001-000000000014', u[6], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000014', u[1], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000014', u[4], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000014', u[5], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000014', u[9], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000014', u[10], 'aceptado'),
        -- Cena 2/5
        ('d1000001-0001-4001-8001-000000000015', u[1], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000015', u[6], 'aceptado'),
        -- Mirador 3/8
        ('d1000001-0001-4001-8001-000000000016', u[10], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000016', u[5], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000016', u[3], 'aceptado'),
        -- Estudio LLENO 3/3
        ('d1000001-0001-4001-8001-000000000017', u[3], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000017', u[8], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000017', u[2], 'aceptado'),
        -- Compras 2/6
        ('d1000001-0001-4001-8001-000000000018', u[8], 'aceptado'),
        ('d1000001-0001-4001-8001-000000000018', u[10], 'aceptado')
    ON CONFLICT DO NOTHING;

    -- ---------- Muchos mensajes en chats de plan ----------
    FOR i IN 1..18 LOOP
        pid := ('d1000001-0001-4001-8001-' || lpad(i::text, 12, '0'))::uuid;
        FOR j IN 1..14 LOOP
            INSERT INTO public.mensajes (plan_id, emisor_id, receptor_id, contenido, tipo, creado_en)
            VALUES (
                pid,
                u[((i + j - 1) % 10) + 1],
                NULL,
                CASE (j % 8)
                    WHEN 0 THEN '¿Confirmáis?'
                    WHEN 1 THEN 'Yo voy seguro 🙌'
                    WHEN 2 THEN '¿Alguien acerca coche?'
                    WHEN 3 THEN 'Genial, nos vemos allí'
                    WHEN 4 THEN 'Llevo snacks por si acaso'
                    WHEN 5 THEN '¿Cambiamos la hora?'
                    WHEN 6 THEN 'Perfecto, apuntadme'
                    ELSE 'Última hora: todo ok'
                END,
                'texto',
                now() - ((j * 41 + i) || ' minutes')::interval
            );
        END LOOP;
    END LOOP;

    -- Chats directos densos entre varios pares
    FOR i IN 1..10 LOOP
        FOR j IN 1..8 LOOP
            INSERT INTO public.mensajes (plan_id, emisor_id, receptor_id, contenido, tipo, creado_en)
            VALUES (
                NULL,
                u[i],
                u[(i % 10) + 1],
                CASE (j % 5)
                    WHEN 0 THEN 'Ey! ¿Vienes al plan de esta semana?'
                    WHEN 1 THEN 'Sí, yo me apunto'
                    WHEN 2 THEN '¿Quedamos antes un café?'
                    WHEN 3 THEN 'He guardado el de senderismo'
                    ELSE 'Hablamos luego!'
                END,
                'texto',
                now() - ((i * 10 + j) || ' hours')::interval
            );
            INSERT INTO public.mensajes (plan_id, emisor_id, receptor_id, contenido, tipo, creado_en)
            VALUES (
                NULL,
                u[(i % 10) + 1],
                u[i],
                CASE (j % 4)
                    WHEN 0 THEN 'Dale, me va bien'
                    WHEN 1 THEN 'Aviso si llego tarde'
                    WHEN 2 THEN 'Guay 🔥'
                    ELSE 'Nos vemos!'
                END,
                'texto',
                now() - ((i * 10 + j) || ' hours')::interval + interval '3 minutes'
            );
        END LOOP;
    END LOOP;

    -- Planes guardados (muchos)
    FOR i IN 1..10 LOOP
        FOR j IN 1..18 LOOP
            IF ((i + j) % 3) <> 0 THEN
                CONTINUE;
            END IF;
            pid := ('d1000001-0001-4001-8001-' || lpad(j::text, 12, '0'))::uuid;
            INSERT INTO public.planes_guardados (usuario_id, plan_id)
            VALUES (u[i], pid)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;

    -- Valoración pendiente para Lucía (plan terminado hace ~4h, ventana abierta)
    pid := 'c1000000-0000-4000-8000-000000000099'::uuid;
    INSERT INTO public.planes (
        id, titulo, descripcion, categoria, tipo_deporte, creador_id,
        fecha_evento, maximo_participantes, imagen_url,
        nombre_ubicacion, latitud, longitud,
        requiere_aprobacion, solo_chicas, solo_amigos, modo_privado
    ) VALUES (
        pid,
        'Cañas después del trabajo',
        'Plan reciente — pendiente de valorar.',
        'FOODIES', 'tapas', u[2],
        now() - interval '4 hours',
        4, 'nexo_cover:FOODIES:tapas:0',
        'Bar Demo', 40.42, -3.70,
        false, false, false, false
    ) ON CONFLICT (id) DO UPDATE SET fecha_evento = EXCLUDED.fecha_evento;

    INSERT INTO public.participantes (plan_id, usuario_id, estado) VALUES
        (pid, u[1], 'aceptado'),
        (pid, u[2], 'aceptado'),
        (pid, u[6], 'aceptado')
    ON CONFLICT DO NOTHING;
    -- Sin historial_planes ni valoraciones de Lucía → sale como pendiente abierta

    -- Stats por usuario
    FOR i IN 1..10 LOOP
        INSERT INTO public.estadisticas_usuario (usuario_id) VALUES (u[i])
        ON CONFLICT (usuario_id) DO NOTHING;

        BEGIN
            PERFORM public.recalcular_estadisticas_valoraciones(u[i]);
            PERFORM public.recalcular_numero_amistades(u[i]);
        EXCEPTION WHEN undefined_function THEN
            NULL;
        END;

        UPDATE public.estadisticas_usuario SET
            valoracion_media = ratings[i],
            numero_valoraciones = CASE WHEN i = 5 THEN 1 ELSE 12 + i END,
            numero_evaluadores_distintos = 8,
            porcentaje_repetiria = LEAST(100, 70 + i * 3),
            porcentaje_asistencia = 100,
            -- Insignias desbloqueadas (umbrales bronce = 5; Sin límites = 5 categorías)
            numero_planes_realizados = 12 + i,
            numero_amistades = CASE WHEN i = 1 THEN 4 ELSE 9 END,
            planes_tapas = 8 + (i % 5),          -- Foodie bronce/plata
            planes_deporte = 7 + ((i + 1) % 6),  -- MVP
            planes_fiesta = 6 + (i % 4),         -- Mr/Mrs Aura
            planes_estudio = 5 + ((i + 2) % 5),  -- Genio
            planes_solo_chicas = CASE WHEN generos[i] = 'femenino' THEN 5 + (i % 3) ELSE 0 END,
            categorias_probadas = 6,             -- Sin límites (elite)
            planes_creados = 6 + (i % 5),
            personas_distintas = 15 + i,
            aspecto_positivo_mas_votado = 'agradable',
            votos_aspecto_positivo = 4,
            actualizado_en = now()
        WHERE usuario_id = u[i];
    END LOOP;

    -- Lucía / Laura: más “top” (Foodie/MVP plata)
    UPDATE public.estadisticas_usuario SET
        planes_tapas = 22,
        planes_deporte = 21,
        planes_fiesta = 20,
        planes_estudio = 8,
        planes_creados = 12,
        categorias_probadas = 6
    WHERE usuario_id IN (u[1], u[10]);

    RAISE NOTICE 'Seed demo ampliado listo: 10 cuentas @nexo.test / Demo1234!';
END $$;

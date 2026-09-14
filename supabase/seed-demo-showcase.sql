-- ============================================================
-- NEXO · Showcase: app llena de vida para demos
-- Ejecutar ENTERO en Supabase → SQL Editor → Run (puede tardar ~20s).
--
-- Crea ~48 personas + 8 comunidades organizador + ~90 planes (feed + mapa),
-- chats, amistades, valoraciones, alineación 11v11 y actividad
-- en la cuenta ikerlazsor@gmail.com.
--
-- Idempotente: borra solo cuentas *@nexo.demo / ids b0e0/b1e0/b2e0.
-- No toca tu perfil (nombre, foto); sí enlaza amistades, chats y planes.
-- Contraseña de las cuentas demo (por si entras a alguna): Demo1234!
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
    iker uuid;
    v_pwd text;
    i int;
    j int;
    k int;
    uid uuid;
    oid uuid;
    pid uuid;
    peer uuid;
    n_people int := 48;
    n_orgs int := 8;
    n_plans int := 34;
    n_extra int := 56;
    n_org_past int := 24;
    demo_ids uuid[] := ARRAY[]::uuid[];
    nombres text[] := ARRAY[
        'Carlos','Lucía','Ana','Mario','Tomás','Carla','Vanesa','María',
        'Selena','Antonio','Pablo','Elena','Javier','Sofía','Diego','Nuria',
        'Hugo','Alba','Sergio','Irene','Adrián','Paula','Marcos','Claudia',
        'Rubén','Marta','Iván','Laura','Óscar','Natalia','Álvaro','Carmen',
        'Raúl','Patricia','Nacho','Cristina','Héctor','Beatriz','Dani','Silvia',
        'Unai','Leire','Ander','Nerea','Mikel','Itziar','Aitor','Ane'
    ];
    handles text[] := ARRAY[
        'carlosm','luciaruiz','anagomez','mariop','tomasv','carlasanz','vanesal','mariacastro',
        'selenan','antoniof','pablor','elenav','javih','sofiap','diegom','nuriag',
        'hugot','albaq','sergiol','ireneb','adrianf','paulam','marcosd','claudiao',
        'rubenv','martas','ivanr','laurac','oscarm','nataliah','alvarog','carmens',
        'raulp','patrician','nachof','crisloz','hectorv','beatrizm','danic','silviae',
        'unaiz','leireb','anderl','neream','mikelr','itziara','aitoro','aneg'
    ];
    generos text[] := ARRAY[
        'masculino','femenino','femenino','masculino','masculino','femenino','femenino','femenino',
        'femenino','masculino','masculino','femenino','masculino','femenino','masculino','femenino',
        'masculino','femenino','masculino','femenino','masculino','femenino','masculino','femenino',
        'masculino','femenino','masculino','femenino','masculino','femenino','masculino','femenino',
        'masculino','femenino','masculino','femenino','masculino','femenino','masculino','femenino',
        'masculino','femenino','masculino','femenino','masculino','femenino','masculino','femenino'
    ];
    org_nombres text[] := ARRAY[
        'Madrid Fútbol Club','Erasmus Madrid','Sunset Club','Nexo Runners',
        'La Comuna Malasaña','Pádel Chamberí','Afterwork Capital','Tribu Outdoor'
    ];
    org_handles text[] := ARRAY[
        'madridfc','erasmusmad','sunsetclub','nexorunners',
        'comunamalasana','padelchamberi','afterworkcap','tribuoutdoor'
    ];
    org_tipos text[] := ARRAY[
        'sports','erasmus','leisure','sports','community','sports','leisure','community'
    ];
    org_ig text[] := ARRAY[
        'madridfutbolclub','erasmusmadrid','sunsetclubmad','nexorunners',
        'comunamalasana','padelchamberi','afterworkcapital','tribuoutdoor'
    ];
    org_info text[] := ARRAY[
        'Comunidad de fútbol 7 y 11 en Madrid. Partidos entre semana, torneos el fin de semana y afters. Todos los niveles. Llevamos chalecos, balones y buen rollo.',
        'Quedadas para erasmus e internacionales en Madrid: language exchanges, tardeos, viajes de fin de semana y fiestas de bienvenida. English & español.',
        'Atardeceres, terraza y música. Planes de afterwork, rooftops y noches especiales en el centro. Ambiente mixto, sin pose.',
        'Grupo de running por Madrid Río, Retiro y Casa de Campo. Tiradas suaves, series y vermut post-entreno. Ritmo 5:30–6:30.',
        'Vecinos de Malasaña y alrededores. Mercadillos, cine al aire libre, cenas populares y cultura de barrio. Ven aunque no conozcas a nadie.',
        'Pistas de pádel en Chamberí. Partidas nivel medio, ligas internas y social el jueves. Raquetas de alquiler en recepción.',
        'Afterworks de empresa y freelance en Salamanca y Chamberí. Cañas, networking ligero y terraza. Ideal para conocer gente nueva entre semana.',
        'Rutas de senderismo, miradores y picnic. Salidas sábado temprano, grupo de 15–30, ritmo conversación. Carpool desde Moncloa.'
    ];
    tags text[] := ARRAY['Foodie','Deportista','Viajero','Aventurero','Tranquilo','Yoga','Fiestero','Lectura','De terraceo','Más de noche','Más de día'];
    covers text[] := ARRAY['party','concert','people','nature','city','sports','beach','travel','cafe','food','cinema','culture'];
    org_cover_presets text[] := ARRAY['sports','party','sunset','sports','culture','sports','cafe','nature'];
    women_av text[] := ARRAY[
        'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1487412720507-e7ab3769038f?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1521146764730-046bf3275ff7?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1548142813-c348350df52b?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1546961329-78bef0414d7c?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1502323777036-f29e3972d82f?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1525134479668-1bee5c7c6845?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1489424731084-a5d8b219a5bb?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1554151228-14d9def656e4?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1592621385612-4d7129426394?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1619895862022-09114b4ac55c?auto=format&fit=crop&w=400&h=400&q=80'
    ];
    men_av text[] := ARRAY[
        'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1463453091185-61582044d556?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1488161628813-04466f872be2?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1501196354995-cbb523fad803?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1504257432389-52343af06ae3?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1519345182560-3f2917c472ef?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1463453091185-61582044d556?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1496360166961-10a51d5f367a?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1552058544-f2b08422138a?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1545167622-3a6ac756afa4?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1506277886164-e25aa3f4dd4d?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1615109396063-5e9eeaa27148?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1618077360395-f3068be8e001?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1531891437563-31b04d4c6b1a?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1600486913747-55e5470d6f40?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1617137968427-85924c800a22?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1557862921-37829c790f32?auto=format&fit=crop&w=400&h=400&q=80'
    ];
    org_av text[] := ARRAY[
        'https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1529156069898-49953e654a00?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1571008887538-b36bb32f4571?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1514933651103-005eec06c04b?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1554068865-24cecd4e34b8?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1470337458703-46ad1756a187?auto=format&fit=crop&w=400&h=400&q=80',
        'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=400&h=400&q=80'
    ];
    barrios text[] := ARRAY[
        'Malasaña','Lavapiés','La Latina','Chamberí','Salamanca','Retiro','Chueca','Conde Duque',
        'Argüelles','Moncloa','Usera','Vallecas','Tetuán','Prosperidad','Ibiza','Atocha',
        'Legazpi','Delicias','Hortaleza','Latina'
    ];
    v_hoy1 timestamptz;
    v_hoy2 timestamptz;
    v_hoy3 timestamptz;
    v_futbol timestamptz;
    v_rate1 timestamptz;
    v_rate2 timestamptz;
    v_max int;
    v_fill int;
    v_person uuid;
    v_creator uuid;
    v_is_org boolean;
    v_cat text;
    v_tipo text;
    v_title text;
    v_desc text;
    v_lugar text;
    v_lat float8;
    v_lng float8;
    v_cover text;
    v_msg text;
    slot int;
    team int;
BEGIN
    SELECT id INTO iker
    FROM auth.users
    WHERE lower(email) = 'ikerlazsor@gmail.com'
    LIMIT 1;

    IF iker IS NULL THEN
        RAISE EXCEPTION 'No encuentro la cuenta ikerlazsor@gmail.com. Entra antes con esa cuenta y vuelve a ejecutar el seed.';
    END IF;

    v_pwd := crypt('Demo1234!', gen_salt('bf'));
    v_hoy1 := now() + interval '2 hours 15 minutes';
    v_hoy2 := now() + interval '4 hours';
    v_hoy3 := now() + interval '6 hours 30 minutes';
    v_futbol := date_trunc('day', now()) + interval '2 days' + interval '19 hours';
    IF v_futbol < now() + interval '20 hours' THEN
        v_futbol := now() + interval '28 hours';
    END IF;
    v_rate1 := now() - interval '4 hours 20 minutes';
    v_rate2 := now() - interval '9 hours';

    FOR i IN 1..n_people LOOP
        demo_ids := array_append(demo_ids, ('b0e00000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid);
    END LOOP;
    FOR i IN 1..n_orgs LOOP
        demo_ids := array_append(demo_ids, ('b1e00000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid);
    END LOOP;

    -- Incluir demos viejos @nexo.test / @nexo.demo
    demo_ids := demo_ids || ARRAY(
        SELECT id FROM auth.users
        WHERE lower(email) LIKE '%@nexo.demo' OR lower(email) LIKE '%@nexo.test'
    );

    SET LOCAL session_replication_role = replica;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'sessions') THEN
        DELETE FROM auth.sessions
        WHERE user_id::text = ANY (ARRAY(SELECT unnest(demo_ids)::text));
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'refresh_tokens') THEN
        DELETE FROM auth.refresh_tokens
        WHERE user_id::text = ANY (ARRAY(SELECT unnest(demo_ids)::text));
    END IF;

    DELETE FROM public.mensaje_reacciones
    WHERE usuario_id = ANY (demo_ids)
       OR mensaje_id IN (
            SELECT id FROM public.mensajes
            WHERE emisor_id = ANY (demo_ids) OR receptor_id = ANY (demo_ids)
               OR plan_id IN (SELECT id FROM public.planes WHERE id::text LIKE 'b2e00000%' OR creador_id = ANY (demo_ids))
       );

    DELETE FROM public.mensajes
    WHERE emisor_id = ANY (demo_ids)
       OR receptor_id = ANY (demo_ids)
       OR plan_id IN (SELECT id FROM public.planes WHERE id::text LIKE 'b2e00000%' OR creador_id = ANY (demo_ids));

    DELETE FROM public.alineaciones
    WHERE plan_id IN (SELECT id FROM public.planes WHERE id::text LIKE 'b2e00000%' OR creador_id = ANY (demo_ids))
       OR usuario_id = ANY (demo_ids);

    DELETE FROM public.valoraciones
    WHERE evaluador_id = ANY (demo_ids) OR evaluado_id = ANY (demo_ids)
       OR plan_id IN (SELECT id FROM public.planes WHERE id::text LIKE 'b2e00000%' OR creador_id = ANY (demo_ids));

    DELETE FROM public.invitaciones_planes
    WHERE invitador_id = ANY (demo_ids) OR invitado_id = ANY (demo_ids)
       OR plan_id IN (SELECT id FROM public.planes WHERE id::text LIKE 'b2e00000%' OR creador_id = ANY (demo_ids));

    DELETE FROM public.planes_guardados
    WHERE usuario_id = ANY (demo_ids)
       OR plan_id IN (SELECT id FROM public.planes WHERE id::text LIKE 'b2e00000%' OR creador_id = ANY (demo_ids));

    DELETE FROM public.historial_planes
    WHERE usuario_id = ANY (demo_ids)
       OR plan_id IN (SELECT id FROM public.planes WHERE id::text LIKE 'b2e00000%' OR creador_id = ANY (demo_ids));

    DELETE FROM public.participantes
    WHERE usuario_id = ANY (demo_ids)
       OR plan_id IN (SELECT id FROM public.planes WHERE id::text LIKE 'b2e00000%' OR creador_id = ANY (demo_ids));

    DELETE FROM public.amistades
    WHERE usuario_origen_id = ANY (demo_ids) OR usuario_destino_id = ANY (demo_ids);

    DELETE FROM public.seguidores
    WHERE seguidor_id = ANY (demo_ids) OR organizador_id = ANY (demo_ids);

    DELETE FROM public.solicitudes_organizador WHERE usuario_id = ANY (demo_ids);

    DELETE FROM public.planes WHERE id::text LIKE 'b2e00000%' OR creador_id = ANY (demo_ids);

    DELETE FROM public.estadisticas_usuario WHERE usuario_id = ANY (demo_ids);
    DELETE FROM auth.identities WHERE user_id = ANY (demo_ids);
    DELETE FROM public.perfiles WHERE id = ANY (demo_ids);
    DELETE FROM auth.users WHERE id = ANY (demo_ids);

    -- Quitar enlaces demo previos con Iker (amistades/chats/planes de ids fijos)
    DELETE FROM public.amistades
    WHERE (usuario_origen_id = iker OR usuario_destino_id = iker)
      AND (
          usuario_origen_id::text LIKE 'b0e00000%' OR usuario_destino_id::text LIKE 'b0e00000%'
          OR usuario_origen_id::text LIKE 'b1e00000%' OR usuario_destino_id::text LIKE 'b1e00000%'
      );
    DELETE FROM public.mensajes
    WHERE plan_id IS NULL
      AND (emisor_id = iker OR receptor_id = iker)
      AND (emisor_id::text LIKE 'b0e00000%' OR receptor_id::text LIKE 'b0e00000%');
    DELETE FROM public.participantes
    WHERE usuario_id = iker AND plan_id::text LIKE 'b2e00000%';
    DELETE FROM public.invitaciones_planes
    WHERE invitado_id = iker AND plan_id::text LIKE 'b2e00000%';
    DELETE FROM public.planes_guardados
    WHERE usuario_id = iker AND plan_id::text LIKE 'b2e00000%';
    DELETE FROM public.seguidores
    WHERE seguidor_id = iker AND organizador_id::text LIKE 'b1e00000%';
    DELETE FROM public.historial_planes
    WHERE usuario_id = iker AND plan_id::text LIKE 'b2e00000%';
    DELETE FROM public.alineaciones
    WHERE usuario_id = iker AND plan_id::text LIKE 'b2e00000%';

    SET LOCAL session_replication_role = DEFAULT;

    -- ---------- Personas ----------
    FOR i IN 1..n_people LOOP
        uid := ('b0e00000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
        INSERT INTO auth.users (
            instance_id, id, aud, role, email, encrypted_password,
            email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
            created_at, updated_at, confirmation_token, recovery_token,
            email_change_token_new, email_change
        ) VALUES (
            '00000000-0000-0000-0000-000000000000', uid,
            'authenticated', 'authenticated',
            'p' || lpad(i::text, 2, '0') || '.showcase@nexo.demo',
            v_pwd, now() - ((80 - i) || ' days')::interval,
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object(
                'nombre', nombres[i],
                'nombre_usuario', 'nxs' || handles[i],
                'registro_completado', true,
                'onboarding_completed', true
            ),
            now() - ((200 - i * 3) || ' days')::interval,
            now(), '', '', '', ''
        );

        INSERT INTO auth.identities (
            id, user_id, identity_data, provider, provider_id,
            last_sign_in_at, created_at, updated_at
        ) VALUES (
            gen_random_uuid(), uid,
            jsonb_build_object('sub', uid::text, 'email', 'p' || lpad(i::text, 2, '0') || '.showcase@nexo.demo', 'email_verified', true),
            'email', uid::text, now(), now(), now()
        );

        INSERT INTO public.perfiles (id)
        VALUES (uid)
        ON CONFLICT (id) DO NOTHING;

        UPDATE public.perfiles SET
            nombre = nombres[i],
            nombre_usuario = 'nxs' || handles[i],
            descripcion = CASE (i % 8)
                WHEN 0 THEN nombres[i] || ' · Me apuntan los planes espontáneos, el vermut del domingo y conocer gente sin pose.'
                WHEN 1 THEN 'Deportes entre semana, terraza el viernes. Abierto a todo lo que suene a plan de verdad.'
                WHEN 2 THEN 'Cafés, cine y paseos. Si el plan tiene buena conversación, ahí estoy.'
                WHEN 3 THEN 'Fútbol, pádel y after. Nivel medio, cero agresividad, mucha caña después.'
                WHEN 4 THEN 'Recién en la ciudad. Busco grupo para quedadas, cultura y alguna ruta.'
                WHEN 5 THEN 'Foodie confeso. Tapas, mercados y cenas largas. Traigo siempre buen humor.'
                WHEN 6 THEN 'Running + yoga. Planes de día y alguna noche de conciertos.'
                ELSE 'Me sobra energía los jueves. Afterworks, fiestas pequeñas y gente nueva.'
            END,
            genero = generos[i]::public.tipo_genero,
            fecha_nacimiento = date '1991-02-08' + ((i * 137) % 4200),
            ambientes_preferidos = ARRAY[tags[(i % 11) + 1], tags[((i + 3) % 11) + 1], tags[((i + 7) % 11) + 1]],
            etiquetas = ARRAY[tags[(i % 11) + 1], tags[((i + 3) % 11) + 1], tags[((i + 7) % 11) + 1]],
            habitos_consumo = CASE (i % 4)
                WHEN 0 THEN '{"bebida":"si","tabaco":"no"}'::jsonb
                WHEN 1 THEN '{"bebida":"ocasional","tabaco":"no"}'::jsonb
                WHEN 2 THEN '{"bebida":"ocasional","tabaco":"ocasional"}'::jsonb
                ELSE '{"bebida":"no","tabaco":"no"}'::jsonb
            END,
            perfil_gustos = jsonb_build_object(
                'privacidad', jsonb_build_object(
                    'mostrar_edad', true,
                    'mostrar_genero', true,
                    'mostrar_bebida', true,
                    'mostrar_tabaco', true,
                    'mostrar_aficiones', true
                )
            ),
            cover_url = 'nexo_cover:' || covers[(i % 12) + 1],
            registro_completado = true,
            idioma = 'es',
            avatar_url = CASE
                WHEN generos[i] = 'femenino' THEN women_av[((i - 1) % 24) + 1]
                ELSE men_av[((i - 1) % 24) + 1]
            END
        WHERE id = uid;
    END LOOP;

    -- ---------- Comunidades organizador ----------
    FOR i IN 1..n_orgs LOOP
        oid := ('b1e00000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
        INSERT INTO auth.users (
            instance_id, id, aud, role, email, encrypted_password,
            email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
            created_at, updated_at, confirmation_token, recovery_token,
            email_change_token_new, email_change
        ) VALUES (
            '00000000-0000-0000-0000-000000000000', oid,
            'authenticated', 'authenticated',
            'org' || lpad(i::text, 2, '0') || '.showcase@nexo.demo',
            v_pwd, now() - interval '100 days',
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object(
                'nombre', org_nombres[i],
                'nombre_usuario', 'nxo' || org_handles[i],
                'registro_completado', true,
                'onboarding_completed', true
            ),
            now() - interval '140 days', now(), '', '', '', ''
        );

        INSERT INTO auth.identities (
            id, user_id, identity_data, provider, provider_id,
            last_sign_in_at, created_at, updated_at
        ) VALUES (
            gen_random_uuid(), oid,
            jsonb_build_object('sub', oid::text, 'email', 'org' || lpad(i::text, 2, '0') || '.showcase@nexo.demo', 'email_verified', true),
            'email', oid::text, now(), now(), now()
        );

        INSERT INTO public.perfiles (id)
        VALUES (oid)
        ON CONFLICT (id) DO NOTHING;

        UPDATE public.perfiles SET
            nombre = org_nombres[i],
            nombre_usuario = 'nxo' || org_handles[i],
            descripcion = CASE i
                WHEN 1 THEN 'Fútbol en Madrid. Partidos, torneos y comunidad. Todos los niveles.'
                WHEN 2 THEN 'Erasmus & internationals in Madrid. Exchanges, parties and weekend trips.'
                WHEN 3 THEN 'Atardeceres, rooftops y afters en el centro. La noche empieza aquí.'
                WHEN 4 THEN 'Running crew Madrid Río. Kilómetros, playlist y vermut.'
                WHEN 5 THEN 'Cultura de barrio en Malasaña. Mercados, cine y cenas populares.'
                WHEN 6 THEN 'Pádel social en Chamberí. Ligas, partidos y cañas.'
                WHEN 7 THEN 'Afterworks entre semana. Terraza, networking ligero, cero corbata.'
                ELSE 'Rutas, miradores y picnic. El finde se sale.'
            END,
            es_organizador = true,
            organizador = jsonb_build_object(
                'tipo', org_tipos[i],
                'ciudad', 'Madrid',
                'instagram', org_ig[i],
                'web', 'https://appnexo.es',
                'whatsapp', '+3460011122' || i::text,
                'informacion', org_info[i],
                'categorias', CASE i
                    WHEN 1 THEN ARRAY['DEPORTES']
                    WHEN 2 THEN ARRAY['VIBES','DESCUBRIR']
                    WHEN 3 THEN ARRAY['VIBES','SHOWTIME']
                    WHEN 4 THEN ARRAY['DEPORTES','AIRE_LIBRE']
                    WHEN 5 THEN ARRAY['VIBES','FOODIES']
                    WHEN 6 THEN ARRAY['DEPORTES']
                    WHEN 7 THEN ARRAY['FOODIES','VIBES']
                    ELSE ARRAY['AIRE_LIBRE']
                END,
                'portada', 'nexo_cover:' || org_cover_presets[i],
                'galeria', jsonb_build_array(
                    jsonb_build_object('url', org_av[i], 'kind', 'image'),
                    jsonb_build_object(
                        'url',
                        CASE i
                            WHEN 1 THEN 'https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?auto=format&fit=crop&w=1200&h=800&q=80'
                            WHEN 2 THEN 'https://images.unsplash.com/photo-1529156069898-49953e654a00?auto=format&fit=crop&w=1200&h=800&q=80'
                            WHEN 3 THEN 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1200&h=800&q=80'
                            WHEN 4 THEN 'https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?auto=format&fit=crop&w=1200&h=800&q=80'
                            WHEN 5 THEN 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1200&h=800&q=80'
                            WHEN 6 THEN 'https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?auto=format&fit=crop&w=1200&h=800&q=80'
                            WHEN 7 THEN 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?auto=format&fit=crop&w=1200&h=800&q=80'
                            ELSE 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1200&h=800&q=80'
                        END,
                        'kind', 'image'
                    ),
                    jsonb_build_object(
                        'url',
                        CASE i
                            WHEN 1 THEN 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?auto=format&fit=crop&w=1200&h=800&q=80'
                            WHEN 2 THEN 'https://images.unsplash.com/photo-1519671482749-fd09be7ccebf?auto=format&fit=crop&w=1200&h=800&q=80'
                            WHEN 3 THEN 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1200&h=800&q=80'
                            WHEN 4 THEN 'https://images.unsplash.com/photo-1571008887538-b36bb32f4571?auto=format&fit=crop&w=1200&h=800&q=80'
                            WHEN 5 THEN 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1200&h=800&q=80'
                            WHEN 6 THEN 'https://images.unsplash.com/photo-1554068865-24cecd4e34b8?auto=format&fit=crop&w=1200&h=800&q=80'
                            WHEN 7 THEN 'https://images.unsplash.com/photo-1470337458703-46ad1756a187?auto=format&fit=crop&w=1200&h=800&q=80'
                            ELSE 'https://images.unsplash.com/photo-1501555085422-4cf9b83bbc48?auto=format&fit=crop&w=1200&h=800&q=80'
                        END,
                        'kind', 'image'
                    )
                )
            ),
            cover_url = 'nexo_cover:' || org_cover_presets[i],
            avatar_url = org_av[i],
            registro_completado = true,
            idioma = 'es',
            etiquetas = '{}',
            ambientes_preferidos = '{}'
        WHERE id = oid;
    END LOOP;

    -- Amistades entre personas (grafo denso, no completo)
    FOR i IN 1..n_people LOOP
        FOR j IN 1..6 LOOP
            k := ((i + j * 5 - 1) % n_people) + 1;
            IF k = i THEN CONTINUE; END IF;
            IF i < k THEN
                INSERT INTO public.amistades (usuario_origen_id, usuario_destino_id, estado, creado_en)
                VALUES (
                    ('b0e00000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
                    ('b0e00000-0000-4000-8000-' || lpad(k::text, 12, '0'))::uuid,
                    'aceptado',
                    now() - ((i + j) || ' days')::interval
                )
                ON CONFLICT DO NOTHING;
            END IF;
        END LOOP;
    END LOOP;

    -- Iker: amigos aceptados + solicitudes entrantes
    FOREACH i IN ARRAY ARRAY[1, 4, 10, 14, 22, 30, 41] LOOP
        INSERT INTO public.amistades (usuario_origen_id, usuario_destino_id, estado, creado_en)
        VALUES (
            ('b0e00000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
            iker, 'aceptado', now() - (i || ' days')::interval
        )
        ON CONFLICT DO NOTHING;
    END LOOP;
    FOREACH i IN ARRAY ARRAY[2, 6, 11, 18, 27, 36] LOOP
        INSERT INTO public.amistades (usuario_origen_id, usuario_destino_id, estado, creado_en)
        VALUES (
            ('b0e00000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
            iker, 'pendiente', now() - ((i % 5) || ' hours')::interval
        )
        ON CONFLICT DO NOTHING;
    END LOOP;

    SET LOCAL session_replication_role = replica;

    -- ---------- Planes ----------
    FOR i IN 1..n_plans LOOP
        pid := ('b2e00000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
        v_is_org := i IN (3, 8, 12, 24, 25, 26, 27, 19);
        v_creator := CASE
            WHEN i = 3 THEN ('b1e00000-0000-4000-8000-' || lpad('7', 12, '0'))::uuid
            WHEN i = 8 THEN ('b1e00000-0000-4000-8000-' || lpad('3', 12, '0'))::uuid
            WHEN i = 12 THEN ('b1e00000-0000-4000-8000-' || lpad('2', 12, '0'))::uuid
            WHEN i = 19 THEN ('b1e00000-0000-4000-8000-' || lpad('5', 12, '0'))::uuid
            WHEN i = 24 THEN ('b1e00000-0000-4000-8000-' || lpad('4', 12, '0'))::uuid
            WHEN i = 25 THEN ('b1e00000-0000-4000-8000-' || lpad('1', 12, '0'))::uuid
            WHEN i = 26 THEN ('b1e00000-0000-4000-8000-' || lpad('8', 12, '0'))::uuid
            WHEN i = 27 THEN ('b1e00000-0000-4000-8000-' || lpad('5', 12, '0'))::uuid
            WHEN i = 5 THEN ('b0e00000-0000-4000-8000-' || lpad('4', 12, '0'))::uuid
            ELSE ('b0e00000-0000-4000-8000-' || lpad((((i * 3) % n_people) + 1)::text, 12, '0'))::uuid
        END;

        v_title := CASE i
            WHEN 1 THEN 'Cañas esta tarde en Malasaña'
            WHEN 2 THEN 'Running suave por Madrid Río'
            WHEN 3 THEN 'Afterwork terraza · Salamanca'
            WHEN 4 THEN 'Picnic en el Retiro'
            WHEN 5 THEN 'Fútbol 11v11 · Partido completo'
            WHEN 6 THEN 'Pádel dobles Chamberí'
            WHEN 7 THEN 'Brunch solo chicas'
            WHEN 8 THEN 'Sunset session en azotea'
            WHEN 9 THEN 'Senderismo La Pedriza'
            WHEN 10 THEN 'Museo Reina Sofía + terraza'
            WHEN 11 THEN 'Cine y cañas en Callao'
            WHEN 12 THEN 'Language exchange Erasmus'
            WHEN 13 THEN 'Ruta de tapas en La Latina'
            WHEN 14 THEN 'Pádel — cupo completo'
            WHEN 15 THEN 'Yoga al atardecer'
            WHEN 16 THEN 'Noche de juegos de mesa'
            WHEN 17 THEN 'Paseo + fotos en Casa de Campo'
            WHEN 18 THEN 'Fútbol 7 nivel medio'
            WHEN 19 THEN 'Cena popular de barrio'
            WHEN 20 THEN 'Teatro off y copa después'
            WHEN 21 THEN 'Intercambio de idiomas café'
            WHEN 22 THEN 'Bici por Madrid Río'
            WHEN 23 THEN 'Vermut del domingo'
            WHEN 24 THEN 'Tirada larga Nexo Runners'
            WHEN 25 THEN 'Torneo relámpago Madrid FC'
            WHEN 26 THEN 'Mirador y picnic Tribu Outdoor'
            WHEN 27 THEN 'Mercadillo y vinilo en Malasaña'
            WHEN 28 THEN 'Quedada entre amigos'
            WHEN 29 THEN 'Café y trabajo en Conde Duque'
            WHEN 30 THEN 'Baloncesto 3x3'
            WHEN 31 THEN 'Cervezas artesanas en Lavapiés'
            WHEN 32 THEN 'Padel + vermut (pasado)'
            WHEN 33 THEN 'Tapas del jueves (valorar)'
            WHEN 34 THEN 'Cine improvisado (valorar)'
            ELSE 'Plan Nexo'
        END;

        v_desc := CASE i
            WHEN 1 THEN 'Plan de HOY. Terraza, cañas y conversación. Ambiente relajado, ven cuando puedas. Si hay cola nos vamos al de al lado.'
            WHEN 2 THEN 'Rodaje suave 8 km. Ritmo conversación. Ducha en el poli y café después si apetece.'
            WHEN 3 THEN 'Afterwork de Afterwork Capital. Terraza, networking ligero y playlist chill. Primera copa a tu ritmo.'
            WHEN 4 THEN 'Mantas, snacks y playlist. Ideal para conocer gente nueva. Plan B si llueve: Café del Retiro.'
            WHEN 5 THEN 'Partido 11 contra 11. Césped artificial, 90 min, árbitro amateur. Elige posición en la alineación. Nivel medio, cero agresividad. Chalecos y balón puestos.'
            WHEN 6 THEN 'Dos parejas, nivel intermedio. Luego vermut cerca del club.'
            WHEN 7 THEN 'Brunch, foto y callejeo. Espacio cómodo, sin prisa. Solo chicas.'
            WHEN 8 THEN 'Atardecer en azotea con DJ set suave. Puesta de sol y after corto. Entrada incluida en el plan.'
            WHEN 9 THEN 'Ruta 12 km, desnivel suave. Salida 8:00 desde Manzanares. Bocata en la cima.'
            WHEN 10 THEN 'Exposición + terraza. Sin ser expertos: vamos a mirar y luego a tomar algo.'
            WHEN 11 THEN 'Peli y cañas. Votamos entre tres títulos en el chat. Palomitas extra.'
            WHEN 12 THEN 'English / español / français. 90 min de intercambio y cañas. All levels welcome.'
            WHEN 13 THEN '3–4 bares, raciones para picar. Cuenta a medias. Ritmo lento.'
            WHEN 14 THEN 'Última hora: estamos completos. Lista de espera por si cae alguien.'
            WHEN 15 THEN 'Vinyasa suave en césped. Trae esterilla. 45 min + té.'
            WHEN 16 THEN 'Catan, coup y lo que aparezca. Piso en Malasaña, pica-pica.'
            WHEN 17 THEN 'Lago, fotos y helado. Plan de tarde sin prisa.'
            WHEN 18 THEN 'Fútbol 7, 60 min. Portería grande. Después ducha y caña.'
            WHEN 19 THEN 'Cena popular de La Comuna. Menú cerrado, mesa larga, vino de la casa.'
            WHEN 20 THEN 'Sala pequeña, obra de 70 min, copa en la esquina.'
            WHEN 21 THEN 'Café Central, 18:30. Trae un tema. Principiantes welcome.'
            WHEN 22 THEN 'Ruta 18 km llana. Casco obligatorio. Avituallamiento en el medio.'
            WHEN 23 THEN 'Vermut, aceitunas y sol. Terraza con reserva a nombre de Nexo.'
            WHEN 24 THEN '18–20 km grupo. Ritmo 5:45. Gel y plátano al final.'
            WHEN 25 THEN '3 partidos cortos + final. Inscripción en el chat. Premios simbólicos.'
            WHEN 26 THEN 'Salida 8:30 Moncloa. Mirador, picnic y vuelta en cercanías.'
            WHEN 27 THEN 'Puestos, vinilos y caña. Quedamos en la plaza y recorremos.'
            WHEN 28 THEN 'Plan entre amigos (solo gente de la lista). Terraza y tablero.'
            WHEN 29 THEN 'Laptops, café y silencio relativo. 2 h de foco y descanso.'
            WHEN 30 THEN '3x3 en pista exterior. Trae agua. 4 equipos rotando.'
            WHEN 31 THEN 'Ruta de 3 craft beers. Picoteo vegano/carne. Cuenta fácil.'
            WHEN 32 THEN 'Partido de pádel de ayer. Cierre abierto para valorar.'
            WHEN 33 THEN 'Tapas del otro día. Queda valorar a quienes vinieron.'
            ELSE 'Cine de ayer. Valorad si os apeteció el plan.'
        END;

        v_cat := CASE
            WHEN i IN (1, 3, 7, 13, 19, 23, 31, 33) THEN 'FOODIES'
            WHEN i IN (2, 5, 6, 14, 18, 22, 24, 25, 30, 32) THEN 'DEPORTES'
            WHEN i IN (4, 9, 17, 26) THEN 'AIRE_LIBRE'
            WHEN i IN (8, 11, 20, 34) THEN 'SHOWTIME'
            WHEN i IN (10, 12, 21, 29) THEN 'DESCUBRIR'
            ELSE 'VIBES'
        END;
        v_tipo := CASE i
            WHEN 1 THEN 'tapas' WHEN 2 THEN 'running' WHEN 3 THEN 'cenar' WHEN 4 THEN 'picnic'
            WHEN 5 THEN 'futbol' WHEN 6 THEN 'padel' WHEN 7 THEN 'cafe' WHEN 8 THEN 'concierto'
            WHEN 9 THEN 'senderismo' WHEN 10 THEN 'museo' WHEN 11 THEN 'cine' WHEN 12 THEN 'idiomas'
            WHEN 13 THEN 'tapas' WHEN 14 THEN 'padel' WHEN 15 THEN 'otro' WHEN 16 THEN 'juegos_mesa'
            WHEN 17 THEN 'otro' WHEN 18 THEN 'futbol' WHEN 19 THEN 'comer' WHEN 20 THEN 'teatro'
            WHEN 21 THEN 'idiomas' WHEN 22 THEN 'otro' WHEN 23 THEN 'tapas' WHEN 24 THEN 'running'
            WHEN 25 THEN 'futbol' WHEN 26 THEN 'senderismo' WHEN 27 THEN 'otro' WHEN 28 THEN 'juegos_mesa'
            WHEN 29 THEN 'estudio' WHEN 30 THEN 'baloncesto' WHEN 31 THEN 'tapas' WHEN 32 THEN 'padel'
            WHEN 33 THEN 'tapas' ELSE 'cine'
        END;
        v_cover := 'nexo_cover:' || v_cat || ':' || v_tipo || ':0';
        v_lugar := CASE i
            WHEN 1 THEN 'Malasaña · Plaza de San Ildefonso'
            WHEN 2 THEN 'Madrid Río · Puente de Toledo'
            WHEN 3 THEN 'Terraza Platea · Salamanca'
            WHEN 4 THEN 'Parque del Retiro · Estanque'
            WHEN 5 THEN 'Campo 11 · Centro Deportivo Moratalaz'
            WHEN 6 THEN 'Club Pádel Chamberí'
            WHEN 7 THEN 'Brunch Café · Conde Duque'
            WHEN 8 THEN 'Azotea Hotel · Gran Vía'
            WHEN 9 THEN 'La Pedriza · parking Cantocochino'
            WHEN 10 THEN 'Museo Reina Sofía'
            WHEN 11 THEN 'Yelmo Cines Callao'
            WHEN 12 THEN 'Café Central · Huertas'
            WHEN 13 THEN 'La Latina · Cava Baja'
            WHEN 14 THEN 'Club Pádel Chamberí'
            WHEN 15 THEN 'Parque del Oeste'
            WHEN 16 THEN 'Malasaña · piso (chat para dirección)'
            WHEN 17 THEN 'Casa de Campo · lago'
            WHEN 18 THEN 'Polideportivo Vallecas'
            WHEN 19 THEN 'Malasaña · local de La Comuna'
            WHEN 20 THEN 'Teatro off · Lavapiés'
            WHEN 21 THEN 'Café Central'
            WHEN 22 THEN 'Madrid Río · Matadero'
            WHEN 23 THEN 'Bar El Rincón · La Latina'
            WHEN 24 THEN 'Madrid Río · start Puente de Segovia'
            WHEN 25 THEN 'Centro Deportivo Moratalaz'
            WHEN 26 THEN 'Mirador de los Robledos'
            WHEN 27 THEN 'Plaza del Dos de Mayo'
            WHEN 28 THEN 'Terraza privada · Chamberí'
            WHEN 29 THEN 'Café Conde Duque'
            WHEN 30 THEN 'Pista exterior · Casa de Campo'
            WHEN 31 THEN 'Lavapiés · Fábrica de cerveza'
            WHEN 32 THEN 'Club Pádel Chamberí'
            WHEN 33 THEN 'La Latina'
            ELSE 'Callao'
        END;
        v_lat := 40.4168 + ((i % 9) - 4) * 0.012;
        v_lng := -3.7038 + ((i % 7) - 3) * 0.014;
        v_max := CASE
            WHEN i = 5 THEN 22
            WHEN i IN (3, 8, 12, 19, 24, 25, 26, 27) THEN 40
            WHEN i IN (14, 6, 32) THEN 4
            WHEN i IN (7, 11, 20, 28, 29) THEN 8
            WHEN i = 18 THEN 14
            ELSE 12
        END;

        INSERT INTO public.planes (
            id, titulo, descripcion, categoria, tipo_deporte, creador_id,
            fecha_evento, maximo_participantes, minimo_participantes, imagen_url, imagenes_url,
            nombre_ubicacion, latitud, longitud,
            requiere_aprobacion, solo_chicas, solo_amigos, modo_privado, estado,
            alineacion
        ) VALUES (
            pid, v_title, v_desc, v_cat, v_tipo, v_creator,
            CASE i
                WHEN 1 THEN v_hoy1
                WHEN 2 THEN v_hoy2
                WHEN 3 THEN v_hoy3
                WHEN 5 THEN v_futbol
                WHEN 32 THEN now() - interval '26 hours'
                WHEN 33 THEN v_rate1
                WHEN 34 THEN v_rate2
                ELSE now() + ((i) || ' hours')::interval + interval '1 day'
            END,
            v_max,
            CASE WHEN i = 5 THEN 16 WHEN v_is_org THEN 2 ELSE 2 END,
            v_cover,
            '{}'::text[],
            v_lugar, v_lat, v_lng,
            false,
            (i = 7),
            (i = 28),
            false,
            'abierto',
            CASE WHEN i = 5 THEN
                jsonb_build_object(
                    'formato', '11v11',
                    'equipos', jsonb_build_array(
                        jsonb_build_object('nombre', 'Los Verdes', 'color', '#16A34A'),
                        jsonb_build_object('nombre', 'Los Azules', 'color', '#2563EB')
                    )
                )
            ELSE NULL END
        );
    END LOOP;

    -- ---------- Más planes para feed y mapa (Madrid) ----------
    FOR i IN (n_plans + 1)..(n_plans + n_extra) LOOP
        pid := ('b2e00000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
        v_is_org := (i <= n_plans + n_orgs) OR (i % 6 = 0);
        IF i <= n_plans + n_orgs THEN
            v_creator := ('b1e00000-0000-4000-8000-' || lpad((i - n_plans)::text, 12, '0'))::uuid;
        ELSIF v_is_org THEN
            v_creator := ('b1e00000-0000-4000-8000-' || lpad((((i / 6) % n_orgs) + 1)::text, 12, '0'))::uuid;
        ELSE
            v_creator := ('b0e00000-0000-4000-8000-' || lpad((((i * 5) % n_people) + 1)::text, 12, '0'))::uuid;
        END IF;

        v_cat := (ARRAY['FOODIES','DEPORTES','AIRE_LIBRE','SHOWTIME','DESCUBRIR','VIBES'])[(i % 6) + 1];
        v_tipo := CASE v_cat
            WHEN 'FOODIES' THEN (ARRAY['tapas','cafe','comer','cenar'])[(i % 4) + 1]
            WHEN 'DEPORTES' THEN (ARRAY['futbol','padel','running','baloncesto'])[(i % 4) + 1]
            WHEN 'AIRE_LIBRE' THEN (ARRAY['picnic','senderismo','mirador','otro'])[(i % 4) + 1]
            WHEN 'SHOWTIME' THEN (ARRAY['cine','teatro','concierto','otro'])[(i % 4) + 1]
            WHEN 'DESCUBRIR' THEN (ARRAY['idiomas','museo','estudio','viajes'])[(i % 4) + 1]
            ELSE (ARRAY['fiesta','juegos_mesa','otro','compras'])[(i % 4) + 1]
        END;
        v_cover := 'nexo_cover:' || v_cat || ':' || v_tipo || ':0';
        v_lugar := barrios[(i % 20) + 1] || ' · Madrid';
        v_lat := 40.4168 + sin(i::float8 * 0.73) * 0.085 + ((i % 11) - 5) * 0.008;
        v_lng := -3.7038 + cos(i::float8 * 0.91) * 0.11 + ((i % 13) - 6) * 0.009;
        v_max := CASE
            WHEN v_tipo IN ('padel') THEN 4
            WHEN v_tipo IN ('cafe','estudio','teatro') THEN 10
            WHEN v_tipo IN ('futbol') THEN 14
            WHEN v_is_org THEN 28
            ELSE 16
        END;
        v_title := CASE v_tipo
            WHEN 'tapas' THEN 'Tapas en ' || barrios[(i % 20) + 1]
            WHEN 'cafe' THEN 'Café y charla en ' || barrios[(i % 20) + 1]
            WHEN 'comer' THEN 'Comida en ' || barrios[(i % 20) + 1]
            WHEN 'cenar' THEN 'Cena en ' || barrios[(i % 20) + 1]
            WHEN 'futbol' THEN 'Fútbol 7 · ' || barrios[(i % 20) + 1]
            WHEN 'padel' THEN 'Pádel dobles · ' || barrios[(i % 20) + 1]
            WHEN 'running' THEN 'Running suave · ' || barrios[(i % 20) + 1]
            WHEN 'baloncesto' THEN 'Basket 3x3 · ' || barrios[(i % 20) + 1]
            WHEN 'picnic' THEN 'Picnic en ' || barrios[(i % 20) + 1]
            WHEN 'senderismo' THEN 'Ruta cerca de Madrid'
            WHEN 'mirador' THEN 'Atardecer en mirador'
            WHEN 'cine' THEN 'Cine en ' || barrios[(i % 20) + 1]
            WHEN 'teatro' THEN 'Teatro off y copa'
            WHEN 'concierto' THEN 'Directo / live session'
            WHEN 'idiomas' THEN 'Language exchange'
            WHEN 'museo' THEN 'Museo + terraza'
            WHEN 'estudio' THEN 'Café y foco'
            WHEN 'viajes' THEN 'Quedada viajeros'
            WHEN 'fiesta' THEN 'After en ' || barrios[(i % 20) + 1]
            WHEN 'juegos_mesa' THEN 'Juegos de mesa'
            WHEN 'compras' THEN 'Mercadillo y caña'
            ELSE 'Quedada en ' || barrios[(i % 20) + 1]
        END;
        v_desc := 'Plan abierto en Madrid. Gente apuntada, ambiente bueno. Entra al chat para cuadrar punto exacto.';

        INSERT INTO public.planes (
            id, titulo, descripcion, categoria, tipo_deporte, creador_id,
            fecha_evento, maximo_participantes, minimo_participantes, imagen_url, imagenes_url,
            nombre_ubicacion, latitud, longitud,
            requiere_aprobacion, solo_chicas, solo_amigos, modo_privado, estado
        ) VALUES (
            pid, v_title, v_desc, v_cat, v_tipo, v_creator,
            now() + (((i % 12) + 1) || ' days')::interval + (((10 + (i % 10)) || ' hours')::interval),
            v_max, 2, v_cover, '{}'::text[],
            v_lugar, v_lat, v_lng,
            false, false, false, false, 'abierto'
        );
    END LOOP;

    -- Planes pasados de cada comunidad (2–3 por organizador)
    FOR i IN (n_plans + n_extra + 1)..(n_plans + n_extra + n_org_past) LOOP
        pid := ('b2e00000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
        j := ((i - n_plans - n_extra - 1) % 3) + 1;
        k := ((i - n_plans - n_extra - 1) / 3) + 1;
        v_creator := ('b1e00000-0000-4000-8000-' || lpad(k::text, 12, '0'))::uuid;
        v_is_org := true;
        v_cat := CASE k
            WHEN 1 THEN 'DEPORTES' WHEN 2 THEN 'VIBES' WHEN 3 THEN 'SHOWTIME'
            WHEN 4 THEN 'DEPORTES' WHEN 5 THEN 'FOODIES' WHEN 6 THEN 'DEPORTES'
            WHEN 7 THEN 'FOODIES' ELSE 'AIRE_LIBRE'
        END;
        v_tipo := CASE k
            WHEN 1 THEN 'futbol' WHEN 2 THEN 'fiesta' WHEN 3 THEN 'concierto'
            WHEN 4 THEN 'running' WHEN 5 THEN 'tapas' WHEN 6 THEN 'padel'
            WHEN 7 THEN 'cenar' ELSE 'senderismo'
        END;
        v_cover := 'nexo_cover:' || v_cat || ':' || v_tipo || ':0';
        v_title := org_nombres[k] || CASE j
            WHEN 1 THEN ' · quedada de mayo'
            WHEN 2 THEN ' · sesión de junio'
            ELSE ' · plan de julio'
        END;
        v_desc := 'Plan ya celebrado por la comunidad. Gente que se apuntó y valoró.';
        v_lugar := barrios[(k * 3 + j) % 20 + 1] || ' · Madrid';
        v_lat := 40.4168 + ((k % 5) - 2) * 0.02;
        v_lng := -3.7038 + ((j % 4) - 2) * 0.02;
        v_max := CASE WHEN v_tipo = 'padel' THEN 4 WHEN v_tipo = 'futbol' THEN 22 ELSE 24 END;

        INSERT INTO public.planes (
            id, titulo, descripcion, categoria, tipo_deporte, creador_id,
            fecha_evento, maximo_participantes, minimo_participantes, imagen_url, imagenes_url,
            nombre_ubicacion, latitud, longitud,
            requiere_aprobacion, solo_chicas, solo_amigos, modo_privado, estado
        ) VALUES (
            pid, v_title, v_desc, v_cat, v_tipo, v_creator,
            now() - ((12 + k * 3 + j * 5) || ' days')::interval,
            v_max, 2, v_cover, '{}'::text[],
            v_lugar, v_lat, v_lng,
            false, false, false, false, 'abierto'
        );
    END LOOP;

    -- Participantes (no organizadores). El fútbol 11v11 se rellena solo con la alineación.
    FOR i IN 1..(n_plans + n_extra + n_org_past) LOOP
        pid := ('b2e00000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
        SELECT maximo_participantes, creador_id INTO v_max, v_creator FROM public.planes WHERE id = pid;
        SELECT es_organizador INTO v_is_org FROM public.perfiles WHERE id = v_creator;
        v_fill := CASE
            WHEN i = 5 THEN 0
            WHEN i = 14 THEN v_max
            WHEN i IN (1, 2, 3) THEN greatest(8, v_max - 3)
            WHEN i IN (33, 34, 32) THEN 6
            ELSE least(v_max - 1, greatest(8, (v_max * 3) / 4))
        END;

        IF NOT coalesce(v_is_org, false) THEN
            INSERT INTO public.participantes (plan_id, usuario_id, estado)
            SELECT pid, v_creator, 'aceptado'
            WHERE (SELECT count(*) FROM public.participantes WHERE plan_id = pid AND estado = 'aceptado') < v_max
            ON CONFLICT DO NOTHING;
        END IF;

        j := 0;
        k := 0;
        WHILE j < v_fill AND k < 90 LOOP
            k := k + 1;
            v_person := ('b0e00000-0000-4000-8000-' || lpad(((((i * 7 + k - 1) % n_people) + 1))::text, 12, '0'))::uuid;
            IF v_person = v_creator THEN CONTINUE; END IF;
            IF i = 7 AND generos[(((i * 7 + k - 1) % n_people) + 1)] <> 'femenino' THEN CONTINUE; END IF;
            INSERT INTO public.participantes (plan_id, usuario_id, estado)
            SELECT pid, v_person, 'aceptado'
            WHERE (SELECT count(*) FROM public.participantes WHERE plan_id = pid AND estado = 'aceptado') < v_max
            ON CONFLICT DO NOTHING;
            j := j + 1;
        END LOOP;

        IF i = 14 THEN
            INSERT INTO public.participantes (plan_id, usuario_id, estado)
            VALUES (
                pid,
                ('b0e00000-0000-4000-8000-' || lpad('12', 12, '0'))::uuid,
                'lista_espera'
            )
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;

    -- Iker en planes visibles: hoy, fútbol 11, afterwork, past ratings
    FOREACH i IN ARRAY ARRAY[1, 5, 3, 33, 34] LOOP
        pid := ('b2e00000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
        SELECT maximo_participantes INTO v_max FROM public.planes WHERE id = pid;
        INSERT INTO public.participantes (plan_id, usuario_id, estado)
        SELECT pid, iker, 'aceptado'
        WHERE (SELECT count(*) FROM public.participantes WHERE plan_id = pid AND estado = 'aceptado') < v_max
        ON CONFLICT DO NOTHING;
    END LOOP;

    FOREACH i IN ARRAY ARRAY[33, 34] LOOP
        INSERT INTO public.historial_planes (usuario_id, plan_id, creado_en)
        VALUES (
            iker,
            ('b2e00000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
            now() - interval '8 hours'
        )
        ON CONFLICT DO NOTHING;
    END LOOP;

    -- Alineación 11v11: 19/22 ocupadas (deja 3 huecos)
    pid := 'b2e00000-0000-4000-8000-000000000005'::uuid;
    -- Equipo 0 (Verdes): 0-8 y 10 (hueco en 9). Iker en el 6.
    FOR slot IN 0..10 LOOP
        IF slot = 9 THEN CONTINUE; END IF;
        IF slot = 6 THEN
            v_person := iker;
        ELSE
            v_person := ('b0e00000-0000-4000-8000-' || lpad((CASE WHEN slot < 6 THEN slot + 1 ELSE slot END)::text, 12, '0'))::uuid;
        END IF;
        INSERT INTO public.alineaciones (plan_id, equipo, posicion, usuario_id)
        VALUES (pid, 0, slot, v_person)
        ON CONFLICT DO NOTHING;
        INSERT INTO public.participantes (plan_id, usuario_id, estado)
        SELECT pid, v_person, 'aceptado'
        WHERE (SELECT count(*) FROM public.participantes WHERE plan_id = pid AND estado = 'aceptado') < 22
        ON CONFLICT DO NOTHING;
    END LOOP;
    -- Equipo 1 (Azules): 0-8 (huecos 9 y 10)
    FOR slot IN 0..8 LOOP
        v_person := ('b0e00000-0000-4000-8000-' || lpad((slot + 16)::text, 12, '0'))::uuid;
        INSERT INTO public.alineaciones (plan_id, equipo, posicion, usuario_id)
        VALUES (pid, 1, slot, v_person)
        ON CONFLICT DO NOTHING;
        INSERT INTO public.participantes (plan_id, usuario_id, estado)
        SELECT pid, v_person, 'aceptado'
        WHERE (SELECT count(*) FROM public.participantes WHERE plan_id = pid AND estado = 'aceptado') < 22
        ON CONFLICT DO NOTHING;
    END LOOP;

    -- Cierre de seguridad: nunca más aceptados que el máximo del plan
    DELETE FROM public.participantes p
    WHERE p.ctid IN (
        SELECT x.ctid FROM (
            SELECT p2.ctid,
                   row_number() OVER (
                       PARTITION BY p2.plan_id
                       ORDER BY
                           (p2.usuario_id = iker) DESC,
                           (p2.usuario_id = pl.creador_id) DESC,
                           p2.creado_en,
                           p2.usuario_id
                   ) AS rn,
                   pl.maximo_participantes
            FROM public.participantes p2
            JOIN public.planes pl ON pl.id = p2.plan_id
            WHERE p2.estado = 'aceptado'
              AND pl.id::text LIKE 'b2e00000%'
        ) x
        WHERE x.rn > x.maximo_participantes
    );

    -- ---------- Chats de plan (los más visibles) ----------
    -- HOY cañas
    pid := 'b2e00000-0000-4000-8000-000000000001'::uuid;
    INSERT INTO public.mensajes (plan_id, emisor_id, receptor_id, contenido, tipo, creado_en) VALUES
        (pid, ('b0e00000-0000-4000-8000-' || lpad('1', 12, '0'))::uuid, NULL, 'Hecho el plan: cañas esta tarde en Malasaña 🍻', 'texto', now() - interval '5 hours'),
        (pid, ('b0e00000-0000-4000-8000-' || lpad('2', 12, '0'))::uuid, NULL, 'Yo voy! ¿Quedamos en la plaza?', 'texto', now() - interval '4 hours 40 minutes'),
        (pid, ('b0e00000-0000-4000-8000-' || lpad('1', 12, '0'))::uuid, NULL, 'San Ildefonso. Si hay cola, al de al lado.', 'texto', now() - interval '4 hours 30 minutes'),
        (pid, iker, NULL, 'Me apunto. Salgo del curro y caigo.', 'texto', now() - interval '3 hours'),
        (pid, ('b0e00000-0000-4000-8000-' || lpad('6', 12, '0'))::uuid, NULL, '¿Alguien baja en Tribunal? Quedamos abajo.', 'texto', now() - interval '2 hours 20 minutes'),
        (pid, ('b0e00000-0000-4000-8000-' || lpad('8', 12, '0'))::uuid, NULL, 'Yo Tribunal también 👋', 'texto', now() - interval '2 hours'),
        (pid, ('b0e00000-0000-4000-8000-' || lpad('10', 12, '0'))::uuid, NULL, 'Reservo mesa para 8 por si se llena.', 'texto', now() - interval '70 minutes'),
        (pid, ('b0e00000-0000-4000-8000-' || lpad('2', 12, '0'))::uuid, NULL, 'Crack. Yo llego puntual, prometido.', 'texto', now() - interval '40 minutes'),
        (pid, ('b0e00000-0000-4000-8000-' || lpad('1', 12, '0'))::uuid, NULL, 'Os escribo cuando esté llegando. Hoy se sale.', 'texto', now() - interval '12 minutes');

    INSERT INTO public.mensaje_reacciones (mensaje_id, usuario_id, emoji)
    SELECT m.id, iker, '🔥'
    FROM public.mensajes m
    WHERE m.plan_id = 'b2e00000-0000-4000-8000-000000000001'::uuid
    ORDER BY m.creado_en DESC
    LIMIT 1
    ON CONFLICT DO NOTHING;

    -- Fútbol 11v11
    pid := 'b2e00000-0000-4000-8000-000000000005'::uuid;
    INSERT INTO public.mensajes (plan_id, emisor_id, receptor_id, contenido, tipo, creado_en) VALUES
        (pid, ('b0e00000-0000-4000-8000-' || lpad('4', 12, '0'))::uuid, NULL, 'Partido 11v11. Elegid posición en la alineación ⚽', 'texto', now() - interval '2 days'),
        (pid, ('b0e00000-0000-4000-8000-' || lpad('1', 12, '0'))::uuid, NULL, 'Yo de central. Verdes.', 'texto', now() - interval '2 days' + interval '20 minutes'),
        (pid, iker, NULL, 'Me pongo de interior. Hueco en el 6, lo pillo.', 'texto', now() - interval '30 hours'),
        (pid, ('b0e00000-0000-4000-8000-' || lpad('16', 12, '0'))::uuid, NULL, 'Azules portería si nadie la quiere.', 'texto', now() - interval '28 hours'),
        (pid, ('b0e00000-0000-4000-8000-' || lpad('4', 12, '0'))::uuid, NULL, 'Chalecos y balón los llevo yo. Botas de tacos cortos.', 'texto', now() - interval '20 hours'),
        (pid, ('b0e00000-0000-4000-8000-' || lpad('18', 12, '0'))::uuid, NULL, 'Quedan 3 huecos. Traed a alguien de nivel medio.', 'texto', now() - interval '12 hours'),
        (pid, ('b0e00000-0000-4000-8000-' || lpad('20', 12, '0'))::uuid, NULL, 'Yo acerco coche desde Atocha, 3 plazas.', 'texto', now() - interval '8 hours'),
        (pid, ('b0e00000-0000-4000-8000-' || lpad('2', 12, '0'))::uuid, NULL, 'Quedamos 15 min antes en la puerta del campo.', 'texto', now() - interval '3 hours'),
        (pid, ('b0e00000-0000-4000-8000-' || lpad('4', 12, '0'))::uuid, NULL, 'Alineación casi llena. Se va a poner muy bueno.', 'texto', now() - interval '25 minutes');

    -- Resto de planes próximos: hilos naturales
    FOR i IN 2..31 LOOP
        IF i IN (1, 5) THEN CONTINUE; END IF;
        pid := ('b2e00000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
        SELECT creador_id INTO v_creator FROM public.planes WHERE id = pid;
        FOR j IN 1..8 LOOP
            v_person := ('b0e00000-0000-4000-8000-' || lpad(((((i + j - 1) % n_people) + 1))::text, 12, '0'))::uuid;
            v_msg := CASE (j % 8)
                WHEN 1 THEN '¡Me apunto! ¿Confirmamos hora en el sitio?'
                WHEN 2 THEN 'Yo también. ¿Alguien viene en metro?'
                WHEN 3 THEN 'Llevo algo para picar si queréis.'
                WHEN 4 THEN 'Perfecto, nos vemos allí 10 min antes.'
                WHEN 5 THEN '¿Hay que reservar o vamos pidiendo?'
                WHEN 6 THEN 'He visto el plan y tiene muy buena pinta.'
                WHEN 7 THEN 'Si se llena avisad, traigo a una amiga.'
                ELSE 'Hecho. Este grupo pinta genial 🔥'
            END;
            INSERT INTO public.mensajes (plan_id, emisor_id, receptor_id, contenido, tipo, creado_en)
            VALUES (pid, CASE WHEN j = 1 THEN v_creator ELSE v_person END, NULL, v_msg, 'texto',
                    now() - ((10 - j) || ' hours')::interval - (i || ' minutes')::interval);
        END LOOP;
    END LOOP;

    -- Chats 1:1 entre demos
    FOR i IN 1..24 LOOP
        uid := ('b0e00000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
        peer := ('b0e00000-0000-4000-8000-' || lpad((((i + 11 - 1) % n_people) + 1)::text, 12, '0'))::uuid;
        IF uid = peer THEN CONTINUE; END IF;
        INSERT INTO public.mensajes (plan_id, emisor_id, receptor_id, contenido, tipo, creado_en) VALUES
            (NULL, uid, peer, 'Ey! ¿Vienes al plan de esta semana?', 'texto', now() - ((i + 8) || ' hours')::interval),
            (NULL, peer, uid, 'Sí, me apunto seguro. ¿Quedamos antes un café?', 'texto', now() - ((i + 7) || ' hours')::interval),
            (NULL, uid, peer, 'Dale, me va bien. Te escribo cuando salga.', 'texto', now() - ((i + 3) || ' hours')::interval),
            (NULL, peer, uid, 'Guay 🔥 nos vemos', 'texto', now() - ((i + 1) || ' hours')::interval);
    END LOOP;

    -- Mensajes a Iker (sin leer → badge)
    INSERT INTO public.mensajes (plan_id, emisor_id, receptor_id, contenido, tipo, creado_en) VALUES
        (NULL, ('b0e00000-0000-4000-8000-' || lpad('1', 12, '0'))::uuid, iker, 'Iker! Al final vas a las cañas de hoy?', 'texto', now() - interval '3 hours'),
        (NULL, iker, ('b0e00000-0000-4000-8000-' || lpad('1', 12, '0'))::uuid, 'Sí, acabo de apuntarme. Nos vemos en la plaza.', 'texto', now() - interval '2 hours 50 minutes'),
        (NULL, ('b0e00000-0000-4000-8000-' || lpad('1', 12, '0'))::uuid, iker, 'Perfecto. Te guardo sitio.', 'texto', now() - interval '18 minutes'),
        (NULL, ('b0e00000-0000-4000-8000-' || lpad('2', 12, '0'))::uuid, iker, 'Hola! Te envié solicitud, coincidimos en el picnic del mes pasado 👋', 'texto', now() - interval '5 hours'),
        (NULL, ('b0e00000-0000-4000-8000-' || lpad('4', 12, '0'))::uuid, iker, 'Para el 11v11: interior derecho o izquierdo, como prefieras. Yo te dejo el 6.', 'texto', now() - interval '6 hours'),
        (NULL, iker, ('b0e00000-0000-4000-8000-' || lpad('4', 12, '0'))::uuid, 'Pillé el 6. Gracias!', 'texto', now() - interval '5 hours 40 minutes'),
        (NULL, ('b0e00000-0000-4000-8000-' || lpad('4', 12, '0'))::uuid, iker, 'Crack. Faltan 3 y cerramos.', 'texto', now() - interval '9 minutes'),
        (NULL, ('b0e00000-0000-4000-8000-' || lpad('10', 12, '0'))::uuid, iker, 'Oye, el domingo hay vermut. Te va?', 'texto', now() - interval '1 hour 10 minutes'),
        (NULL, ('b0e00000-0000-4000-8000-' || lpad('14', 12, '0'))::uuid, iker, 'Reina Sofía el sábado? Hay plan creado ya.', 'texto', now() - interval '40 minutes'),
        (NULL, ('b0e00000-0000-4000-8000-' || lpad('22', 12, '0'))::uuid, iker, 'Traje las fotos del running. Te las paso luego.', 'texto', now() - interval '22 minutes'),
        (NULL, ('b0e00000-0000-4000-8000-' || lpad('41', 12, '0'))::uuid, iker, 'Cuando bajes al norte hacemos una ruta, Unai apunta mil.', 'texto', now() - interval '2 hours');

    -- Invitaciones de plan a Iker
    INSERT INTO public.invitaciones_planes (plan_id, invitador_id, invitado_id, tipo, estado, creado_en) VALUES
        ('b2e00000-0000-4000-8000-000000000004'::uuid,
         ('b0e00000-0000-4000-8000-' || lpad('2', 12, '0'))::uuid, iker, 'plan', 'pendiente', now() - interval '3 hours'),
        ('b2e00000-0000-4000-8000-000000000008'::uuid,
         ('b0e00000-0000-4000-8000-' || lpad('8', 12, '0'))::uuid, iker, 'plan', 'pendiente', now() - interval '80 minutes'),
        ('b2e00000-0000-4000-8000-000000000023'::uuid,
         ('b0e00000-0000-4000-8000-' || lpad('10', 12, '0'))::uuid, iker, 'plan', 'pendiente', now() - interval '50 minutes');

    -- Iker sigue comunidades + muchos followers
    FOR i IN 1..n_orgs LOOP
        oid := ('b1e00000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
        INSERT INTO public.seguidores (seguidor_id, organizador_id, creado_en)
        VALUES (iker, oid, now() - interval '20 days')
        ON CONFLICT DO NOTHING;
        FOR j IN 1..n_people LOOP
            IF (j + i) % 3 = 0 THEN CONTINUE; END IF;
            INSERT INTO public.seguidores (seguidor_id, organizador_id, creado_en)
            VALUES (
                ('b0e00000-0000-4000-8000-' || lpad(j::text, 12, '0'))::uuid,
                oid,
                now() - ((j + i) || ' days')::interval
            )
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;

    -- Guardados de Iker
    INSERT INTO public.planes_guardados (usuario_id, plan_id) VALUES
        (iker, 'b2e00000-0000-4000-8000-000000000004'::uuid),
        (iker, 'b2e00000-0000-4000-8000-000000000008'::uuid),
        (iker, 'b2e00000-0000-4000-8000-000000000009'::uuid),
        (iker, 'b2e00000-0000-4000-8000-000000000026'::uuid)
    ON CONFLICT DO NOTHING;

    -- Valoraciones cruzadas. Iker NO valora los planes 33 y 34 → le salen pendientes.
    INSERT INTO public.valoraciones (
        plan_id, evaluador_id, evaluado_id, asistencia, puntuacion_general,
        repetiria_experiencia, aspectos_positivos, aspectos_negativos
    )
    SELECT
        p1.plan_id,
        p1.usuario_id,
        p2.usuario_id,
        true,
        4 + ((ascii(substr(p1.usuario_id::text, 1, 1)) + ascii(substr(p2.usuario_id::text, 1, 1))) % 2),
        'si',
        ARRAY['agradable', 'social']::text[],
        '{}'::text[]
    FROM public.participantes p1
    JOIN public.participantes p2
      ON p2.plan_id = p1.plan_id
     AND p2.usuario_id <> p1.usuario_id
     AND p2.estado = 'aceptado'
    JOIN public.planes pl ON pl.id = p1.plan_id
    WHERE p1.estado = 'aceptado'
      AND pl.fecha_evento < now() - interval '1 hour'
      AND pl.id::text LIKE 'b2e00000%'
      AND NOT (p1.usuario_id = iker AND pl.id IN (
          'b2e00000-0000-4000-8000-000000000033'::uuid,
          'b2e00000-0000-4000-8000-000000000034'::uuid
      ))
    ON CONFLICT DO NOTHING;

    -- Historial extra para stats
    INSERT INTO public.historial_planes (usuario_id, plan_id, creado_en)
    SELECT pa.usuario_id, pa.plan_id, pl.fecha_evento
    FROM public.participantes pa
    JOIN public.planes pl ON pl.id = pa.plan_id
    WHERE pl.fecha_evento < now()
      AND pa.estado = 'aceptado'
    ON CONFLICT DO NOTHING;

    SET LOCAL session_replication_role = DEFAULT;

    -- Stats personas
    FOR i IN 1..n_people LOOP
        uid := ('b0e00000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
        INSERT INTO public.estadisticas_usuario (usuario_id) VALUES (uid)
        ON CONFLICT (usuario_id) DO NOTHING;
        BEGIN
            PERFORM public.recalcular_estadisticas_valoraciones(uid);
            PERFORM public.recalcular_numero_amistades(uid);
            PERFORM public.recalcular_personas_distintas(uid);
        EXCEPTION WHEN undefined_function THEN
            NULL;
        END;
        UPDATE public.estadisticas_usuario SET
            valoracion_media = 4.1 + ((i % 9)::numeric / 10),
            numero_valoraciones = 6 + (i % 14),
            numero_evaluadores_distintos = 5 + (i % 8),
            porcentaje_repetiria = 82 + (i % 16),
            porcentaje_asistencia = 94 + (i % 6),
            numero_planes_realizados = 8 + (i % 18),
            planes_tapas = 3 + (i % 8),
            planes_deporte = 4 + (i % 10),
            planes_fiesta = 2 + (i % 7),
            planes_estudio = 1 + (i % 4),
            categorias_probadas = 4 + (i % 3),
            planes_creados = 1 + (i % 4),
            aspecto_positivo_mas_votado = CASE (i % 4) WHEN 0 THEN 'agradable' WHEN 1 THEN 'social' WHEN 2 THEN 'divertido' ELSE 'puntual' END,
            votos_aspecto_positivo = 4 + (i % 5),
            actualizado_en = now()
        WHERE usuario_id = uid;
    END LOOP;

    FOR i IN 1..n_orgs LOOP
        oid := ('b1e00000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
        INSERT INTO public.estadisticas_usuario (usuario_id) VALUES (oid)
        ON CONFLICT (usuario_id) DO NOTHING;
        UPDATE public.estadisticas_usuario SET
            valoracion_media = 4.5 + ((i % 4)::numeric / 10),
            numero_valoraciones = 20 + i * 3,
            numero_evaluadores_distintos = 18 + i,
            porcentaje_repetiria = 90 + i,
            numero_planes_realizados = 12 + i * 2,
            planes_creados = 8 + i,
            categorias_probadas = 3,
            actualizado_en = now()
        WHERE usuario_id = oid;
    END LOOP;

    INSERT INTO public.estadisticas_usuario (usuario_id) VALUES (iker)
    ON CONFLICT (usuario_id) DO NOTHING;
    BEGIN
        PERFORM public.recalcular_estadisticas_valoraciones(iker);
        PERFORM public.recalcular_numero_amistades(iker);
        PERFORM public.recalcular_personas_distintas(iker);
    EXCEPTION WHEN undefined_function THEN
        NULL;
    END;

    RAISE NOTICE 'Showcase listo. Iker=%. Planes hoy=%, %, %. Fútbol 11v11=%. Extra feed=% past comunidades=%',
        iker, v_hoy1, v_hoy2, v_hoy3, v_futbol, n_extra, n_org_past;
    RAISE NOTICE 'Planes showcase en BD: % total, % próximos (feed)',
        (SELECT count(*) FROM public.planes WHERE id::text LIKE 'b2e00000%'),
        (SELECT count(*) FROM public.planes WHERE id::text LIKE 'b2e00000%' AND fecha_evento >= now());
END $$;

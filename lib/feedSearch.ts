import { normalizeMainCategory, type MainCategoryId } from './categories';

/**
 * Grupos de conceptos relacionados (ES / EN / FR / PT / DE / IT…).
 * Si la query toca un término del grupo, también busca el resto
 * en título + descripción + categoría.
 */
const CONCEPT_GROUPS: string[][] = [
    // —— Combate / grappling ——
    [
        'open mat', 'openmat', 'open-mat', 'jiu jitsu', 'jiujitsu', 'jujitsu', 'jujutsu',
        'bjj', 'brazilian jiu jitsu', 'jiu jitsu brasileño', 'jiu jitsu brasileno',
        'jiu-jitsu', 'grappling', 'jjb', 'submission', 'submissions', 'roll', 'rolls',
        'rolling', 'nogi', 'no gi', 'no-gi', 'gi', 'kimono', 'guardia', 'guard',
        'sweeps', 'takedown', 'takedowns', 'ibjjf', 'adcc',
    ],
    [
        'judo', 'judoka', 'ne waza', 'randori', 'ippon',
    ],
    [
        'lucha', 'wrestling', 'lucha libre', 'grecorromana', 'freestyle wrestling',
    ],
    [
        'mma', 'artes marciales', 'martial arts', 'artes marciales mixtas', 'ufc',
        'combate', 'fight', 'sparring', 'octagono', 'octágono',
    ],
    [
        'boxeo', 'boxing', 'boxe', 'kickboxing', 'kick boxing', 'muay thai', 'thai',
        'sacos', 'saco', 'guantes', 'ring', 'pugilismo', 'boxeador',
    ],
    [
        'karate', 'taekwondo', 'tkd', 'kung fu', 'wing chun', 'aikido', 'krav maga',
        'capoeira', 'esgrima', 'fencing',
    ],

    // —— Fútbol y variantes ——
    [
        'futbol', 'fútbol', 'football', 'soccer', 'partido', 'pachanga', 'futbol 7',
        'futbol 5', 'futbol 11', 'futsal', 'sala', 'indoor football', 'balon', 'balón',
        'porteria', 'portería', 'gol', 'goles', 'equipo', 'liga', 'champions',
    ],

    // —— Baloncesto ——
    [
        'baloncesto', 'basket', 'basketball', 'nba', 'acb', 'triple', 'triples',
        'canasta', 'streetball', '3x3', 'pick and roll',
    ],

    // —— Raqueta ——
    [
        'padel', 'pádel', 'paddle', 'padel tennis', 'pista de padel', 'pista de pádel',
    ],
    [
        'tenis', 'tennis', 'raqueta', 'racket', 'wimbledon', 'set', 'tie break',
    ],
    [
        'badminton', 'bádminton', 'squash', 'ping pong', 'ping-pong', 'tenis de mesa',
        'table tennis',
    ],

    // —— Running / ciclismo ——
    [
        'running', 'correr', 'run', 'runner', 'footing', 'jogging', 'maratón', 'maraton',
        'marathon', 'media maraton', 'trail', 'trail running', 'carrera', '5k', '10k',
        'atletismo', 'sprint', 'intervalos', 'series',
    ],
    [
        'ciclismo', 'bici', 'bicicleta', 'cycling', 'bike', 'mtb', 'mountain bike',
        'carretera', 'gravel', 'fixar', 'ruta en bici', 'spinning', 'indoor cycling',
    ],

    // —— Aire libre / naturaleza ——
    [
        'senderismo', 'hiking', 'hike', 'trek', 'trekking', 'montaña', 'montana',
        'mountain', 'ruta', 'caminata', 'paseo', 'walk', 'walking', 'excursion',
        'excursión', 'pico', 'sierra', 'bosque', 'forest', 'naturaleza', 'nature',
        'outdoor', 'outdoors', 'aire libre',
    ],
    [
        'escalada', 'climbing', 'boulder', 'bouldering', 'roca', 'rocodromo',
        'rocódromo', 'via ferrata', 'vía ferrata', 'rappelling', 'rapel',
    ],
    [
        'playa', 'beach', 'bañarse', 'banarse', 'chiringuito', 'arena', 'sand',
        'costa', 'coast', 'mar', 'sea', 'olas', 'waves', 'hamaca',
    ],
    [
        'surf', 'surfing', 'bodyboard', 'bodyboard', 'paddle surf', 'paddleboard',
        'sup', 'windsurf', 'kitesurf', 'kite', 'olas',
    ],
    [
        'picnic', 'merienda al aire libre', 'parque', 'park', 'cesped', 'césped',
        'blanket', 'mantita', 'merienda',
    ],
    [
        'mirador', 'viewpoint', 'vistas', 'views', 'atardecer', 'sunset', 'amanecer',
        'sunrise', 'puesta de sol', 'foto', 'fotos', 'fotografia', 'fotografía',
        'photography', 'instagram',
    ],
    [
        'camping', 'acampada', 'tienda de campaña', 'tienda de campana', 'glamping',
        'fuego', 'barbacoa', 'bbq', 'asado',
    ],
    [
        'kayak', 'canoa', 'paddle', 'remo', 'rafting', 'piragua', 'barco', 'boat',
        'vela', 'sailing',
    ],
    [
        'ski', 'esqui', 'esquí', 'snowboard', 'nieve', 'snow', 'estacion de esqui',
        'estación de esquí',
    ],

    // —— Fitness / bienestar ——
    [
        'yoga', 'pilates', 'meditacion', 'meditación', 'meditation', 'wellness',
        'estiramientos', 'stretching', 'mindfulness', 'respiracion', 'respiración',
        'vinyasa', 'hatha', 'yin yoga',
    ],
    [
        'gym', 'gimnasio', 'pesas', 'gymnasium', 'crossfit', 'entrenamiento',
        'workout', 'fitness', 'musculacion', 'musculación', 'fuerza', 'strength',
        'hipertrofia', 'funcional', 'calistenia', 'calisthenics', 'hiit',
    ],
    [
        'natacion', 'natación', 'swim', 'swimming', 'piscina', 'pool', 'aguas abiertas',
        'waterpolo',
    ],
    [
        'baile', 'dance', 'bailar', 'salsa', 'bachata', 'kizomba', 'tango', 'swing',
        'hip hop', 'hiphop', 'reggaeton', 'reggaetón', 'contemporaneo', 'contemporáneo',
        'ballet', 'zumba', 'clase de baile',
    ],

    // —— Gaming ——
    [
        'fortnite', 'videojuegos', 'videogames', 'video games', 'gaming', 'gamer',
        'juegos', 'games', 'online', 'partida', 'partidas', 'battle royale',
        'ps5', 'ps4', 'playstation', 'xbox', 'nintendo', 'switch', 'pc gaming',
        'steam', 'twitch', 'discord', 'streamer', 'esports', 'e-sports',
        'lol', 'league of legends', 'valorant', 'csgo', 'cs2', 'counter strike',
        'minecraft', 'roblox', 'gta', 'call of duty', 'cod', 'fifa', 'ea fc',
        'rocket league', 'among us', 'pokemon', 'pokémon', 'zelda', 'mario kart',
        'warzone', 'apex', 'overwatch', 'dota', 'clash royale', 'clash of clans',
        'consola', 'console', 'mando', 'controller',
    ],
    [
        'juegos de mesa', 'board games', 'mesa', 'cartas', 'card games', 'uno',
        'catan', 'catan', 'carcassonne', 'role', 'rol', 'dnd', 'd&d',
        'dungeons and dragons', 'magic', 'pokemon tcg', 'poker', 'póker',
        'blackjack', 'trivial', 'monopoly', 'pictionary', 'exploding kittens',
    ],

    // —— Comida / bebida ——
    [
        'brunch', 'desayuno', 'breakfast', 'café', 'cafe', 'coffee', 'merienda',
        'tostadas', 'avocado toast', 'pancake', 'pancakes', 'croissant', 'bolleria',
        'bollería', 'churros', 'chocolate',
    ],
    [
        'comer', 'cena', 'cenar', 'dinner', 'lunch', 'comida', 'almuerzo',
        'restaurante', 'restaurant', 'tapas', 'pintxos', 'pinchos', 'raciones',
        'foodie', 'gastro', 'gastronomia', 'gastronomía', 'cocina', 'cooking',
        'chef', 'menu', 'menú', 'menudo',
    ],
    [
        'pizza', 'hamburguesa', 'burger', 'sushi', 'ramen', 'pasta', 'italiano',
        'italiano', 'mexicano', 'tacos', 'burrito', 'kebab', 'pollo', 'carne',
        'vegano', 'vegan', 'vegetariano', 'vegetarian', 'healthy', 'saludable',
        'poke', 'pokebowl', 'bowls',
    ],
    [
        'cerveza', 'beer', 'cañas', 'canas', 'caña', 'cana', 'vermut', 'vinos',
        'wine', 'copas', 'drinks', 'cocktail', 'coctel', 'cóctel', 'mojito',
        'gin tonic', 'cervezas artesanas', 'craft beer', 'sidra', 'sangria', 'sangría',
    ],
    [
        'helado', 'ice cream', 'gelato', 'postre', 'dessert', 'dulce', 'pastel',
        'tarta', 'cake', 'churreria', 'churrería',
    ],

    // —— Noche / social ——
    [
        'fiesta', 'party', 'noche', 'night', 'nightlife', 'discoteca', 'disco',
        'club', 'after', 'afterparty', 'baile', 'dance', 'dj', 'rave', 'techno',
        'reggaeton', 'latin party', 'copas', 'salida', 'salir', 'previa', 'predrinks',
    ],
    [
        'terraceo', 'terraza', 'terrazas', 'rooftop', 'afterwork', 'after work',
        'aperitivo', 'vermuteo', 'tardeo', 'atardecer con amigos',
    ],
    [
        'karaoke', 'bolera', 'bowling', 'escape room', 'escape', 'laser tag',
        'paintball', 'karting', 'ocio',
    ],

    // —— Cultura / espectáculos ——
    [
        'cine', 'cinema', 'pelicula', 'película', 'movie', 'film', 'netflix',
        'estreno', 'premiere', 'series', 'marvel', 'disney', 'horror', 'terror',
        'comedia', 'drama',
    ],
    [
        'concierto', 'concert', 'musica', 'música', 'music', 'live', 'festival',
        'directo', 'banda', 'band', 'cantante', 'gig', 'actuacion', 'actuación',
        'indie', 'pop', 'rock', 'rap', 'jazz', 'flamenco',
    ],
    [
        'teatro', 'theatre', 'theater', 'obra', 'espectaculo', 'espectáculo',
        'musical', 'comedia', 'stand up', 'standup', 'monologo', 'monólogo',
        'improv', 'improvisacion', 'improvisación',
    ],
    [
        'museo', 'museum', 'exposicion', 'exposición', 'exhibition', 'arte', 'art',
        'galeria', 'galería', 'gallery', 'pintura', 'escultura', 'contemporaneo',
        'contemporáneo', 'cultura', 'culture',
    ],
    [
        'feria', 'mercado', 'market', 'mercadillo', 'street market', 'vintage',
        'antiguedades', 'antigüedades', 'pulgas',
    ],

    // —— Idiomas / aprendizaje ——
    [
        'idiomas', 'languages', 'intercambio', 'language exchange', 'tandem',
        'english', 'ingles', 'inglés', 'francais', 'français', 'frances', 'francés',
        'deutsch', 'aleman', 'alemán', 'italiano', 'portuguese', 'portugues',
        'portugués', 'chinese', 'chino', 'japanese', 'japones', 'japonés',
        'hablar', 'conversation', 'conversacion', 'conversación', 'clase de idiomas',
        'practice english', 'practicar ingles', 'practicar inglés',
    ],
    [
        'estudio', 'study', 'estudiar', 'biblioteca', 'library', 'deberes',
        'examen', 'universidad', 'university', 'campus', 'apuntarse', 'apuntes',
        'coworking', 'trabajo', 'remote work', 'productividad',
    ],
    [
        'lectura', 'reading', 'libro', 'libros', 'book', 'books', 'club de lectura',
        'book club', 'novela', 'poesia', 'poesía',
    ],

    // —— Viajes / descubrir ——
    [
        'viajes', 'travel', 'trip', 'escapada', 'turismo', 'tourist', 'roadtrip',
        'road trip', 'finde', 'weekend trip', 'ciudad', 'city break', 'explorar',
        'explore', 'descubrir', 'discover', 'paseo urbano', 'ruta urbana',
    ],
    [
        'compras', 'shopping', 'tienda', 'tiendas', 'outlet', 'centro comercial',
        'mall', 'moda', 'fashion', 'ropa',
    ],
    [
        'voluntariado', 'volunteer', 'ong', 'solidario', 'ayuda', 'comunidad',
    ],
    [
        'mascotas', 'dogs', 'perros', 'pasear perro', 'dog walk', 'gatos', 'cats',
        'animal', 'animales',
    ],
    [
        'coche', 'car', 'conducir', 'drive', 'ruta en coche', 'roadtrip',
    ],
    [
        'foto', 'fotos', 'fotografia', 'fotografía', 'photography', 'photowalk',
        'sesion de fotos', 'sesión de fotos', 'camara', 'cámara',
    ],
    [
        'amigos', 'friends', 'quedada', 'quedadas', 'meetup', 'conocer gente',
        'new friends', 'social', 'networking', 'planes', 'plan',
    ],

    // —— Más deportes ——
    [
        'voleibol', 'volleyball', 'voley', 'vóley', 'beach volleyball', 'voley playa',
    ],
    [
        'handball', 'balonmano', 'balónmano', 'handbol',
    ],
    [
        'rugby', 'rugbi', 'touch rugby', 'futbol americano', 'fútbol americano', 'nfl',
        'american football',
    ],
    [
        'hockey', 'hockey hierba', 'hockey hielo', 'patinaje', 'skating', 'skate',
        'skateboard', 'rollers', 'patines', 'rollerskating',
    ],
    [
        'golf', 'minigolf', 'mini golf', 'putting',
    ],
    [
        'equitacion', 'equitación', 'caballo', 'caballos', 'horse', 'horses', 'hípica',
        'hipica', 'montar a caballo',
    ],
    [
        'buceo', 'diving', 'snorkel', 'snorkeling', 'submarinismo', 'apnea',
    ],
    [
        'pesca', 'fishing', 'pescar', 'caña', 'surfcasting',
    ],
    [
        'orientacion', 'orientación', 'raid', 'ocr', 'obstacle race', 'spartan',
        'hyrox', 'triatlon', 'triatlón', 'triathlon', 'duatlon', 'duatlón',
    ],
    [
        'escalada indoor', 'bloc', 'bloque', 'boulder gym', 'roca deportiva',
    ],

    // —— Más comida ——
    [
        'hamburguesa', 'burger', 'burgers', 'smash burger', 'cheeseburger', 'fast food',
    ],
    [
        'pizza', 'pizzeria', 'pizzería', 'pepperoni', 'napolitana', 'margarita',
    ],
    [
        'sushi', 'sashimi', 'ramen', 'poke', 'pokebowl', 'poke bowl', 'japones', 'japonés',
        'nikkei', 'udon', 'gyoza',
    ],
    [
        'mexicano', 'tacos', 'burrito', 'nachos', 'guacamole', 'quesadillas', 'tex mex',
    ],
    [
        'italiano', 'pasta', 'risotto', 'lasagna', 'lasaña', 'spaghetti', 'carbonara',
        'tiramisu',
    ],
    [
        'asiatico', 'asiático', 'thai', 'vietnamita', 'pho', 'pad thai', 'curry',
        'indio', 'indian', 'kebab', 'shawarma', 'falafel', 'hummus',
    ],
    [
        'vegano', 'vegan', 'vegetariano', 'vegetarian', 'healthy', 'saludable',
        'ensalada', 'salad', 'bowl', 'bowls', 'smoothie', 'zumos', 'juice',
    ],
    [
        'chocolate', 'churros', 'helado', 'ice cream', 'gelato', 'postre', 'dessert',
        'pastel', 'tarta', 'cake', 'brownie', 'donut', 'croissant',
    ],
    [
        'bbq', 'barbacoa', 'asado', 'parrilla', 'grill', 'costillas', 'ribs',
    ],
    [
        'marisco', 'seafood', 'pescado', 'fish', 'paella', 'arroces', 'fideua', 'fideuá',
        'pulpo', 'gambas',
    ],
    [
        'bodega', 'cata', 'cata de vinos', 'wine tasting', 'cerveza artesana',
        'brewery', 'cerveceria', 'cervecería', 'sidreria', 'sidrería',
    ],

    // —— Más ocio / cultura ——
    [
        'standup', 'stand up', 'monologo', 'monólogo', 'comedia', 'comedy', 'improv',
        'improvisacion', 'improvisación', 'humor',
    ],
    [
        'musical', 'broadway', 'obra de teatro', 'ballet', 'danza', 'opera', 'ópera',
        'zarzuela', 'circo', 'circus',
    ],
    [
        'expo', 'feria', 'salon', 'salón', 'comic', 'cómic', 'manga', 'anime',
        'cosplay', 'friki', 'geek',
    ],
    [
        'museo', 'museum', 'galeria', 'galería', 'arte urbano', 'street art',
        'grafiti', 'graffiti', 'exposicion', 'exposición',
    ],
    [
        'astro', 'astronomia', 'astronomía', 'estrellas', 'stars', 'planetario',
        'observacion', 'observación', ' Perseidas', 'perseidas',
    ],
    [
        'taller', 'workshop', 'curso', 'clase', 'manualidades', 'crafts', 'ceramica',
        'cerámica', 'pintura', 'painting', 'dibujo', 'drawing', 'costura', 'diy',
    ],
    [
        'cocina', 'cooking', 'taller de cocina', 'cooking class', 'reposteria',
        'repostería', 'baking', 'panaderia', 'panadería',
    ],

    // —— Social / planes típicos ——
    [
        'bienvenida', 'welcome', 'welcome day', 'dia de bienvenida', 'día de bienvenida',
        'conocerse', 'icebreaker', 'primer plan', 'primera quedada', 'onboarding',
    ],
    [
        'afterwork', 'after work', 'tardeo', 'vermut', 'vermutear', 'aperitivo',
        'cañas', 'canas', 'cervezas', 'birras',
    ],
    [
        'cumple', 'cumpleaños', 'birthday', 'celebracion', 'celebración', 'fiesta de cumple',
        'despedida', 'despedida de soltero', 'despedida de soltera', 'bachelor',
    ],
    [
        'quedada', 'quedadas', 'planazo', 'planazo del finde', 'quedamos', 'nos vemos',
        'salir', 'salida', 'rutina', 'rutina semanal',
    ],
    [
        'parejas', 'couples', 'citas', 'dating', 'speed dating', 'solteros', 'singles',
    ],
    [
        'familia', 'family', 'niños', 'ninos', 'kids', 'padres', 'parents', 'con niños',
    ],
    [
        'internacional', 'erasmus', 'expat', 'expats', 'exchange', 'intercambio cultural',
        'language exchange', 'tandem',
    ],

    // —— Gaming extra ——
    [
        'zelda', 'mario', 'mario kart', 'smash', 'smash bros', 'pokemon', 'pokémon',
        'animal crossing', 'splatoon',
    ],
    [
        'warzone', 'cod', 'call of duty', 'battlefield', 'apex', 'apex legends',
        'overwatch', 'rainbow six', 'r6', 'destiny',
    ],
    [
        'minecraft', 'roblox', 'terraria', 'rust', 'ark', 'valheim', 'survival',
    ],
    [
        'league of legends', 'lol', 'wild rift', 'dota', 'dota 2', 'smite', 'moba',
    ],
    [
        'valorant', 'cs2', 'counter strike', 'csgo', 'fps', 'shooter',
    ],
    [
        'fifa', 'ea fc', 'efootball', 'pes', 'nba 2k', 'rocket league', 'f1',
    ],
    [
        'board game cafe', 'cafe de juegos', 'café de juegos', 'juegos de mesa cafe',
        'dnd', 'dungeons and dragons', 'rol en vivo', 'larp',
    ],

    // —— Planes urbanos ——
    // (Sin grupos de ciudades ni barrios: buscar «Madrid» no debe sacar planes de Barcelona.)
    [
        'terraza', 'rooftop', 'azotea', 'mirador urbano', 'skyline', 'vistas ciudad',
    ],
    [
        'mercado', 'market', 'mercadillo', 'rastro', 'vintage market', 'pulgas',
        'farmers market',
    ],
    [
        'gimnasio outdoor', 'calistenia parque', 'park workout', 'street workout',
        'barras',
    ],
];

/**
 * Palabras que nombran una categoría entera. Solo estas expanden a «toda la
 * categoría»: buscar «teatro» no debe sacar cualquier plan de SHOWTIME.
 */
const CATEGORY_NAMES: Record<MainCategoryId, string[]> = {
    FOODIES: ['foodies', 'foodie', 'comida', 'food', 'gastro', 'gastronomia', 'gastronomía'],
    DEPORTES: ['deportes', 'deporte', 'sport', 'sports', 'esporte', 'esportes', 'sportif'],
    AIRE_LIBRE: ['aire libre', 'outdoor', 'outdoors', 'naturaleza', 'nature', 'plein air'],
    SHOWTIME: ['showtime', 'espectaculo', 'espectáculo', 'espectaculos', 'espectáculos', 'show', 'shows'],
    DESCUBRIR: ['descubrir', 'discover', 'explorar', 'explore', 'cultura', 'culture'],
    VIBES: ['vibes', 'ocio'],
};

const SUB_KEYWORDS: Record<string, string[]> = {
    cafe: ['cafe', 'café', 'coffee', 'brunch', 'desayuno', 'breakfast', 'merienda', 'tostadas'],
    comer: ['comer', 'lunch', 'comida', 'almuerzo', 'restaurante', 'menu', 'menú'],
    cenar: ['cenar', 'cena', 'dinner', 'noche', 'restaurante'],
    tapas: ['tapas', 'pintxos', 'pinchos', 'raciones', 'cañas', 'canas', 'vermut'],
    futbol: ['futbol', 'fútbol', 'soccer', 'football', 'partido', 'pachanga', 'futsal', 'gol'],
    baloncesto: ['baloncesto', 'basket', 'basketball', 'nba', 'canasta', 'triple'],
    padel: ['padel', 'pádel', 'paddle', 'pista'],
    running: ['running', 'correr', 'footing', 'jogging', 'maratón', 'maraton', 'carrera', 'trail'],
    senderismo: ['senderismo', 'hiking', 'trek', 'trekking', 'montaña', 'montana', 'ruta', 'caminata'],
    playa: ['playa', 'beach', 'bañarse', 'banarse', 'chiringuito', 'mar', 'surf'],
    mirador: ['mirador', 'viewpoint', 'vistas', 'atardecer', 'sunset', 'amanecer', 'fotos'],
    picnic: ['picnic', 'parque', 'park', 'merienda', 'cesped', 'césped'],
    cine: ['cine', 'cinema', 'movie', 'pelicula', 'película', 'film', 'estreno', 'netflix'],
    teatro: ['teatro', 'theatre', 'theater', 'obra', 'musical', 'monologo', 'monólogo'],
    concierto: ['concierto', 'concert', 'musica', 'música', 'live', 'festival', 'banda', 'gig'],
    espectaculo: ['espectaculo', 'espectáculo', 'show', 'standup', 'comedia', 'actuacion', 'actuación'],
    museo: ['museo', 'museum', 'arte', 'art', 'exposicion', 'exposición', 'galeria', 'galería'],
    estudio: ['estudio', 'study', 'biblioteca', 'deberes', 'universidad', 'apuntes', 'coworking'],
    idiomas: [
        'idiomas', 'languages', 'english', 'ingles', 'inglés', 'intercambio', 'tandem',
        'francais', 'français', 'frances', 'francés', 'aleman', 'alemán',
    ],
    viajes: ['viajes', 'travel', 'trip', 'escapada', 'turismo', 'roadtrip', 'explorar'],
    fiesta: ['fiesta', 'party', 'noche', 'club', 'discoteca', 'dj', 'copas', 'after'],
    compras: ['compras', 'shopping', 'tienda', 'outlet', 'moda', 'centro comercial'],
    gaming: [
        'gaming', 'videojuegos', 'fortnite', 'gamer', 'juegos', 'ps5', 'xbox', 'nintendo',
        'lol', 'valorant', 'minecraft', 'steam', 'online',
    ],
    juegos_mesa: [
        'juegos de mesa', 'board games', 'cartas', 'catan', 'rol', 'uno', 'poker', 'póker',
    ],
};

/** No expandir estas palabras: sueltan grupos enteros (quedadas, fotos, juegos…). */
const SEARCH_STOPWORDS = new Set([
    'plan', 'planes', 'mesa', 'foto', 'fotos',
    'the', 'and', 'con', 'para', 'una', 'uno', 'del', 'las', 'los', 'por', 'que',
    'de', 'el', 'la', 'en', 'al', 'un',
]);

function stripAccents(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function normalizeSearchText(s: string): string {
    return stripAccents(String(s || '').toLowerCase().trim()).replace(/\s+/g, ' ');
}

function tokenize(s: string): string[] {
    return normalizeSearchText(s)
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 2);
}

function wordsKey(term: string): string {
    return tokenize(term).join(' ');
}

/**
 * Palabras que están en los grupos pero significan otras cosas en el día a día
 * («series» de Netflix, «clase» de inglés, «noche» de cualquier plan…).
 * Ni activan un grupo ni se usan como sinónimo; si se escriben tal cual, se
 * siguen encontrando por coincidencia literal.
 */
const AMBIGUOUS_TERMS = new Set([
    'set', 'live', 'online', 'ring', 'art', 'mar', 'sea', 'run', 'roll', 'rolls', 'rolling', 'gi',
    'sala', 'series', 'obra', 'clase', 'curso', 'centro', 'barrio', 'ciudad', 'ruta', 'paseo',
    'salir', 'salida', 'noche', 'night', 'club', 'equipo', 'liga', 'partido', 'partida', 'partidas',
    'juegos', 'games', 'magic', 'role', 'rol', 'cartas', 'after', 'amigos', 'friends', 'social',
    'thai', 'paddle', 'pes', 'cod', 'lol', 'rust', 'ark', 'apex', 'switch', 'mando', 'consola',
    'console', 'controller', 'trabajo', 'estudio', 'ayuda', 'comunidad', 'animal', 'car', 'drive',
    'coche', 'tienda', 'moda', 'ropa', 'arena', 'sand', 'costa', 'coast', 'fuego', 'directo', 'banda',
    'band', 'pop', 'rock', 'drama', 'terror', 'horror', 'comedia', 'musical', 'pintura', 'cocina',
    'chef', 'menu', 'menudo', 'carne', 'pollo', 'healthy', 'saludable', 'dulce', 'tarta', 'cake',
    'sprint', 'intervalos', 'carrera', 'sierra', 'pico', 'vistas', 'views', 'instagram', 'barras',
    'bloque', 'bloc', 'raid', 'cana', 'canas', 'vela', 'remo', 'barco', 'boat', 'nieve', 'snow',
    'combate', 'fight', 'guantes', 'sacos', 'saco', 'gol', 'goles', 'balon', 'triple', 'triples',
    'guardia', 'guard', 'despedida', 'padres', 'parents', 'familia', 'family', 'kids', 'expo',
    'salon', 'mercado', 'market', 'feria', 'escape', 'rutina', 'quedamos', 'nos vemos', 'hablar',
    'conversation', 'conversacion', 'marvel', 'disney', 'netflix', 'pista', 'bowl', 'bowls',
    'chocolate', 'merienda', 'hamaca', 'olas', 'waves', 'kite', 'sup', 'ufc', 'premiere',
    'estreno', 'indie', 'trivial', 'mtb', 'carretera', 'gravel', 'apuntarse', 'campus',
].map(wordsKey));

const EXPAND_MIN_LEN = 3;
/** Mínimo de letras para tratar lo escrito como el inicio de un sinónimo («senderi» → senderismo). */
const PREFIX_EXPAND_MIN_LEN = 5;

/** Texto como lista de palabras con espacios a los lados: « pachanga de futbol ». */
function padded(...parts: (string | null | undefined)[]): string {
    return ` ${tokenize(parts.filter(Boolean).join(' ')).join(' ')} `;
}

function isStopword(term: string): boolean {
    return SEARCH_STOPWORDS.has(term);
}

function isUsableTerm(term: string): boolean {
    return !!term && term.length >= 2 && !isStopword(term) && !AMBIGUOUS_TERMS.has(term);
}

/** ¿Aparece el término como palabra o frase completa? Admite plural (-s / -es). */
function hasWholeTerm(text: string, term: string): boolean {
    const t = wordsKey(term);
    if (!t) return false;
    return text.includes(` ${t} `) || text.includes(` ${t}s `) || text.includes(` ${t}es `);
}

/** ¿Alguna palabra empieza por lo escrito? («pad» → «padel», pero «mar» no casa con «tomar»). */
function hasWordPrefix(text: string, query: string): boolean {
    const t = wordsKey(query);
    return !!t && text.includes(` ${t}`);
}

const NORM_GROUPS: string[][] = CONCEPT_GROUPS.map((group) =>
    Array.from(new Set(group.map(wordsKey).filter(isUsableTerm))),
);
const CONCEPT_PHRASES = new Set(NORM_GROUPS.flat());
const NORM_CATEGORY_NAMES = (Object.entries(CATEGORY_NAMES) as [MainCategoryId, string[]][])
    .map(([cat, names]) => [cat, names.map(wordsKey).filter(Boolean)] as const);
const NORM_SUB_KEYWORDS = Object.entries(SUB_KEYWORDS)
    .map(([sub, words]) => [sub, words.map(wordsKey).filter(isUsableTerm)] as const);

/** Grupos de sinónimos que nombra lo que ha escrito el usuario. */
function queryGroupIndexes(query: string): number[] {
    const text = padded(query);
    const tokens = tokenize(query).filter((t) => t.length >= PREFIX_EXPAND_MIN_LEN && isUsableTerm(t));
    const hits: number[] = [];
    NORM_GROUPS.forEach((group, i) => {
        const hit = group.some((term) =>
            hasWholeTerm(text, term)
            || tokens.some((t) => term.startsWith(t)),
        );
        if (hit) hits.push(i);
    });
    return hits;
}

/**
 * Expande una búsqueda con sinónimos locales (sin red). Incluye la propia
 * búsqueda y sus palabras; los sinónimos se comparan siempre como palabra completa.
 */
export function expandQueryLocally(query: string): string[] {
    const q = wordsKey(query);
    if (!q) return [];

    const out = new Set<string>([q, ...tokenize(q).filter((t) => !isStopword(t))]);
    if (q.length < EXPAND_MIN_LEN || isStopword(q)) {
        return Array.from(out);
    }
    const text = padded(q);

    for (const idx of queryGroupIndexes(q)) {
        for (const term of NORM_GROUPS[idx]) out.add(term);
    }
    for (const [cat, names] of NORM_CATEGORY_NAMES) {
        if (names.some((n) => hasWholeTerm(text, n))) out.add(wordsKey(cat));
    }
    for (const [sub, words] of NORM_SUB_KEYWORDS) {
        if (hasWholeTerm(text, sub) || words.some((w) => hasWholeTerm(text, w))) {
            out.add(wordsKey(sub));
            for (const w of words) out.add(w);
        }
    }
    return Array.from(out);
}

const expandCache = new Map<string, string[]>();

function expandCached(query: string): string[] {
    const key = wordsKey(query);
    if (!key) return [];
    const cached = expandCache.get(key);
    if (cached) return cached;
    const terms = expandQueryLocally(key);
    expandCache.set(key, terms);
    if (expandCache.size > 120) {
        const first = expandCache.keys().next().value;
        if (first) expandCache.delete(first);
    }
    return terms;
}

export async function expandSearchQuery(query: string): Promise<string[]> {
    // Expansión local determinista: sin claves en cliente, cuotas ni servicios de pago.
    return expandCached(query);
}

/** Palabras de la búsqueda que cuentan (sin «de», «con», «plan»…). */
function queryTokens(query: string): string[] {
    return tokenize(query).filter((t) => !isStopword(t));
}

/** Una sola idea («padel», «open mat», «juegos de mesa»), no varias palabras sueltas. */
function isSingleConcept(query: string): boolean {
    return queryTokens(query).length <= 1 || CONCEPT_PHRASES.has(wordsKey(query));
}

/**
 * Sinónimos que se mandan al servidor para que también encuentre planes que
 * aún no están cargados. Vacío si la búsqueda son varias ideas («padel madrid»):
 * ahí el servidor exige que estén todas las palabras.
 */
export function searchSynonymTerms(query: string, max = 40): string[] {
    const q = wordsKey(query);
    if (!q || !isSingleConcept(q)) return [];
    return expandCached(q)
        .filter((t) => t !== q && t.length >= EXPAND_MIN_LEN && isUsableTerm(t))
        .slice(0, max);
}

export type SearchablePlan = {
    titulo?: string | null;
    descripcion?: string | null;
    categoria?: string | null;
    tipo_deporte?: string | null;
    nombre_ubicacion?: string | null;
    host?: { nombre?: string | null; nombre_usuario?: string | null } | null;
    /** Puntuación que da el servidor (`search_feed_plans`), si el plan viene de ahí. */
    search_score?: number | null;
};

function hostSearchText(plan: SearchablePlan): string {
    const host = plan.host;
    if (!host || typeof host !== 'object') return '';
    return [host.nombre, host.nombre_usuario].filter(Boolean).join(' ');
}

type PlanFields = {
    title: string;
    desc: string;
    loc: string;
    host: string;
    cat: string;
    /** Todo lo literal: título, descripción, sitio, anfitrión y categoría. */
    all: string;
    /** Donde se buscan sinónimos: título, descripción y categoría (no el sitio ni el anfitrión). */
    semantic: string;
};

function planFields(plan: SearchablePlan): PlanFields {
    const main = normalizeMainCategory(plan.categoria);
    const hostText = hostSearchText(plan);
    return {
        title: padded(plan.titulo),
        desc: padded(plan.descripcion),
        loc: padded(plan.nombre_ubicacion),
        host: padded(hostText),
        cat: padded(plan.categoria, plan.tipo_deporte, main),
        semantic: padded(plan.titulo, plan.descripcion, plan.categoria, plan.tipo_deporte, main),
        all: padded(
            plan.titulo, plan.descripcion, plan.nombre_ubicacion, hostText,
            plan.categoria, plan.tipo_deporte, main,
        ),
    };
}

function synonymHit(part: string, semantic: string, expanded?: string[]): boolean {
    const key = wordsKey(part);
    // Las palabras sueltas de lo escrito no son sinónimos («open» no basta para «open mat»).
    const own = new Set([key, ...tokenize(key)]);
    const terms = expanded?.length ? expanded : expandCached(part);
    return terms.some((term) => !own.has(term) && isUsableTerm(term) && hasWholeTerm(semantic, term));
}

/** Más alto = más relevante (título exacto > parcial > sitio > anfitrión > categoría > descripción > sinónimo). */
export function searchRelevanceScore(plan: SearchablePlan, query: string): number {
    const q = wordsKey(query);
    if (!q) return 0;
    const server = Number(plan.search_score) || 0;
    const f = planFields(plan);
    const tokens = queryTokens(q);
    let local = 0;
    if (f.title.trim() === q) local = 100;
    else if (f.title.startsWith(` ${q}`)) local = 80;
    else if (hasWordPrefix(f.title, q)) local = 60;
    else if (tokens.length >= 2 && tokens.every((t) => hasWordPrefix(f.title, t))) local = 55;
    else if (hasWordPrefix(f.loc, q)) local = 45;
    else if (hasWordPrefix(f.host, q)) local = 40;
    else if (tokens.length >= 2 && tokens.every((t) => hasWordPrefix(f.all, t))) local = 30;
    else if (hasWordPrefix(f.cat, q)) local = 25;
    else if (hasWordPrefix(f.desc, q)) local = 20;
    else if (planMatchesSearch(plan, query)) local = 10;
    return Math.max(local, server);
}

/** ¿El plan encaja con la búsqueda (literal + sinónimos)? */
export function planMatchesSearch(
    plan: SearchablePlan,
    query: string,
    expandedTerms?: string[],
): boolean {
    const q = wordsKey(query);
    if (!q) return true;
    const f = planFields(plan);

    // 1) Lo escrito, como inicio de palabra, en cualquier campo.
    if (hasWordPrefix(f.all, q)) return true;

    // 2) Una sola idea: vale un sinónimo como palabra completa.
    if (isSingleConcept(q)) return synonymHit(q, f.semantic, expandedTerms);

    // 3) Varias ideas («padel madrid»): tienen que estar todas, en el campo que sea.
    return queryTokens(q).every((t) => hasWordPrefix(f.all, t) || synonymHit(t, f.semantic));
}

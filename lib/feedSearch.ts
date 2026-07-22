import { normalizeMainCategory, type MainCategoryId } from './categories';
import { getClientOpenAiKey } from './aiConfig';
import { supabase } from './supabase';

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
        'fifa', 'ea fc', 'pes', 'efootball',
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
        'finde', 'fin de semana', 'weekend', 'sabado', 'sábado', 'domingo', 'sunday',
        'saturday', 'viernes', 'friday', 'noche de viernes',
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

    // —— Ciudad / planes urbanos ——
    [
        'madrid', 'barcelona', 'valencia', 'sevilla', 'bilbao', 'malaga', 'málaga',
        'zaragoza', 'granada', 'alicante', 'murcia', 'palma', 'las palmas',
    ],
    [
        'centro', 'casco antiguo', 'barrio', 'malasaña', 'malasana', 'chueca',
        'latina', 'retiro', 'gracia', 'born', 'eixample', 'triball',
    ],
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

const CATEGORY_KEYWORDS: Record<MainCategoryId, string[]> = {
    FOODIES: [
        'foodies', 'comida', 'food', 'gastro', 'comer', 'cenar', 'tapas', 'cafe',
        'café', 'restaurant', 'restaurante', 'brunch', 'cena', 'almuerzo', 'pintxos',
        'gastronomia', 'gastronomía', 'cocina', 'foodie', 'pizza', 'burger', 'sushi',
        'paella', 'vermut', 'cerveza', 'vino',
    ],
    DEPORTES: [
        'deportes', 'sport', 'sports', 'deporte', 'sportif', 'esporte', 'entrenamiento',
        'partido', 'equipo', 'competicion', 'competición', 'fitness', 'gym', 'padel',
        'futbol', 'running', 'yoga', 'crossfit', 'natacion', 'natación',
    ],
    AIRE_LIBRE: [
        'aire libre', 'outdoor', 'outdoors', 'naturaleza', 'nature', 'plein air',
        'montaña', 'montana', 'senderismo', 'playa', 'picnic', 'excursión', 'excursion',
        'hiking', 'surf', 'kayak', 'camping', 'parque',
    ],
    SHOWTIME: [
        'showtime', 'espectaculo', 'espectáculo', 'show', 'culture', 'cultura',
        'cine', 'teatro', 'concierto', 'musica', 'música', 'festival', 'comedia',
        'standup', 'musical', 'opera', 'ópera',
    ],
    DESCUBRIR: [
        'descubrir', 'discover', 'explorar', 'explore', 'cultura', 'aprender',
        'museo', 'idiomas', 'viajes', 'turismo', 'city', 'taller', 'workshop',
        'exposicion', 'exposición', 'mercado',
    ],
    VIBES: [
        'vibes', 'fiesta', 'party', 'social', 'gaming', 'juegos', 'noche', 'copas',
        'terraceo', 'compras', 'ocio', 'afterwork', 'tardeo', 'quedada', 'karaoke',
        'bolera', 'escape room',
    ],
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

function stripAccents(s: string): string {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeSearchText(s: string): string {
    return stripAccents(String(s || '').toLowerCase().trim()).replace(/\s+/g, ' ');
}

function tokenize(s: string): string[] {
    return normalizeSearchText(s)
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 2);
}

/** ¿El texto contiene el término (frase o tokens)? */
function textHasTerm(text: string, term: string): boolean {
    if (!term || !text) return false;
    if (text.includes(term)) return true;
    const tokens = tokenize(term);
    if (tokens.length >= 2) return tokens.every((t) => text.includes(t));
    return false;
}

/** Índices de grupos que toca un texto. */
function matchingGroupIndexes(text: string): number[] {
    const n = normalizeSearchText(text);
    if (!n) return [];
    const tokens = tokenize(n);
    const hits: number[] = [];
    for (let i = 0; i < CONCEPT_GROUPS.length; i++) {
        const norms = CONCEPT_GROUPS[i].map(normalizeSearchText);
        const hit = norms.some(
            (term) =>
                n.includes(term)
                || term.includes(n)
                || tokens.some((t) => t.length >= 3 && (term.includes(t) || t.includes(term))),
        );
        if (hit) hits.push(i);
    }
    return hits;
}

/** Expande una query con sinónimos locales (sin red). */
export function expandQueryLocally(query: string): string[] {
    const q = normalizeSearchText(query);
    if (!q) return [];

    const out = new Set<string>([q, ...tokenize(query)]);

    for (const idx of matchingGroupIndexes(q)) {
        for (const term of CONCEPT_GROUPS[idx]) out.add(normalizeSearchText(term));
    }

    for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS) as [MainCategoryId, string[]][]) {
        if (words.some((w) => q.includes(normalizeSearchText(w)))) {
            out.add(normalizeSearchText(cat));
            for (const w of words) out.add(normalizeSearchText(w));
        }
    }

    for (const [sub, words] of Object.entries(SUB_KEYWORDS)) {
        if (words.some((w) => q.includes(normalizeSearchText(w))) || q.includes(sub)) {
            out.add(sub);
            for (const w of words) out.add(normalizeSearchText(w));
        }
    }

    return Array.from(out).filter(Boolean);
}

/**
 * Expande el texto del plan (título + descripción) con conceptos relacionados.
 * Así "vamos a hacer rolls" en la descripción enlaza con bjj / open mat.
 */
function expandPlanConcepts(title: string, description: string): string[] {
    const blob = `${title} ${description}`;
    const out = new Set<string>();
    for (const idx of matchingGroupIndexes(blob)) {
        for (const term of CONCEPT_GROUPS[idx]) out.add(normalizeSearchText(term));
    }
    return Array.from(out);
}

async function expandViaEdge(query: string): Promise<string[] | null> {
    try {
        const { data, error } = await supabase.functions.invoke('expand-search-query', {
            body: { query },
        });
        if (error || !data) return null;
        const terms = (data as { terms?: unknown }).terms;
        if (!Array.isArray(terms)) return null;
        return terms.map((t) => normalizeSearchText(String(t))).filter((t) => t.length >= 2);
    } catch {
        return null;
    }
}

async function expandViaOpenAi(query: string): Promise<string[] | null> {
    const apiKey = getClientOpenAiKey();
    if (!apiKey) return null;

    try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                temperature: 0.2,
                max_tokens: 220,
                messages: [
                    {
                        role: 'system',
                        content:
                            'You expand search queries for a Spanish social plans app (NEXO). '
                            + 'Given a user query in ANY language, return related keywords/synonyms in Spanish and English '
                            + 'that could match plan titles OR descriptions (e.g. "jiu jitsu brasileño" → open mat, bjj, grappling; '
                            + '"fortnite" → videojuegos, gaming). '
                            + 'Reply ONLY JSON: {"terms":["..."]}. Max 18 short terms.',
                    },
                    { role: 'user', content: query },
                ],
            }),
        });
        if (!res.ok) return null;
        const json = await res.json();
        const text = json?.choices?.[0]?.message?.content?.trim() || '';
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return null;
        const parsed = JSON.parse(match[0]) as { terms?: unknown };
        if (!Array.isArray(parsed.terms)) return null;
        return parsed.terms.map((t) => normalizeSearchText(String(t))).filter((t) => t.length >= 2);
    } catch {
        return null;
    }
}

const expandCache = new Map<string, string[]>();

export async function expandSearchQuery(query: string): Promise<string[]> {
    const key = normalizeSearchText(query);
    if (!key) return [];
    const cached = expandCache.get(key);
    if (cached) return cached;

    // Local primero (gratis y amplio); IA opcional si está configurada.
    const local = expandQueryLocally(query);
    let aiTerms: string[] = [];
    try {
        const viaEdge = await expandViaEdge(query);
        aiTerms = viaEdge ?? (await expandViaOpenAi(query)) ?? [];
    } catch {
        aiTerms = [];
    }
    const merged = Array.from(new Set([...local, ...aiTerms]));
    expandCache.set(key, merged);
    if (expandCache.size > 80) {
        const first = expandCache.keys().next().value;
        if (first) expandCache.delete(first);
    }
    return merged;
}

export type SearchablePlan = {
    titulo?: string | null;
    descripcion?: string | null;
    categoria?: string | null;
    tipo_deporte?: string | null;
    nombre_ubicacion?: string | null;
};

function planHaystack(plan: SearchablePlan): string {
    const main = normalizeMainCategory(plan.categoria);
    const title = plan.titulo || '';
    const desc = plan.descripcion || '';
    const parts = [
        title,
        desc,
        plan.categoria,
        plan.tipo_deporte,
        plan.nombre_ubicacion,
        main || '',
        ...(main ? CATEGORY_KEYWORDS[main] || [] : []),
        ...(plan.tipo_deporte ? SUB_KEYWORDS[String(plan.tipo_deporte)] || [] : []),
        ...expandPlanConcepts(title, desc),
    ];
    return normalizeSearchText(parts.filter(Boolean).join(' '));
}

/** ¿El plan encaja con la búsqueda (título + descripción + semántica)? */
export function planMatchesSearch(
    plan: SearchablePlan,
    query: string,
    expandedTerms?: string[],
): boolean {
    const q = normalizeSearchText(query);
    if (!q) return true;

    const title = normalizeSearchText(plan.titulo || '');
    const desc = normalizeSearchText(plan.descripcion || '');
    const hay = planHaystack(plan);

    // 1) Coincidencia literal en título, descripción o texto ampliado
    if (textHasTerm(title, q) || textHasTerm(desc, q) || textHasTerm(hay, q)) return true;

    const terms = expandedTerms?.length ? expandedTerms : expandQueryLocally(query);

    // 2) Algún término expandido aparece en título o descripción (prioridad)
    for (const term of terms) {
        if (term.length < 2) continue;
        if (textHasTerm(title, term) || textHasTerm(desc, term) || textHasTerm(hay, term)) {
            return true;
        }
    }

    // 3) Tokens de la query repartidos por título/descripción
    const qTokens = tokenize(query).filter((t) => t.length >= 3);
    if (qTokens.length >= 2) {
        const hits = qTokens.filter((t) => title.includes(t) || desc.includes(t) || hay.includes(t));
        if (hits.length >= Math.ceil(qTokens.length * 0.6)) return true;
    } else if (qTokens.length === 1) {
        const t = qTokens[0];
        if (title.includes(t) || desc.includes(t)) return true;
    }

    // 4) Mismo grupo conceptual: query ↔ título o descripción
    const qGroups = new Set(matchingGroupIndexes(q));
    if (qGroups.size > 0) {
        const planGroups = matchingGroupIndexes(`${title} ${desc}`);
        if (planGroups.some((g) => qGroups.has(g))) return true;
    }

    return false;
}

import type { DeporteTipo } from './sportFormations';

/** Identificadores de categoría principal (valor en BD: `categoria`). */
export const MAIN_CATEGORY_IDS = [
    'FOODIES',
    'DEPORTES',
    'AIRE_LIBRE',
    'SHOWTIME',
    'DESCUBRIR',
    'VIBES',
] as const;

export type MainCategoryId = (typeof MAIN_CATEGORY_IDS)[number];

/** Slugs de subcategoría (valor en BD: `tipo_deporte`). */
export const SUBCATEGORIES: Record<MainCategoryId, readonly string[]> = {
    FOODIES: ['cafe', 'comer', 'cenar', 'tapas', 'otro'],
    DEPORTES: ['futbol', 'baloncesto', 'padel', 'running', 'otro'],
    AIRE_LIBRE: ['senderismo', 'playa', 'mirador', 'picnic', 'otro'],
    SHOWTIME: ['cine', 'teatro', 'concierto', 'espectaculo', 'otro'],
    DESCUBRIR: ['museo', 'estudio', 'idiomas', 'viajes', 'otro'],
    VIBES: ['fiesta', 'compras', 'gaming', 'juegos_mesa', 'otro'],
};

export const MAIN_CATEGORIES: MainCategoryId[] = [...MAIN_CATEGORY_IDS];

export const FEED_PLAN_CATEGORIES = new Set<string>([...MAIN_CATEGORY_IDS]);

const COVERS_PER_SUB = 3;

/** Placeholder hasta subir imágenes por subcategoría. */
export const PLACEHOLDER_COVER_URI = 'https://via.placeholder.com/800x600/E8EEF5/94A3B8?text=NEXO';

export const PLACEHOLDER_COVER = { uri: PLACEHOLDER_COVER_URI };

export type CoverSource = string | number;

/**
 * Portadas locales por `main:sub` desde `assets/images`.
 * Convención: `SUB_1.jpg` … `SUB_3.jpg`, y `{MAIN}_OTRO.jpg` para "otro".
 */
const COVER_ASSETS: Partial<Record<string, CoverSource[]>> = {
    'FOODIES:cafe': [
        require('../assets/images/CAFE_1.jpg'),
        require('../assets/images/CAFE_2.jpg'),
        require('../assets/images/CAFE_3.jpg'),
    ],
    'FOODIES:comer': [
        require('../assets/images/COMER_1.jpg'),
        require('../assets/images/COMER_2.jpg'),
        require('../assets/images/COMER_3.jpg'),
    ],
    'FOODIES:cenar': [
        require('../assets/images/CENAR_1.jpg'),
        require('../assets/images/CENAR_2.jpg'),
        require('../assets/images/CENAR_3.jpg'),
    ],
    'FOODIES:tapas': [
        require('../assets/images/TAPAS_1.jpg'),
        require('../assets/images/TAPAS_2.jpg'),
        require('../assets/images/TAPAS_3.jpg'),
    ],
    'FOODIES:otro': [require('../assets/images/FOODIES_OTRO.jpg')],

    'DEPORTES:futbol': [
        require('../assets/images/FUTBOL_1.jpg'),
        require('../assets/images/FUTBOL_2.jpg'),
        require('../assets/images/FUTBOL_3.jpg'),
    ],
    'DEPORTES:baloncesto': [
        require('../assets/images/BALONCESTO_1.jpg'),
        require('../assets/images/BALONCESTO_2.jpg'),
        require('../assets/images/BALONCESTO_3.jpg'),
    ],
    'DEPORTES:padel': [
        require('../assets/images/PADEL_1.jpg'),
        require('../assets/images/PADEL_2.jpg'),
        require('../assets/images/PADEL_3.jpg'),
    ],
    'DEPORTES:running': [
        require('../assets/images/RUNNING_1.jpg'),
        require('../assets/images/RUNNING_2.jpg'),
        require('../assets/images/RUNNING_3.jpg'),
    ],
    'DEPORTES:otro': [require('../assets/images/DEPORTES_OTRO.jpg')],

    'AIRE_LIBRE:senderismo': [
        require('../assets/images/SENDERISMO_1.jpg'),
        require('../assets/images/SENDERISMO_2.jpg'),
        require('../assets/images/SENDERISMO_3.jpg'),
    ],
    'AIRE_LIBRE:playa': [
        require('../assets/images/PLAYA_1.jpg'),
        require('../assets/images/PLAYA_2.jpg'),
        require('../assets/images/PLAYA_3.jpg'),
    ],
    'AIRE_LIBRE:mirador': [
        require('../assets/images/MIRADOR_1.jpg'),
        require('../assets/images/MIRADOR_2.jpg'),
        require('../assets/images/MIRADOR_3.jpg'),
    ],
    'AIRE_LIBRE:picnic': [
        require('../assets/images/PICNIC_1.jpg'),
        require('../assets/images/PICNIC_2.jpg'),
        require('../assets/images/PICNIC_3.jpg'),
    ],
    'AIRE_LIBRE:otro': [require('../assets/images/AIRE_LIBRE_OTRO.jpg')],

    'SHOWTIME:cine': [
        require('../assets/images/CINE_1.jpg'),
        require('../assets/images/CINE_2.jpg'),
        require('../assets/images/CINE_3.jpg'),
    ],
    'SHOWTIME:teatro': [
        require('../assets/images/TEATRO_1.jpg'),
        require('../assets/images/TEATRO_2.jpg'),
        require('../assets/images/TEATRO_3.jpg'),
    ],
    'SHOWTIME:concierto': [
        require('../assets/images/CONCIERTO_1.jpg'),
        require('../assets/images/CONCIERTO_2.jpg'),
        require('../assets/images/CONCIERTO_3.jpg'),
    ],
    'SHOWTIME:espectaculo': [
        require('../assets/images/ESPECTACULO_1.jpg'),
        require('../assets/images/ESPECTACULO_2.jpg'),
        require('../assets/images/ESPECTACULO_3.jpg'),
    ],
    'SHOWTIME:otro': [require('../assets/images/SHOWTIME_OTRO.jpg')],

    'DESCUBRIR:museo': [
        require('../assets/images/MUSEO_1.jpg'),
        require('../assets/images/MUSEO_2.jpg'),
        require('../assets/images/MUSEO_3.jpg'),
    ],
    'DESCUBRIR:estudio': [
        require('../assets/images/ESTUDIO_1.jpg'),
        require('../assets/images/ESTUDIO_2.jpg'),
        require('../assets/images/ESTUDIO_3.jpg'),
    ],
    'DESCUBRIR:idiomas': [
        require('../assets/images/IDIOMAS_1.jpg'),
        require('../assets/images/IDIOMAS_2.jpg'),
        require('../assets/images/IDIOMAS_3.jpg'),
    ],
    'DESCUBRIR:viajes': [
        require('../assets/images/VIAJES_1.jpg'),
        require('../assets/images/VIAJES_2.jpg'),
        require('../assets/images/VIAJES_3.jpg'),
    ],
    'DESCUBRIR:otro': [require('../assets/images/DESCUBRIR_OTRO.jpg')],

    'VIBES:fiesta': [
        require('../assets/images/FIESTA_1.jpg'),
        require('../assets/images/FIESTA_2.jpg'),
        require('../assets/images/FIESTA_3.jpg'),
    ],
    'VIBES:compras': [
        require('../assets/images/COMPRAS_1.jpg'),
        require('../assets/images/COMPRAS_2.jpg'),
        require('../assets/images/COMPRAS_3.jpg'),
    ],
    'VIBES:gaming': [
        require('../assets/images/GAMING_1.jpg'),
        require('../assets/images/GAMING_2.jpg'),
        require('../assets/images/GAMING_3.jpg'),
    ],
    'VIBES:juegos_mesa': [
        require('../assets/images/JUEGOS_DE_MESA_1.jpg'),
        require('../assets/images/JUEGOS_DE_MESA_2.jpg'),
        require('../assets/images/JUEGOS_DE_MESA_3.jpg'),
    ],
    'VIBES:otro': [require('../assets/images/VIBES_OTRO.jpg')],
};

const LEGACY_MAIN_MAP: Record<string, MainCategoryId> = {
    Tapas: 'FOODIES',
    Deporte: 'DEPORTES',
    Fiesta: 'VIBES',
    Estudio: 'DESCUBRIR',
    'Solo chicas': 'VIBES',
    Café: 'FOODIES',
    Ocio: 'VIBES',
};

const LEGACY_SUB_MAP: Record<string, string> = {
    futbol: 'futbol',
    basket: 'baloncesto',
    baloncesto: 'baloncesto',
    padel: 'padel',
    tenis: 'otro',
    running: 'running',
    fiesta: 'fiesta',
    tapas: 'tapas',
    estudio: 'estudio',
};

export function isMainCategoryId(value?: string | null): value is MainCategoryId {
    return !!value && MAIN_CATEGORY_IDS.includes(value as MainCategoryId);
}

export function normalizeMainCategory(value?: string | null): MainCategoryId | null {
    if (!value) return null;
    if (isMainCategoryId(value)) return value;
    return LEGACY_MAIN_MAP[value] ?? null;
}

export function normalizeSubcategory(main: MainCategoryId, value?: string | null): string {
    const subs = SUBCATEGORIES[main];
    if (value && subs.includes(value)) return value;
    if (value && LEGACY_SUB_MAP[value] && subs.includes(LEGACY_SUB_MAP[value])) {
        return LEGACY_SUB_MAP[value];
    }
    return subs[0];
}

export function resolvePlanCategories(plan: {
    categoria?: string | null;
    tipo_deporte?: string | null;
}): { main: MainCategoryId | null; sub: string | null } {
    const main = normalizeMainCategory(plan.categoria);
    if (!main) return { main: null, sub: null };
    const sub = plan.tipo_deporte ? normalizeSubcategory(main, plan.tipo_deporte) : SUBCATEGORIES[main][0];
    return { main, sub };
}

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

export function getPlanCategoryDisplay(
    plan: { categoria?: string | null; tipo_deporte?: string | null },
    t: TranslateFn,
): string {
    const { main, sub } = resolvePlanCategories(plan);
    if (main && sub) {
        return `${t(`cat.main.${main}`)} · ${t(`cat.sub.${sub}`)}`;
    }
    if (main) return t(`cat.main.${main}`);
    if (plan.categoria) {
        const legacy = t(`cat.${plan.categoria}`);
        return legacy !== `cat.${plan.categoria}` ? legacy : plan.categoria;
    }
    return '';
}

/** Para iconos deportivos en DEPORTES. */
export function resolvePlanSport(plan: {
    categoria?: string | null;
    tipo_deporte?: string | null;
}): { tipo: DeporteTipo } | null {
    const { main, sub } = resolvePlanCategories(plan);
    if (main !== 'DEPORTES' || !sub) return null;
    const sportMap: Record<string, DeporteTipo> = {
        futbol: 'futbol',
        baloncesto: 'basket',
        padel: 'padel',
        running: 'running',
    };
    const tipo = sportMap[sub];
    return tipo ? { tipo } : null;
}

export function getCoverImages(main: MainCategoryId, sub: string): CoverSource[] {
    const custom = COVER_ASSETS[`${main}:${sub}`];
    if (custom && custom.length > 0) return custom;
    return Array.from({ length: COVERS_PER_SUB }, () => PLACEHOLDER_COVER_URI);
}

export function encodeCoverImageKey(main: MainCategoryId, sub: string, index: number): string {
    return `nexo_cover:${main}:${sub}:${index}`;
}

function buildCoverLookup(): Record<string, CoverSource> {
    const lookup: Record<string, CoverSource> = {};
    for (const main of MAIN_CATEGORY_IDS) {
        for (const sub of SUBCATEGORIES[main]) {
            const images = getCoverImages(main, sub);
            for (let i = 0; i < Math.max(images.length, COVERS_PER_SUB); i++) {
                lookup[encodeCoverImageKey(main, sub, i)] = images[i] ?? PLACEHOLDER_COVER_URI;
            }
        }
    }
    return lookup;
}

export const COVER_IMAGE_LOOKUP = buildCoverLookup();

export function resolvePlanImageSource(imagenUrl: string | null | undefined): string | number {
    if (!imagenUrl) return PLACEHOLDER_COVER_URI;
    const urlStr = String(imagenUrl);
    if (urlStr.startsWith('http')) return urlStr;
    if (COVER_IMAGE_LOOKUP[urlStr] != null) return COVER_IMAGE_LOOKUP[urlStr];
    if (urlStr.startsWith('nexo_cover:')) return PLACEHOLDER_COVER_URI;
    const parsedId = parseInt(urlStr, 10);
    if (!isNaN(parsedId)) return parsedId;
    if (urlStr.startsWith('file://') || urlStr.includes('/assets/')) return urlStr;
    return PLACEHOLDER_COVER_URI;
}

export const MAIN_CATEGORY_ICONS: Record<MainCategoryId, string> = {
    FOODIES: 'restaurant',
    DEPORTES: 'fitness',
    AIRE_LIBRE: 'sunny',
    SHOWTIME: 'film',
    DESCUBRIR: 'compass',
    VIBES: 'sparkles',
};

export const SUBCATEGORY_ICONS: Record<string, string> = {
    cafe: 'cafe',
    comer: 'restaurant',
    cenar: 'moon',
    tapas: 'wine',
    futbol: 'football',
    baloncesto: 'basketball',
    padel: 'tennisball',
    running: 'walk',
    senderismo: 'trail-sign',
    playa: 'umbrella',
    mirador: 'eye',
    picnic: 'basket',
    cine: 'videocam',
    teatro: 'mic',
    concierto: 'musical-notes',
    espectaculo: 'star',
    museo: 'business',
    estudio: 'book',
    idiomas: 'language',
    viajes: 'airplane',
    fiesta: 'sparkles',
    compras: 'bag',
    gaming: 'game-controller',
    juegos_mesa: 'grid',
    otro: 'ellipsis-horizontal',
};

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

export function getCoverImages(main: MainCategoryId, sub: string): string[] {
    return Array.from({ length: COVERS_PER_SUB }, () => PLACEHOLDER_COVER_URI);
}

export function encodeCoverImageKey(main: MainCategoryId, sub: string, index: number): string {
    return `nexo_cover:${main}:${sub}:${index}`;
}

function buildCoverLookup(): Record<string, string> {
    const lookup: Record<string, string> = {};
    for (const main of MAIN_CATEGORY_IDS) {
        for (const sub of SUBCATEGORIES[main]) {
            for (let i = 0; i < COVERS_PER_SUB; i++) {
                lookup[encodeCoverImageKey(main, sub, i)] = PLACEHOLDER_COVER_URI;
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
    if (COVER_IMAGE_LOOKUP[urlStr]) return COVER_IMAGE_LOOKUP[urlStr];
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

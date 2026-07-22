import { normalizeMainCategory, type MainCategoryId } from './categories';

/**
 * Pesos base (máximos) de cada señal.
 * El blend dinámico los escala: usuario nuevo → personalidad casi al 100%;
 * con historial/amigos → esas señales ganan peso y la personalidad baja.
 */
const BASE = {
    friendCreator: 50,
    friendJoined: 32,
    friendJoinedCap: 95,
    historyCategory: 40,
    historySubcategory: 16,
    personalityCategory: 58,
    personalityTime: 18,
    soon: 10,
} as const;

/** A partir de cuántos planes / amigos la señal se considera “madura”. */
const HISTORY_FULL_AT = 8;
const FRIENDS_FULL_AT = 5;

/** Personalidad (onboarding) → categorías afines. */
const PERSONALITY_CATEGORIES: Record<string, MainCategoryId[]> = {
    Deportista: ['DEPORTES', 'AIRE_LIBRE'],
    Viajero: ['DESCUBRIR', 'AIRE_LIBRE'],
    Aventurero: ['AIRE_LIBRE', 'DEPORTES'],
    Tranquilo: ['DESCUBRIR', 'FOODIES', 'AIRE_LIBRE'],
    Yoga: ['DEPORTES', 'AIRE_LIBRE'],
    Foodie: ['FOODIES'],
    Fiestero: ['VIBES'],
    Lectura: ['DESCUBRIR'],
    'De terraceo': ['FOODIES', 'VIBES'],
};

type TimePref = 'day' | 'night' | null;

export type FeedTaste = {
    personalityTags: string[];
    preferredCategories: Partial<Record<MainCategoryId, number>>;
    preferredSubcategories: Record<string, number>;
    timePref: TimePref;
    historyCount: number;
};

export type AffinityPlan = {
    id?: string;
    categoria?: string | null;
    tipo_deporte?: string | null;
    fecha_evento?: string | null;
    creador_id?: string | null;
    participantsList?: Array<{ id?: string; isCreator?: boolean }>;
};

/** Multiplicadores 0–1 según madurez del usuario. */
export type AffinityBlend = {
    personality: number;
    history: number;
    friends: number;
    soon: number;
};

export function emptyFeedTaste(): FeedTaste {
    return {
        personalityTags: [],
        preferredCategories: {},
        preferredSubcategories: {},
        timePref: null,
        historyCount: 0,
    };
}

function clamp01(n: number): number {
    return Math.max(0, Math.min(1, n));
}

/**
 * Cold start: personalidad ~1, historial/amigos ~0.
 * Con datos: historial y amigos suben; personalidad baja hasta ~0.25 (sigue como base).
 */
export function getAffinityBlend(taste: FeedTaste, friendCount: number): AffinityBlend {
    const hasPersonality = taste.personalityTags.length > 0;
    const historyMaturity = clamp01(taste.historyCount / HISTORY_FULL_AT);
    const friendsMaturity = clamp01(friendCount / FRIENDS_FULL_AT);

    // Cuánto “otras señales” hay disponibles para ir restando peso a personalidad.
    const otherSignals = clamp01(historyMaturity * 0.55 + friendsMaturity * 0.45);

    return {
        personality: hasPersonality ? 1 - otherSignals * 0.75 : 0, // 1.0 → 0.25
        history: historyMaturity, // 0 → 1
        // Con al menos 1 amigo ya puede pesar fuerte; crece hasta 1.
        friends: friendCount > 0 ? 0.45 + 0.55 * friendsMaturity : 0,
        // Un poco más de “pronto” al principio para no dejar el feed plano.
        soon: 0.55 + 0.45 * (1 - otherSignals),
    };
}

export function buildFeedTaste(
    tags: string[] | null | undefined,
    historyPlans: Array<{ categoria?: string | null; tipo_deporte?: string | null }>,
): FeedTaste {
    const personalityTags = (tags || []).map((t) => String(t).trim()).filter(Boolean);

    let timePref: TimePref = null;
    if (personalityTags.includes('Más de noche')) timePref = 'night';
    else if (personalityTags.includes('Más de día')) timePref = 'day';

    const preferredCategories: Partial<Record<MainCategoryId, number>> = {};
    const preferredSubcategories: Record<string, number> = {};

    for (const plan of historyPlans) {
        const cat = normalizeMainCategory(plan.categoria);
        if (cat) preferredCategories[cat] = (preferredCategories[cat] || 0) + 1;
        const sub = (plan.tipo_deporte || '').trim().toLowerCase();
        if (sub && sub !== 'otro') {
            preferredSubcategories[sub] = (preferredSubcategories[sub] || 0) + 1;
        }
    }

    const historyCount = Object.values(preferredCategories).reduce((a, b) => a + b, 0);

    return { personalityTags, preferredCategories, preferredSubcategories, timePref, historyCount };
}

function personalityCategoryBoost(
    tags: string[],
    category: MainCategoryId | null,
    mul: number,
): number {
    if (!category || tags.length === 0 || mul <= 0) return 0;
    let hits = 0;
    for (const tag of tags) {
        const cats = PERSONALITY_CATEGORIES[tag];
        if (cats?.includes(category)) hits += 1;
    }
    if (hits === 0) return 0;
    return BASE.personalityCategory * mul * Math.min(1, hits / Math.max(1, tags.length));
}

function historyCategoryBoost(
    taste: FeedTaste,
    category: MainCategoryId | null,
    sub: string,
    mul: number,
): number {
    if (!category || mul <= 0 || taste.historyCount === 0) return 0;

    const total = taste.historyCount;
    const catCount = taste.preferredCategories[category] || 0;
    let score = (catCount / total) * BASE.historyCategory * mul;

    const subCount = taste.preferredSubcategories[sub] || 0;
    if (subCount > 0) {
        const subTotal = Object.values(taste.preferredSubcategories).reduce((a, b) => a + b, 0) || 1;
        score += (subCount / subTotal) * BASE.historySubcategory * mul;
    }
    return score;
}

function timeOfDayBoost(taste: FeedTaste, fechaEvento: string | null | undefined, mul: number): number {
    if (!taste.timePref || !fechaEvento || mul <= 0) return 0;
    const hour = new Date(fechaEvento).getHours();
    const isNight = hour >= 18 || hour < 5;
    const isDay = hour >= 7 && hour < 18;
    if (taste.timePref === 'night' && isNight) return BASE.personalityTime * mul;
    if (taste.timePref === 'day' && isDay) return BASE.personalityTime * mul;
    return 0;
}

function soonBoost(fechaEvento: string | null | undefined, mul: number): number {
    if (!fechaEvento || mul <= 0) return 0;
    const ms = new Date(fechaEvento).getTime() - Date.now();
    if (ms < 0) return 0;
    const days = ms / (1000 * 60 * 60 * 24);
    let raw = 0;
    if (days <= 1) raw = BASE.soon;
    else if (days <= 3) raw = BASE.soon * 0.75;
    else if (days <= 7) raw = BASE.soon * 0.45;
    else if (days <= 14) raw = BASE.soon * 0.2;
    return raw * mul;
}

function friendBoost(plan: AffinityPlan, friendIds: Set<string>, mul: number): number {
    if (!friendIds.size || mul <= 0) return 0;

    let score = 0;
    if (plan.creador_id && friendIds.has(String(plan.creador_id))) {
        score += BASE.friendCreator;
    }

    const participants = plan.participantsList || [];
    let friendJoined = 0;
    for (const p of participants) {
        const id = p.id ? String(p.id) : '';
        if (!id || !friendIds.has(id)) continue;
        if (plan.creador_id && id === String(plan.creador_id)) continue;
        friendJoined += 1;
    }
    if (friendJoined > 0) {
        let joinedScore = 0;
        for (let i = 0; i < friendJoined; i++) {
            joinedScore += BASE.friendJoined * Math.pow(0.7, i);
        }
        score += Math.min(BASE.friendJoinedCap, joinedScore);
    }
    return score * mul;
}

/** Puntuación de afinidad (mayor = más arriba). No incluye “mis planes”. */
export function scoreFeedPlan(plan: AffinityPlan, taste: FeedTaste, friendIds: Set<string>): number {
    const blend = getAffinityBlend(taste, friendIds.size);
    const category = normalizeMainCategory(plan.categoria);
    const sub = (plan.tipo_deporte || '').trim().toLowerCase();

    return (
        friendBoost(plan, friendIds, blend.friends)
        + historyCategoryBoost(taste, category, sub, blend.history)
        + personalityCategoryBoost(taste.personalityTags, category, blend.personality)
        + timeOfDayBoost(taste, plan.fecha_evento, blend.personality)
        + soonBoost(plan.fecha_evento, blend.soon)
    );
}

export function compareFeedAffinity(
    a: AffinityPlan & { fecha_evento?: string | null },
    b: AffinityPlan & { fecha_evento?: string | null },
    taste: FeedTaste,
    friendIds: Set<string>,
): number {
    const sb = scoreFeedPlan(b, taste, friendIds);
    const sa = scoreFeedPlan(a, taste, friendIds);
    if (sb !== sa) return sb - sa;
    const ad = a.fecha_evento ? new Date(a.fecha_evento).getTime() : Infinity;
    const bd = b.fecha_evento ? new Date(b.fecha_evento).getTime() : Infinity;
    return ad - bd;
}

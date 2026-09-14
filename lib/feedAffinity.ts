import { normalizeMainCategory, type MainCategoryId } from './categories';
import { isSoloChicasPlan } from './soloChicas';

/**
 * Pesos base (máximos) de cada señal.
 * El blend dinámico los escala: usuario nuevo → personalidad casi al 100%;
 * con historial/amigos → esas señales ganan peso y la personalidad baja.
 */
const BASE = {
    friendCreator: 72,
    friendJoined: 42,
    friendJoinedCap: 120,
    coincidedCreator: 30,
    coincidedJoined: 24,
    coincidedJoinedCap: 55,
    historyCategory: 40,
    historySubcategory: 16,
    personalityCategory: 76,
    personalityTime: 18,
    soon: 10,
    /** Cuánta gente hay apuntada (no si el plan está lleno). */
    popularity: 58,
    popularityCap: 62,
    almostFull1: 14,
    almostFull2: 8,
    /** Media de cuánto se acerca la edad de la gente del plan a la tuya. */
    peerAge: 40,
    newness: 18,
    organizer: 8,
    nowSlot: 8,
    jitter: 3,
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
    viewerAge: number | null;
};

export type AffinityPlan = {
    id?: string;
    categoria?: string | null;
    tipo_deporte?: string | null;
    fecha_evento?: string | null;
    creado_en?: string | null;
    creador_id?: string | null;
    latitud?: number | null;
    longitud?: number | null;
    joinedCount?: number | null;
    maximo_participantes?: number | null;
    es_organizador?: boolean | null;
    participantsList?: Array<{ id?: string; isCreator?: boolean; edad?: number | null }>;
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
        viewerAge: null,
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
        // Sigue mandando lo que eligió la persona (1.0 → ~0.55).
        personality: hasPersonality ? 1 - otherSignals * 0.45 : 0,
        history: historyMaturity, // 0 → 1
        // Con al menos 1 amigo ya puede pesar fuerte; crece hasta 1.
        friends: friendCount > 0 ? 0.9 + 0.1 * friendsMaturity : 0,
        // Un poco más de “pronto” al principio para no dejar el feed plano.
        soon: 0.55 + 0.45 * (1 - otherSignals),
    };
}

export function buildFeedTaste(
    tags: string[] | null | undefined,
    historyPlans: Array<{ categoria?: string | null; tipo_deporte?: string | null }>,
    viewerAge?: number | null,
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

    return {
        personalityTags,
        preferredCategories,
        preferredSubcategories,
        timePref,
        historyCount,
        viewerAge: viewerAge ?? null,
    };
}

function personalityCategoryTags(tags: string[]): string[] {
    return tags
        .map((t) => String(t).trim())
        .filter((tag) => tag.length > 0 && PERSONALITY_CATEGORIES[tag] != null);
}

function personalityCategoryBoost(
    tags: string[],
    category: MainCategoryId | null,
    mul: number,
): number {
    const catTags = personalityCategoryTags(tags);
    if (!category || catTags.length === 0 || mul <= 0) return 0;
    let hits = 0;
    for (const tag of catTags) {
        const cats = PERSONALITY_CATEGORIES[tag];
        if (cats?.includes(category)) hits += 1;
    }
    if (hits === 0) return 0;
    return BASE.personalityCategory * mul * Math.min(1, hits / catTags.length);
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

function popularityBoost(plan: AffinityPlan): number {
    const joined = Math.max(0, Number(plan.joinedCount) || 0);
    if (joined <= 0) return 0;
    const curved = Math.log2(1 + joined) / Math.log2(1 + 16);
    return Math.min(BASE.popularityCap, BASE.popularity * curved);
}

/** ±2 años = 1; 14+ años = 0; lineal en medio. Igual que afinidad de perfil. */
function ageCloseness(a: number, b: number): number {
    const d = Math.abs(a - b);
    if (d <= 2) return 1;
    if (d >= 14) return 0;
    return 1 - (d - 2) / 12;
}

/**
 * Media de cercanía de edad de la gente del plan (sin contarte a ti).
 * Si no hay edades conocidas, 0: no penaliza.
 */
function peerAgeBoost(plan: AffinityPlan, viewerAge: number | null, currentUserId?: string | null): number {
    if (viewerAge == null || !Number.isFinite(viewerAge)) return 0;
    const people = plan.participantsList || [];
    let sum = 0;
    let n = 0;
    for (const p of people) {
        const id = p.id ? String(p.id) : '';
        if (currentUserId && id && id === currentUserId) continue;
        const age = p.edad;
        if (age == null || !Number.isFinite(age)) continue;
        sum += ageCloseness(viewerAge, age);
        n += 1;
    }
    if (n <= 0) return 0;
    return BASE.peerAge * (sum / n);
}

function almostFullBoost(plan: AffinityPlan): number {
    const joined = Math.max(0, Number(plan.joinedCount) || 0);
    const max = Number(plan.maximo_participantes);
    if (joined <= 0 || !Number.isFinite(max) || max < 2) return 0;
    const left = max - joined;
    if (left === 1) return BASE.almostFull1;
    if (left === 2) return BASE.almostFull2;
    return 0;
}

function coincidedBoost(plan: AffinityPlan, friendIds: Set<string>, coincidedIds: Set<string>): number {
    if (!coincidedIds.size) return 0;

    let score = 0;
    const creatorId = plan.creador_id ? String(plan.creador_id) : '';
    if (creatorId && coincidedIds.has(creatorId) && !friendIds.has(creatorId)) {
        score += BASE.coincidedCreator;
    }

    let coincidedJoined = 0;
    for (const p of plan.participantsList || []) {
        const id = p.id ? String(p.id) : '';
        if (!id || !coincidedIds.has(id) || friendIds.has(id)) continue;
        if (creatorId && id === creatorId) continue;
        coincidedJoined += 1;
    }
    if (coincidedJoined > 0) {
        let joinedScore = 0;
        for (let i = 0; i < coincidedJoined; i++) {
            joinedScore += BASE.coincidedJoined * Math.pow(0.7, i);
        }
        score += Math.min(BASE.coincidedJoinedCap, joinedScore);
    }
    return score;
}

/** Puntuación de afinidad (mayor = más arriba). No incluye “mis planes”. */
export function scoreFeedPlan(
    plan: AffinityPlan,
    taste: FeedTaste,
    friendIds: Set<string>,
    coincidedIds: Set<string> = new Set(),
    currentUserId?: string | null,
): number {
    const blend = getAffinityBlend(taste, friendIds.size);
    const category = normalizeMainCategory(plan.categoria);
    const sub = (plan.tipo_deporte || '').trim().toLowerCase();

    return (
        friendBoost(plan, friendIds, blend.friends)
        + coincidedBoost(plan, friendIds, coincidedIds)
        + historyCategoryBoost(taste, category, sub, blend.history)
        + personalityCategoryBoost(taste.personalityTags, category, blend.personality)
        + timeOfDayBoost(taste, plan.fecha_evento, blend.personality)
        + soonBoost(plan.fecha_evento, blend.soon)
        + popularityBoost(plan)
        + almostFullBoost(plan)
        + peerAgeBoost(plan, taste.viewerAge, currentUserId)
    );
}

/** Señales estables del viewer para el badge de encaje (no historial ni membresía). */
export type FitViewerContext = {
    personalityTags: string[];
    viewerAge: number | null;
    viewerGenero?: string | null;
};

export type FitPlan = Pick<
    AffinityPlan,
    'categoria' | 'tipo_deporte' | 'fecha_evento' | 'solo_chicas'
>;

const FIT_SHOW_MIN = 63;
const FIT_PCT_MIN = 62;
const FIT_PCT_MAX = 97;

const SPORTY_TAGS = new Set(['Deportista', 'Aventurero', 'Yoga']);

function fitCategoryRatio(tags: string[], category: MainCategoryId | null): number {
    const catTags = personalityCategoryTags(tags);
    if (!category) return 0.42;
    if (catTags.length === 0) return 0.38;
    let best = 0;
    for (const tag of catTags) {
        const cats = PERSONALITY_CATEGORIES[tag];
        if (!cats) continue;
        const idx = cats.indexOf(category);
        if (idx === 0) best = Math.max(best, 1);
        else if (idx > 0) best = Math.max(best, 0.7);
    }
    return best > 0 ? best : 0.18;
}

function fitTimePrefRatio(tags: string[], fechaEvento: string | null | undefined): number {
    if (!fechaEvento) return 0.5;
    const hour = new Date(fechaEvento).getHours();
    const isNight = hour >= 18 || hour < 5;
    const isDay = hour >= 7 && hour < 18;
    const wantsNight = tags.includes('Más de noche');
    const wantsDay = tags.includes('Más de día');
    if (!wantsNight && !wantsDay) return 0.52;
    if (wantsNight && isNight) return 0.94;
    if (wantsDay && isDay) return 0.94;
    if (wantsNight && isDay) return 0.26;
    if (wantsDay && isNight) return 0.3;
    return 0.48;
}

function fitVibeRatio(tags: string[], fechaEvento: string | null | undefined): number {
    if (!fechaEvento) return 0.5;
    const event = new Date(fechaEvento);
    if (!Number.isFinite(event.getTime())) return 0.5;
    const dow = event.getDay();
    const isWeekend = dow === 0 || dow === 5 || dow === 6;
    const hour = event.getHours();
    const evening = hour >= 18 || hour < 3;

    const fiestero = tags.includes('Fiestero');
    const tranquilo = tags.includes('Tranquilo');
    const foodie = tags.includes('Foodie');
    const terraceo = tags.includes('De terraceo');

    if (fiestero && isWeekend && evening) return 0.92;
    if (fiestero && !evening) return 0.38;
    if (tranquilo && !evening && !isWeekend) return 0.86;
    if (foodie && hour >= 12 && hour < 16) return 0.84;
    if (foodie && evening) return 0.78;
    if (terraceo && (hour >= 17 || hour < 2)) return 0.82;
    if (tranquilo && fiestero) return 0.52;
    return 0.5;
}

function fitSubcategoryRatio(
    tags: string[],
    category: MainCategoryId | null,
    tipoDeporte: string | null | undefined,
): number {
    const sub = (tipoDeporte || '').trim().toLowerCase();
    if (!sub || sub === 'otro') return 0.5;
    const sporty = tags.some((t) => SPORTY_TAGS.has(t));
    if (category === 'DEPORTES' || category === 'AIRE_LIBRE') {
        if (sporty) return 0.88;
        return 0.35;
    }
    if (category === 'FOODIES' && (tags.includes('Foodie') || tags.includes('De terraceo'))) return 0.86;
    if (category === 'VIBES' && tags.includes('Fiestero')) return 0.84;
    if (category === 'DESCUBRIR' && (tags.includes('Viajero') || tags.includes('Lectura'))) return 0.8;
    return 0.48;
}

function fitInterestBreadth(tags: string[], category: MainCategoryId | null): number {
    const interestTags = tags.filter((t) => t !== 'Más de día' && t !== 'Más de noche');
    if (interestTags.length === 0) return 0.45;
    if (!category) return 0.5;
    let aligned = 0;
    for (const tag of interestTags) {
        const cats = PERSONALITY_CATEGORIES[tag];
        if (cats?.includes(category)) aligned += 1;
    }
    return clamp01(0.35 + (aligned / interestTags.length) * 0.6);
}

function fitAgeCategoryHint(viewerAge: number | null, category: MainCategoryId | null): number {
    if (viewerAge == null || !Number.isFinite(viewerAge) || !category) return 0.5;
    if (category === 'VIBES' && viewerAge <= 34) return 0.62;
    if (category === 'DEPORTES' && viewerAge <= 40) return 0.58;
    if (category === 'DESCUBRIR' && viewerAge >= 22) return 0.57;
    if (category === 'FOODIES') return 0.55;
    return 0.5;
}

function fitPlanSpread(
    planId: string | number | null | undefined,
    plan: FitPlan,
): number {
    if (planId == null || planId === '') return 0;
    const stamp = plan.fecha_evento ? plan.fecha_evento.slice(0, 16) : '';
    const blob = `${planId}|${plan.categoria ?? ''}|${plan.tipo_deporte ?? ''}|${stamp}`;
    let h = 2166136261;
    for (let i = 0; i < blob.length; i++) {
        h ^= blob.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    const spreads = [-11, -9, -8, -7, -6, -4, -3, -2, 2, 3, 4, 6, 7, 8, 9, 11];
    return spreads[Math.abs(h) % spreads.length];
}

/**
 * Encaje personal mostrado (62–97). Solo señales estables del perfil y del plan:
 * categoría, subcategoría, preferencia día/noche, «vibra» del horario y dispersión por plan.
 * No usa historial, amigos, participantes ni si ya estás unida.
 */
export function feedFitPercent(
    plan: FitPlan,
    viewer: FitViewerContext,
    planId?: string | number | null,
): number | null {
    if (isSoloChicasPlan(plan) && viewer.viewerGenero !== 'femenino') return null;

    const tags = (viewer.personalityTags || []).map((t) => String(t).trim()).filter(Boolean);
    if (tags.length === 0) return null;

    const category = normalizeMainCategory(plan.categoria);
    const categoryScore = fitCategoryRatio(tags, category);
    const timeScore = fitTimePrefRatio(tags, plan.fecha_evento);
    const vibeScore = fitVibeRatio(tags, plan.fecha_evento);
    const subScore = fitSubcategoryRatio(tags, category, plan.tipo_deporte);
    const breadthScore = fitInterestBreadth(tags, category);
    const ageHint = fitAgeCategoryHint(viewer.viewerAge, category);

    const raw01 =
        categoryScore * 0.31
        + timeScore * 0.2
        + vibeScore * 0.15
        + subScore * 0.13
        + breadthScore * 0.13
        + ageHint * 0.08;

    const basePct = 58 + raw01 * 30;
    const spread = fitPlanSpread(planId, plan);
    let pct = Math.round(basePct + spread);
    pct = Math.max(FIT_PCT_MIN, Math.min(FIT_PCT_MAX, pct));
    if (pct < FIT_SHOW_MIN) return null;
    return pct;
}

/** @deprecated El encaje final ya viene de feedFitPercent; se mantiene por compatibilidad. */
export function displayFitPercent(rawPct: number, _planId?: string | number | null): number {
    if (!Number.isFinite(rawPct)) return rawPct;
    return Math.max(FIT_PCT_MIN, Math.min(FIT_PCT_MAX, Math.round(rawPct)));
}

export function feedFitTone(pct: number): 'soft' | 'mid' | 'high' | 'elite' {
    if (pct >= 90) return 'elite';
    if (pct >= 80) return 'high';
    if (pct >= 70) return 'mid';
    return 'soft';
}

export function compareFeedAffinity(
    a: AffinityPlan & { fecha_evento?: string | null },
    b: AffinityPlan & { fecha_evento?: string | null },
    taste: FeedTaste,
    friendIds: Set<string>,
    coincidedIds: Set<string> = new Set(),
): number {
    const sb = scoreFeedPlan(b, taste, friendIds, coincidedIds);
    const sa = scoreFeedPlan(a, taste, friendIds, coincidedIds);
    if (sb !== sa) return sb - sa;
    const jb = Number(b.joinedCount) || 0;
    const ja = Number(a.joinedCount) || 0;
    if (jb !== ja) return jb - ja;
    const ad = a.fecha_evento ? new Date(a.fecha_evento).getTime() : Infinity;
    const bd = b.fecha_evento ? new Date(b.fecha_evento).getTime() : Infinity;
    return ad - bd;
}

/** Categorías que piden de verdad los tags de onboarding (para fetch + ranking). */
export function personalityPreferredCategories(tags: string[] | null | undefined): MainCategoryId[] {
    const set = new Set<MainCategoryId>();
    for (const tag of tags || []) {
        const cats = PERSONALITY_CATEGORIES[String(tag).trim()];
        if (!cats) continue;
        for (const cat of cats) set.add(cat);
    }
    return [...set];
}

/** Categorías a pedir al servidor: personalidad + historial más fuerte. */
export function preferredFetchCategories(taste: FeedTaste): MainCategoryId[] {
    const set = new Set<MainCategoryId>(personalityPreferredCategories(taste.personalityTags));
    const ranked = Object.entries(taste.preferredCategories)
        .filter((entry): entry is [MainCategoryId, number] => !!entry[0] && (entry[1] || 0) > 0)
        .sort((a, b) => b[1] - a[1]);
    for (const [cat] of ranked.slice(0, 3)) set.add(cat);
    return [...set];
}

export type RankContext = {
    taste: FeedTaste;
    friendIds: Set<string>;
    coincidedIds?: Set<string>;
    coords?: { latitude: number; longitude: number } | null;
    now?: number;
    currentUserId?: string | null;
};

function planDistanceKm(
    plan: AffinityPlan,
    coords?: { latitude: number; longitude: number } | null,
): number | null {
    if (!coords) return null;
    const lat = Number(plan.latitud);
    const lng = Number(plan.longitud);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const dLat = lat - coords.latitude;
    const dLng = lng - coords.longitude;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const a =
        Math.sin(toRad(dLat) / 2) ** 2
        + Math.cos(toRad(coords.latitude)) * Math.cos(toRad(lat)) * Math.sin(toRad(dLng) / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const FAR_KM = 20;

function distanceBoost(km: number | null): number {
    if (km == null || !Number.isFinite(km)) return -30;
    const walk = 95 * Math.exp(-km / 0.85);
    const area = 55 * Math.exp(-km / 7.5);
    const near = walk + area;
    if (km <= FAR_KM) return near;
    return Math.max(-180, near - (km - FAR_KM) * 4);
}

export function isFarFeedPlan(
    plan: AffinityPlan,
    coords?: { latitude: number; longitude: number } | null,
): boolean {
    if (!coords) return false;
    const km = planDistanceKm(plan, coords);
    if (km == null) return true;
    return km > FAR_KM;
}

function newnessBoost(creadoEn: string | null | undefined, now: number): number {
    if (!creadoEn) return 0;
    const ageMs = now - new Date(creadoEn).getTime();
    if (!Number.isFinite(ageMs) || ageMs < 0) return 0;
    const hours = ageMs / (1000 * 60 * 60);
    if (hours <= 6) return BASE.newness;
    if (hours <= 24) return BASE.newness * 0.7;
    if (hours <= 48) return BASE.newness * 0.35;
    return 0;
}

function nowSlotBoost(fechaEvento: string | null | undefined, now: number): number {
    if (!fechaEvento) return 0;
    const event = new Date(fechaEvento);
    if (!Number.isFinite(event.getTime())) return 0;
    const hourNow = new Date(now).getHours();
    const eventHour = event.getHours();
    const startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);
    const dayDiff = Math.floor((event.getTime() - startToday.getTime()) / (1000 * 60 * 60 * 24));
    if (dayDiff < 0 || dayDiff > 1) return 0;
    const eveningNow = hourNow >= 17;
    const morningNow = hourNow < 12;
    const eveningEvent = eventHour >= 18 || eventHour < 5;
    const dayEvent = eventHour >= 7 && eventHour < 18;
    if (eveningNow && eveningEvent) return BASE.nowSlot;
    if (morningNow && dayEvent && dayDiff === 0) return BASE.nowSlot * 0.7;
    return 0;
}

function dayJitter(planId: string | undefined, now: number): number {
    if (!planId) return 0;
    const day = new Date(now).toISOString().slice(0, 10);
    const s = `${planId}|${day}`;
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 1000) / 1000 * BASE.jitter;
}

/**
 * Ranking del feed: cuanto más cerca, mejor; los muy lejanos van al final.
 * Luego gente apuntada, afinidad y coincidencias.
 */
export function scoreFeedPlanRanked(plan: AffinityPlan, ctx: RankContext): number {
    const now = ctx.now ?? Date.now();
    const coincidedIds = ctx.coincidedIds ?? new Set<string>();
    return (
        scoreFeedPlan(plan, ctx.taste, ctx.friendIds, coincidedIds, ctx.currentUserId)
        + distanceBoost(planDistanceKm(plan, ctx.coords))
        + newnessBoost(plan.creado_en, now)
        + (plan.es_organizador ? BASE.organizer : 0)
        + nowSlotBoost(plan.fecha_evento, now)
        + dayJitter(plan.id ? String(plan.id) : undefined, now)
    );
}

export function compareFeedRanked(a: AffinityPlan, b: AffinityPlan, ctx: RankContext): number {
    const aFar = isFarFeedPlan(a, ctx.coords);
    const bFar = isFarFeedPlan(b, ctx.coords);
    if (aFar !== bFar) return aFar ? 1 : -1;
    const sb = scoreFeedPlanRanked(b, ctx);
    const sa = scoreFeedPlanRanked(a, ctx);
    if (sb !== sa) return sb - sa;
    return compareFeedAffinity(a, b, ctx.taste, ctx.friendIds, ctx.coincidedIds);
}

import type { MainCategoryId } from './categories';
import { categoryCounts, topAttendedCategory, EMPTY_BADGE_STATS, type BadgeStats } from './badgeStats';
import type { HabitosConsumo } from './profileFields';
import { hasPublicRepeatStats, type UserStats } from './stats';
import { supabase } from './supabase';

export type AffinityLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type FirstRepeatVote = 'si' | 'no' | null;

export type AffinityPerson = {
    age?: number | null;
    tags?: string[] | null;
    habitos?: HabitosConsumo | null;
    categoryCounts?: Partial<Record<MainCategoryId, number>>;
    topCategory?: MainCategoryId | null;
    repeatPct?: number | null;
    plansDone?: number;
    friendsCount?: number;
    peopleMet?: number;
    accountDays?: number;
};

const SCALE = 86;

const W = {
    age: 14,
    friends: 16,
    fof: 10,
    category: 12,
    communities: 12,
    interests: 22,
    repeat: 10,
} as const;

const INTEREST_TAGS = [
    'Deportista',
    'Viajero',
    'Aventurero',
    'Tranquilo',
    'Yoga',
    'Foodie',
    'Fiestero',
    'Lectura',
    'De terraceo',
] as const;

function clamp(n: number, min: number, max: number) {
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
}

function uniqTags(tags?: string[] | null): string[] {
    return [...new Set((tags ?? []).map((t) => t.trim()).filter(Boolean))];
}

function agePoints(a?: number | null, b?: number | null): number | null {
    if (a == null || b == null) return null;
    const d = Math.abs(a - b);
    if (d <= 2) return W.age;
    if (d >= 14) return 0;
    return W.age * (1 - (d - 2) / 12);
}

function interestPoints(tagsA: string[], tagsB: string[]): number {
    const setA = new Set(tagsA);
    const setB = new Set(tagsB);
    let shared = 0;
    for (const tag of INTEREST_TAGS) {
        if (setA.has(tag) && setB.has(tag)) shared += 1;
    }
    const dayA = setA.has('Más de día');
    const nightA = setA.has('Más de noche');
    const dayB = setB.has('Más de día');
    const nightB = setB.has('Más de noche');
    if ((dayA && dayB) || (nightA && nightB)) shared += 1;
    if (shared >= 3) return 22;
    if (shared === 2) return 15;
    if (shared === 1) return 8;
    return 0;
}

function communityPoints(n: number): number {
    if (n >= 3) return 12;
    if (n === 2) return 9;
    if (n === 1) return 6;
    return 0;
}

function repeatPoints(pct: number): number {
    if (pct >= 80) return 10;
    if (pct >= 60) return 8;
    if (pct >= 40) return 5;
    return 2;
}

const YOUNG_ACCOUNT_DAYS = 45;

/** Cuenta con menos de 45 días: el nivel nunca baja de «Algo de feeling». */
function isYoungAccount(p: AffinityPerson): boolean {
    const days = p.accountDays;
    if (days == null || !Number.isFinite(days)) return false;
    return days < YOUNG_ACCOUNT_DAYS;
}

function resolveAccountDays(badge: BadgeStats | null | undefined): number | undefined {
    if (!badge || badge === EMPTY_BADGE_STATS) return undefined;
    return badge.cuentaAntiguedadDias;
}

/** Perfil con poca historia para comparar: cualquier señal de cuenta joven basta. */
function isLowDataAffinityProfile(p: AffinityPerson): boolean {
    const plans = p.plansDone ?? 0;
    const days = p.accountDays ?? 0;
    const met = p.peopleMet ?? 0;
    const friends = p.friendsCount ?? 0;
    const hasTopCategory = !!p.topCategory;
    return (
        plans < 4
        || met < 8
        || days < 120
        || friends < 3
        || (!hasTopCategory && plans < 6)
    );
}

export function levelFromScore(score: number): AffinityLevel {
    if (score >= 92) return 9;
    if (score >= 85) return 8;
    if (score >= 78) return 7;
    if (score >= 71) return 6;
    if (score >= 64) return 5;
    if (score >= 57) return 4;
    if (score >= 50) return 3;
    if (score >= 33) return 2;
    if (score >= 17) return 1;
    return 0;
}

export function affinityPersonFromProfile(input: {
    age?: number | null;
    tags?: string[] | null;
    habitos?: HabitosConsumo | null;
    stats?: UserStats | BadgeStats | null;
    badgeStats?: BadgeStats | null;
    friendsCount?: number;
}): AffinityPerson {
    const badge = input.badgeStats ?? (input.stats as BadgeStats | null | undefined);
    const stats = input.stats;
    const counts = badge && 'planesTapas' in badge ? categoryCounts(badge) : undefined;
    return {
        age: input.age ?? null,
        tags: uniqTags(input.tags),
        habitos: input.habitos ?? null,
        categoryCounts: counts,
        topCategory: badge && 'planesTapas' in badge ? topAttendedCategory(badge) : null,
        repeatPct: stats && hasPublicRepeatStats(stats)
            ? Math.round(stats.porcentajeRepetiria)
            : null,
        plansDone: stats?.numeroPlanesRealizados ?? 0,
        friendsCount: input.friendsCount ?? stats?.numeroAmistades ?? 0,
        peopleMet: badge && 'personasDistintas' in badge ? badge.personasDistintas : 0,
        accountDays: resolveAccountDays(badge),
    };
}

export async function countSharedOrganizerFollows(userA: string, userB: string): Promise<number> {
    if (!userA || !userB || userA === userB) return 0;
    const map = await countSharedOrganizerFollowsMany(userA, [userB]);
    return map.get(userB) ?? 0;
}

/** Cuántos organizadores en común tiene el viewer con cada persona. */
export async function countSharedOrganizerFollowsMany(
    viewerId: string,
    otherIds: string[],
): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const ids = [...new Set(otherIds.filter((id) => id && id !== viewerId))];
    if (!viewerId || ids.length === 0) return out;

    const { data: mine } = await supabase
        .from('seguidores')
        .select('organizador_id')
        .eq('seguidor_id', viewerId);
    const myOrgs = [...new Set((mine ?? []).map((row) => String(row.organizador_id || '')).filter(Boolean))];
    if (myOrgs.length === 0) {
        for (const id of ids) out.set(id, 0);
        return out;
    }

    for (let i = 0; i < ids.length; i += 80) {
        const chunk = ids.slice(i, i + 80);
        const { data } = await supabase
            .from('seguidores')
            .select('seguidor_id, organizador_id')
            .in('seguidor_id', chunk)
            .in('organizador_id', myOrgs);
        const counts = new Map<string, number>();
        for (const row of data ?? []) {
            const sid = String(row.seguidor_id || '');
            if (!sid) continue;
            counts.set(sid, (counts.get(sid) || 0) + 1);
        }
        for (const id of chunk) out.set(id, counts.get(id) ?? 0);
    }
    return out;
}

export async function fetchFirstPersonRepeat(viewerId: string, targetId: string): Promise<FirstRepeatVote> {
    if (!viewerId || !targetId || viewerId === targetId) return null;
    const { data, error } = await supabase
        .from('valoraciones')
        .select('repetiria_experiencia')
        .eq('evaluador_id', viewerId)
        .eq('evaluado_id', targetId)
        .eq('tipo', 'persona')
        .order('creado_en', { ascending: true })
        .limit(1)
        .maybeSingle();
    if (error || !data) return null;
    const vote = data.repetiria_experiencia;
    if (vote === 'si' || vote === 'no') return vote;
    return null;
}

/** Offset estable por pareja (±2…±8) para que no salgan tantos % iguales. */
function affinityPairSpread(viewerId?: string | null, targetId?: string | null): number {
    const a = (viewerId ?? '').trim();
    const b = (targetId ?? '').trim();
    if (!a || !b || a === b) return 0;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const blob = `${lo}|${hi}`;
    let h = 2166136261;
    for (let i = 0; i < blob.length; i++) {
        h ^= blob.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    const spreads = [-8, -7, -6, -5, -4, -3, -2, 2, 3, 4, 5, 6, 7, 8];
    return spreads[Math.abs(h) % spreads.length];
}

export function resolveProfileAffinity(input: {
    isSelf?: boolean;
    viewer?: AffinityPerson | null;
    target: AffinityPerson;
    viewerId?: string | null;
    targetId?: string | null;
    isFriends?: boolean;
    mutualFriends?: number;
    sharedCommunities?: number;
    firstRepeat?: FirstRepeatVote;
}): { score: number; level: AffinityLevel } {
    if (input.isSelf || !input.viewer) {
        return { score: 0, level: 0 };
    }

    const a = input.viewer;
    const b = input.target;
    let earned = 0;
    let available = 0;

    const age = agePoints(a.age, b.age);
    if (age != null) {
        available += W.age;
        earned += age;
    }

    if (input.isFriends) {
        available += W.friends;
        earned += W.friends;
    } else {
        available += W.fof;
        if ((input.mutualFriends ?? 0) > 0) earned += W.fof;
    }

    if (a.topCategory && b.topCategory) {
        available += W.category;
        if (a.topCategory === b.topCategory) earned += W.category;
    }

    available += W.communities;
    earned += communityPoints(input.sharedCommunities ?? 0);

    available += W.interests;
    earned += interestPoints(uniqTags(a.tags), uniqTags(b.tags));

    if (b.repeatPct != null) {
        available += W.repeat;
        earned += repeatPoints(b.repeatPct);
    }

    const maxAvailable =
        W.age + W.friends + W.fof + W.category + W.communities + W.interests + W.repeat;
    const coverage = maxAvailable > 0 ? available / maxAvailable : 0;

    let score = available > 0 ? Math.round((earned / available) * SCALE) : 0;
    if (input.firstRepeat === 'si') score += 6;
    if (input.firstRepeat === 'no') score -= 6;

    // Pocas señales: tirar hacia un neutro en lugar de castigar por datos que aún no existen.
    if (coverage < 0.55) {
        const neutral = 50;
        const blend = clamp(coverage / 0.55, 0.2, 1);
        score = Math.round(score * blend + neutral * (1 - blend));
    }

    const viewerLow = isLowDataAffinityProfile(a);
    const targetLow = isLowDataAffinityProfile(b);
    if (viewerLow && targetLow) {
        score = Math.max(score, 52);
    } else if (viewerLow || targetLow) {
        score = Math.max(score, 48);
    } else if (available >= 48) {
        score = Math.max(score, 32);
    } else if (available >= 32) {
        score = Math.max(score, 26);
    }

    score = Math.round(clamp(score + affinityPairSpread(input.viewerId, input.targetId), 0, 100));
    let level = levelFromScore(score);

    const viewerYoung = isYoungAccount(a);
    const targetYoung = isYoungAccount(b);
    if (viewerYoung || targetYoung) {
        score = Math.max(score, 42);
        level = Math.max(level, 2) as AffinityLevel;
    } else if (viewerLow || targetLow) {
        level = Math.max(level, 2) as AffinityLevel;
    }
    return { score, level };
}

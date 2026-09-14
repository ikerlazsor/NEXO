import { supabase } from './supabase';
import { cacheGetOrFetch, cacheGetStale, cacheSet } from './ttlCache';

export const ORGANIZER_INSIGHTS_TTL_MS = 90_000;

export function organizerInsightsCacheKey(userId: string) {
    return `organizerInsights:${userId}`;
}

export type InsightAspect = { key: string; n: number };

export type InsightAudience = {
    total: number;
    ageAvg: number | null;
    ageN: number;
    gender: {
        masculino: number;
        femenino: number;
        no_binario: number;
        otro: number;
        unknown: number;
    };
};

export type InsightTopPlan = {
    id: string;
    title: string;
    n: number;
};

export type PeriodCount = {
    week: number;
    month: number;
};

export type OrganizerInsights = {
    generatedAt: string;
    activity: {
        joins: PeriodCount;
        profileViews: PeriodCount;
        saves: PeriodCount;
        follows: PeriodCount;
        unfollows: PeriodCount;
    };
    followersTotal: number;
    rating: {
        score: number;
        reviews: number;
        positives: InsightAspect[];
        negatives: InsightAspect[];
    };
    members: InsightAudience;
    joiners: InsightAudience;
    topSaved: InsightTopPlan | null;
    topJoined: InsightTopPlan | null;
};

type GenderRaw = {
    masculino?: number;
    femenino?: number;
    no_binario?: number;
    otro?: number;
    unknown?: number;
};

type AudienceRaw = {
    total?: number;
    age_avg?: number | string | null;
    age_n?: number;
    gender?: GenderRaw;
};

type TopRaw = { id?: string; title?: string; n?: number } | null;

function asInt(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function asScore(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(5, n)) : 0;
}

function asAge(value: unknown): number | null {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : null;
}

function parseAspects(raw: unknown): InsightAspect[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((row) => {
            if (!row || typeof row !== 'object') return null;
            const o = row as { key?: unknown; n?: unknown };
            const key = typeof o.key === 'string' ? o.key : '';
            if (!key) return null;
            return { key, n: asInt(o.n) };
        })
        .filter((row): row is InsightAspect => row != null);
}

function parseAudience(raw: AudienceRaw | null | undefined): InsightAudience {
    const g = raw?.gender ?? {};
    return {
        total: asInt(raw?.total),
        ageAvg: asAge(raw?.age_avg),
        ageN: asInt(raw?.age_n),
        gender: {
            masculino: asInt(g.masculino),
            femenino: asInt(g.femenino),
            no_binario: asInt(g.no_binario),
            otro: asInt(g.otro),
            unknown: asInt(g.unknown),
        },
    };
}

function parseTop(raw: TopRaw): InsightTopPlan | null {
    if (!raw || typeof raw !== 'object') return null;
    const id = typeof raw.id === 'string' ? raw.id : '';
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    const n = asInt(raw.n);
    if (!id || n <= 0) return null;
    return { id, title: title || 'Plan', n };
}

export function genderKnownTotal(g: InsightAudience['gender']): number {
    return g.masculino + g.femenino + g.no_binario + g.otro;
}

export function genderPct(n: number, known: number): number {
    if (known <= 0 || n <= 0) return 0;
    return Math.round((n / known) * 100);
}

export function emptyOrganizerInsights(): OrganizerInsights {
    const zero: PeriodCount = { week: 0, month: 0 };
    const emptyGender: InsightAudience['gender'] = {
        masculino: 0,
        femenino: 0,
        no_binario: 0,
        otro: 0,
        unknown: 0,
    };
    const emptyAudience: InsightAudience = {
        total: 0,
        ageAvg: null,
        ageN: 0,
        gender: emptyGender,
    };
    return {
        generatedAt: new Date().toISOString(),
        activity: {
            joins: { ...zero },
            profileViews: { ...zero },
            saves: { ...zero },
            follows: { ...zero },
            unfollows: { ...zero },
        },
        followersTotal: 0,
        rating: {
            score: 0,
            reviews: 0,
            positives: [],
            negatives: [],
        },
        members: { ...emptyAudience, gender: { ...emptyGender } },
        joiners: { ...emptyAudience, gender: { ...emptyGender } },
        topSaved: null,
        topJoined: null,
    };
}

async function fetchOrganizerInsightsUncached(): Promise<OrganizerInsights> {
    const { data, error } = await supabase.rpc('get_organizer_insights');
    if (error || data == null || typeof data !== 'object') {
        return emptyOrganizerInsights();
    }
    const row = data as Record<string, unknown>;
    const activity = (row.activity ?? {}) as Record<string, unknown>;
    const rating = (row.rating ?? {}) as Record<string, unknown>;
    return {
        generatedAt: typeof row.generated_at === 'string' ? row.generated_at : new Date().toISOString(),
        activity: {
            joins: {
                week: asInt(activity.joins_week),
                month: asInt(activity.joins_month),
            },
            profileViews: {
                week: asInt(activity.profile_views_week),
                month: asInt(activity.profile_views_month),
            },
            saves: {
                week: asInt(activity.saves_week),
                month: asInt(activity.saves_month),
            },
            follows: {
                week: asInt(activity.follows_week),
                month: asInt(activity.follows_month),
            },
            unfollows: {
                week: asInt(activity.unfollows_week),
                month: asInt(activity.unfollows_month),
            },
        },
        followersTotal: asInt(row.followers_total),
        rating: {
            score: asScore(rating.score),
            reviews: asInt(rating.reviews),
            positives: parseAspects(rating.positives),
            negatives: parseAspects(rating.negatives),
        },
        members: parseAudience(row.members as AudienceRaw),
        joiners: parseAudience(row.joiners as AudienceRaw),
        topSaved: parseTop(row.top_saved as TopRaw),
        topJoined: parseTop(row.top_joined as TopRaw),
    };
}

export async function fetchOrganizerInsights(opts?: {
    userId?: string;
    force?: boolean;
}): Promise<OrganizerInsights> {
    const uid = opts?.userId;
    if (!uid) return fetchOrganizerInsightsUncached();
    return cacheGetOrFetch(
        organizerInsightsCacheKey(uid),
        ORGANIZER_INSIGHTS_TTL_MS,
        () => fetchOrganizerInsightsUncached(),
        { force: !!opts?.force },
    );
}

export function peekOrganizerInsights(userId: string): OrganizerInsights | null {
    return cacheGetStale<OrganizerInsights>(organizerInsightsCacheKey(userId));
}

/** Best-effort: una visita distinta por persona y día (lo deduplica la base). */
export function recordOrganizerProfileView(organizerId: string): void {
    if (!organizerId) return;
    void supabase.rpc('record_organizer_profile_view', { p_organizador_id: organizerId }).then(
        () => undefined,
        () => undefined,
    );
}

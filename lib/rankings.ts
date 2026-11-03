import { getFriends } from './friends';
import { getAuthUser } from './auth';
import { getPublicProfiles } from './profileData';
import { RANKINGS_PUBLIC_USER, screenCacheKey, ScreenCacheTTL } from './screenCaches';
import { supabase } from './supabase';
import { cacheGetStale, cacheIsFresh, cacheSet } from './ttlCache';

export type RankKey = 'plans' | 'rating' | 'members';
export type RankScope = 'global' | 'communities' | 'friends';

export type RankedProfile = {
    id: string;
    nombre: string;
    avatar_url: string | null;
    nombre_usuario: string | null;
    score: number;
    rating?: number;
    reviews?: number;
    es_organizador?: boolean;
    previews?: Array<{ id: string; nombre: string; avatar_url: string | null }>;
};

type StatsRow = {
    usuario_id: string;
    numero_planes_realizados?: number | null;
    planes_creados?: number | null;
    valoracion_media?: number | null;
    numero_valoraciones?: number | null;
    numero_evaluadores_distintos?: number | null;
    porcentaje_repetiria?: number | null;
    perfiles?: {
        id?: string;
        nombre?: string | null;
        avatar_url?: string | null;
        nombre_usuario?: string | null;
    } | Array<{
        id?: string;
        nombre?: string | null;
        avatar_url?: string | null;
        nombre_usuario?: string | null;
    }> | null;
};

function mapStatsRow(
    row: StatsRow,
    fallback: string,
    score: number,
): RankedProfile {
    const raw = row.perfiles;
    const profile = Array.isArray(raw) ? raw[0] : raw;
    return {
        id: (profile?.id as string) ?? row.usuario_id,
        nombre: (profile?.nombre as string) || fallback,
        avatar_url: (profile?.avatar_url as string | null) ?? null,
        nombre_usuario: (profile?.nombre_usuario as string | null) ?? null,
        score,
        rating: Number(row.valoracion_media ?? 0) || 0,
        reviews: Number(row.numero_valoraciones ?? 0) || 0,
    };
}

async function filterByOrganizer(
    rows: RankedProfile[],
    mode: 'exclude' | 'only',
): Promise<RankedProfile[]> {
    if (!rows.length) return rows;
    try {
        const publics = await getPublicProfiles(rows.map((row) => row.id));
        const orgIds = new Set(publics.filter((p) => p.es_organizador === true).map((p) => p.id));
        return rows.filter((row) => (mode === 'only' ? orgIds.has(row.id) : !orgIds.has(row.id)));
    } catch {
        return mode === 'only' ? [] : rows;
    }
}

async function friendScopeIdsFor(userId: string | null | undefined): Promise<string[] | null> {
    if (!userId) {
        const user = await getAuthUser();
        userId = user?.id ?? null;
    }
    if (!userId) return null;
    const friends = await getFriends(userId);
    if (friends.length === 0) return [];
    return [userId, ...friends.map((f) => f.id)];
}

function sortPlans(a: RankedProfile, b: RankedProfile) {
    if (b.score !== a.score) return b.score - a.score;
    if ((b.rating ?? 0) !== (a.rating ?? 0)) return (b.rating ?? 0) - (a.rating ?? 0);
    return (b.reviews ?? 0) - (a.reviews ?? 0);
}

function sortRatings(a: RankedProfile, b: RankedProfile) {
    if (b.score !== a.score) return b.score - a.score;
    return (b.reviews ?? 0) - (a.reviews ?? 0);
}

async function withFriendZeros(
    friendScopeIds: string[],
    scored: RankedProfile[],
    fallback: string,
): Promise<RankedProfile[]> {
    const publics = await getPublicProfiles(friendScopeIds);
    const scoreById = new Map(scored.map((row) => [row.id, row.score]));
    const mapped = publics.map((profile) => ({
        id: profile.id,
        nombre: profile.nombre || fallback,
        avatar_url: profile.avatar_url,
        nombre_usuario: profile.nombre_usuario,
        score: scoreById.get(profile.id) ?? 0,
    } satisfies RankedProfile));
    const people = await filterByOrganizer(mapped, 'exclude');
    return people.sort(sortPlans).slice(0, 50);
}

async function fetchThisMonthRanking(
    scope: RankScope,
    friendScopeIds: string[] | null,
    fallback: string,
): Promise<RankedProfile[]> {
    const { data, error } = await supabase.rpc('get_person_ranking_this_month', {
        p_limit: scope === 'friends' ? 100 : 80,
        p_user_ids: friendScopeIds,
    });
    if (error) throw error;

    const rows = (error ? [] : (data ?? [])) as Array<{ usuario_id: string; score: number }>;
    const scoredIds = rows.map((row) => row.usuario_id);
    const publics = scoredIds.length ? await getPublicProfiles(scoredIds) : [];
    const byId = new Map(publics.map((p) => [p.id, p]));
    const scored = rows.map((row) => {
        const profile = byId.get(row.usuario_id);
        return {
            id: row.usuario_id,
            nombre: profile?.nombre || fallback,
            avatar_url: profile?.avatar_url ?? null,
            nombre_usuario: profile?.nombre_usuario ?? null,
            score: Number(row.score) || 0,
        } satisfies RankedProfile;
    });

    if (scope === 'friends' && friendScopeIds?.length) {
        return withFriendZeros(friendScopeIds, scored, fallback);
    }

    let mapped = scored.filter((p) => p.score > 0);
    mapped = await filterByOrganizer(mapped, 'exclude');
    return mapped.sort(sortPlans).slice(0, 25);
}

async function fetchCreatedRanking(
    scope: RankScope,
    friendScopeIds: string[] | null,
    fallback: string,
): Promise<RankedProfile[]> {
    let query = supabase
        .from('estadisticas_usuario')
        .select(`
            planes_creados,
            valoracion_media,
            numero_valoraciones,
            usuario_id,
            perfiles:usuario_id ( id, nombre, avatar_url, nombre_usuario )
        `)
        .order('planes_creados', { ascending: false })
        .limit(scope === 'friends' ? 100 : 80);

    if (friendScopeIds) {
        query = query.in('usuario_id', friendScopeIds);
    }

    const { data, error } = await query;
    if (error) throw error;

    let mapped = ((data ?? []) as StatsRow[]).map((row) =>
        mapStatsRow(row, fallback, Number(row.planes_creados ?? 0) || 0),
    );

    mapped = await filterByOrganizer(mapped, 'exclude');

    if (scope === 'friends' && friendScopeIds?.length) {
        return withFriendZeros(friendScopeIds, mapped, fallback);
    }

    mapped = mapped.filter((p) => p.id && p.score > 0);
    return mapped.sort(sortPlans).slice(0, 25);
}

async function fetchRatingRanking(
    fallback: string,
): Promise<RankedProfile[]> {
    const query = supabase
        .from('estadisticas_usuario')
        .select(`
            valoracion_media,
            numero_valoraciones,
            usuario_id,
            perfiles:usuario_id ( id, nombre, avatar_url, nombre_usuario )
        `)
        .gt('numero_valoraciones', 0)
        .order('valoracion_media', { ascending: false })
        .order('numero_valoraciones', { ascending: false })
        .limit(160);

    const { data, error } = await query;
    if (error) throw error;

    let mapped: RankedProfile[] = ((data ?? []) as StatsRow[])
        .map((row) => ({
            ...mapStatsRow(row, fallback, Number(row.valoracion_media ?? 0) || 0),
            reviews: Number(row.numero_valoraciones ?? 0) || 0,
        }))
        .filter((p) => !!p.id && (p.reviews ?? 0) > 0);

    mapped = await filterByOrganizer(mapped, 'only');
    return mapped.sort(sortRatings).slice(0, 25);
}

async function fetchCommunitiesRanking(fallback: string): Promise<RankedProfile[]> {
    const { data: follows, error } = await supabase
        .from('seguidores')
        .select('organizador_id, seguidor_id');
    if (error) throw error;

    const counts = new Map<string, number>();
    const previewIds = new Map<string, string[]>();
    for (const row of follows ?? []) {
        const id = row.organizador_id as string | null;
        const followerId = row.seguidor_id as string | null;
        if (!id) continue;
        counts.set(id, (counts.get(id) ?? 0) + 1);
        if (!followerId) continue;
        const list = previewIds.get(id) ?? [];
        if (list.length < 5) {
            list.push(followerId);
            previewIds.set(id, list);
        }
    }

    const rankedIds = [...counts.entries()]
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 40)
        .map(([id]) => id);

    if (!rankedIds.length) return [];

    const publics = await getPublicProfiles(rankedIds);
    const byId = new Map(publics.map((p) => [p.id, p]));
    const followerIds = [...new Set(rankedIds.flatMap((id) => previewIds.get(id) ?? []))];
    const followerProfiles = followerIds.length ? await getPublicProfiles(followerIds) : [];
    const followerById = new Map(followerProfiles.map((p) => [p.id, p]));

    return rankedIds
        .map((id) => {
            const profile = byId.get(id);
            if (!profile || profile.es_organizador !== true) return null;
            const previews = (previewIds.get(id) ?? [])
                .map((fid) => {
                    const person = followerById.get(fid);
                    if (!person) return null;
                    return {
                        id: person.id,
                        nombre: person.nombre || fallback,
                        avatar_url: person.avatar_url,
                    };
                })
                .filter((row): row is NonNullable<typeof row> => row != null);
            return {
                id: profile.id,
                nombre: profile.nombre || fallback,
                avatar_url: profile.avatar_url,
                nombre_usuario: profile.nombre_usuario,
                score: counts.get(id) ?? 0,
                previews,
            } satisfies RankedProfile;
        })
        .filter((row): row is NonNullable<typeof row> => row != null)
        .slice(0, 25);
}

export async function fetchRankings(
    key: RankKey,
    scope: RankScope,
    opts?: { userId?: string | null; fallbackName?: string },
): Promise<RankedProfile[]> {
    const fallback = opts?.fallbackName ?? 'Usuario';

    if (scope === 'communities') {
        if (key === 'members') return fetchCommunitiesRanking(fallback);
        if (key === 'rating') return fetchRatingRanking(fallback);
        return [];
    }

    if (key === 'members') return [];

    let friendScopeIds: string[] | null = null;
    if (scope === 'friends') {
        friendScopeIds = await friendScopeIdsFor(opts?.userId);
        if (!friendScopeIds || friendScopeIds.length === 0) return [];
    }

    if (key === 'rating') {
        return fetchCreatedRanking(scope, friendScopeIds, fallback);
    }

    return fetchThisMonthRanking(scope, friendScopeIds, fallback);
}

const PUBLIC_PREFETCH: Array<{ key: RankKey; scope: RankScope }> = [
    { key: 'plans', scope: 'global' },
    { key: 'rating', scope: 'global' },
    { key: 'members', scope: 'communities' },
    { key: 'rating', scope: 'communities' },
];

/** Rankings globales (sin cuenta) — útil durante el registro. */
export async function prefetchPublicRankings(fallbackName?: string): Promise<void> {
    await Promise.allSettled(
        PUBLIC_PREFETCH.map(async ({ key, scope }) => {
            const cacheKey = screenCacheKey.rankings(RANKINGS_PUBLIC_USER, key, scope);
            if (cacheIsFresh(cacheKey)) return;
            try {
                const rows = await fetchRankings(key, scope, { fallbackName });
                cacheSet(cacheKey, rows, ScreenCacheTTL.rankings);
            } catch {
                // best effort
            }
        }),
    );
}

/** Copia rankings públicos a la clave del usuario (evita refetch al terminar el registro). */
export function adoptPublicRankings(userId: string): void {
    for (const { key, scope } of PUBLIC_PREFETCH) {
        const pub = cacheGetStale<RankedProfile[]>(
            screenCacheKey.rankings(RANKINGS_PUBLIC_USER, key, scope),
        );
        if (!Array.isArray(pub)) continue;
        const userKey = screenCacheKey.rankings(userId, key, scope);
        if (cacheIsFresh(userKey)) continue;
        cacheSet(userKey, pub, ScreenCacheTTL.rankings);
    }
}

/** Precarga rankings usados en Buscar. */
export async function prefetchSearchRankings(userId: string, fallbackName?: string): Promise<void> {
    const jobs: Array<{ key: RankKey; scope: RankScope }> = [
        ...PUBLIC_PREFETCH,
        { key: 'plans', scope: 'friends' },
        { key: 'rating', scope: 'friends' },
    ];

    await Promise.allSettled(
        jobs.map(async ({ key, scope }) => {
            const cacheKey = screenCacheKey.rankings(userId, key, scope);
            if (cacheIsFresh(cacheKey)) return;
            try {
                const rows = await fetchRankings(key, scope, { userId, fallbackName });
                cacheSet(cacheKey, rows, ScreenCacheTTL.rankings);
            } catch {
                // best effort
            }
        }),
    );
}

export function peekRankings(
    userId: string,
    key: RankKey,
    scope: RankScope,
): RankedProfile[] | null {
    const own = cacheGetStale<RankedProfile[]>(screenCacheKey.rankings(userId, key, scope));
    if (own != null) return own;
    if (scope === 'global' || scope === 'communities') {
        return cacheGetStale<RankedProfile[]>(
            screenCacheKey.rankings(RANKINGS_PUBLIC_USER, key, scope),
        );
    }
    return null;
}

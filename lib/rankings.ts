import { countUnlockedBadges } from './badges';
import { getBadgeStats } from './badgeStats';
import { getFriends } from './friends';
import { RANKINGS_PUBLIC_USER, screenCacheKey, ScreenCacheTTL } from './screenCaches';
import { supabase } from './supabase';
import { cacheGetStale, cacheIsFresh, cacheSet } from './ttlCache';

export type RankKey = 'plans' | 'badges';
export type RankScope = 'global' | 'friends';

export type RankedProfile = {
    id: string;
    nombre: string;
    avatar_url: string | null;
    nombre_usuario: string | null;
    score: number;
};

export async function fetchRankings(
    key: RankKey,
    scope: RankScope,
    opts?: { userId?: string | null; fallbackName?: string },
): Promise<RankedProfile[]> {
    let friendScopeIds: string[] | null = null;
    if (scope === 'friends') {
        let userId = opts?.userId ?? null;
        if (!userId) {
            const { data: { user } } = await supabase.auth.getUser();
            userId = user?.id ?? null;
        }
        if (!userId) return [];
        const friends = await getFriends(userId);
        friendScopeIds = [userId, ...friends.map((f) => f.id)];
    }

    let query = supabase
        .from('estadisticas_usuario')
        .select(`
            numero_planes_realizados,
            usuario_id,
            perfiles:usuario_id ( id, nombre, avatar_url, nombre_usuario )
        `)
        .order('numero_planes_realizados', { ascending: false })
        .limit(scope === 'friends' ? 100 : key === 'badges' ? 60 : 50);

    if (friendScopeIds) {
        query = query.in('usuario_id', friendScopeIds);
    }

    const { data, error } = await query;
    if (error) throw error;

    const fallback = opts?.fallbackName ?? 'Usuario';
    let mapped: RankedProfile[] = await Promise.all(
        (data ?? []).map(async (row) => {
            const raw = row.perfiles;
            const profile = Array.isArray(raw) ? raw[0] : raw;
            let score = 0;

            if (key === 'badges') {
                const stats = await getBadgeStats(row.usuario_id as string);
                score = countUnlockedBadges(stats);
            } else {
                score = row.numero_planes_realizados ?? 0;
            }

            return {
                id: (profile?.id as string) ?? (row.usuario_id as string),
                nombre: (profile?.nombre as string) || fallback,
                avatar_url: (profile?.avatar_url as string | null) ?? null,
                nombre_usuario: (profile?.nombre_usuario as string | null) ?? null,
                score,
            };
        }),
    );

    // Global: métrica > 0. Entre amigos: todos (también con 0 planes).
    if (scope === 'global') {
        mapped = mapped.filter((p) => p.id && p.score > 0);
    } else {
        mapped = mapped.filter((p) => !!p.id);
    }
    mapped = mapped.sort((a, b) => b.score - a.score).slice(0, scope === 'friends' ? 50 : 25);
    return mapped;
}

/** Rankings globales (sin cuenta) — útil durante el registro. */
export async function prefetchPublicRankings(fallbackName?: string): Promise<void> {
    const keys: RankKey[] = ['plans', 'badges'];
    await Promise.allSettled(
        keys.map(async (key) => {
            const cacheKey = screenCacheKey.rankings(RANKINGS_PUBLIC_USER, key, 'global');
            if (cacheIsFresh(cacheKey)) return;
            try {
                const rows = await fetchRankings(key, 'global', { fallbackName });
                cacheSet(cacheKey, rows, ScreenCacheTTL.rankings);
            } catch {
                // best effort
            }
        }),
    );
}

/** Copia rankings públicos a la clave del usuario (evita refetch al terminar el registro). */
export function adoptPublicRankings(userId: string): void {
    const keys: RankKey[] = ['plans', 'badges'];
    for (const key of keys) {
        const pub = cacheGetStale<RankedProfile[]>(
            screenCacheKey.rankings(RANKINGS_PUBLIC_USER, key, 'global'),
        );
        if (!Array.isArray(pub)) continue;
        const userKey = screenCacheKey.rankings(userId, key, 'global');
        if (cacheIsFresh(userKey)) continue;
        cacheSet(userKey, pub, ScreenCacheTTL.rankings);
    }
}

/** Precarga rankings usados en Buscar (global + amigos × planes/insignias). */
export async function prefetchSearchRankings(userId: string, fallbackName?: string): Promise<void> {
    const keys: RankKey[] = ['plans', 'badges'];
    const scopes: RankScope[] = ['global', 'friends'];

    await Promise.allSettled(
        keys.flatMap((key) =>
            scopes.map(async (scope) => {
                const cacheKey = screenCacheKey.rankings(userId, key, scope);
                if (cacheIsFresh(cacheKey)) return;
                try {
                    const rows = await fetchRankings(key, scope, { userId, fallbackName });
                    cacheSet(cacheKey, rows, ScreenCacheTTL.rankings);
                } catch {
                    // best effort
                }
            }),
        ),
    );
}

export function peekRankings(
    userId: string,
    key: RankKey,
    scope: RankScope,
): RankedProfile[] | null {
    const own = cacheGetStale<RankedProfile[]>(screenCacheKey.rankings(userId, key, scope));
    if (own != null) return own;
    if (scope === 'global') {
        return cacheGetStale<RankedProfile[]>(
            screenCacheKey.rankings(RANKINGS_PUBLIC_USER, key, scope),
        );
    }
    return null;
}

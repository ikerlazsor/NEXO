import {
    affinityPersonFromProfile,
    countSharedOrganizerFollows,
    fetchFirstPersonRepeat,
    resolveProfileAffinity,
    type AffinityLevel,
    type AffinityPerson,
    type FirstRepeatVote,
} from './profileAffinity';
import { ensureViewerAffinityPerson } from './viewerAffinityCache';
import { getBadgeStats } from './badgeStats';
import { getFriendsCount } from './friends';
import { getMutualFriends } from './profileSocial';
import { getPublicProfile } from './profileData';
import { parseHabitos } from './profileFields';
import { getUserStats, peekUserStats, type UserStats } from './stats';
import { cacheGetStale, cacheSet } from './ttlCache';
import { userProfileKey } from './userProfileCache';

export type PairAffinityResult = { score: number; level: AffinityLevel };

const cache = new Map<string, PairAffinityResult>();
const inflight = new Map<string, Promise<PairAffinityResult | null>>();

function pairKey(viewerId: string, targetId: string): string {
    const a = viewerId.trim();
    const b = targetId.trim();
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function peekPairAffinity(viewerId: string, targetId: string): PairAffinityResult | null {
    if (!viewerId || !targetId || viewerId === targetId) return null;
    return cache.get(pairKey(viewerId, targetId)) ?? null;
}

export function rememberPairAffinity(
    viewerId: string,
    targetId: string,
    result: PairAffinityResult,
): void {
    if (!viewerId || !targetId || viewerId === targetId) return;
    cache.set(pairKey(viewerId, targetId), result);
}

/** Misma resolución en plan y perfil; guarda el resultado para que coincidan. */
export function resolveAndRememberPairAffinity(input: {
    isSelf?: boolean;
    viewer?: AffinityPerson | null;
    target: AffinityPerson;
    viewerId?: string | null;
    targetId?: string | null;
    isFriends?: boolean;
    mutualFriends?: number;
    sharedCommunities?: number;
    firstRepeat?: FirstRepeatVote;
}): PairAffinityResult {
    const result = resolveProfileAffinity(input);
    if (input.viewerId && input.targetId && !input.isSelf) {
        rememberPairAffinity(input.viewerId, input.targetId, result);
        const prev = cacheGetStale<Record<string, unknown>>(userProfileKey(input.targetId)) ?? {};
        cacheSet(
            userProfileKey(input.targetId),
            { ...prev, pairAffinity: result, pairAffinityFull: true },
            90_000,
        );
    }
    return result;
}

type ProfileAffinitySnap = {
    userProfile?: {
        edad?: number | null;
        ambientes_preferidos?: string[] | null;
        etiquetas?: string[] | null;
        habitos_consumo?: Record<string, unknown> | null;
        es_organizador?: boolean;
    };
    stats?: UserStats | null;
    friendsCount?: number;
    badgeStats?: Parameters<typeof affinityPersonFromProfile>[0]['badgeStats'];
    friendStatus?: string | null;
    pairAffinity?: PairAffinityResult | null;
    /** true cuando el % se calculó con stats+friendsCount (mismo input que el perfil). */
    pairAffinityFull?: boolean;
};

/**
 * Instantáneo: solo el % oficial (mismos inputs que el perfil).
 * No devuelve provisionales que luego cambian.
 */
export function peekOrComputePairAffinity(
    viewerId: string,
    targetId: string,
    _opts?: { isFriends?: boolean },
): PairAffinityResult | null {
    if (!viewerId || !targetId || viewerId === targetId) return null;

    const snap = cacheGetStale<ProfileAffinitySnap>(userProfileKey(targetId));
    if (hasFullAffinityInputs(snap)) {
        const full = snap!.pairAffinity!;
        rememberPairAffinity(viewerId, targetId, full);
        return full;
    }

    // Sin cálculo completo no inventamos un % distinto al del perfil.
    return null;
}

function hasFullAffinityInputs(snap: ProfileAffinitySnap | null | undefined): boolean {
    return !!(snap?.pairAffinityFull && snap.pairAffinity);
}

/** Precarga afinidad persona↔persona con los mismos inputs que el perfil. */
export function prefetchPairAffinity(
    viewerId: string,
    targetId: string,
    opts?: { isFriends?: boolean },
): Promise<PairAffinityResult | null> {
    if (!viewerId || !targetId || viewerId === targetId) return Promise.resolve(null);

    const snap0 = cacheGetStale<ProfileAffinitySnap>(userProfileKey(targetId));
    // Solo reutilizar si ya es el cálculo completo (stats + friends), igual que el perfil.
    if (hasFullAffinityInputs(snap0)) {
        const cached = peekPairAffinity(viewerId, targetId) ?? snap0!.pairAffinity!;
        rememberPairAffinity(viewerId, targetId, cached);
        return Promise.resolve(cached);
    }

    const key = pairKey(viewerId, targetId);
    const running = inflight.get(key);
    if (running) return running;

    const task = (async (): Promise<PairAffinityResult | null> => {
        try {
            const snap = cacheGetStale<ProfileAffinitySnap>(userProfileKey(targetId));
            const needProfile = !snap?.userProfile;
            const needBadges = !snap?.badgeStats && snap?.userProfile?.es_organizador !== true;
            const peekedStats = snap?.stats ?? peekUserStats(targetId);

            const [viewer, publicProfile, userStats, badgeStats, friendsCountRaw, mutual, communities, firstRepeat] =
                await Promise.all([
                    ensureViewerAffinityPerson(viewerId),
                    needProfile ? getPublicProfile(targetId) : Promise.resolve(null),
                    peekedStats
                        ? Promise.resolve(peekedStats)
                        : getUserStats(targetId).catch(() => null),
                    needBadges
                        ? getBadgeStats(targetId).catch(() => null)
                        : Promise.resolve(snap?.badgeStats ?? null),
                    typeof snap?.friendsCount === 'number'
                        ? Promise.resolve(snap.friendsCount)
                        : getFriendsCount(targetId).catch(() => 0),
                    getMutualFriends(targetId, 1)
                        .then((r) => r.total)
                        .catch(() => 0),
                    countSharedOrganizerFollows(viewerId, targetId).catch(() => 0),
                    fetchFirstPersonRepeat(viewerId, targetId).catch(() => null),
                ]);

            if (!viewer) return null;

            const profile = publicProfile ?? snap?.userProfile;
            if (!profile) return null;
            if ((profile as { es_organizador?: boolean }).es_organizador) return null;

            const tags =
                ('ambientes_preferidos' in profile && profile.ambientes_preferidos?.length
                    ? profile.ambientes_preferidos
                    : profile.etiquetas) ?? [];
            const age = 'edad' in profile ? profile.edad ?? null : null;
            const habitos = parseHabitos(
                ('habitos_consumo' in profile ? profile.habitos_consumo : null) ?? null,
            );
            const badges = badgeStats ?? snap?.badgeStats ?? undefined;
            const isFriends = opts?.isFriends === true || snap?.friendStatus === 'friends';
            const friendsCount = Math.max(
                typeof friendsCountRaw === 'number' ? friendsCountRaw : 0,
                userStats?.numeroAmistades || 0,
            );

            // Persistir stats/friends para que peekOrCompute exija el mismo input que el perfil.
            const prevSnap = cacheGetStale<Record<string, unknown>>(userProfileKey(targetId)) ?? {};
            cacheSet(
                userProfileKey(targetId),
                {
                    ...prevSnap,
                    ...(userStats ? { stats: userStats } : null),
                    friendsCount,
                    ...(badges ? { badgeStats: badges } : null),
                    ...(profile && !prevSnap.userProfile
                        ? {
                              userProfile: {
                                  edad: age,
                                  ambientes_preferidos:
                                      'ambientes_preferidos' in profile
                                          ? profile.ambientes_preferidos
                                          : null,
                                  etiquetas: 'etiquetas' in profile ? profile.etiquetas : tags,
                                  habitos_consumo:
                                      'habitos_consumo' in profile ? profile.habitos_consumo : null,
                                  es_organizador: false,
                              },
                          }
                        : null),
                },
                90_000,
            );

            return resolveAndRememberPairAffinity({
                isSelf: false,
                viewer,
                viewerId,
                targetId,
                target: affinityPersonFromProfile({
                    age,
                    tags,
                    habitos,
                    stats: userStats ?? undefined,
                    badgeStats: badges,
                    friendsCount,
                }),
                isFriends,
                mutualFriends: mutual,
                sharedCommunities: communities,
                firstRepeat,
            });
        } catch {
            return null;
        } finally {
            if (inflight.get(key) === task) inflight.delete(key);
        }
    })();

    inflight.set(key, task);
    return task;
}

import { EMPTY_STATS, type UserStats } from './stats';
import type { FriendStatus } from './friends';
import { cacheGetStale, cacheIsFresh, cacheSet } from './ttlCache';
import { rememberFriendStatus } from './friendStatusPeek';

export const USER_PROFILE_TTL_MS = 90_000;
export const userProfileKey = (id: string) => `userProfile:${id}`;

export type UserProfilePeekInput = {
    id: string;
    nombre?: string | null;
    nombre_usuario?: string | null;
    avatar_url?: string | null;
    es_organizador?: boolean;
    friendStatus?: FriendStatus | null;
    requestId?: string | null;
};

/** Semilla mínima para pintar el perfil al instante al tocar. */
export function seedUserProfilePeek(input: UserProfilePeekInput): void {
    if (!input.id) return;
    const key = userProfileKey(input.id);
    const existing = cacheGetStale<{
        userProfile?: { id: string };
        badgeStats?: unknown;
        friendStatus?: FriendStatus | null;
        requestId?: string | null;
    }>(key);
    // Si ya hay datos “completos”, no pises (salvo enriquecer friendStatus).
    if (existing?.userProfile?.id === input.id && existing.badgeStats != null) {
        if (input.friendStatus && input.friendStatus !== existing.friendStatus) {
            cacheSet(
                key,
                {
                    ...existing,
                    friendStatus: input.friendStatus,
                    requestId: input.requestId ?? existing.requestId ?? null,
                },
                USER_PROFILE_TTL_MS,
            );
            rememberFriendStatus(input.id, input.friendStatus, input.requestId ?? null);
        }
        return;
    }

    const nextFriendStatus =
        input.friendStatus ?? existing?.friendStatus ?? null;
    const nextRequestId = input.requestId ?? existing?.requestId ?? null;
    if (nextFriendStatus) {
        rememberFriendStatus(input.id, nextFriendStatus, nextRequestId);
    }

    cacheSet(
        key,
        {
            userProfile: {
                id: input.id,
                nombre: input.nombre ?? null,
                nombre_usuario: input.nombre_usuario ?? null,
                avatar_url: input.avatar_url ?? null,
                cover_url: null,
                descripcion: null,
                etiquetas: [],
                edad: null,
                genero: null,
                habitos_consumo: {},
                ambientes_preferidos: [],
                perfil_gustos: {},
                es_organizador: input.es_organizador === true,
                organizador: {},
            },
            friendsCount: 0,
            stats: EMPTY_STATS as UserStats,
            friendStatus: nextFriendStatus,
            requestId: nextRequestId,
            blocked: false,
            blockedEitherWay: false,
            currentUserId: null,
            currentUserGenero: null,
            sharedPlans: 0,
            followersCount: 0,
            organizerPlansCount: 0,
            followingOrganizer: false,
            upcomingPlans: [],
            organizedPlans: [],
            mutualFriends: { total: 0, items: [] },
            attendedPlans: [],
            orgFriendAttendees: { total: 0, items: [] },
            followerPreviews: [],
            viewerAffinity: null,
            sharedCommunities: 0,
            firstRepeat: null,
        },
        USER_PROFILE_TTL_MS,
    );
}

const prefetchInflight = new Set<string>();

/**
 * Precarga perfil en red (best-effort). No bloquea UI.
 * Rellena afinidad/reputación / datos org antes o al entrar.
 */
export function prefetchUserProfile(userId: string): void {
    if (!userId || prefetchInflight.has(userId)) return;
    const key = userProfileKey(userId);
    const existing = cacheGetStale<{
        badgeStats?: unknown;
        userProfile?: { es_organizador?: boolean };
        viewerAffinity?: unknown;
    }>(key);
    if (existing?.badgeStats != null && existing.viewerAffinity != null && cacheIsFresh(key)) return;

    prefetchInflight.add(userId);
    void (async () => {
        try {
            const [
                { getPublicProfile },
                { getBadgeStats, EMPTY_BADGE_STATS },
                { getUserStats },
                { getFriendsCount },
                {
                    getOrganizerFollowStats,
                    getOrganizerUpcomingPlans,
                    getOrganizerPlansCount,
                    parseOrganizerMeta,
                },
                { readCoverUrl },
                { getAuthUser },
                { ensureViewerAffinityPerson },
            ] = await Promise.all([
                import('./profileData'),
                import('./badgeStats'),
                import('./stats'),
                import('./friends'),
                import('./organizer'),
                import('./profileCover'),
                import('./auth'),
                import('./viewerAffinityCache'),
            ]);

            const me = await getAuthUser();
            const [profile, stats, friendsCount, viewerAffinity, friendSt] = await Promise.all([
                getPublicProfile(userId),
                getUserStats(userId),
                getFriendsCount(userId),
                me && me.id !== userId ? ensureViewerAffinityPerson(me.id) : Promise.resolve(null),
                me && me.id !== userId
                    ? import('./friends').then(({ getFriendStatus }) => getFriendStatus(me.id, userId))
                    : Promise.resolve(null),
            ]);
            if (!profile) return;

            const isOrg = profile.es_organizador === true;
            const [badgeStats, orgFollow, upcoming, orgPlansCount, attendedPlans] = await Promise.all([
                isOrg ? Promise.resolve(EMPTY_BADGE_STATS) : getBadgeStats(userId),
                isOrg ? getOrganizerFollowStats(userId) : Promise.resolve({ followers: 0, following: false }),
                isOrg ? getOrganizerUpcomingPlans(userId, 8) : Promise.resolve([]),
                isOrg ? getOrganizerPlansCount(userId) : Promise.resolve(0),
                isOrg
                    ? Promise.resolve([])
                    : import('./profileSocial').then(({ getPublicAttendedPlans }) =>
                          getPublicAttendedPlans(userId, 12),
                      ),
            ]);

            if (friendSt) {
                rememberFriendStatus(userId, friendSt.status, friendSt.requestId);
            }

            const prev = cacheGetStale<Record<string, unknown>>(key) ?? {};
            cacheSet(
                key,
                {
                    ...prev,
                    userProfile: {
                        id: profile.id,
                        nombre: profile.nombre,
                        nombre_usuario: profile.nombre_usuario,
                        avatar_url: profile.avatar_url,
                        cover_url:
                            readCoverUrl({
                                cover_url: profile.cover_url,
                                organizador: profile.organizador,
                                perfil_gustos: profile.perfil_gustos,
                            }) ||
                            parseOrganizerMeta(profile.organizador).portada ||
                            null,
                        descripcion: profile.descripcion,
                        etiquetas: Array.isArray(profile.etiquetas) ? profile.etiquetas : [],
                        edad: profile.edad,
                        genero: profile.genero,
                        habitos_consumo: (profile.habitos_consumo as Record<string, unknown>) ?? {},
                        ambientes_preferidos: Array.isArray(profile.ambientes_preferidos)
                            ? profile.ambientes_preferidos
                            : [],
                        perfil_gustos: (profile.perfil_gustos as Record<string, unknown>) ?? {},
                        es_organizador: isOrg,
                        organizador: parseOrganizerMeta(profile.organizador),
                    },
                    friendsCount: Math.max(friendsCount, stats.numeroAmistades || 0),
                    stats,
                    badgeStats,
                    friendStatus:
                        me && me.id === userId
                            ? 'self'
                            : friendSt?.status ?? (prev.friendStatus as FriendStatus | null | undefined) ?? null,
                    requestId: friendSt?.requestId ?? (prev.requestId as string | null | undefined) ?? null,
                    followersCount: orgFollow.followers ?? 0,
                    followingOrganizer: orgFollow.following === true,
                    organizerPlansCount: orgPlansCount,
                    upcomingPlans: upcoming,
                    attendedPlans,
                    viewerAffinity: isOrg ? null : viewerAffinity,
                    currentUserId: me?.id ?? null,
                },
                USER_PROFILE_TTL_MS,
            );
        } catch {
            /* best-effort */
        } finally {
            prefetchInflight.delete(userId);
        }
    })();
}

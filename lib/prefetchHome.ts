import { fetchIncomingPlanJoinRequests } from './planJoinRequests';
import { rememberChromeAvatar } from './chromeAvatar';
import { prefetchPlanDetail, planDetailKey } from './planDetailCache';
import { prefetchUserProfile } from './userProfileCache';
import { rememberFriendsSet } from './friendStatusPeek';
import { AppState, InteractionManager, type AppStateStatus } from 'react-native';
import { getAuthUser } from './auth';
import { fetchGuestFeedPlans } from './guestFeed';
import { getUserBadges } from './badges';
import { getBadgeStats } from './badgeStats';
import { getChatSummaries } from './chatSummaries';
import {
    FEED_CACHE_KEY,
    FEED_CACHE_TTL_MS,
    type FeedSnapshot,
    sanitizeFeedSnapshot,
} from './feedCache';
import { attachFeedPlanPeople } from './feedQuery';
import { emptyGuestFeedSnapshot, fetchSignedInFeedSnapshot } from './feedLoad';
import { fetchMyPlansSnapshot } from './myPlansQuery';
import {
    getFriends,
    getFriendsCount,
    getIncomingRequests,
    getOutgoingRequests,
} from './friends';
import { getProfileNotificationCount } from './notifications';
import { mapEstadoToMembership } from './participants';
import { getIncomingPlanInvites } from './planInvites';
import { isPlanActiveForSaved, purgePastSavedPlansForUser } from './planLifecycle';
import { calcAge, parseHabitos, parsePrivacy, type Genero } from './profileFields';
import { loadProfileRow, resolveDisplayName, syncProfileFromAuth } from './profile';
import { getMyProfile } from './profileData';
import {
    getOrganizerMembers,
    getOrganizerUpcomingPlans,
    parseOrganizerMeta,
    peekViewerIsOrganizer,
    rememberViewerIsOrganizer,
} from './organizer';
import { getPendingRatingPlans, type PendingRatingPlan } from './ratings';
import {
    adoptPublicRankings,
    prefetchPublicRankings,
    prefetchSearchRankings,
} from './rankings';
import { diskGet, diskSet } from './diskCache';
import { prefetchRecentChatThreads } from './prefetchChats';
import { peekUserCoords } from './location';
import { getIsOnline } from './network';
import { prefetchRemoteImages, scheduleCoverPrefetch } from './prefetchCovers';
import { withRetry } from './retry';
import { screenCacheKey, ScreenCacheTTL } from './screenCaches';
import { getUserStats } from './stats';
import { supabase } from './supabase';
import { cacheGetStale, cacheIsFresh, cacheInvalidate, cacheSet } from './ttlCache';
import type { User } from '@supabase/supabase-js';
import { scheduleLegalPrefetch } from './legalWarm';
import { fetchOrganizerInsights } from './organizerInsights';
import { getPublicAttendedPlans } from './profileSocial';
import { runWhenIdle } from './runWhenIdle';
import { warmMapRegion, warmMapRegionsFromPlans, warmMapsForSignedInUser } from './mapWarm';
import { syncNotificationCategoryPrefsFromServer } from './notificationPrefs';
import { syncPushPreferenceFromServer } from './push';

const FEED_DISK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CHATS_DISK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MY_PLANS_DISK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ORGANIZER_MEMBERS_TTL_MS = 90_000;

type MyPlansDiskSnap = {
    plans: unknown[];
    pendingCount: number;
    ratingByPlan: Record<string, unknown>;
};

let inflight: Promise<void> | null = null;
let publicInflight: Promise<void> | null = null;

async function prefetchProfile(userId: string, authUser: Awaited<ReturnType<typeof getAuthUser>>) {
    if (!authUser || cacheIsFresh(screenCacheKey.profileUI(userId))) return;

    const row = await loadProfileRow(userId);
    let profile = row.data
        ? {
            nombre: row.data.nombre?.trim() || resolveDisplayName(authUser),
            nombre_usuario: row.data.nombre_usuario ?? null,
            avatar_url:
                row.data.avatar_url
                ?? (typeof authUser.user_metadata?.avatar_url === 'string'
                    ? authUser.user_metadata.avatar_url
                    : null),
            descripcion: row.data.descripcion ?? '',
            etiquetas: row.data.etiquetas ?? [],
            fecha_nacimiento: row.data.fecha_nacimiento ?? null,
            genero: row.data.genero ?? null,
            habitos_consumo: (row.data.habitos_consumo as Record<string, unknown>) ?? {},
            ambientes_preferidos: row.data.ambientes_preferidos ?? [],
            perfil_gustos: (row.data.perfil_gustos as Record<string, unknown>) ?? {},
        }
        : await syncProfileFromAuth(authUser);

    const organizer = row.data?.es_organizador === true;
    rememberViewerIsOrganizer(organizer);
    const [userStats, badgeStats, friendsCountVal, notifs, ratings] = await Promise.all([
        getUserStats(userId),
        organizer ? Promise.resolve(null) : getBadgeStats(userId, { userCreatedAt: authUser.created_at }),
        getFriendsCount(userId),
        getProfileNotificationCount(userId),
        getPendingRatingPlans(userId),
    ]);

    const habitos = parseHabitos(profile.habitos_consumo);
    cacheSet(screenCacheKey.profileUI(userId), {
        userId,
        nombre: profile.nombre,
        nombreUsuario: profile.nombre_usuario,
        coverUrl: row.data?.cover_url ?? null,
        aboutMe: profile.descripcion,
        avatarUrl: profile.avatar_url,
        age: calcAge(profile.fecha_nacimiento),
        genero: (profile.genero as Genero) || null,
        habitoBebida: habitos.bebida,
        habitoTabaco: habitos.tabaco,
        aficiones: profile.ambientes_preferidos?.length
            ? profile.ambientes_preferidos
            : profile.etiquetas,
        perfilGustos: profile.perfil_gustos,
        privacy: parsePrivacy(profile.perfil_gustos),
        stats: userStats,
        friendsCount: friendsCountVal,
        friendsNotifCount: notifs.friendRequests + notifs.planInvites,
        planRequests: notifs.planRequests,
        pendingRatings: ratings,
        badges: badgeStats ? getUserBadges(badgeStats) : [],
        badgeStats: badgeStats ?? undefined,
        isOrganizer: organizer,
        organizer: parseOrganizerMeta(row.data?.organizador),
    }, ScreenCacheTTL.profileUI);
    rememberChromeAvatar(userId, profile.avatar_url ?? null);
    if (profile.avatar_url) {
        void import('expo-image').then(({ Image }) => {
            void Image.prefetch(profile.avatar_url as string);
        });
    }
    warmPendingRatings(ratings);
    if (organizer) {
        void prefetchOrganizerExtras(userId);
    } else {
        void getPublicAttendedPlans(userId, 12).then((attended) => {
            for (const p of attended.slice(0, 12)) {
                void prefetchPlanDetail(p.id).then(() => {
                    const detail = cacheGetStale<{ plan?: { latitud?: number | null; longitud?: number | null } }>(
                        planDetailKey(p.id),
                    );
                    if (detail?.plan) {
                        warmMapRegion({
                            latitude: detail.plan.latitud,
                            longitude: detail.plan.longitud,
                        });
                    }
                });
            }
        }).catch(() => {});
    }
}

/** Detalle + perfiles de anfitrión/gente del feed (los primeros planes visibles). */
function warmFeedDeep(snap: FeedSnapshot): void {
    const plans = Array.isArray(snap.plans) ? snap.plans.slice(0, 12) : [];
    runWhenIdle(() => {
        for (const plan of plans) {
            const id = typeof plan?.id === 'string' ? plan.id : '';
            if (!id) continue;
            void prefetchPlanDetail(id);
            const hostId =
                (typeof plan?.host?.id === 'string' && plan.host.id)
                || (typeof plan?.creador_id === 'string' && plan.creador_id)
                || null;
            if (hostId) prefetchUserProfile(hostId);
            const people = Array.isArray(plan?.participantsList) ? plan.participantsList : [];
            for (const person of people.slice(0, 3)) {
                if (typeof person?.id === 'string' && person.id) prefetchUserProfile(person.id);
            }
        }
        for (const id of (snap.coincidedIds ?? []).slice(0, 12)) {
            if (id) prefetchUserProfile(id);
        }
        for (const id of (snap.friendIds ?? []).slice(0, 8)) {
            if (id) prefetchUserProfile(id);
        }
        warmMapRegionsFromPlans(plans, 14);
    }, 120);
}

function warmPendingRatings(ratings: PendingRatingPlan[]): void {
    const open = ratings.filter((r) => r.phase === 'open' || r.phase === 'waiting').slice(0, 6);
    runWhenIdle(() => {
        for (const r of open) {
            void prefetchPlanDetail(r.planId);
            if (r.organizer?.id) prefetchUserProfile(r.organizer.id);
            for (const peer of (r.searchPeers ?? r.peers ?? []).slice(0, 8)) {
                if (peer?.id) prefetchUserProfile(peer.id);
            }
            if (r.imagen_url) prefetchRemoteImages([r.imagen_url], 1);
        }
    }, 180);
}

async function prefetchOrganizerExtras(userId: string): Promise<void> {
    await Promise.allSettled([
        fetchOrganizerInsights({ userId }),
        (async () => {
            const key = `organizerMembers:${userId}`;
            if (cacheIsFresh(key)) return;
            const members = await getOrganizerMembers(userId);
            cacheSet(key, members, ORGANIZER_MEMBERS_TTL_MS);
            for (const m of members.slice(0, 12)) {
                if (m?.id) prefetchUserProfile(m.id);
            }
        })(),
        (async () => {
            const upcoming = await getOrganizerUpcomingPlans(userId, 8);
            for (const p of upcoming.slice(0, 8)) prefetchPlanDetail(p.id);
        })(),
    ]);
}

/**
 * Tras unirse/crear/aceptar: recalienta Mis planes, chats y amigos sin esperar al próximo ciclo.
 */
export function schedulePersonalRewarm(userId?: string | null): void {
    void (async () => {
        const uid = userId ?? (await getAuthUser())?.id;
        if (!uid || !getIsOnline()) return;
        cacheInvalidate(screenCacheKey.myPlans(uid));
        cacheInvalidate(screenCacheKey.chatsList(uid));
        cacheInvalidate(screenCacheKey.friends(uid));
        runWhenIdle(() => {
            void Promise.allSettled([
                prefetchMyPlans(uid),
                prefetchChats(uid),
                prefetchFriends(uid),
            ]);
        }, 80);
    })();
}

async function prefetchChats(userId: string) {
    if (!getIsOnline()) return;
    const summaries = await getChatSummaries(userId);
    prefetchRemoteImages(summaries.map((row) => row.image_url), 24);
    prefetchRecentChatThreads(
        userId,
        summaries.map((row) => ({
            id: row.conversation_id,
            title: row.title,
            image_url: row.image_url,
            kind: row.conversation_kind === 'direct'
                ? 'direct'
                : row.category === 'Grupo'
                    ? 'group'
                    : 'plan',
            peerId: row.conversation_kind === 'direct' ? row.conversation_id : undefined,
            creadorId: row.creator_id ?? undefined,
            fechaEvento: row.event_at,
            unread: row.unread_count,
            lastAt: row.last_at ?? undefined,
        })),
    );
}

async function prefetchMyPlans(userId: string) {
    const key = screenCacheKey.myPlans(userId);
    const existing = cacheGetStale<MyPlansDiskSnap>(key);
    // Caché vacía no cuenta: hay que ir a red.
    if (cacheIsFresh(key) && (existing?.plans?.length ?? 0) > 0) return;
    const snap = await fetchMyPlansSnapshot(userId, { applyHidden: true, forceRatings: true });
    const myPlansSnap = {
        plans: snap.plans,
        pendingCount: snap.pendingCount,
        ratingByPlan: snap.ratingByPlan,
    };
    cacheSet(key, myPlansSnap, ScreenCacheTTL.myPlans);
    void diskSet(key, myPlansSnap);

    // Detalle de próximos + pasados (Mis planes / «he ido») listos al abrir.
    const upcoming = snap.plans.filter((p) => !p.isPast).slice(0, 8);
    const pastWarm = snap.plans.filter((p) => p.isPast).slice(0, 12);
    for (const plan of [...upcoming, ...pastWarm]) {
        prefetchPlanDetail(plan.id);
        warmMapRegion({
            latitude: plan.latitud,
            longitude: plan.longitud,
        });
        for (const pending of plan.pending.slice(0, 4)) {
            prefetchUserProfile(pending.id);
        }
    }
}

async function prefetchFriends(userId: string) {
    const key = screenCacheKey.friends(userId);
    const existing = cacheGetStale<{
        friends: unknown[];
        incoming: unknown[];
        outgoing: unknown[];
        planInvites: unknown[];
        planJoinRequests?: unknown[];
    }>(key);
    // Caché vacía no cuenta como válida (p. ej. semilla antigua).
    if (cacheIsFresh(key) && friendsCacheLooksPopulated(existing)) return;

    const [friendsData, incomingData, outgoingData, invitesData, joinReqData] = await Promise.all([
        getFriends(userId),
        getIncomingRequests(userId),
        getOutgoingRequests(userId),
        getIncomingPlanInvites(userId).catch(() => []),
        fetchIncomingPlanJoinRequests(userId).catch(() => []),
    ]);

    cacheSet(key, {
        friends: friendsData,
        incoming: incomingData,
        outgoing: outgoingData,
        planInvites: invitesData,
        planJoinRequests: joinReqData,
    }, ScreenCacheTTL.friends);
    rememberFriendsSet(friendsData.map((f) => f.id));

    // Perfiles de amigos / solicitudes para abrir sin esperar.
    const warmIds = [
        ...friendsData.slice(0, 12).map((f) => f.id),
        ...incomingData.slice(0, 6).map((r) => r.perfil?.id ?? r.usuario_origen_id),
        ...joinReqData.slice(0, 6).map((r) => r.userId),
    ].filter(Boolean) as string[];
    for (const id of warmIds) {
        if (id && id !== userId) prefetchUserProfile(id);
    }
    prefetchRemoteImages(
        [
            ...friendsData.slice(0, 16).map((f) => f.avatar_url),
            ...incomingData.slice(0, 8).map((r) => r.perfil?.avatar_url),
        ],
        20,
    );
}

/** Semilla vacía: NUNCA chats (bloqueaba prefetch y disco con [] “fresco”). */
function seedEmptyPersonalCaches(_userId: string): void {
    // Intencionalmente vacío. Mis planes / friends ya evitan tratar [] como válido.
}

function friendsCacheLooksPopulated(snap: {
    friends?: unknown[];
    incoming?: unknown[];
    outgoing?: unknown[];
    planInvites?: unknown[];
    planJoinRequests?: unknown[];
} | null): boolean {
    if (!snap) return false;
    return (
        (snap.friends?.length ?? 0) > 0
        || (snap.incoming?.length ?? 0) > 0
        || (snap.outgoing?.length ?? 0) > 0
        || (snap.planInvites?.length ?? 0) > 0
        || (snap.planJoinRequests?.length ?? 0) > 0
    );
}

function savedPlansCacheLooksPopulated(snap: { savedPlans?: unknown[] } | null): boolean {
    return (snap?.savedPlans?.length ?? 0) > 0;
}

async function prefetchSavedPlans(userId: string) {
    const key = screenCacheKey.savedPlans(userId);
    const existing = cacheGetStale<{ savedPlans: unknown[] }>(key);
    if (cacheIsFresh(key) && savedPlansCacheLooksPopulated(existing)) return;

    await purgePastSavedPlansForUser(userId);

    const [{ data: myProfile }, { data: savedData }, { data: joinedData }] = await Promise.all([
        getMyProfile(),
        supabase
            .from('planes_guardados')
            .select('plan_id, planes (*)')
            .eq('usuario_id', userId),
        supabase.from('participantes').select('plan_id, estado').eq('usuario_id', userId),
    ]);

    const rawPlans = (savedData || [])
        .map((s: any) => s.planes)
        .filter(Boolean)
        .filter((plan: any) => isPlanActiveForSaved(plan));
    const formatted = await attachFeedPlanPeople(rawPlans, { keepNonFeed: true });

    const membershipMap: Record<string, string> = {};
    (joinedData || []).forEach((p: any) => {
        const m = mapEstadoToMembership(p.estado);
        if (m) membershipMap[p.plan_id] = m;
    });

    cacheSet(key, {
        savedPlans: formatted,
        membershipMap,
        currentUserGenero: myProfile?.genero ?? null,
    }, ScreenCacheTTL.savedPlans);
}

/** Precarga Amigos + Guardados (p. ej. al abrir perfil, antes de entrar). */
export function warmFriendsAndSavedPlans(userId?: string | null): void {
    void (async () => {
        const uid = userId ?? (await getAuthUser())?.id;
        if (!uid) return;
        await Promise.allSettled([prefetchFriends(uid), prefetchSavedPlans(uid)]);
    })();
}

function warmFeedImages(snap: FeedSnapshot) {
    const uris: Array<string | null | undefined> = [];
    for (const plan of snap.plans.slice(0, 20)) {
        uris.push(plan?.imagen_url);
        const host = plan?.host;
        if (host?.avatar_url) uris.push(host.avatar_url);
        const creator = plan?.participantsList?.[0];
        if (creator?.avatar_url) uris.push(creator.avatar_url);
    }
    prefetchRemoteImages(uris, 28);
    warmFeedDeep(snap);
}

/** Restaura el último feed guardado en disco (arranque / offline). */
export async function hydrateFeedFromDisk(userId: string | null): Promise<void> {
    if (cacheGetStale(FEED_CACHE_KEY) != null) return;
    const snap = await diskGet<FeedSnapshot>(FEED_CACHE_KEY, FEED_DISK_MAX_AGE_MS);
    if (!snap?.plans?.length || (snap.currentUserId ?? null) !== userId) return;
    const clean = sanitizeFeedSnapshot(snap);
    if (!clean.plans.length) return;
    cacheSet(FEED_CACHE_KEY, clean, FEED_CACHE_TTL_MS);
    warmFeedImages(clean);
}

/** Restaura lista de chats desde disco (cold start / offline). */
export async function hydrateChatsFromDisk(userId: string): Promise<void> {
    const uid = userId;
    const existing = cacheGetStale<unknown[]>(screenCacheKey.chatsList(uid));
    // [] sembrado / vacío no bloquea hidratar disco.
    if (Array.isArray(existing) && existing.length > 0) return;
    const rows = await diskGet<unknown[]>(screenCacheKey.chatsList(uid), CHATS_DISK_MAX_AGE_MS);
    if (!Array.isArray(rows) || rows.length === 0) return;
    cacheSet(screenCacheKey.chatsList(uid), rows, ScreenCacheTTL.chatsList);
}

/** Restaura mis planes desde disco (cold start / offline). */
export async function hydrateMyPlansFromDisk(userId: string): Promise<void> {
    const uid = userId;
    if (cacheGetStale(screenCacheKey.myPlans(uid)) != null) return;
    const snap = await diskGet<MyPlansDiskSnap>(screenCacheKey.myPlans(uid), MY_PLANS_DISK_MAX_AGE_MS);
    if (!snap || !Array.isArray(snap.plans)) return;
    cacheSet(screenCacheKey.myPlans(uid), snap, ScreenCacheTTL.myPlans);
}

async function prefetchFeed(userId: string | null): Promise<void> {
    if (cacheIsFresh(FEED_CACHE_KEY)) {
        const snap = cacheGetStale<FeedSnapshot>(FEED_CACHE_KEY);
        if (!userId) return;
        if (snap?.currentUserId === userId) return;
    }

    if (!getIsOnline()) {
        await hydrateFeedFromDisk(userId);
        return;
    }

    const coords = peekUserCoords();

    if (!userId) {
        const formattedPlans = await withRetry(() => fetchGuestFeedPlans(coords));
        const snapshot = emptyGuestFeedSnapshot(formattedPlans);
        cacheSet(FEED_CACHE_KEY, snapshot, FEED_CACHE_TTL_MS);
        void diskSet(FEED_CACHE_KEY, snapshot);
        warmFeedImages(snapshot);
        return;
    }

    const snapshot = await withRetry(() => fetchSignedInFeedSnapshot(userId, coords));
    cacheSet(FEED_CACHE_KEY, snapshot, FEED_CACHE_TTL_MS);
    void diskSet(FEED_CACHE_KEY, snapshot);
    warmFeedImages(snapshot);
}

async function warmSettingsPrefs(userId: string): Promise<void> {
    await Promise.allSettled([
        syncPushPreferenceFromServer(userId),
        syncNotificationCategoryPrefsFromServer(userId),
    ]);
}

async function runPrefetch(userId: string, authUser: User) {
    adoptPublicRankings(userId);
    seedEmptyPersonalCaches(userId);
    scheduleCoverPrefetch();
    scheduleLegalPrefetch();
    await Promise.allSettled([
        prefetchFeed(userId),
        prefetchProfile(userId, authUser),
        prefetchChats(userId),
        prefetchMyPlans(userId),
        prefetchFriends(userId),
        prefetchSavedPlans(userId),
        prefetchSearchRankings(userId),
        warmSettingsPrefs(userId),
    ]);
    if (peekViewerIsOrganizer()) {
        void prefetchOrganizerExtras(userId);
    }
    runWhenIdle(() => {
        warmMapsForSignedInUser(userId);
    }, 400);
}

/** Listo al instante (sin red): rankings públicos + pantallas personales vacías. */
export function prepareCachesForNewUser(userId: string): void {
    adoptPublicRankings(userId);
    seedEmptyPersonalCaches(userId);
}

/**
 * Durante el registro (aún sin sesión): feed público + rankings globales.
 * Así al entrar ya hay contenido listo.
 */
export function scheduleOnboardingPrefetch(): void {
    scheduleCoverPrefetch();
    if (publicInflight) return;
    InteractionManager.runAfterInteractions(() => {
        if (publicInflight) return;
        publicInflight = Promise.allSettled([
            prefetchFeed(null).catch(() => undefined),
            prefetchPublicRankings(),
        ]).then(() => undefined).finally(() => {
            publicInflight = null;
        });
    });
}

/**
 * Warmup completo y awaitable (fin de onboarding / primer login).
 * No bloquea la UI del feed si ya había caché pública.
 */
export async function warmAppCaches(authUser: User): Promise<void> {
    if (inflight) {
        await inflight;
        return;
    }
    inflight = runPrefetch(authUser.id, authUser).finally(() => {
        inflight = null;
    });
    await inflight;
}

/** Precarga en segundo plano tras entrar a la app / feed (sin bloquear la UI). */
export function scheduleHomePrefetch(): void {
    scheduleCoverPrefetch();
    scheduleLegalPrefetch();
    void (async () => {
        const user = await getAuthUser();
        if (!user) {
            scheduleOnboardingPrefetch();
            return;
        }
        if (inflight) return;

        const friendsSnap = cacheGetStale<{
            friends?: unknown[];
            incoming?: unknown[];
            outgoing?: unknown[];
            planInvites?: unknown[];
            planJoinRequests?: unknown[];
        }>(screenCacheKey.friends(user.id));
        const savedSnap = cacheGetStale<{ savedPlans?: unknown[] }>(
            screenCacheKey.savedPlans(user.id),
        );
        const myPlansSnap = cacheGetStale<MyPlansDiskSnap>(screenCacheKey.myPlans(user.id));
        const allFresh =
            cacheIsFresh(FEED_CACHE_KEY)
            && cacheIsFresh(screenCacheKey.profileUI(user.id))
            && cacheIsFresh(screenCacheKey.chatsList(user.id))
            && cacheIsFresh(screenCacheKey.myPlans(user.id))
            && (myPlansSnap?.plans?.length ?? 0) > 0
            && cacheIsFresh(screenCacheKey.friends(user.id))
            && friendsCacheLooksPopulated(friendsSnap)
            && cacheIsFresh(screenCacheKey.savedPlans(user.id))
            && savedPlansCacheLooksPopulated(savedSnap)
            && cacheIsFresh(screenCacheKey.rankings(user.id, 'plans', 'global'));
        if (allFresh) {
            // Aun con caché fresca: calienta perfiles de amigos ya listados.
            const friends = (friendsSnap?.friends ?? []) as Array<{ id?: string }>;
            for (const f of friends.slice(0, 8)) {
                if (f.id) prefetchUserProfile(f.id);
            }
            return;
        }

        InteractionManager.runAfterInteractions(() => {
            if (inflight) return;
            inflight = runPrefetch(user.id, user).finally(() => {
                inflight = null;
            });
        });
    })();
}

let appStateSub: { remove: () => void } | null = null;
let lastForegroundPrefetchAt = 0;

/** Al volver a la app: refresca pantallas clave en segundo plano. */
export function ensureBackgroundPrefetchLifecycle(): void {
    if (appStateSub) return;
    let prev: AppStateStatus = AppState.currentState;
    appStateSub = AppState.addEventListener('change', (next) => {
        const fromBg = prev === 'background' || prev === 'inactive';
        prev = next;
        if (!fromBg || next !== 'active') return;
        const now = Date.now();
        if (now - lastForegroundPrefetchAt < 20_000) return;
        lastForegroundPrefetchAt = now;
        scheduleHomePrefetch();
    });
}

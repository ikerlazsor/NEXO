import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCoincidedUserIds } from './coincidences';
import { attachFeedPlanPeople } from './feedQuery';
import { getFriendIds, getFriendOfFriendIds } from './friends';
import { invalidatePlanDetailCache } from './planDetailCache';
import { getRatingPhase, getRatingsUnlockMs, isGroupOrChatPlan, runPlanLifecycleMaintenance } from './planLifecycle';
import { invalidateProfileNotificationCount, patchProfileNotificationCount } from './profileNotificationBus';
import type { PublicAttendedPlan } from './profileSocial';
import { invalidatePlanMembershipCaches, screenCacheKey, ScreenCacheTTL } from './screenCaches';
import { bumpPlansDoneOptimistic } from './stats';
import { supabase } from './supabase';
import { cacheGetOrFetch, cacheGetStale, cacheInvalidate, cacheInvalidatePrefix, cacheSet } from './ttlCache';

const PENDING_RATINGS_TTL_MS = 45_000;
const ATTENDED_OPTIMISTIC_TTL_MS = 120_000;

function pendingRatingsKey(userId: string) {
    return `pendingRatings:${userId}`;
}

function attendedOptimisticKey(userId: string) {
    return `attendedOptimistic:${userId}`;
}

export function invalidatePendingRatingsCache(userId?: string): void {
    if (userId) {
        cacheInvalidate(pendingRatingsKey(userId));
        invalidateProfileNotificationCount(userId);
        return;
    }
    cacheInvalidatePrefix('pendingRatings:');
    cacheInvalidatePrefix('notifCount:');
}

const ratingSessionListeners = new Set<(evt: RatingSessionEvent) => void>();

export type RatingSessionEvent =
    | {
          type: 'removed';
          userId: string;
          planId: string;
      }
    | {
          type: 'attended';
          userId: string;
          plan: PublicAttendedPlan;
      };

export function subscribeRatingSession(listener: (evt: RatingSessionEvent) => void): () => void {
    ratingSessionListeners.add(listener);
    return () => {
        ratingSessionListeners.delete(listener);
    };
}

function emitRatingSession(evt: RatingSessionEvent): void {
    ratingSessionListeners.forEach((listener) => {
        try {
            listener(evt);
        } catch {
            /* ignore */
        }
    });
}

/** Quita un plan de «Qué tal fue» en caché de memoria (antes de navegar atrás). */
export function removePendingRatingOptimistic(userId: string, planId: string): void {
    const key = pendingRatingsKey(userId);
    const prev = cacheGetStale<PendingRatingPlan[]>(key) ?? [];
    const next = prev.filter((p) => p.planId !== planId);
    // invalidate primero: invalida inflight para que un fetch viejo no reescriba el plan.
    cacheInvalidate(key);
    cacheSet(key, next, PENDING_RATINGS_TTL_MS);
    // Badge al instante (perfil / avatar), da igual si valoraste desde chats, Mis planes o perfil.
    patchProfileNotificationCount(userId, {
        openRatings: next.filter((p) => p.phase === 'open').length,
    });

    const profileKey = screenCacheKey.profileUI(userId);
    const snap = cacheGetStale<{ pendingRatings?: PendingRatingPlan[] }>(profileKey);
    if (snap) {
        cacheSet(
            profileKey,
            {
                ...snap,
                pendingRatings: (snap.pendingRatings ?? []).filter((p) => p.planId !== planId),
            },
            ScreenCacheTTL.profileUI,
        );
    }
    emitRatingSession({ type: 'removed', userId, planId });
    try {
        invalidatePlanDetailCache(planId);
    } catch {
        /* ignore */
    }
}

/** Planes «a los que he ido» añadidos en local hasta que el RPC los confirme. */
export function peekAttendedPlansOptimistic(userId: string): PublicAttendedPlan[] {
    return cacheGetStale<PublicAttendedPlan[]>(attendedOptimisticKey(userId)) ?? [];
}

export function mergeAttendedPlansOptimistic(
    userId: string,
    remote: PublicAttendedPlan[],
): PublicAttendedPlan[] {
    const local = peekAttendedPlansOptimistic(userId);
    if (local.length === 0) return remote;
    const seen = new Set(remote.map((p) => p.id));
    const pendingLocal = local.filter((p) => !seen.has(p.id));
    if (pendingLocal.length === 0) {
        cacheInvalidate(attendedOptimisticKey(userId));
        return remote;
    }
    return [...pendingLocal, ...remote];
}

function prependAttendedPlanOptimistic(userId: string, plan: PublicAttendedPlan): void {
    const key = attendedOptimisticKey(userId);
    const prev = cacheGetStale<PublicAttendedPlan[]>(key) ?? [];
    if (prev.some((p) => p.id === plan.id)) return;
    cacheSet(key, [plan, ...prev], ATTENDED_OPTIMISTIC_TTL_MS);
    emitRatingSession({ type: 'attended', userId, plan });
}

const RATING_SKIP_PREFIX = '@nexo_rating_skip:';
const RATING_STARTED_PREFIX = '@nexo_rating_started:';
const RATING_DONE_PREFIX = '@nexo_rating_done:';
const PLAN_MOOD_PREFIX = '@nexo_plan_mood:';

function ratingSkipKey(userId: string, planId: string) {
    return `${RATING_SKIP_PREFIX}${userId}:${planId}`;
}

function ratingStartedKey(userId: string, planId: string) {
    return `${RATING_STARTED_PREFIX}${userId}:${planId}`;
}

function ratingDoneKey(userId: string, planId: string) {
    return `${RATING_DONE_PREFIX}${userId}:${planId}`;
}

/** Hechos locales aún no confirmados por AsyncStorage (evita que el refetch re-enseñe el plan). */
const ratingDoneMemory = new Set<string>();
const ratingSkipMemory = new Set<string>();

function ratingMemoryId(userId: string, planId: string) {
    return `${userId}:${planId}`;
}

/**
 * Al pulsar «Sí, fui»: contador + Mis planes + «planes a los que he ido» al instante.
 * La red (historial) sigue en segundo plano. Nunca debe lanzar (congelaba el flujo).
 */
export function applyAttendanceConfirmedOptimistic(
    userId: string,
    plan: { planId: string; titulo: string; imagen_url: string | null; fecha_evento: string },
): void {
    try {
        bumpPlansDoneOptimistic(userId, 1);
        prependAttendedPlanOptimistic(userId, {
            id: plan.planId,
            titulo: plan.titulo,
            imagen_url: plan.imagen_url,
            fecha_evento: plan.fecha_evento,
            nombre_ubicacion: null,
            categoria: null,
        });
        invalidatePlanMembershipCaches(userId);
    } catch {
        /* UI ya avanzó; el ensurePlanInHistory de fondo corrige. */
    }
}

async function persistRatingClosure(userId: string, planId: string, skipped: boolean): Promise<void> {
    try {
        await supabase.from('cierres_valoracion').upsert(
            {
                usuario_id: userId,
                plan_id: planId,
                skipped,
                cerrado_en: new Date().toISOString(),
            },
            { onConflict: 'usuario_id,plan_id' },
        );
    } catch {
        /* Tabla aún no migrada / offline: AsyncStorage sigue siendo respaldo. */
    }
}

/** Cierra el flujo de valoración en UI al instante (sí fui o no fui). */
export function applyRatingFlowCompleteOptimistic(
    userId: string,
    planId: string,
    opts?: { skipped?: boolean },
): void {
    const mid = ratingMemoryId(userId, planId);
    ratingDoneMemory.add(mid);
    if (opts?.skipped) ratingSkipMemory.add(mid);
    else ratingSkipMemory.delete(mid);

    removePendingRatingOptimistic(userId, planId);
    const pairs: [string, string][] = opts?.skipped
        ? [
            [ratingSkipKey(userId, planId), new Date().toISOString()],
            [ratingStartedKey(userId, planId), ''],
            [ratingDoneKey(userId, planId), '1'],
        ]
        : [
            [ratingDoneKey(userId, planId), '1'],
            [ratingStartedKey(userId, planId), ''],
            [ratingSkipKey(userId, planId), ''],
        ];
    void AsyncStorage.multiSet(pairs);
    void persistRatingClosure(userId, planId, opts?.skipped === true);
}

/** Marca que el usuario no asistió: sin historial ni “planes hechos”. */
export async function dismissRatingWithoutHistory(userId: string, planId: string): Promise<void> {
    const { data: hadRow } = await supabase
        .from('historial_planes')
        .select('id')
        .eq('usuario_id', userId)
        .eq('plan_id', planId)
        .maybeSingle();

    const mid = ratingMemoryId(userId, planId);
    ratingDoneMemory.add(mid);
    ratingSkipMemory.add(mid);

    await AsyncStorage.multiSet([
        [ratingSkipKey(userId, planId), new Date().toISOString()],
        [ratingStartedKey(userId, planId), ''],
        [ratingDoneKey(userId, planId), '1'],
    ]);
    await supabase.from('historial_planes').delete().eq('usuario_id', userId).eq('plan_id', planId);
    void persistRatingClosure(userId, planId, true);
    if (hadRow) {
        bumpPlansDoneOptimistic(userId, -1);
    }
    invalidatePendingRatingsCache(userId);
}

export async function isPlanAttendanceDismissed(userId: string, planId: string): Promise<boolean> {
    return isRatingDismissed(userId, planId);
}

/** Lote: evita N getItem al filtrar planes pasados en Mis planes. */
export async function getDismissedPlanIdSet(userId: string, planIds: string[]): Promise<Set<string>> {
    if (planIds.length === 0) return new Set();
    const dismissed = new Set<string>();
    for (const id of planIds) {
        if (ratingSkipMemory.has(ratingMemoryId(userId, id))) dismissed.add(id);
    }
    const pairs = await AsyncStorage.multiGet(planIds.map((id) => ratingSkipKey(userId, id)));
    for (let i = 0; i < planIds.length; i++) {
        if (pairs[i]?.[1]) dismissed.add(planIds[i]);
    }
    return dismissed;
}

export async function markRatingSessionStarted(userId: string, planId: string): Promise<void> {
    await AsyncStorage.setItem(ratingStartedKey(userId, planId), '1');
}

export async function clearRatingSessionFlags(userId: string, planId: string): Promise<void> {
    await AsyncStorage.multiRemove([
        ratingSkipKey(userId, planId),
        ratingStartedKey(userId, planId),
    ]);
}

async function isRatingDismissed(userId: string, planId: string): Promise<boolean> {
    if (ratingSkipMemory.has(ratingMemoryId(userId, planId))) return true;
    const v = await AsyncStorage.getItem(ratingSkipKey(userId, planId));
    return !!v;
}

async function isRatingFlowDone(userId: string, planId: string): Promise<boolean> {
    if (ratingDoneMemory.has(ratingMemoryId(userId, planId))) return true;
    const v = await AsyncStorage.getItem(ratingDoneKey(userId, planId));
    return v === '1';
}

export async function hasRatingSessionStarted(userId: string, planId: string): Promise<boolean> {
    const v = await AsyncStorage.getItem(ratingStartedKey(userId, planId));
    return v === '1';
}

/** Deshace un «No fui» por si se pulsó sin querer. */
export async function undoAttendanceSkip(userId: string, planId: string): Promise<void> {
    const mid = ratingMemoryId(userId, planId);
    ratingDoneMemory.delete(mid);
    ratingSkipMemory.delete(mid);
    await AsyncStorage.multiRemove([
        ratingSkipKey(userId, planId),
        ratingStartedKey(userId, planId),
        ratingDoneKey(userId, planId),
    ]);
    try {
        await supabase.from('cierres_valoracion').delete().eq('usuario_id', userId).eq('plan_id', planId);
    } catch {
        /* ignore */
    }
    invalidatePendingRatingsCache(userId);
}

/** Valores permitidos por CHECK en public.valoraciones (máx. 2). */
export const POSITIVE_ASPECTS = [
    'agradable',
    'puntual',
    'respetuoso',
    'cercano',
    'divertido',
    'social',
] as const;

/** Valores permitidos por CHECK en public.valoraciones (máx. 2). */
export const NEGATIVE_ASPECTS = [
    'impuntual',
    'irrespetuoso',
    'frio',
    'poco_participativo',
    'incomodo',
] as const;

export const ORGANIZER_POSITIVE_ASPECTS = [
    'organizado',
    'buen_ambiente',
    'puntual_org',
    'comunicacion',
    'fiel_anuncio',
] as const;

export const ORGANIZER_NEGATIVE_ASPECTS = [
    'desorganizado',
    'retraso',
    'masificado',
    'no_anunciado',
    'mal_ambiente',
] as const;

export const MAX_ASPECTS = 2;
/** Caras visibles en el cierre. Si hay más, se priorizan amigos / amigos de amigos / coincidencias. */
export const MAX_FACE_PEERS = 20;
/** Tope de personas a valorar en un mismo plan. */
export const MAX_PEOPLE_RATINGS_COMPACT = 30;
/** A partir de este número de asistentes, un plan de persona también usa lista compacta. */
export const COMPACT_PEOPLE_THRESHOLD = 15;

export const STAR_LABEL_KEYS = [
    'ratings.star1',
    'ratings.star2',
    'ratings.star3',
    'ratings.star4',
    'ratings.star5',
] as const;

export type AspectPositivo = (typeof POSITIVE_ASPECTS)[number];
export type AspectNegativo = (typeof NEGATIVE_ASPECTS)[number];
export type OrganizerAspectPositivo = (typeof ORGANIZER_POSITIVE_ASPECTS)[number];
export type OrganizerAspectNegativo = (typeof ORGANIZER_NEGATIVE_ASPECTS)[number];
/** Coincide con CHECK: si | indiferente | no */
export type Repetiria = 'si' | 'no' | 'indiferente';
export type RatingTargetTipo = 'persona' | 'organizacion';
export type PlanMood = 'great' | 'good' | 'ok';
export type PersonVibe = 'yes' | 'no';

export type RatingPeer = {
    id: string;
    nombre: string;
    avatar_url: string | null;
    genero?: string | null;
};

export type PendingRatingPlan = {
    planId: string;
    titulo: string;
    imagen_url: string | null;
    fecha_evento: string;
    phase: 'waiting' | 'open';
    unlockAt: number;
    peers: RatingPeer[];
    searchPeers: RatingPeer[];
    /** Orden de prioridad (amigos, coincidencias…) para rellenar burbujas en planes grandes. */
    peerRankIds: string[];
    ratedIds: string[];
    pendingCount: number;
    totalPeers: number;
    compactPeople: boolean;
    organizer: RatingPeer | null;
    organizerRated: boolean;
};

export type RatingDraft = {
    asistencia: boolean | null;
    puntuacion_general: number;
    repetiria_experiencia: Repetiria | null;
    aspectos_positivos: string[];
    aspectos_negativos: string[];
};

export const EMPTY_RATING_DRAFT: RatingDraft = {
    asistencia: null,
    puntuacion_general: 0,
    repetiria_experiencia: null,
    aspectos_positivos: [],
    aspectos_negativos: [],
};

export function isPersonDraftComplete(draft: RatingDraft): boolean {
    if (draft.asistencia === null) return false;
    if (draft.asistencia === false) return true;
    return draft.puntuacion_general >= 1 && draft.puntuacion_general <= 5 && !!draft.repetiria_experiencia;
}

function planMoodKey(userId: string, planId: string) {
    return `${PLAN_MOOD_PREFIX}${userId}:${planId}`;
}

export async function savePlanMood(userId: string, planId: string, mood: PlanMood): Promise<void> {
    await AsyncStorage.setItem(planMoodKey(userId, planId), mood);
}

export async function getPlanMood(userId: string, planId: string): Promise<PlanMood | null> {
    const v = await AsyncStorage.getItem(planMoodKey(userId, planId));
    return v === 'great' || v === 'good' || v === 'ok' ? v : null;
}

export function orgStarsFromMood(mood: PlanMood): number {
    if (mood === 'great') return 5;
    if (mood === 'good') return 4;
    return 3;
}

export function orgDraftFromMood(mood: PlanMood): RatingDraft {
    const stars = orgStarsFromMood(mood);
    return {
        asistencia: true,
        puntuacion_general: stars,
        repetiria_experiencia: mood === 'ok' ? 'indiferente' : 'si',
        aspectos_positivos: [],
        aspectos_negativos: [],
    };
}

export function personDraftFromVibe(vibe: PersonVibe, tags: string[]): RatingDraft {
    if (vibe === 'yes') {
        const allowed = new Set<string>(POSITIVE_ASPECTS);
        return {
            asistencia: true,
            puntuacion_general: 5,
            repetiria_experiencia: 'si',
            aspectos_positivos: tags.filter((k) => allowed.has(k)).slice(0, MAX_ASPECTS),
            aspectos_negativos: [],
        };
    }
    const allowed = new Set<string>(NEGATIVE_ASPECTS);
    return {
        asistencia: true,
        puntuacion_general: 2,
        repetiria_experiencia: 'no',
        aspectos_positivos: [],
        aspectos_negativos: tags.filter((k) => allowed.has(k)).slice(0, MAX_ASPECTS),
    };
}

/** El otro ya te marcó «buen rollo» en este plan. Visible por RLS (eres el evaluado). */
export async function findMutualSpark(
    planId: string,
    me: string,
    them: string,
): Promise<boolean> {
    const { data } = await supabase
        .from('valoraciones')
        .select('repetiria_experiencia')
        .eq('plan_id', planId)
        .eq('evaluador_id', them)
        .eq('evaluado_id', me)
        .maybeSingle();
    return data?.repetiria_experiencia === 'si';
}

export function isOrganizerDraftComplete(draft: RatingDraft): boolean {
    return draft.puntuacion_general >= 1 && draft.puntuacion_general <= 5;
}

export function repetiriaFromStars(stars: number): Repetiria {
    if (stars >= 4) return 'si';
    if (stars <= 2) return 'no';
    return 'indiferente';
}

function peerAffinityScore(
    p: RatingPeer,
    friendIds: Set<string>,
    fofIds: Set<string>,
    coincidedIds: Set<string>,
): number {
    if (friendIds.has(p.id)) return 3;
    if (fofIds.has(p.id)) return 2;
    if (coincidedIds.has(p.id)) return 1;
    return 0;
}

export function rankPeerIds(
    peers: RatingPeer[],
    friendIds: Set<string>,
    fofIds: Set<string>,
    coincidedIds: Set<string>,
): string[] {
    return [...peers]
        .sort(
            (a, b) =>
                peerAffinityScore(b, friendIds, fofIds, coincidedIds) -
                    peerAffinityScore(a, friendIds, fofIds, coincidedIds) ||
                a.nombre.localeCompare(b.nombre, 'es'),
        )
        .map((p) => p.id);
}

/** Burbujas visibles: ≤20 todos (valorados al final); >20 hasta 20 (sin valorar primero, valorados al final si faltan). */
export function visibleRatingPeers(
    searchPeers: RatingPeer[],
    ratedIds: Set<string>,
    rankIds: string[] = [],
): RatingPeer[] {
    if (searchPeers.length === 0) return [];
    const byId = new Map(searchPeers.map((p) => [p.id, p]));
    const order = rankIds.length ? rankIds : searchPeers.map((p) => p.id);

    const unrated: RatingPeer[] = [];
    const rated: RatingPeer[] = [];
    for (const id of order) {
        const peer = byId.get(id);
        if (!peer) continue;
        if (ratedIds.has(id)) rated.push(peer);
        else unrated.push(peer);
    }
    for (const peer of searchPeers) {
        if (unrated.some((p) => p.id === peer.id) || rated.some((p) => p.id === peer.id)) continue;
        if (ratedIds.has(peer.id)) rated.push(peer);
        else unrated.push(peer);
    }

    if (searchPeers.length <= MAX_FACE_PEERS) {
        return [...unrated, ...rated];
    }

    if (unrated.length >= MAX_FACE_PEERS) {
        return unrated.slice(0, MAX_FACE_PEERS);
    }

    const picked = [...unrated];
    for (const peer of rated) {
        if (picked.length >= MAX_FACE_PEERS) break;
        picked.push(peer);
    }
    return picked;
}

export function pickFacePeers(
    peers: RatingPeer[],
    friendIds: Set<string>,
    fofIds: Set<string>,
    coincidedIds: Set<string>,
    limit = MAX_FACE_PEERS,
): RatingPeer[] {
    const rankIds = rankPeerIds(peers, friendIds, fofIds, coincidedIds);
    return visibleRatingPeers(peers, new Set(), rankIds).slice(0, limit);
}

export function needsOrganizerRating(
    plan: Pick<PendingRatingPlan, 'organizer' | 'organizerRated'>,
): boolean {
    return Boolean(plan.organizer && !plan.organizerRated);
}

export function filterPeersByQuery(peers: RatingPeer[], query: string): RatingPeer[] {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return peers.filter((p) => p.nombre.toLowerCase().includes(q)).slice(0, 8);
}

async function getAcceptedPeers(planId: string, excludeUserId: string): Promise<RatingPeer[]> {
    const { data } = await supabase
        .from('participantes')
        .select('usuario_id, perfiles:usuario_id(id, nombre, avatar_url, genero)')
        .eq('plan_id', planId)
        .eq('estado', 'aceptado');

    return peersFromParticipanteRows(data ?? [], excludeUserId);
}

type ParticipanteProfileRow = {
    plan_id?: string;
    usuario_id: string;
    perfiles?: RatingPeer | RatingPeer[] | null;
};

function peersFromParticipanteRows(
    rows: ParticipanteProfileRow[],
    excludeUserId: string,
): RatingPeer[] {
    const peers: RatingPeer[] = [];
    for (const row of rows) {
        if (row.usuario_id === excludeUserId) continue;
        const raw = row.perfiles;
        const profile = Array.isArray(raw) ? raw[0] : raw;
        peers.push({
            id: (profile?.id as string) ?? (row.usuario_id as string),
            nombre: (profile?.nombre as string) || 'Usuario',
            avatar_url: (profile?.avatar_url as string | null) ?? null,
            genero: (profile?.genero as string | null) ?? null,
        });
    }
    return peers;
}

type FeedPersonCard = {
    id?: string;
    nombre?: string | null;
    avatar_url?: string | null;
    genero?: string | null;
    isCreator?: boolean;
};

type FeedPlanPeopleSnapshot = {
    joinedCount: number;
    esOrganizador: boolean;
    participantsList: FeedPersonCard[];
    host: FeedPersonCard | null;
};

function mergeRatingPeers(...lists: RatingPeer[][]): RatingPeer[] {
    const byId = new Map<string, RatingPeer>();
    for (const list of lists) {
        for (const peer of list) {
            if (!peer.id || byId.has(peer.id)) continue;
            byId.set(peer.id, peer);
        }
    }
    return [...byId.values()];
}

function peersFromFeedParticipantsList(
    list: FeedPersonCard[] | undefined,
    excludeUserId: string,
    excludeOrganizerId?: string | null,
): RatingPeer[] {
    const peers: RatingPeer[] = [];
    for (const raw of list ?? []) {
        const id = String(raw.id ?? '');
        if (!id || id === excludeUserId) continue;
        if (excludeOrganizerId && id === excludeOrganizerId) continue;
        peers.push({
            id,
            nombre: (raw.nombre as string) || 'Usuario',
            avatar_url: (raw.avatar_url as string | null) ?? null,
            genero: (raw.genero as string | null) ?? null,
        });
    }
    return peers;
}

function peerFromFeedCard(raw: FeedPersonCard | null | undefined): RatingPeer | null {
    const id = String(raw?.id ?? '');
    if (!id) return null;
    return {
        id,
        nombre: (raw?.nombre as string) || 'Usuario',
        avatar_url: (raw?.avatar_url as string | null) ?? null,
        genero: (raw?.genero as string | null) ?? null,
    };
}

/** Une participantes + feed (misma fuente que el detalle del plan) para no perder caras. */
function buildSearchPeers(input: {
    partRows: ParticipanteProfileRow[];
    userId: string;
    creadorId: string | null;
    creator: RatingPeer | null;
    isOrganizerPlan: boolean;
    organizer: RatingPeer | null;
    feed?: FeedPlanPeopleSnapshot;
}): RatingPeer[] {
    const organizerId = input.organizer?.id ?? null;
    const fromRows = peersFromParticipanteRows(input.partRows, input.userId).filter(
        (p) => !organizerId || p.id !== organizerId,
    );
    const fromFeed = peersFromFeedParticipantsList(
        input.feed?.participantsList,
        input.userId,
        input.isOrganizerPlan ? organizerId : null,
    );

    let merged = mergeRatingPeers(fromRows, fromFeed);

    if (!input.isOrganizerPlan) {
        const hostPeer = peerFromFeedCard(input.feed?.host);
        if (hostPeer && hostPeer.id !== input.userId) {
            merged = mergeRatingPeers(merged, [hostPeer]);
        }
    }

    return appendCreatorAsPeer(
        merged,
        input.creadorId,
        input.userId,
        input.creator,
        input.isOrganizerPlan,
    );
}

/** Cuenta asistentes reales: participantes aceptados + anfitrión si no está en la tabla. */
function effectiveAttendeeCount(
    acceptedUserIds: Set<string>,
    creadorId: string | null,
    creatorIsOrganizer: boolean,
): number {
    let count = acceptedUserIds.size;
    if (!creadorId) return count;
    if (creatorIsOrganizer) return count + 1;
    if (!acceptedUserIds.has(creadorId)) count += 1;
    return count;
}

/** Misma lógica de cupo que el feed (RPC get_feed_plan_people). */
function feedAttendeeHeadcount(
    joinedCount: number,
    esOrganizador: boolean,
    creadorId: string | null,
    acceptedUserIds: Set<string>,
): number {
    if (esOrganizador) return joinedCount + 1;
    if (creadorId && !acceptedUserIds.has(creadorId)) return joinedCount + 1;
    return joinedCount;
}

function appendCreatorAsPeer(
    peers: RatingPeer[],
    creadorId: string | null,
    userId: string,
    creator: RatingPeer | null,
    isOrganizerPlan: boolean,
): RatingPeer[] {
    if (!creadorId || creadorId === userId || isOrganizerPlan || !creator) return peers;
    if (peers.some((p) => p.id === creadorId)) return peers;
    return [...peers, creator];
}

async function ensureCreatorParticipanteRow(userId: string, planIds: string[]): Promise<void> {
    if (planIds.length === 0) return;
    const { data: me } = await supabase
        .from('perfiles')
        .select('es_organizador')
        .eq('id', userId)
        .maybeSingle();
    if (me?.es_organizador === true) return;

    await Promise.all(
        planIds.map((planId) =>
            supabase.from('participantes').upsert(
                { plan_id: planId, usuario_id: userId, estado: 'aceptado' },
                { onConflict: 'plan_id,usuario_id' },
            ),
        ),
    );
}

/** Guarda el plan en el historial personal (recuerdo). Idempotente. */
/** Suma el plan al historial (planes hechos) sin cerrar la sesión de valoración. */
export async function ensurePlanInHistory(
    userId: string,
    planId: string,
    opts?: { skipBump?: boolean },
): Promise<{ error: string | null; added: boolean }> {
    const { data: existing } = await supabase
        .from('historial_planes')
        .select('id')
        .eq('usuario_id', userId)
        .eq('plan_id', planId)
        .maybeSingle();
    if (existing) return { error: null, added: false };

    const { error } = await supabase.from('historial_planes').insert({ usuario_id: userId, plan_id: planId });
    if (error) {
        const { data: raced } = await supabase
            .from('historial_planes')
            .select('id')
            .eq('usuario_id', userId)
            .eq('plan_id', planId)
            .maybeSingle();
        if (raced) return { error: null, added: false };
        return { error: error.message, added: false };
    }

    if (!opts?.skipBump) {
        bumpPlansDoneOptimistic(userId, 1);
    }
    return { error: null, added: true };
}

export async function addPlanToHistory(userId: string, planId: string): Promise<{ error: string | null }> {
    // skipBump: el contador ya subió al pulsar «Sí, fui».
    const result = await ensurePlanInHistory(userId, planId, { skipBump: true });
    if (!result.error) {
        await AsyncStorage.setItem(ratingDoneKey(userId, planId), '1');
        await clearRatingSessionFlags(userId, planId);
        ratingDoneMemory.add(ratingMemoryId(userId, planId));
        void persistRatingClosure(userId, planId, false);
        invalidatePendingRatingsCache(userId);
    }
    return result;
}

async function fetchPendingRatingPlans(userId: string): Promise<PendingRatingPlan[]> {
    await runPlanLifecycleMaintenance();

    const [partsRes, createdRes] = await Promise.all([
        supabase
            .from('participantes')
            .select('plan_id, planes:plan_id(id, titulo, imagen_url, fecha_evento, categoria, creador_id)')
            .eq('usuario_id', userId)
            .eq('estado', 'aceptado'),
        supabase
            .from('planes')
            .select('id, titulo, imagen_url, fecha_evento, categoria, creador_id')
            .eq('creador_id', userId),
    ]);

    const candidates: {
        planId: string;
        titulo: string;
        imagen_url: string | null;
        fecha_evento: string;
        creadorId: string | null;
    }[] = [];
    const seen = new Set<string>();
    const orphanPartPlanIds: string[] = [];

    const pushCandidate = (plan: {
        id?: unknown;
        titulo?: unknown;
        imagen_url?: unknown;
        fecha_evento?: unknown;
        categoria?: unknown;
        creador_id?: unknown;
    } | null | undefined) => {
        if (!plan?.fecha_evento || isGroupOrChatPlan(plan)) return;
        const planId = String(plan.id ?? '');
        if (!planId || seen.has(planId)) return;
        const phase = getRatingPhase(String(plan.fecha_evento));
        if (phase !== 'waiting' && phase !== 'open') return;
        seen.add(planId);
        candidates.push({
            planId,
            titulo: (plan.titulo as string) || 'Plan',
            imagen_url: (plan.imagen_url as string | null) ?? null,
            fecha_evento: plan.fecha_evento as string,
            creadorId: (plan.creador_id as string | null) ?? null,
        });
    };

    for (const row of partsRes.data ?? []) {
        const raw = row.planes;
        const plan = Array.isArray(raw) ? raw[0] : raw;
        if (plan?.id && plan?.fecha_evento) {
            pushCandidate(plan);
            continue;
        }
        const planId = String(row.plan_id ?? '');
        if (!planId || seen.has(planId)) continue;
        orphanPartPlanIds.push(planId);
    }
    if (orphanPartPlanIds.length > 0) {
        const { data: orphanPlans } = await supabase
            .from('planes')
            .select('id, titulo, imagen_url, fecha_evento, categoria, creador_id')
            .in('id', [...new Set(orphanPartPlanIds)]);
        for (const plan of orphanPlans ?? []) {
            pushCandidate(plan);
        }
    }
    for (const plan of createdRes.data ?? []) {
        pushCandidate(plan);
    }

    if (candidates.length === 0) return [];

    // Si eres creador (no organizador) y falta tu fila en participantes,
    // la valoración no desbloquea. Repara en silencio.
    const partPlanIds = new Set((partsRes.data ?? []).map((r) => String(r.plan_id)));
    const toRepair = candidates.filter(
        (c) => c.creadorId && String(c.creadorId) === String(userId) && !partPlanIds.has(c.planId),
    );
    if (toRepair.length > 0) {
        await ensureCreatorParticipanteRow(userId, toRepair.map((c) => c.planId));
    }

    const planIds = candidates.map((c) => c.planId);
    const creatorIds = [...new Set(candidates.map((c) => c.creadorId).filter(Boolean))] as string[];

    const feedPeopleByPlan = new Map<string, FeedPlanPeopleSnapshot>();
    try {
        const feedRows = await attachFeedPlanPeople(
            candidates.map((c) => ({ id: c.planId, creador_id: c.creadorId ?? '' })),
            { keepNonFeed: true },
        );
        for (const row of feedRows) {
            const id = String(row.id ?? '');
            if (!id) continue;
            feedPeopleByPlan.set(id, {
                joinedCount: Number(row.joinedCount) || 0,
                esOrganizador: row.es_organizador === true,
                participantsList: Array.isArray(row.participantsList)
                    ? (row.participantsList as FeedPersonCard[])
                    : [],
                host: (row.host as FeedPersonCard | null) ?? null,
            });
        }
    } catch {
        // El feed RPC puede fallar offline; seguimos con participantes locales.
    }

    const [
        { data: done },
        { data: allPartsRows },
        dismissedFlags,
        doneFlags,
        friendIds,
        coincidedIds,
        { data: creators },
        closedRes,
    ] = await Promise.all([
        supabase
            .from('valoraciones')
            .select('plan_id, evaluado_id')
            .eq('evaluador_id', userId)
            .in('plan_id', planIds),
        supabase
            .from('participantes')
            .select('plan_id, usuario_id, perfiles:usuario_id(id, nombre, avatar_url, genero)')
            .in('plan_id', planIds)
            .eq('estado', 'aceptado'),
        Promise.all(planIds.map(async (id) => [id, await isRatingDismissed(userId, id)] as const)),
        Promise.all(planIds.map(async (id) => [id, await isRatingFlowDone(userId, id)] as const)),
        getFriendIds(userId),
        getCoincidedUserIds(userId),
        creatorIds.length
            ? supabase.from('perfiles').select('id, nombre, avatar_url, es_organizador').in('id', creatorIds)
            : Promise.resolve({ data: [] as Array<{ id: string; nombre: string | null; avatar_url: string | null; es_organizador: boolean | null }> }),
        supabase
            .from('cierres_valoracion')
            .select('plan_id, skipped')
            .eq('usuario_id', userId)
            .in('plan_id', planIds),
    ]);

    const partsByPlan = new Map<string, ParticipanteProfileRow[]>();
    for (const row of allPartsRows ?? []) {
        const planId = row.plan_id as string;
        const list = partsByPlan.get(planId) ?? [];
        list.push(row as ParticipanteProfileRow);
        partsByPlan.set(planId, list);
    }

    const creatorById = new Map(
        (creators ?? []).map((row) => [
            row.id as string,
            {
                id: row.id as string,
                nombre: (row.nombre as string) || 'Organizador',
                avatar_url: (row.avatar_url as string | null) ?? null,
                es_organizador: row.es_organizador === true,
            },
        ]),
    );

    const dismissed = new Set(dismissedFlags.filter(([, d]) => d).map(([id]) => id));
    const flowDone = new Set(doneFlags.filter(([, d]) => d).map(([id]) => id));
    for (const row of closedRes?.data ?? []) {
        const pid = String(row.plan_id);
        flowDone.add(pid);
        if (row.skipped) dismissed.add(pid);
        // Rehidrata memoria local tras logout en otro dispositivo.
        ratingDoneMemory.add(ratingMemoryId(userId, pid));
        void AsyncStorage.setItem(ratingDoneKey(userId, pid), '1');
        if (row.skipped) {
            ratingSkipMemory.add(ratingMemoryId(userId, pid));
            void AsyncStorage.setItem(ratingSkipKey(userId, pid), '1');
        }
    }
    const rated = new Set((done ?? []).map((r) => `${r.plan_id}:${r.evaluado_id}`));

    const needsFof = candidates.some((c) => {
        const rows = partsByPlan.get(c.planId) ?? [];
        const creator = c.creadorId ? creatorById.get(c.creadorId) ?? null : null;
        const isOrganizerPlan = creator?.es_organizador === true && creator.id !== userId;
        const withCreator = buildSearchPeers({
            partRows: rows,
            userId,
            creadorId: c.creadorId,
            creator,
            isOrganizerPlan,
            organizer: isOrganizerPlan && creator
                ? { id: creator.id, nombre: creator.nombre, avatar_url: creator.avatar_url }
                : null,
            feed: feedPeopleByPlan.get(c.planId),
        });
        return withCreator.length > MAX_FACE_PEERS;
    });
    const fofIds = needsFof ? await getFriendOfFriendIds(userId, friendIds) : new Set<string>();

    const result: PendingRatingPlan[] = [];

    candidates.forEach((c) => {
        if (dismissed.has(c.planId) || flowDone.has(c.planId)) return;
        const creator = c.creadorId ? creatorById.get(c.creadorId) ?? null : null;
        const isOrganizerPlan = creator?.es_organizador === true && creator.id !== userId;
        const organizer: RatingPeer | null = isOrganizerPlan && creator
            ? { id: creator.id, nombre: creator.nombre, avatar_url: creator.avatar_url }
            : null;
        const organizerRated = organizer ? rated.has(`${c.planId}:${organizer.id}`) : true;

        const partRows = partsByPlan.get(c.planId) ?? [];
        const acceptedIds = new Set(partRows.map((row) => row.usuario_id as string));
        const feedSnap = feedPeopleByPlan.get(c.planId);
        const attendeeCount = Math.max(
            effectiveAttendeeCount(
                acceptedIds,
                c.creadorId,
                creator?.es_organizador === true,
            ),
            feedSnap
                ? feedAttendeeHeadcount(
                      feedSnap.joinedCount,
                      feedSnap.esOrganizador,
                      c.creadorId,
                      acceptedIds,
                  )
                : 0,
        );
        if (attendeeCount < 2) return;

        const searchPeers = buildSearchPeers({
            partRows,
            userId,
            creadorId: c.creadorId,
            creator,
            isOrganizerPlan,
            organizer,
            feed: feedSnap,
        });
        const hasOrgPending = isOrganizerPlan && !organizerRated;
        if (!isOrganizerPlan && searchPeers.length === 0) return;
        if (isOrganizerPlan && searchPeers.length === 0 && !hasOrgPending) return;

        const compactPeople = searchPeers.length > MAX_FACE_PEERS;
        const peerRankIds = rankPeerIds(searchPeers, friendIds, fofIds, coincidedIds);
        const ratedIds = searchPeers.filter((p) => rated.has(`${c.planId}:${p.id}`)).map((p) => p.id);
        const peers = visibleRatingPeers(searchPeers, new Set(ratedIds), peerRankIds);
        const peoplePending = Math.max(0, searchPeers.length - ratedIds.length);
        const orgPending = isOrganizerPlan && !organizerRated ? 1 : 0;
        const pendingCount = peoplePending + orgPending;

        const phase = getRatingPhase(c.fecha_evento) as 'waiting' | 'open';

        result.push({
            planId: c.planId,
            titulo: c.titulo,
            imagen_url: c.imagen_url,
            fecha_evento: c.fecha_evento,
            phase,
            unlockAt: getRatingsUnlockMs(c.fecha_evento) ?? 0,
            peers,
            searchPeers,
            peerRankIds,
            ratedIds,
            pendingCount,
            totalPeers: searchPeers.length,
            compactPeople,
            organizer,
            organizerRated,
        });
    });

    return result.sort((a, b) => {
        if (a.phase !== b.phase) return a.phase === 'open' ? -1 : 1;
        return a.unlockAt - b.unlockAt;
    });
}

/** Planes terminados pendientes de flujo de valoración (mín. 2 personas). */
export async function getPendingRatingPlans(
    userId: string,
    opts?: { force?: boolean },
): Promise<PendingRatingPlan[]> {
    return cacheGetOrFetch(
        pendingRatingsKey(userId),
        PENDING_RATINGS_TTL_MS,
        () => fetchPendingRatingPlans(userId),
        opts,
    );
}

export async function countOpenRatings(userId: string): Promise<number> {
    const plans = await getPendingRatingPlans(userId);
    return plans.filter((p) => p.phase === 'open').length;
}

/** Planes pendientes de valorar (espera + abiertos), indexados por planId. */
export function getPendingRatingPlanMap(
    plans: PendingRatingPlan[],
): Record<string, PendingRatingPlan> {
    const map: Record<string, PendingRatingPlan> = {};
    for (const p of plans) {
        if (p.phase === 'open' || p.phase === 'waiting') map[p.planId] = p;
    }
    return map;
}

export async function fetchPendingRatingPlanMap(
    userId: string,
    opts?: { force?: boolean },
): Promise<Record<string, PendingRatingPlan>> {
    const plans = await getPendingRatingPlans(userId, opts);
    return getPendingRatingPlanMap(plans);
}

/** Planes con valoración abierta (fase open), indexados por planId. */
export async function getOpenRatingPlanMap(
    userId: string,
    opts?: { force?: boolean },
): Promise<Record<string, PendingRatingPlan>> {
    const plans = await getPendingRatingPlans(userId, opts);
    const map: Record<string, PendingRatingPlan> = {};
    for (const p of plans) {
        if (p.phase === 'open') map[p.planId] = p;
    }
    return map;
}

export async function getPendingRatingForPlan(
    userId: string,
    planId: string,
    opts?: { force?: boolean },
): Promise<PendingRatingPlan | null> {
    const plans = await getPendingRatingPlans(userId, opts);
    return plans.find((p) => p.planId === planId && (p.phase === 'open' || p.phase === 'waiting')) ?? null;
}

export async function getOpenRatingForPlan(
    userId: string,
    planId: string,
    opts?: { force?: boolean },
): Promise<PendingRatingPlan | null> {
    const plans = await getPendingRatingPlans(userId, opts);
    return plans.find((p) => p.planId === planId && p.phase === 'open') ?? null;
}

/** Etiqueta de aspecto según género (sin “/a”). */
export function getAspectLabel(
    kind: 'pos' | 'neg',
    key: string,
    genero: string | null | undefined,
    t: (k: string) => string,
): string {
    const orgKey = kind === 'pos' ? `ratings.orgPos.${key}` : `ratings.orgNeg.${key}`;
    const orgLabel = t(orgKey);
    if (orgLabel && orgLabel !== orgKey) return orgLabel;

    const gender =
        genero === 'femenino' ? 'f' : genero === 'masculino' ? 'm' : 'n';
    const gendered = t(`ratings.${kind}.${key}.${gender}`);
    if (gendered && gendered !== `ratings.${kind}.${key}.${gender}`) return gendered;
    const fallback = t(`ratings.${kind}.${key}`);
    return fallback !== `ratings.${kind}.${key}` ? fallback : key;
}

export async function submitValoracion(params: {
    planId: string;
    evaluadorId: string;
    evaluadoId: string;
    draft: RatingDraft;
    tipo?: RatingTargetTipo;
}): Promise<{ error: string | null }> {
    const { planId, evaluadorId, evaluadoId, draft } = params;
    const tipo: RatingTargetTipo = params.tipo ?? 'persona';

    if (evaluadorId === evaluadoId) return { error: 'self_rating' };
    if (tipo === 'organizacion') {
        if (!isOrganizerDraftComplete(draft)) return { error: 'incomplete' };
    } else if (!isPersonDraftComplete(draft)) {
        if (draft.asistencia !== false) return { error: 'incomplete' };
    }

    const asistencia = tipo === 'organizacion' ? true : draft.asistencia === false ? false : true;
    const posAllowed = new Set<string>(
        tipo === 'organizacion' ? ORGANIZER_POSITIVE_ASPECTS : POSITIVE_ASPECTS,
    );
    const negAllowed = new Set<string>(
        tipo === 'organizacion' ? ORGANIZER_NEGATIVE_ASPECTS : NEGATIVE_ASPECTS,
    );
    const pos = (draft.aspectos_positivos || [])
        .filter((a) => posAllowed.has(a))
        .filter((a, i, arr) => arr.indexOf(a) === i)
        .slice(0, MAX_ASPECTS);
    const neg = (draft.aspectos_negativos || [])
        .filter((a) => negAllowed.has(a))
        .filter((a, i, arr) => arr.indexOf(a) === i)
        .slice(0, MAX_ASPECTS);

    const rpcArgs = {
        p_plan_id: planId,
        p_evaluado_id: evaluadoId,
        p_asistencia: asistencia,
        p_puntuacion_general: asistencia ? draft.puntuacion_general : null,
        p_repetiria_experiencia: asistencia
            ? draft.repetiria_experiencia ?? (tipo === 'organizacion' ? repetiriaFromStars(draft.puntuacion_general) : null)
            : null,
        p_aspectos_positivos: asistencia ? pos : [],
        p_aspectos_negativos: asistencia ? neg : [],
        p_tipo: tipo,
    };

    const { data: rpcData, error: rpcError } = await supabase.rpc('guardar_valoracion', rpcArgs);
    if (!rpcError) {
        const result = rpcData as { ok?: boolean; error?: string } | null;
        if (result && typeof result === 'object' && 'ok' in result) {
            if (!result.ok) {
                console.warn('[submitValoracion] rpc rejected', result.error);
                return { error: result.error || 'rpc_rejected' };
            }
        }
        // Optimistic: invalidar caches instantáneamente para que el botón de valorar desaparezca
        invalidatePendingRatingsCache(evaluadorId);
        invalidatePlanDetailCache(planId);
        void import('./stats').then(({ invalidateUserStatsCache }) => invalidateUserStatsCache(evaluadoId));
        void import('./screenCaches').then(({ screenCacheKey, cacheInvalidate }) => {
            cacheInvalidate(screenCacheKey.feedSnapshot);
        });
        return { error: null };
    }

    if (tipo === 'organizacion') {
        return { error: rpcError.message };
    }

    // Fallback: update si ya existe esa pareja, si no insert
    const payload = {
        plan_id: planId,
        evaluador_id: evaluadorId,
        evaluado_id: evaluadoId,
        asistencia,
        puntuacion_general: asistencia ? draft.puntuacion_general : null,
        repetiria_experiencia: asistencia
            ? draft.repetiria_experiencia ?? (tipo === 'organizacion' ? repetiriaFromStars(draft.puntuacion_general) : null)
            : null,
        aspectos_positivos: asistencia ? pos : ([] as string[]),
        aspectos_negativos: asistencia ? neg : ([] as string[]),
        motivos_seguridad: [] as string[],
        incidencia_seguridad: false,
    };

    const { data: existing } = await supabase
        .from('valoraciones')
        .select('id')
        .eq('plan_id', planId)
        .eq('evaluador_id', evaluadorId)
        .eq('evaluado_id', evaluadoId)
        .maybeSingle();

    if (existing?.id) {
        const { error: updateError } = await supabase
            .from('valoraciones')
            .update({
                asistencia: payload.asistencia,
                puntuacion_general: payload.puntuacion_general,
                repetiria_experiencia: payload.repetiria_experiencia,
                aspectos_positivos: payload.aspectos_positivos,
                aspectos_negativos: payload.aspectos_negativos,
            })
            .eq('id', existing.id);
        if (!updateError) {
            invalidatePendingRatingsCache(evaluadorId);
            return { error: null };
        }
        console.warn('[submitValoracion]', { rpcError: rpcError.message, updateError });
        return { error: updateError.message || rpcError.message };
    }

    const { error: insertError } = await supabase.from('valoraciones').insert(payload);
    if (!insertError) {
        invalidatePendingRatingsCache(evaluadorId);
        return { error: null };
    }

    console.warn('[submitValoracion]', { rpcError: rpcError.message, insertError });
    return { error: insertError.message || rpcError.message };
}

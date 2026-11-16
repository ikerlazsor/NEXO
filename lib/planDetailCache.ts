import { parseGenero, type Genero } from './profileFields';
import type { PendingRatingPlan } from './ratings';
import { getAuthUser } from './auth';
import { getCoincidedUserIds } from './coincidences';
import { FEED_CACHE_KEY } from './feedCache';
import { feedFitPercent } from './feedAffinity';
import { getFriends } from './friends';
import { fetchGuestPlanDetail } from './guestFeed';
import { getOrganizerFollowStats } from './organizer';
import { withEndedPlanPresentation } from './planLifecycle';
import { prefetchPairAffinity } from './pairAffinityCache';
import { formatPlanPeople, isAcceptedParticipant, mapEstadoToMembership, type Membership } from './participants';
import { getMyProfile, getPublicProfileCards, profileCardsFromRows } from './profileData';
import { EMPTY_STATS, getUserStats, type UserStats } from './stats';
import { supabase } from './supabase';
import { diskGet, diskSet } from './diskCache';
import { cacheGetStale, cacheInvalidate, cacheInvalidatePrefix, cacheIsFresh, cacheSet } from './ttlCache';
import { userProfileKey } from './userProfileCache';

export const PLAN_DETAIL_TTL_MS = 90_000;
const PLAN_DETAIL_DISK_MS = 3 * 24 * 60 * 60 * 1000;
export const planDetailKey = (id: string) => `planDetail:${id}`;

export function rememberPlanDetailDisk(planId: string, snap: PlanDetailSnapshot): void {
    void diskSet(planDetailKey(planId), snap);
}

/** Cold start: la ficha del plan aparece con lo último visto, sin esperar a la red. */
export async function hydratePlanDetailDisk(planId: string): Promise<PlanDetailSnapshot | null> {
    const key = planDetailKey(planId);
    const mem = cacheGetStale<PlanDetailSnapshot>(key);
    if (mem?.plan) return mem;
    const snap = await diskGet<PlanDetailSnapshot>(key, PLAN_DETAIL_DISK_MS);
    if (!snap?.plan) return null;
    cacheSet(key, snap, PLAN_DETAIL_TTL_MS);
    return snap;
}

export type PlanDetailPlanRow = {
    id: string;
    titulo: string;
    imagen_url: string | null;
    categoria: string;
    tipo_deporte: string | null;
    solo_chicas?: boolean;
    modo_privado?: boolean;
    fecha_evento: string | null;
    nombre_ubicacion: string | null;
    latitud: number | null;
    longitud: number | null;
    maximo_participantes: number;
    creador_id: string;
    requiere_aprobacion: boolean;
    descripcion: string | null;
    chat_eliminado_en?: string | null;
    imagenes_url?: string[] | null;
    recurrencia?: { freq?: string; paused?: boolean } | null;
    es_organizador?: boolean;
};

export type PlanDetailParticipant = {
    id: string;
    nombre: string;
    avatar_url?: string | null;
    isCreator?: boolean;
    ambientes_preferidos?: string[] | null;
    etiquetas?: string[] | null;
    genero?: string | null;
};

export type PlanDetailSnapshot = {
    plan: PlanDetailPlanRow;
    participants: PlanDetailParticipant[];
    joinedCount: number;
    creator: PlanDetailParticipant | null;
    creatorStats: UserStats;
    membership: Membership;
    friendIds: string[];
    coincidedIds: string[];
    isSaved: boolean;
    currentUserGenero: Genero | null;
    openRating: PendingRatingPlan | null;
    currentUserId: string | null;
    organizerFollowers?: number | null;
    /** Porcentaje de compatibilidad precargado desde el feed */
    fitPct?: number | null;
    /** Semilla del feed: no debe bloquear el fetch completo (auth, guardados, amigos…). */
    partial?: boolean;
    /**
     * `participants` trae a todos los unidos (fetch completo), no la muestra de avatares
     * del feed (get_feed_plan_people recorta la lista). Sin esto, el feed pisaba la
     * lista completa del detalle y solo se veían 8 integrantes.
     */
    participantsComplete?: boolean;
};

/** True si la lista cubre a todos los unidos (y por tanto puede sustituir a otra). */
function listCoversJoined(list: unknown[] | null | undefined, joinedCount: number | null | undefined): boolean {
    const total = Number(joinedCount);
    if (!Number.isFinite(total)) return false;
    return (list?.length ?? 0) >= total;
}

/**
 * Integrantes que ya conocemos del plan (detalle o semilla del feed).
 * El chat los usa para no enseñar «0» mientras va a buscarlos a red.
 */
export function peekPlanMembers(planId: string): Array<{
    id: string;
    nombre: string;
    avatar_url: string | null;
    isCreator: boolean;
    genero?: string | null;
}> {
    if (!planId) return [];
    const snap = cacheGetStale<PlanDetailSnapshot>(planDetailKey(planId));
    if (!snap) return [];
    const byId = new Map<string, { id: string; nombre: string; avatar_url: string | null; isCreator: boolean; genero?: string | null }>();
    const push = (p: PlanDetailParticipant | null | undefined, isCreator: boolean) => {
        const id = p?.id ? String(p.id) : '';
        if (!id || byId.has(id)) return;
        byId.set(id, {
            id,
            nombre: p?.nombre ?? '',
            avatar_url: p?.avatar_url ?? null,
            isCreator,
            genero: p?.genero ?? null,
        });
    };
    push(snap.creator, true);
    for (const p of snap.participants ?? []) push(p, p?.isCreator === true);
    return [...byId.values()];
}

/** Semilla rápida desde el feed (antes de navegar / al scrollear). */
export function seedPlanDetailFromFeed(
    plan: Record<string, unknown>,
    opts?: {
        membership?: Membership;
        friendIds?: string[];
        coincidedIds?: string[];
        currentUserId?: string | null;
        currentUserGenero?: string | null;
        isSaved?: boolean;
        fitPct?: number | null;
    },
): void {
    try {
    const id = String(plan.id ?? '');
    if (!id) return;
    const key = planDetailKey(id);
    const existing = cacheGetStale<PlanDetailSnapshot>(key);

    const resolveFitPct = (): number | null => {
        if (opts?.fitPct != null) return opts.fitPct;
        if (existing?.fitPct != null) return existing.fitPct;
        const uid = opts?.currentUserId ?? existing?.currentUserId ?? null;
        const genero = opts?.currentUserGenero ?? existing?.currentUserGenero ?? null;
        if (!uid || !genero) return null;
        const feedTaste = cacheGetStale<{ feedTaste?: { personalityTags?: string[]; viewerAge?: number | null } }>(
            FEED_CACHE_KEY,
        )?.feedTaste;
        const tags = feedTaste?.personalityTags;
        if (!tags?.length) return null;
        try {
            return feedFitPercent(
                {
                    categoria: (plan.categoria as string) ?? existing?.plan.categoria,
                    tipo_deporte: (plan.tipo_deporte as string | null) ?? existing?.plan.tipo_deporte ?? null,
                    fecha_evento: (plan.fecha_evento as string | null) ?? existing?.plan.fecha_evento ?? null,
                    solo_chicas: !!(plan.solo_chicas ?? existing?.plan.solo_chicas),
                },
                {
                    personalityTags: tags,
                    viewerAge: feedTaste?.viewerAge ?? null,
                    viewerGenero: genero,
                },
                id,
            );
        } catch {
            return null;
        }
    };

    // No pisar un detalle completo ya cargado… salvo gente / membership / fit frescos del feed.
    if (existing && !existing.partial && cacheIsFresh(key)) {
        const fitPct = resolveFitPct();
        const membershipChanged = !!(opts?.membership && opts.membership !== existing.membership);
        const fitChanged = fitPct != null && fitPct !== existing.fitPct;
        const feedPeople = (Array.isArray(plan.participantsList)
            ? plan.participantsList
            : []) as PlanDetailParticipant[];
        const feedJoined = Number(plan.joinedCount);
        const countChanged = Number.isFinite(feedJoined) && feedJoined !== existing.joinedCount;
        // La lista del feed solo puede sustituir a la del detalle si no la recorta.
        const canReplaceList =
            feedPeople.length > 0 &&
            (!existing.participantsComplete || listCoversJoined(feedPeople, feedJoined)) &&
            feedPeople.map((p) => String(p.id)).join(',') !==
                (existing.participants ?? []).map((p) => String(p.id)).join(',');
        if (membershipChanged || fitChanged || canReplaceList || countChanged) {
            const nextParticipants = canReplaceList ? feedPeople : existing.participants;
            const nextJoined = Number.isFinite(feedJoined)
                ? feedJoined
                : Math.max(existing.joinedCount ?? 0, (nextParticipants ?? []).length);
            cacheSet(
                key,
                {
                    ...existing,
                    membership: opts?.membership ?? existing.membership,
                    fitPct: fitPct ?? existing.fitPct,
                    participants: nextParticipants,
                    joinedCount: nextJoined,
                    participantsComplete: listCoversJoined(nextParticipants, nextJoined),
                    partial: false,
                },
                PLAN_DETAIL_TTL_MS,
            );
        }
        return;
    }

    const participantsList = (Array.isArray(plan.participantsList) ? plan.participantsList : []) as PlanDetailParticipant[];
    const host = (plan.host as PlanDetailParticipant | undefined)
        ?? participantsList.find((p) => p.isCreator)
        ?? participantsList[0]
        ?? null;
    const joinedCount = Number(plan.joinedCount) || participantsList.length || 0;
    const membership = opts?.membership ?? existing?.membership ?? 'none';
    const creatorId = String(plan.creador_id ?? host?.id ?? '');

    // Si ya precargamos el perfil del host, pintar estrellas / tags / followers al instante.
    let creator = host;
    let creatorStats = existing?.creatorStats ?? EMPTY_STATS;
    let organizerFollowers = existing?.organizerFollowers ?? null;
    if (creatorId) {
        const peek = cacheGetStale<{
            userProfile?: {
                nombre?: string | null;
                avatar_url?: string | null;
                ambientes_preferidos?: string[] | null;
                etiquetas?: string[] | null;
                genero?: string | null;
            };
            stats?: UserStats;
            followersCount?: number;
        }>(userProfileKey(creatorId));
        if (peek?.stats && peek.stats !== EMPTY_STATS && (peek.stats.numeroValoraciones > 0 || peek.stats.valoracionMedia > 0)) {
            creatorStats = peek.stats;
        } else if (peek?.stats) {
            creatorStats = peek.stats;
        }
        if (typeof peek?.followersCount === 'number') {
            organizerFollowers = peek.followersCount;
        }
        if (peek?.userProfile && creator) {
            creator = {
                ...creator,
                nombre: peek.userProfile.nombre ?? creator.nombre,
                avatar_url: peek.userProfile.avatar_url ?? creator.avatar_url,
                ambientes_preferidos:
                    peek.userProfile.ambientes_preferidos ?? creator.ambientes_preferidos ?? null,
                etiquetas: peek.userProfile.etiquetas ?? creator.etiquetas ?? null,
                genero: peek.userProfile.genero ?? creator.genero ?? null,
            };
        }
    }

    const snap: PlanDetailSnapshot = {
        plan: {
            id,
            titulo: String(plan.titulo ?? ''),
            imagen_url: (plan.imagen_url as string | null) ?? null,
            categoria: String(plan.categoria ?? ''),
            tipo_deporte: (plan.tipo_deporte as string | null) ?? null,
            solo_chicas: !!plan.solo_chicas,
            modo_privado: !!plan.modo_privado,
            fecha_evento: (plan.fecha_evento as string | null) ?? null,
            nombre_ubicacion: (plan.nombre_ubicacion as string | null) ?? null,
            latitud:
                plan.latitud == null || plan.latitud === ''
                    ? null
                    : Number.isFinite(Number(plan.latitud))
                      ? Number(plan.latitud)
                      : null,
            longitud:
                plan.longitud == null || plan.longitud === ''
                    ? null
                    : Number.isFinite(Number(plan.longitud))
                      ? Number(plan.longitud)
                      : null,
            maximo_participantes: Number(plan.maximo_participantes) || 5,
            creador_id: creatorId,
            requiere_aprobacion: !!plan.requiere_aprobacion,
            descripcion: (plan.descripcion as string | null) ?? null,
            chat_eliminado_en: (plan.chat_eliminado_en as string | null) ?? null,
            imagenes_url: Array.isArray(plan.imagenes_url) ? (plan.imagenes_url as string[]) : undefined,
            es_organizador: plan.es_organizador === true,
        },
        participants: participantsList,
        joinedCount,
        participantsComplete: listCoversJoined(participantsList, joinedCount),
        creator,
        creatorStats,
        membership,
        friendIds: opts?.friendIds ?? existing?.friendIds ?? [],
        coincidedIds: opts?.coincidedIds ?? existing?.coincidedIds ?? [],
        isSaved: opts?.isSaved ?? existing?.isSaved ?? false,
        currentUserGenero: parseGenero(opts?.currentUserGenero ?? existing?.currentUserGenero),
        openRating: null,
        currentUserId: opts?.currentUserId ?? existing?.currentUserId ?? null,
        organizerFollowers,
        fitPct: resolveFitPct(),
        partial: true,
    };

    cacheSet(key, snap, PLAN_DETAIL_TTL_MS);

    // Precarga afinidad + stats del creador para pintar al instante en detalle.
    const viewerId = opts?.currentUserId ?? existing?.currentUserId ?? null;
    if (creatorId) {
        void import('./stats').then(({ getUserStats }) => {
            void getUserStats(creatorId);
        });
    }
    if (viewerId && creatorId && viewerId !== creatorId) {
        const friendSet = opts?.friendIds ?? existing?.friendIds ?? [];
        void prefetchPairAffinity(viewerId, creatorId, {
            isFriends: friendSet.includes(creatorId),
        });
    }
    } catch (e) {
        if (__DEV__) console.warn('seedPlanDetailFromFeed', e);
    }
}

const prefetchInflight = new Set<string>();
const prefetchJobs = new Map<string, Promise<void>>();
const prefetchGen = new Map<string, number>();

/** Si el scroll ya pidió este detalle, la pantalla puede esperar esa misma petición. */
export function planDetailPrefetchJob(planId: string): Promise<void> | null {
    return prefetchJobs.get(planId) ?? null;
}

/** Tras editar portada / fecha / sitio: la ficha no debe esperar los 90s de TTL. */
export function patchPlanDetailFromEdit(
    planId: string,
    patch: Partial<PlanDetailPlanRow> & Record<string, unknown>,
): void {
    if (!planId) return;
    const key = planDetailKey(planId);
    const existing = cacheGetStale<PlanDetailSnapshot>(key);
    prefetchGen.set(planId, (prefetchGen.get(planId) ?? 0) + 1);
    prefetchInflight.delete(planId);
    prefetchJobs.delete(planId);
    if (!existing?.plan) {
        seedPlanDetailFromFeed({ id: planId, ...patch });
        return;
    }
    const nextPlan: PlanDetailPlanRow = { ...existing.plan };
    for (const [field, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        (nextPlan as Record<string, unknown>)[field] = value;
    }
    cacheSet(
        key,
        {
            ...existing,
            plan: nextPlan,
            // loadPlan aplica esto ya y sigue descargando el detalle completo.
            partial: true,
        },
        PLAN_DETAIL_TTL_MS,
    );
}

/** Invalida detalle cacheado (p. ej. tras unirse/salir) para forzar refetch. */
export function invalidatePlanDetailCache(planId: string): void {
    if (!planId) return;
    cacheInvalidate(planDetailKey(planId));
    prefetchGen.set(planId, (prefetchGen.get(planId) ?? 0) + 1);
    prefetchInflight.delete(planId);
    prefetchJobs.delete(planId);
}

/** Tras cambiar foto/intereses del perfil: ningún detalle de plan debe quedar con datos viejos. */
export function invalidateAllPlanDetailCaches(): void {
    cacheInvalidatePrefix('planDetail:');
    prefetchGen.clear();
    prefetchInflight.clear();
    prefetchJobs.clear();
}

/** Si el visitante es el creador, usa su perfil privado (intereses/foto) y no el recorte público cacheado. */
export function overlayOwnCreatorProfile<T extends {
    id?: string;
    nombre?: string | null;
    avatar_url?: string | null;
    ambientes_preferidos?: string[] | null;
    etiquetas?: string[] | null;
    genero?: string | null;
}>(
    creator: T | null | undefined,
    myProfile: {
        nombre?: string | null;
        avatar_url?: string | null;
        ambientes_preferidos?: string[] | null;
        etiquetas?: string[] | null;
        genero?: string | null;
    } | null | undefined,
    currentUserId: string | null | undefined,
    creatorId: string,
): T | null | undefined {
    if (!myProfile || !currentUserId || currentUserId !== creatorId) return creator;
    return {
        ...(creator as T),
        id: (creator?.id ?? creatorId) as T['id'],
        nombre: myProfile.nombre ?? creator?.nombre,
        avatar_url: myProfile.avatar_url ?? creator?.avatar_url ?? null,
        ambientes_preferidos: myProfile.ambientes_preferidos ?? creator?.ambientes_preferidos ?? [],
        etiquetas: myProfile.etiquetas ?? creator?.etiquetas ?? [],
        genero: myProfile.genero ?? creator?.genero ?? null,
    };
}

/** Precarga en red del detalle. Devuelve promesa para poder esperar (p. ej. al abrir desde push). */
export function prefetchPlanDetail(planId: string): Promise<void> {
    if (!planId) return Promise.resolve();
    const existing = cacheGetStale<PlanDetailSnapshot>(planDetailKey(planId));
    if (
        existing &&
        !existing.partial &&
        (existing.participantsComplete === true ||
            listCoversJoined(existing.participants, existing.joinedCount)) &&
        cacheIsFresh(planDetailKey(planId))
    ) {
        return Promise.resolve();
    }
    const running = prefetchJobs.get(planId);
    if (running) return running;

    const gen = prefetchGen.get(planId) ?? 0;
    prefetchInflight.add(planId);
    let work!: Promise<void>;
    work = (async () => {
        try {
            const user = await getAuthUser();
            if (!user) {
                const guest = await fetchGuestPlanDetail(planId);
                if (!guest || (prefetchGen.get(planId) ?? 0) !== gen) return;
                const list = guest.participants.map((p) => ({
                    ...p,
                    nombre: p.nombre ?? 'Usuario',
                }));
                const creatorProfile = guest.creator
                    ? { ...guest.creator, nombre: guest.creator.nombre ?? 'Usuario' }
                    : list.find((p) => p.isCreator) ?? null;
                const creatorId =
                    (typeof guest.plan.creador_id === 'string' && guest.plan.creador_id) ||
                    guest.creator?.id ||
                    null;
                const follow =
                    guest.plan.es_organizador === true && creatorId
                        ? await getOrganizerFollowStats(creatorId)
                        : { followers: undefined as number | undefined, following: false };
                if ((prefetchGen.get(planId) ?? 0) !== gen) return;
                cacheSet(
                    planDetailKey(planId),
                    {
                        plan: guest.plan as PlanDetailPlanRow,
                        participants: list,
                        joinedCount: guest.joinedCount,
                        participantsComplete: listCoversJoined(list, guest.joinedCount),
                        creator: creatorProfile,
                        creatorStats: EMPTY_STATS,
                        membership: 'none',
                        friendIds: [],
                        coincidedIds: [],
                        isSaved: false,
                        currentUserGenero: null,
                        openRating: null,
                        currentUserId: null,
                        organizerFollowers: follow.followers,
                        partial: false,
                    },
                    PLAN_DETAIL_TTL_MS,
                );
                return;
            }
            const rpc = await supabase.rpc('get_plan_detail', { p_plan_id: planId });
            let planRow: PlanDetailPlanRow | null = null;
            let acceptedIds: string[] = [];
            let publicProfiles = [] as Awaited<ReturnType<typeof getPublicProfileCards>>;
            if (!rpc.error && rpc.data && typeof rpc.data === 'object') {
                const raw = rpc.data as { plan?: unknown; acceptedIds?: unknown; profiles?: unknown };
                if (raw.plan && typeof raw.plan === 'object' && typeof (raw.plan as { id?: unknown }).id === 'string') {
                    planRow = withEndedPlanPresentation(raw.plan as PlanDetailPlanRow & {
                        titulo_cierre?: string | null;
                        imagen_cierre?: string | null;
                    });
                    acceptedIds = Array.isArray(raw.acceptedIds)
                        ? raw.acceptedIds.filter((id): id is string => typeof id === 'string')
                        : [];
                    publicProfiles = profileCardsFromRows(raw.profiles);
                }
            }
            if (!planRow) {
                const { data: fallbackRow, error } = await supabase
                    .from('planes')
                    .select(
                        'id, titulo, titulo_cierre, imagen_url, imagen_cierre, imagenes_url, recurrencia, categoria, tipo_deporte, solo_chicas, modo_privado, fecha_evento, nombre_ubicacion, latitud, longitud, maximo_participantes, creador_id, requiere_aprobacion, descripcion, chat_eliminado_en',
                    )
                    .eq('id', planId)
                    .maybeSingle();
                if (error || !fallbackRow) return;
                planRow = withEndedPlanPresentation(fallbackRow as PlanDetailPlanRow & {
                    titulo_cierre?: string | null;
                    imagen_cierre?: string | null;
                });
                const partsRes = await supabase
                    .from('participantes')
                    .select('usuario_id, estado')
                    .eq('plan_id', planId)
                    .eq('estado', 'aceptado');
                acceptedIds = (partsRes.data || [])
                    .filter((p: { estado: string }) => isAcceptedParticipant(p.estado))
                    .map((p: { usuario_id: string }) => p.usuario_id);
                publicProfiles = await getPublicProfileCards([planRow.creador_id, ...acceptedIds]);
            }
            if ((prefetchGen.get(planId) ?? 0) !== gen) return;

            const [myPartRes, savedRes, friendsData, coincidedSet, stats, followStats, myProfileRes] =
                await Promise.all([
                    supabase
                        .from('participantes')
                        .select('estado')
                        .eq('plan_id', planId)
                        .eq('usuario_id', user.id)
                        .maybeSingle(),
                    supabase
                        .from('planes_guardados')
                        .select('plan_id')
                        .eq('plan_id', planId)
                        .eq('usuario_id', user.id)
                        .maybeSingle(),
                    getFriends(user.id),
                    getCoincidedUserIds(user.id),
                    getUserStats(planRow.creador_id),
                    getOrganizerFollowStats(planRow.creador_id),
                    getMyProfile(),
                ]);

            if ((prefetchGen.get(planId) ?? 0) !== gen) return;

            const profileMap = new Map(publicProfiles.map((profile) => [profile.id, profile]));
            if (!profileMap.has(planRow.creador_id)) {
                const extra = await getPublicProfileCards([planRow.creador_id]);
                extra.forEach((profile) => profileMap.set(profile.id, profile));
            }
            const creatorData = overlayOwnCreatorProfile(
                profileMap.get(planRow.creador_id),
                myProfileRes.data,
                user.id,
                planRow.creador_id,
            );
            const people = formatPlanPeople({
                creadorId: planRow.creador_id,
                creatorProfile: creatorData
                    ? { ...creatorData, nombre: creatorData.nombre ?? 'Usuario' }
                    : null,
                acceptedUserIds: acceptedIds,
                profileOf: (id) => {
                    const prof = profileMap.get(id);
                    return prof ? { ...prof, nombre: prof.nombre ?? 'Usuario' } : undefined;
                },
            });

            const nextMembership = myPartRes.data?.estado
                ? (mapEstadoToMembership(myPartRes.data.estado) ?? 'none')
                : 'none';

            const snap: PlanDetailSnapshot = {
                plan: {
                    ...withEndedPlanPresentation(planRow as PlanDetailPlanRow & {
                        titulo_cierre?: string | null;
                        imagen_cierre?: string | null;
                    }),
                    es_organizador: people.es_organizador,
                },
                participants: people.participantsList,
                joinedCount: people.joinedCount,
                // Fetch completo: la lista trae a todos los aceptados.
                participantsComplete: true,
                creator: people.host,
                creatorStats: stats,
                membership: nextMembership,
                friendIds: friendsData.map((f) => f.id),
                coincidedIds: [...coincidedSet],
                isSaved: !!savedRes.data,
                currentUserGenero: parseGenero(myProfileRes.data?.genero),
                openRating: null,
                currentUserId: user?.id ?? null,
                organizerFollowers: followStats.followers,
                partial: false,
            };
            cacheSet(planDetailKey(planId), snap, PLAN_DETAIL_TTL_MS);
        } catch {
            /* ignore */
        } finally {
            prefetchInflight.delete(planId);
            if (prefetchJobs.get(planId) === work) prefetchJobs.delete(planId);
        }
    })();
    prefetchJobs.set(planId, work);
    return work;
}

/** Espera a que el detalle deje de ser partial / esté en caché (con tope de tiempo). */
export function waitForPlanDetail(planId: string, maxMs = 1200): Promise<void> {
    if (!planId) return Promise.resolve();
    const key = planDetailKey(planId);
    const ready = () => {
        const snap = cacheGetStale<PlanDetailSnapshot>(key);
        return !!(snap && !snap.partial);
    };
    if (ready()) return Promise.resolve();
    return new Promise((resolve) => {
        const start = Date.now();
        const tick = () => {
            if (ready() || Date.now() - start >= maxMs) {
                resolve();
                return;
            }
            setTimeout(tick, 40);
        };
        tick();
    });
}

/** Tras unirse / salir / aceptar invitación: la ficha no debe quedar desfasada. */
export function patchPlanDetailMembership(
    planId: string,
    membership: Membership | 'none',
    opts?: {
        bumpJoined?: boolean;
        dropJoined?: boolean;
        /** Añadir burbuja al instante (p. ej. yo al unirme). */
        addParticipant?: PlanDetailParticipant | null;
        /** Quitar burbuja al salir. */
        removeParticipantId?: string | null;
        /** Sustituir lista entera (p. ej. desde el feed ya actualizado). */
        participants?: PlanDetailParticipant[] | null;
        joinedCount?: number;
    },
): void {
    if (!planId) return;
    const key = planDetailKey(planId);
    const existing = cacheGetStale<PlanDetailSnapshot>(key);
    if (!existing) return;
    const nextMembership = (membership === 'none' ? 'none' : membership) as Membership;
    let joinedDelta = 0;
    if (opts?.bumpJoined && nextMembership === 'joined' && existing.membership !== 'joined') {
        joinedDelta = 1;
    } else if (
        opts?.dropJoined &&
        existing.membership === 'joined' &&
        nextMembership !== 'joined'
    ) {
        joinedDelta = -1;
    }

    let participants = existing.participants ?? [];
    let participantsComplete = existing.participantsComplete;
    if (opts?.participants) {
        participants = opts.participants;
        participantsComplete = listCoversJoined(opts.participants, opts.joinedCount ?? existing.joinedCount);
    } else {
        if (opts?.removeParticipantId) {
            const rid = String(opts.removeParticipantId);
            participants = participants.filter((p) => String(p.id) !== rid);
        }
        if (opts?.addParticipant?.id) {
            const aid = String(opts.addParticipant.id);
            if (!participants.some((p) => String(p.id) === aid)) {
                participants = [...participants, { ...opts.addParticipant, isCreator: false }];
            }
        }
    }

    const nextJoined =
        opts?.joinedCount != null
            ? Math.max(0, opts.joinedCount)
            : Math.max(0, (existing.joinedCount ?? 0) + joinedDelta);

    cacheSet(
        key,
        {
            ...existing,
            membership: nextMembership,
            participants,
            joinedCount: nextJoined,
            participantsComplete: participantsComplete && listCoversJoined(participants, nextJoined),
            // partial: true fuerza loadPlan a completar en red si hace falta,
            // pero la UI ya pinta la burbuja al instante.
            partial: true,
        },
        PLAN_DETAIL_TTL_MS,
    );
}

/** Si el feed ya tiene más gente, el detalle no debe quedarse con la lista vieja. */
export function syncPlanDetailParticipantsFromFeed(
    planId: string,
    feedParticipants: PlanDetailParticipant[] | undefined | null,
    joinedCount?: number,
): void {
    if (!planId || !feedParticipants?.length) return;
    const key = planDetailKey(planId);
    const existing = cacheGetStale<PlanDetailSnapshot>(key);
    if (!existing) return;
    const prevIds = (existing.participants ?? []).map((p) => String(p.id)).join(',');
    const nextIds = feedParticipants.map((p) => String(p.id)).join(',');
    const nextJoined =
        joinedCount != null
            ? Math.max(0, joinedCount)
            : Math.max(existing.joinedCount ?? 0, feedParticipants.length);
    // La lista del feed es una muestra para avatares: no debe recortar la lista completa.
    const keepExistingList =
        existing.participantsComplete === true && !listCoversJoined(feedParticipants, nextJoined);
    if (
        (prevIds === nextIds || keepExistingList) &&
        nextJoined === existing.joinedCount
    ) {
        return;
    }
    cacheSet(
        key,
        {
            ...existing,
            participants: keepExistingList ? existing.participants : feedParticipants,
            joinedCount: nextJoined,
            participantsComplete: keepExistingList
                ? listCoversJoined(existing.participants, nextJoined)
                : listCoversJoined(feedParticipants, nextJoined),
            partial: existing.partial,
        },
        PLAN_DETAIL_TTL_MS,
    );
}

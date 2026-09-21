import { getAuthUser } from './auth';
import { getCoincidedUserIds } from './coincidences';
import { FEED_CACHE_KEY } from './feedCache';
import { feedFitPercent } from './feedAffinity';
import { getFriends } from './friends';
import { fetchGuestPlanDetail } from './guestFeed';
import { getOrganizerFollowStats } from './organizer';
import { prefetchPairAffinity } from './pairAffinityCache';
import { formatPlanPeople, isAcceptedParticipant, mapEstadoToMembership, type Membership } from './participants';
import { getMyProfile, getPublicProfileCards } from './profileData';
import { EMPTY_STATS, getUserStats, type UserStats } from './stats';
import { supabase } from './supabase';
import { cacheGetStale, cacheInvalidate, cacheInvalidatePrefix, cacheIsFresh, cacheSet } from './ttlCache';
import { userProfileKey } from './userProfileCache';

export const PLAN_DETAIL_TTL_MS = 90_000;
export const planDetailKey = (id: string) => `planDetail:${id}`;

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
    currentUserGenero: string | null;
    openRating: null;
    currentUserId: string | null;
    organizerFollowers?: number | null;
    /** Porcentaje de compatibilidad precargado desde el feed */
    fitPct?: number | null;
    /** Semilla del feed: no debe bloquear el fetch completo (auth, guardados, amigos…). */
    partial?: boolean;
};

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

    // No pisar un detalle completo ya cargado (salvo membership / fitPct frescos).
    if (existing && !existing.partial && cacheIsFresh(key)) {
        const fitPct = resolveFitPct();
        const membershipChanged = !!(opts?.membership && opts.membership !== existing.membership);
        const fitChanged = fitPct != null && fitPct !== existing.fitPct;
        if (membershipChanged || fitChanged) {
            cacheSet(
                key,
                {
                    ...existing,
                    membership: opts?.membership ?? existing.membership,
                    fitPct: fitPct ?? existing.fitPct,
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
            latitud: Number.isFinite(Number(plan.latitud)) ? Number(plan.latitud) : null,
            longitud: Number.isFinite(Number(plan.longitud)) ? Number(plan.longitud) : null,
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
        creator,
        creatorStats,
        membership,
        friendIds: opts?.friendIds ?? existing?.friendIds ?? [],
        coincidedIds: opts?.coincidedIds ?? existing?.coincidedIds ?? [],
        isSaved: opts?.isSaved ?? existing?.isSaved ?? false,
        currentUserGenero: opts?.currentUserGenero ?? existing?.currentUserGenero ?? null,
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
const prefetchGen = new Map<string, number>();

/** Invalida detalle cacheado (p. ej. tras unirse/salir) para forzar refetch. */
export function invalidatePlanDetailCache(planId: string): void {
    if (!planId) return;
    cacheInvalidate(planDetailKey(planId));
    prefetchGen.set(planId, (prefetchGen.get(planId) ?? 0) + 1);
    prefetchInflight.delete(planId);
}

/** Tras cambiar foto/intereses del perfil: ningún detalle de plan debe quedar con datos viejos. */
export function invalidateAllPlanDetailCaches(): void {
    cacheInvalidatePrefix('planDetail:');
    prefetchGen.clear();
    prefetchInflight.clear();
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
    if (existing && !existing.partial && cacheIsFresh(planDetailKey(planId))) {
        return Promise.resolve();
    }
    if (prefetchInflight.has(planId)) {
        return waitForPlanDetail(planId, 1400);
    }

    const gen = prefetchGen.get(planId) ?? 0;
    prefetchInflight.add(planId);
    const work = (async () => {
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
            const { data: planRow, error } = await supabase
                .from('planes')
                .select(
                    'id, titulo, imagen_url, imagenes_url, recurrencia, categoria, tipo_deporte, solo_chicas, modo_privado, fecha_evento, nombre_ubicacion, latitud, longitud, maximo_participantes, creador_id, requiere_aprobacion, descripcion, chat_eliminado_en',
                )
                .eq('id', planId)
                .maybeSingle();
            if (error || !planRow) return;
            if ((prefetchGen.get(planId) ?? 0) !== gen) return;

            const [partsRes, myPartRes, savedRes, friendsData, coincidedSet, stats, followStats, myProfileRes] =
                await Promise.all([
                    supabase
                        .from('participantes')
                        .select('usuario_id, estado')
                        .eq('plan_id', planId)
                        .eq('estado', 'aceptado'),
                    user
                        ? supabase
                              .from('participantes')
                              .select('estado')
                              .eq('plan_id', planId)
                              .eq('usuario_id', user.id)
                              .maybeSingle()
                        : Promise.resolve({ data: null }),
                    user
                        ? supabase
                              .from('planes_guardados')
                              .select('plan_id')
                              .eq('plan_id', planId)
                              .eq('usuario_id', user.id)
                              .maybeSingle()
                        : Promise.resolve({ data: null }),
                    user ? getFriends(user.id) : Promise.resolve([]),
                    user ? getCoincidedUserIds(user.id) : Promise.resolve(new Set<string>()),
                    getUserStats(planRow.creador_id),
                    getOrganizerFollowStats(planRow.creador_id),
                    user
                        ? getMyProfile()
                        : Promise.resolve({ data: null }),
                ]);

            if ((prefetchGen.get(planId) ?? 0) !== gen) return;

            const accepted = (partsRes.data || []).filter((p: { estado: string }) =>
                isAcceptedParticipant(p.estado),
            );
            const profileIds = [
                planRow.creador_id,
                ...accepted.map((p: { usuario_id: string }) => p.usuario_id),
            ];
            const publicProfiles = await getPublicProfileCards(profileIds);
            const profileMap = new Map(publicProfiles.map((profile) => [profile.id, profile]));
            const creatorData = overlayOwnCreatorProfile(
                profileMap.get(planRow.creador_id),
                myProfileRes.data,
                user?.id,
                planRow.creador_id,
            );
            const people = formatPlanPeople({
                creadorId: planRow.creador_id,
                creatorProfile: creatorData
                    ? { ...creatorData, nombre: creatorData.nombre ?? 'Usuario' }
                    : null,
                acceptedUserIds: accepted.map((p: { usuario_id: string }) => p.usuario_id),
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
                    ...(planRow as PlanDetailPlanRow),
                    es_organizador: people.es_organizador,
                },
                participants: people.participantsList,
                joinedCount: people.joinedCount,
                creator: people.host,
                creatorStats: stats,
                membership: nextMembership,
                friendIds: friendsData.map((f) => f.id),
                coincidedIds: [...coincidedSet],
                isSaved: !!savedRes.data,
                currentUserGenero: (myProfileRes.data?.genero as string | null) ?? null,
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
        }
    })();
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
    opts?: { bumpJoined?: boolean; dropJoined?: boolean },
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
    cacheSet(
        key,
        {
            ...existing,
            membership: nextMembership,
            joinedCount: Math.max(0, (existing.joinedCount ?? 0) + joinedDelta),
            partial: false,
        },
        PLAN_DETAIL_TTL_MS,
    );
}

import { getAuthUser } from './auth';
import { getCoincidedUserIds } from './coincidences';
import { getFriends } from './friends';
import { isAcceptedParticipant, mapEstadoToMembership, type Membership } from './participants';
import { EMPTY_STATS, getUserStats, type UserStats } from './stats';
import { cacheGetStale, cacheInvalidate, cacheIsFresh, cacheSet } from './ttlCache';
import { supabase } from './supabase';

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
    /** Semilla del feed: no debe bloquear el fetch completo (auth, guardados, amigos…). */
    partial?: boolean;
};

/** Semilla rápida desde el feed (antes de navegar / al scrollear). */
export function seedPlanDetailFromFeed(
    plan: Record<string, unknown>,
    opts?: { membership?: Membership },
): void {
    const id = String(plan.id ?? '');
    if (!id) return;
    const key = planDetailKey(id);
    const existing = cacheGetStale<PlanDetailSnapshot>(key);
    // No pisar un detalle completo ya cargado (salvo que traigamos membership más reciente).
    if (existing && !existing.partial && cacheIsFresh(key)) {
        if (opts?.membership && opts.membership !== existing.membership) {
            cacheSet(
                key,
                { ...existing, membership: opts.membership, partial: false },
                PLAN_DETAIL_TTL_MS,
            );
        }
        return;
    }

    const participantsList = (Array.isArray(plan.participantsList) ? plan.participantsList : []) as PlanDetailParticipant[];
    const creator = participantsList.find((p) => p.isCreator) ?? participantsList[0] ?? null;
    const joinedCount = Number(plan.joinedCount) || participantsList.length || 0;
    const membership = opts?.membership ?? existing?.membership ?? 'none';

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
            latitud: plan.latitud != null ? Number(plan.latitud) : null,
            longitud: plan.longitud != null ? Number(plan.longitud) : null,
            maximo_participantes: Number(plan.maximo_participantes) || 5,
            creador_id: String(plan.creador_id ?? ''),
            requiere_aprobacion: !!plan.requiere_aprobacion,
            descripcion: (plan.descripcion as string | null) ?? null,
            chat_eliminado_en: (plan.chat_eliminado_en as string | null) ?? null,
        },
        participants: participantsList,
        joinedCount,
        creator,
        creatorStats: EMPTY_STATS,
        membership,
        friendIds: existing?.friendIds ?? [],
        coincidedIds: existing?.coincidedIds ?? [],
        isSaved: existing?.isSaved ?? false,
        currentUserGenero: existing?.currentUserGenero ?? null,
        openRating: null,
        currentUserId: existing?.currentUserId ?? null,
        partial: true,
    };
    cacheSet(key, snap, PLAN_DETAIL_TTL_MS);
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

/** Precarga en red del detalle (best-effort, sin bloquear UI). */
export function prefetchPlanDetail(planId: string): void {
    if (!planId || prefetchInflight.has(planId)) return;
    const existing = cacheGetStale<PlanDetailSnapshot>(planDetailKey(planId));
    if (existing && !existing.partial && cacheIsFresh(planDetailKey(planId))) return;

    const gen = prefetchGen.get(planId) ?? 0;
    prefetchInflight.add(planId);
    void (async () => {
        try {
            const user = await getAuthUser();
            const { data: planRow, error } = await supabase
                .from('planes')
                .select(
                    'id, titulo, imagen_url, categoria, tipo_deporte, solo_chicas, modo_privado, fecha_evento, nombre_ubicacion, latitud, longitud, maximo_participantes, creador_id, requiere_aprobacion, descripcion, chat_eliminado_en',
                )
                .eq('id', planId)
                .maybeSingle();
            if (error || !planRow) return;
            if ((prefetchGen.get(planId) ?? 0) !== gen) return;

            const [partsRes, creatorRes, myPartRes, savedRes, friendsData, coincidedSet, stats, myProfileRes] =
                await Promise.all([
                    supabase
                        .from('participantes')
                        .select('usuario_id, estado, perfiles:usuario_id(id, nombre, avatar_url, genero)')
                        .eq('plan_id', planId)
                        .eq('estado', 'aceptado'),
                    supabase
                        .from('perfiles')
                        .select('id, nombre, avatar_url, ambientes_preferidos, etiquetas, genero')
                        .eq('id', planRow.creador_id)
                        .maybeSingle(),
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
                    user
                        ? supabase.from('perfiles').select('genero').eq('id', user.id).maybeSingle()
                        : Promise.resolve({ data: null }),
                ]);

            if ((prefetchGen.get(planId) ?? 0) !== gen) return;

            const accepted = (partsRes.data || []).filter((p: { estado: string }) =>
                isAcceptedParticipant(p.estado),
            );
            const creatorProfile: PlanDetailParticipant | null = creatorRes.data
                ? { ...creatorRes.data, isCreator: true }
                : null;
            const list: PlanDetailParticipant[] = [];
            if (creatorProfile) list.push(creatorProfile);
            accepted.forEach((p: { perfiles?: PlanDetailParticipant | PlanDetailParticipant[] | null }) => {
                const prof = Array.isArray(p.perfiles) ? p.perfiles[0] : p.perfiles;
                if (prof && prof.id !== planRow.creador_id) {
                    list.push({ ...prof, isCreator: false });
                }
            });

            const nextMembership = myPartRes.data?.estado
                ? (mapEstadoToMembership(myPartRes.data.estado) ?? 'none')
                : 'none';

            const snap: PlanDetailSnapshot = {
                plan: planRow as PlanDetailPlanRow,
                participants: list,
                joinedCount: accepted.length,
                creator: creatorProfile,
                creatorStats: stats,
                membership: nextMembership,
                friendIds: friendsData.map((f) => f.id),
                coincidedIds: [...coincidedSet],
                isSaved: !!savedRes.data,
                currentUserGenero: (myProfileRes.data?.genero as string | null) ?? null,
                openRating: null,
                currentUserId: user?.id ?? null,
                partial: false,
            };
            cacheSet(planDetailKey(planId), snap, PLAN_DETAIL_TTL_MS);
        } catch {
            /* ignore */
        } finally {
            prefetchInflight.delete(planId);
        }
    })();
}

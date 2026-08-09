import AsyncStorage from '@react-native-async-storage/async-storage';
import { getRatingPhase, getRatingsUnlockMs, isGroupOrChatPlan, runPlanLifecycleMaintenance } from './planLifecycle';
import { supabase } from './supabase';
import { cacheGetOrFetch, cacheInvalidate, cacheInvalidatePrefix } from './ttlCache';

const PENDING_RATINGS_TTL_MS = 45_000;

function pendingRatingsKey(userId: string) {
    return `pendingRatings:${userId}`;
}

export function invalidatePendingRatingsCache(userId?: string): void {
    if (userId) {
        cacheInvalidate(pendingRatingsKey(userId));
        cacheInvalidate(`notifCount:${userId}`);
        return;
    }
    cacheInvalidatePrefix('pendingRatings:');
    cacheInvalidatePrefix('notifCount:');
}

const RATING_SKIP_PREFIX = '@nexo_rating_skip:';
const RATING_STARTED_PREFIX = '@nexo_rating_started:';
const RATING_DONE_PREFIX = '@nexo_rating_done:';

function ratingSkipKey(userId: string, planId: string) {
    return `${RATING_SKIP_PREFIX}${userId}:${planId}`;
}

function ratingStartedKey(userId: string, planId: string) {
    return `${RATING_STARTED_PREFIX}${userId}:${planId}`;
}

function ratingDoneKey(userId: string, planId: string) {
    return `${RATING_DONE_PREFIX}${userId}:${planId}`;
}

/** Marca que el usuario no asistió: sin historial ni “planes hechos”. */
export async function dismissRatingWithoutHistory(userId: string, planId: string): Promise<void> {
    await AsyncStorage.multiSet([
        [ratingSkipKey(userId, planId), new Date().toISOString()],
        [ratingStartedKey(userId, planId), ''],
        [ratingDoneKey(userId, planId), '1'],
    ]);
    await supabase.from('historial_planes').delete().eq('usuario_id', userId).eq('plan_id', planId);
    invalidatePendingRatingsCache(userId);
}

export async function isPlanAttendanceDismissed(userId: string, planId: string): Promise<boolean> {
    return isRatingDismissed(userId, planId);
}

/** Lote: evita N getItem al filtrar planes pasados en Mis planes. */
export async function getDismissedPlanIdSet(userId: string, planIds: string[]): Promise<Set<string>> {
    if (planIds.length === 0) return new Set();
    const pairs = await AsyncStorage.multiGet(planIds.map((id) => ratingSkipKey(userId, id)));
    const dismissed = new Set<string>();
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
    const v = await AsyncStorage.getItem(ratingSkipKey(userId, planId));
    return !!v;
}

async function isRatingFlowDone(userId: string, planId: string): Promise<boolean> {
    const v = await AsyncStorage.getItem(ratingDoneKey(userId, planId));
    return v === '1';
}

export async function hasRatingSessionStarted(userId: string, planId: string): Promise<boolean> {
    const v = await AsyncStorage.getItem(ratingStartedKey(userId, planId));
    return v === '1';
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

export const MAX_ASPECTS = 2;

export const STAR_LABEL_KEYS = [
    'ratings.star1',
    'ratings.star2',
    'ratings.star3',
    'ratings.star4',
    'ratings.star5',
] as const;

export type AspectPositivo = (typeof POSITIVE_ASPECTS)[number];
export type AspectNegativo = (typeof NEGATIVE_ASPECTS)[number];
/** Coincide con CHECK: si | indiferente | no */
export type Repetiria = 'si' | 'no' | 'indiferente';

export type RatingPeer = {
    id: string;
    nombre: string;
    avatar_url: string | null;
};

export type PendingRatingPlan = {
    planId: string;
    titulo: string;
    imagen_url: string | null;
    fecha_evento: string;
    phase: 'waiting' | 'open';
    unlockAt: number;
    peers: RatingPeer[];
    ratedIds: string[];
    pendingCount: number;
    totalPeers: number;
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

async function getAcceptedPeers(planId: string, excludeUserId: string): Promise<RatingPeer[]> {
    const { data } = await supabase
        .from('participantes')
        .select('usuario_id, perfiles:usuario_id(id, nombre, avatar_url)')
        .eq('plan_id', planId)
        .eq('estado', 'aceptado');

    const peers: RatingPeer[] = [];
    for (const row of data ?? []) {
        if (row.usuario_id === excludeUserId) continue;
        const raw = row.perfiles;
        const profile = Array.isArray(raw) ? raw[0] : raw;
        peers.push({
            id: (profile?.id as string) ?? (row.usuario_id as string),
            nombre: (profile?.nombre as string) || 'Usuario',
            avatar_url: (profile?.avatar_url as string | null) ?? null,
        });
    }
    return peers;
}

/** Guarda el plan en el historial personal (recuerdo). Idempotente. */
/** Suma el plan al historial (planes hechos) sin cerrar la sesión de valoración. */
export async function ensurePlanInHistory(userId: string, planId: string): Promise<{ error: string | null }> {
    const { error } = await supabase.from('historial_planes').upsert(
        { usuario_id: userId, plan_id: planId },
        { onConflict: 'usuario_id,plan_id', ignoreDuplicates: true },
    );
    if (!error) return { error: null };

    const { data: existing } = await supabase
        .from('historial_planes')
        .select('id')
        .eq('usuario_id', userId)
        .eq('plan_id', planId)
        .maybeSingle();
    if (existing) return { error: null };

    const { error: insertError } = await supabase
        .from('historial_planes')
        .insert({ usuario_id: userId, plan_id: planId });
    return { error: insertError?.message ?? error.message };
}

export async function addPlanToHistory(userId: string, planId: string): Promise<{ error: string | null }> {
    const result = await ensurePlanInHistory(userId, planId);
    if (!result.error) {
        await AsyncStorage.setItem(ratingDoneKey(userId, planId), '1');
        await clearRatingSessionFlags(userId, planId);
        invalidatePendingRatingsCache(userId);
    }
    return result;
}

async function fetchPendingRatingPlans(userId: string): Promise<PendingRatingPlan[]> {
    await runPlanLifecycleMaintenance();

    const { data: parts } = await supabase
        .from('participantes')
        .select('plan_id, planes:plan_id(id, titulo, imagen_url, fecha_evento, categoria)')
        .eq('usuario_id', userId)
        .eq('estado', 'aceptado');

    const candidates: { planId: string; titulo: string; imagen_url: string | null; fecha_evento: string }[] = [];
    for (const row of parts ?? []) {
        const raw = row.planes;
        const plan = Array.isArray(raw) ? raw[0] : raw;
        if (!plan?.fecha_evento || isGroupOrChatPlan(plan)) continue;
        const phase = getRatingPhase(plan.fecha_evento);
        if (phase !== 'waiting' && phase !== 'open') continue;
        candidates.push({
            planId: plan.id as string,
            titulo: (plan.titulo as string) || 'Plan',
            imagen_url: (plan.imagen_url as string | null) ?? null,
            fecha_evento: plan.fecha_evento as string,
        });
    }

    if (candidates.length === 0) return [];

    const planIds = candidates.map((c) => c.planId);

    const [{ data: done }, { data: allParts }, peerLists, dismissedFlags, doneFlags] = await Promise.all([
        supabase
            .from('valoraciones')
            .select('plan_id, evaluado_id')
            .eq('evaluador_id', userId)
            .in('plan_id', planIds),
        supabase
            .from('participantes')
            .select('plan_id')
            .in('plan_id', planIds)
            .eq('estado', 'aceptado'),
        Promise.all(candidates.map((c) => getAcceptedPeers(c.planId, userId))),
        Promise.all(planIds.map(async (id) => [id, await isRatingDismissed(userId, id)] as const)),
        Promise.all(planIds.map(async (id) => [id, await isRatingFlowDone(userId, id)] as const)),
    ]);

    const dismissed = new Set(dismissedFlags.filter(([, d]) => d).map(([id]) => id));
    const flowDone = new Set(doneFlags.filter(([, d]) => d).map(([id]) => id));
    const rated = new Set((done ?? []).map((r) => `${r.plan_id}:${r.evaluado_id}`));

    const countByPlan = new Map<string, number>();
    for (const row of allParts ?? []) {
        countByPlan.set(row.plan_id, (countByPlan.get(row.plan_id) ?? 0) + 1);
    }

    const result: PendingRatingPlan[] = [];

    candidates.forEach((c, i) => {
        // No ocultar solo por estar en historial: al confirmar asistencia ya se añade,
        // y la valoración debe seguir visible hasta terminar/omitir.
        if (dismissed.has(c.planId) || flowDone.has(c.planId)) return;
        if ((countByPlan.get(c.planId) ?? 0) < 2) return;

        const peers = peerLists[i];
        if (peers.length === 0) return;

        const ratedIds = peers.filter((p) => rated.has(`${c.planId}:${p.id}`)).map((p) => p.id);
        const pendingCount = peers.length - ratedIds.length;
        if (pendingCount <= 0) return;

        const phase = getRatingPhase(c.fecha_evento) as 'waiting' | 'open';

        result.push({
            planId: c.planId,
            titulo: c.titulo,
            imagen_url: c.imagen_url,
            fecha_evento: c.fecha_evento,
            phase,
            unlockAt: getRatingsUnlockMs(c.fecha_evento) ?? 0,
            peers,
            ratedIds,
            pendingCount,
            totalPeers: peers.length,
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

/** Planes con valoración abierta (fase open), indexados por planId. */
export async function getOpenRatingPlanMap(
    userId: string,
): Promise<Record<string, PendingRatingPlan>> {
    const plans = await getPendingRatingPlans(userId);
    const map: Record<string, PendingRatingPlan> = {};
    for (const p of plans) {
        if (p.phase === 'open') map[p.planId] = p;
    }
    return map;
}

export async function getOpenRatingForPlan(
    userId: string,
    planId: string,
): Promise<PendingRatingPlan | null> {
    const plans = await getPendingRatingPlans(userId);
    return plans.find((p) => p.planId === planId && p.phase === 'open') ?? null;
}

/** Etiqueta de aspecto según género (sin “/a”). */
export function getAspectLabel(
    kind: 'pos' | 'neg',
    key: string,
    genero: string | null | undefined,
    t: (k: string) => string,
): string {
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
}): Promise<{ error: string | null }> {
    const { planId, evaluadorId, evaluadoId, draft } = params;

    if (evaluadorId === evaluadoId) return { error: 'self_rating' };
    if (!isPersonDraftComplete(draft)) {
        if (draft.asistencia === false) {
            // ok
        } else {
            return { error: 'incomplete' };
        }
    }

    const asistencia = draft.asistencia === false ? false : true;
    const posAllowed = new Set<string>(POSITIVE_ASPECTS);
    const negAllowed = new Set<string>(NEGATIVE_ASPECTS);
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
        p_repetiria_experiencia: asistencia ? draft.repetiria_experiencia : null,
        p_aspectos_positivos: asistencia ? pos : [],
        p_aspectos_negativos: asistencia ? neg : [],
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
        if (asistencia) {
            void import('./push').then(({ notifyRated }) => notifyRated(evaluadoId, planId));
        }
        return { error: null };
    }

    // Fallback: update si ya existe esa pareja, si no insert
    const payload = {
        plan_id: planId,
        evaluador_id: evaluadorId,
        evaluado_id: evaluadoId,
        asistencia,
        puntuacion_general: asistencia ? draft.puntuacion_general : null,
        repetiria_experiencia: asistencia ? draft.repetiria_experiencia : null,
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
            if (asistencia) {
                void import('./push').then(({ notifyRated }) => notifyRated(evaluadoId, planId));
            }
            return { error: null };
        }
        console.warn('[submitValoracion]', { rpcError: rpcError.message, updateError });
        return { error: updateError.message || rpcError.message };
    }

    const { error: insertError } = await supabase.from('valoraciones').insert(payload);
    if (!insertError) {
        invalidatePendingRatingsCache(evaluadorId);
        if (asistencia) {
            void import('./push').then(({ notifyRated }) => notifyRated(evaluadoId, planId));
        }
        return { error: null };
    }

    console.warn('[submitValoracion]', { rpcError: rpcError.message, insertError });
    return { error: insertError.message || rpcError.message };
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getRatingPhase, getRatingsUnlockMs, isGroupOrChatPlan, runPlanLifecycleMaintenance } from './planLifecycle';
import { supabase } from './supabase';

const RATING_SKIP_PREFIX = '@nexo_rating_skip:';

function ratingSkipKey(userId: string, planId: string) {
    return `${RATING_SKIP_PREFIX}${userId}:${planId}`;
}

/** Marca el flujo como cerrado sin historial (p. ej. el plan no se hizo). */
export async function dismissRatingWithoutHistory(userId: string, planId: string): Promise<void> {
    await AsyncStorage.setItem(ratingSkipKey(userId, planId), new Date().toISOString());
}

async function isRatingDismissed(userId: string, planId: string): Promise<boolean> {
    const v = await AsyncStorage.getItem(ratingSkipKey(userId, planId));
    return !!v;
}

export const POSITIVE_ASPECTS = [
    'puntual',
    'amable',
    'divertido',
    'respetuoso',
    'buena_conversacion',
    'colaborador',
] as const;

export const NEGATIVE_ASPECTS = [
    'impuntual',
    'poco_respetuoso',
    'pasivo',
    'cancelo_tarde',
    'mal_ambiente',
] as const;

export type AspectPositivo = (typeof POSITIVE_ASPECTS)[number];
export type AspectNegativo = (typeof NEGATIVE_ASPECTS)[number];
export type Repetiria = 'si' | 'no' | 'tal_vez';

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

async function countAcceptedParticipants(planId: string): Promise<number> {
    const { count } = await supabase
        .from('participantes')
        .select('id', { count: 'exact', head: true })
        .eq('plan_id', planId)
        .eq('estado', 'aceptado');
    return count ?? 0;
}

/** Guarda el plan en el historial personal (recuerdo). Idempotente. */
export async function addPlanToHistory(userId: string, planId: string): Promise<{ error: string | null }> {
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

/** Planes terminados pendientes de flujo de valoración (no solo el creador). */
export async function getPendingRatingPlans(userId: string): Promise<PendingRatingPlan[]> {
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

    const [{ data: done }, { data: history }, counts] = await Promise.all([
        supabase
            .from('valoraciones')
            .select('plan_id, evaluado_id')
            .eq('evaluador_id', userId)
            .in('plan_id', planIds),
        supabase
            .from('historial_planes')
            .select('plan_id')
            .eq('usuario_id', userId)
            .in('plan_id', planIds),
        Promise.all(planIds.map((id) => countAcceptedParticipants(id))),
    ]);

    const dismissedFlags = await Promise.all(
        planIds.map(async (id) => [id, await isRatingDismissed(userId, id)] as const),
    );
    const dismissed = new Set(dismissedFlags.filter(([, d]) => d).map(([id]) => id));

    const inHistory = new Set((history ?? []).map((h) => h.plan_id as string));
    const rated = new Set((done ?? []).map((r) => `${r.plan_id}:${r.evaluado_id}`));

    const result: PendingRatingPlan[] = [];
    const peerLists = await Promise.all(candidates.map((c) => getAcceptedPeers(c.planId, userId)));

    candidates.forEach((c, i) => {
        if (inHistory.has(c.planId) || dismissed.has(c.planId)) return;

        // Solo 1 integrante: sin valoración ni historial
        if ((counts[i] ?? 0) < 2) return;

        const peers = peerLists[i];
        if (peers.length === 0) return;

        const ratedIds = peers.filter((p) => rated.has(`${c.planId}:${p.id}`)).map((p) => p.id);
        const pendingCount = peers.length - ratedIds.length;
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
        });
    });

    return result.sort((a, b) => {
        if (a.phase !== b.phase) return a.phase === 'open' ? -1 : 1;
        return a.unlockAt - b.unlockAt;
    });
}

export async function countOpenRatings(userId: string): Promise<number> {
    const plans = await getPendingRatingPlans(userId);
    return plans.filter((p) => p.phase === 'open').length;
}

export async function submitValoracion(params: {
    planId: string;
    evaluadorId: string;
    evaluadoId: string;
    draft: RatingDraft;
}): Promise<{ error: string | null }> {
    const { planId, evaluadorId, evaluadoId, draft } = params;

    const payload = !draft.asistencia
        ? {
              plan_id: planId,
              evaluador_id: evaluadorId,
              evaluado_id: evaluadoId,
              asistencia: false,
              puntuacion_general: null,
              repetiria_experiencia: null,
              aspectos_positivos: [],
              aspectos_negativos: [],
          }
        : (() => {
              if (draft.puntuacion_general < 1 || draft.puntuacion_general > 5) return null;
              if (!draft.repetiria_experiencia) return null;
              return {
                  plan_id: planId,
                  evaluador_id: evaluadorId,
                  evaluado_id: evaluadoId,
                  asistencia: true,
                  puntuacion_general: draft.puntuacion_general,
                  repetiria_experiencia: draft.repetiria_experiencia,
                  aspectos_positivos: draft.aspectos_positivos,
                  aspectos_negativos: draft.aspectos_negativos,
              };
          })();

    if (!payload) {
        if (!draft.asistencia) return { error: null };
        if (draft.puntuacion_general < 1 || draft.puntuacion_general > 5) return { error: 'invalid_score' };
        return { error: 'missing_repeat' };
    }

    const { error: upsertError } = await supabase.from('valoraciones').upsert(payload, {
        onConflict: 'plan_id,evaluador_id,evaluado_id',
    });
    if (!upsertError) return { error: null };

    const { error: insertError } = await supabase.from('valoraciones').insert(payload);
    return { error: insertError?.message ?? upsertError.message };
}

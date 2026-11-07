import { createPersistentQueue } from './persistentQueue';
import { getAuthUser } from './auth';
import { getIsOnline, subscribeNetwork } from './network';
import { withRetry } from './retry';
import { supabase } from './supabase';

const OUTBOX_KEY = '@nexo_offline_actions_v1';

export type OfflineAction =
    | {
        id: string;
        kind: 'join';
        planId: string;
        userId: string;
        estado: 'pendiente' | 'aceptado' | 'lista_espera';
        planTitle?: string | null;
        fechaEvento?: string | null;
        categoria?: string | null;
        locationName?: string | null;
        createdAt: string;
    }
    | {
        id: string;
        kind: 'leave';
        planId: string;
        userId: string;
        wasJoined: boolean;
        createdAt: string;
    }
    | {
        id: string;
        kind: 'save' | 'unsave';
        planId: string;
        userId: string;
        createdAt: string;
    };

let flushInflight: Promise<void> | null = null;
let networkHooked = false;
let outboxGeneration = 0;
const queue = createPersistentQueue<OfflineAction>(OUTBOX_KEY);

function isUniqueViolation(error: { code?: string; message?: string } | null | undefined): boolean {
    const code = String(error?.code || '');
    const msg = String(error?.message || '').toLowerCase();
    return code === '23505' || msg.includes('duplicate') || msg.includes('unique');
}

export async function discardOfflineActions(): Promise<void> {
    outboxGeneration += 1;
    await queue.clear();
}

function ensureNetworkHook() {
    if (networkHooked) return;
    networkHooked = true;
    subscribeNetwork((online) => {
        if (online) void flushOfflineActions().catch(() => {});
    });
}

async function enqueue(action: OfflineAction): Promise<void> {
    ensureNetworkHook();
    await queue.update((q) => {
        // Only a repeated latest intent is redundant. save → unsave → save must
        // preserve the final save, as must join → leave → join.
        const family = (item: OfflineAction) => item.kind === 'save' || item.kind === 'unsave' ? 'save' : 'membership';
        const previous = [...q].reverse().find((item) => item.planId === action.planId && item.userId === action.userId && family(item) === family(action));
        const duplicate = previous?.kind === action.kind &&
            (previous.kind !== 'join' || action.kind !== 'join' || previous.estado === action.estado);
        return duplicate ? q : [...q, action];
    });
}

function newId(): string {
    return `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function enqueueJoinAction(
    action: Omit<Extract<OfflineAction, { kind: 'join' }>, 'id' | 'kind' | 'createdAt'> & { createdAt?: string },
): Promise<void> {
    await enqueue({
        ...action,
        id: newId(),
        kind: 'join',
        createdAt: action.createdAt || new Date().toISOString(),
    });
}

export async function enqueueLeaveAction(planId: string, userId: string, wasJoined: boolean): Promise<void> {
    await enqueue({
        id: newId(),
        kind: 'leave',
        planId,
        userId,
        wasJoined,
        createdAt: new Date().toISOString(),
    });
}

export async function enqueueSaveAction(planId: string, userId: string, saved: boolean): Promise<void> {
    await enqueue({
        id: newId(),
        kind: saved ? 'save' : 'unsave',
        planId,
        userId,
        createdAt: new Date().toISOString(),
    });
}

export async function persistJoin(input: {
    planId: string;
    userId: string;
    estado: 'pendiente' | 'aceptado' | 'lista_espera';
    planTitle?: string | null;
    fechaEvento?: string | null;
    categoria?: string | null;
    locationName?: string | null;
}): Promise<{ queued: boolean; error?: { message?: string } | null }> {
    ensureNetworkHook();
    if (!getIsOnline()) {
        await enqueueJoinAction(input);
        return { queued: true };
    }
    try {
        const { error } = await supabase.from('participantes').insert({
            plan_id: input.planId,
            usuario_id: input.userId,
            estado: input.estado,
        });
        if (!error || isUniqueViolation(error)) {
            const { clearPendingPlanInvitesForMember } = await import('./planInvites');
            void clearPendingPlanInvitesForMember(input.planId, input.userId);
            return { queued: false };
        }
        if (!getIsOnline()) {
            await enqueueJoinAction(input);
            return { queued: true };
        }
        return { queued: false, error };
    } catch (e) {
        if (!getIsOnline()) {
            await enqueueJoinAction(input);
            return { queued: true };
        }
        return { queued: false, error: e as { message?: string } };
    }
}

function isCapacityJoinError(error?: { message?: string } | null): boolean {
    const msg = String(error?.message || '').toLowerCase();
    return msg.includes('plan_full');
}

/** Si el aforo se llena entre medias, pasa a lista de espera en el mismo toque. */
export async function persistJoinWithWaitlistFallback(
    input: {
        planId: string;
        userId: string;
        estado: 'pendiente' | 'aceptado' | 'lista_espera';
        planTitle?: string | null;
        fechaEvento?: string | null;
        categoria?: string | null;
        locationName?: string | null;
    },
    allowWaitlist: boolean,
): Promise<{ queued: boolean; error?: { message?: string } | null; estado: 'pendiente' | 'aceptado' | 'lista_espera' }> {
    const first = await persistJoin(input);
    if (!first.error || input.estado !== 'aceptado' || !allowWaitlist || !isCapacityJoinError(first.error)) {
        return { ...first, estado: input.estado };
    }
    const retry = await persistJoin({ ...input, estado: 'lista_espera' });
    return { ...retry, estado: retry.error ? input.estado : 'lista_espera' };
}

export async function persistLeave(planId: string, userId: string, wasJoined: boolean): Promise<{ queued: boolean; error?: { message?: string } | null }> {
    ensureNetworkHook();
    if (!getIsOnline()) {
        await enqueueLeaveAction(planId, userId, wasJoined);
        return { queued: true };
    }
    const { error } = await supabase
        .from('participantes')
        .delete()
        .eq('plan_id', planId)
        .eq('usuario_id', userId);
    if (!error) return { queued: false };
    if (!getIsOnline()) {
        await enqueueLeaveAction(planId, userId, wasJoined);
        return { queued: true };
    }
    return { queued: false, error };
}

const saveStateListeners = new Set<(evt: { planId: string; saved: boolean }) => void>();

export function subscribeSaveState(listener: (evt: { planId: string; saved: boolean }) => void): () => void {
    saveStateListeners.add(listener);
    return () => {
        saveStateListeners.delete(listener);
    };
}

function emitSaveStateChange(planId: string, saved: boolean): void {
    saveStateListeners.forEach((listener) => {
        try {
            listener({ planId, saved });
        } catch {
            /* ignore */
        }
    });
}

export async function persistSave(planId: string, userId: string, saved: boolean): Promise<{ queued: boolean; error?: { message?: string } | null }> {
    ensureNetworkHook();
    // Emitir ya: card ↔ detalle ↔ guardados sin esperar a la red.
    emitSaveStateChange(planId, saved);
    try {
        void import('./planDetailCache').then(({ planDetailKey, PLAN_DETAIL_TTL_MS }) =>
            import('./ttlCache').then(({ cacheGetStale, cacheSet }) => {
                const key = planDetailKey(planId);
                const stale = cacheGetStale<{ isSaved?: boolean }>(key);
                if (stale) {
                    cacheSet(key, { ...stale, isSaved: saved }, PLAN_DETAIL_TTL_MS);
                }
            }),
        );
        void import('./screenCaches').then(({ screenCacheKey, ScreenCacheTTL }) =>
            import('./ttlCache').then(({ cacheGetStale, cacheSet }) => {
                const key = screenCacheKey.savedPlans(userId);
                const snap = cacheGetStale<{
                    savedPlans?: { id?: string }[];
                    membershipMap?: Record<string, unknown>;
                    currentUserGenero?: unknown;
                }>(key);
                if (!snap?.savedPlans) return;
                if (saved) return;
                cacheSet(
                    key,
                    {
                        ...snap,
                        savedPlans: snap.savedPlans.filter((p) => String(p.id) !== planId),
                    },
                    ScreenCacheTTL.savedPlans,
                );
            }),
        );
        void import('./feedCache').then(({ FEED_CACHE_KEY, FEED_CACHE_TTL_MS }) =>
            import('./ttlCache').then(({ cacheGetStale, cacheSet }) => {
                const snap = cacheGetStale<{ savedPlans?: string[] }>(FEED_CACHE_KEY);
                if (!snap?.savedPlans) return;
                const next = saved
                    ? (snap.savedPlans.includes(planId) ? snap.savedPlans : [...snap.savedPlans, planId])
                    : snap.savedPlans.filter((id) => id !== planId);
                cacheSet(FEED_CACHE_KEY, { ...snap, savedPlans: next }, FEED_CACHE_TTL_MS);
            }),
        );
    } catch {
        /* ignore */
    }
    if (!getIsOnline()) {
        await enqueueSaveAction(planId, userId, saved);
        return { queued: true };
    }
    const { error } = saved
        ? await supabase.from('planes_guardados').insert({ plan_id: planId, usuario_id: userId })
        : await supabase.from('planes_guardados').delete().eq('plan_id', planId).eq('usuario_id', userId);
    if (!error || (saved && isUniqueViolation(error))) {
        return { queued: false };
    }
    if (!getIsOnline()) {
        await enqueueSaveAction(planId, userId, saved);
        return { queued: true };
    }
    emitSaveStateChange(planId, !saved);
    return { queued: false, error };
}

export async function flushOfflineActions(): Promise<void> {
    ensureNetworkHook();
    if (!getIsOnline()) return;
    if (flushInflight) return flushInflight;

    flushInflight = (async () => {
        const generation = outboxGeneration;
        const q = await queue.read();
        if (!q.length) return;
        const remaining: OfflineAction[] = [];

        for (const [index, item] of q.entries()) {
            if (generation !== outboxGeneration) return;
            if (!getIsOnline()) {
                remaining.push(...q.slice(index));
                break;
            }
            let user;
            try {
                user = await getAuthUser();
            } catch {
                remaining.push(...q.slice(index));
                break;
            }
            if (generation !== outboxGeneration) return;
            if (!user || user.id !== item.userId) {
                remaining.push(item);
                continue;
            }
            try {
                if (item.kind === 'join') {
                    const { error } = await withRetry(async () => {
                        const res = await supabase.from('participantes').insert({
                            plan_id: item.planId,
                            usuario_id: item.userId,
                            estado: item.estado,
                        });
                        if (res.error && !isUniqueViolation(res.error)) throw res.error;
                        return res;
                    }, { retries: 2, baseMs: 400 });
                    if (error && !isUniqueViolation(error)) {
                        remaining.push(item);
                        continue;
                    }
                    if (generation !== outboxGeneration) return;
                    try {
                        const { clearPendingPlanInvitesForMember } = await import('./planInvites');
                        if (generation !== outboxGeneration) return;
                        void clearPendingPlanInvitesForMember(item.planId, item.userId);
                    } catch {
                        /* ignore */
                    }
                    try {
                        const { notifyPlanJoin, schedulePlanLifecycleReminders } = await import('./push');
                        if (generation !== outboxGeneration) return;
                        notifyPlanJoin(item.planId, item.estado);
                        if (item.estado === 'aceptado') {
                            void schedulePlanLifecycleReminders({
                                planId: item.planId,
                                planTitle: item.planTitle || '',
                                fechaEvento: item.fechaEvento,
                                categoria: item.categoria,
                                locationName: item.locationName,
                            });
                        }
                    } catch {
                        /* ignore */
                    }
                    continue;
                }

                if (item.kind === 'leave') {
                    const { error } = await supabase
                        .from('participantes')
                        .delete()
                        .eq('plan_id', item.planId)
                        .eq('usuario_id', item.userId);
                    if (error) {
                        remaining.push(item);
                        continue;
                    }
                    if (generation !== outboxGeneration) return;
                    if (item.wasJoined) {
                        const { promoteWaitlist } = await import('./participants');
                        if (generation !== outboxGeneration) return;
                        await promoteWaitlist(item.planId);
                    }
                    continue;
                }

                const { error } = item.kind === 'save'
                    ? await supabase.from('planes_guardados').insert({
                        plan_id: item.planId,
                        usuario_id: item.userId,
                    })
                    : await supabase.from('planes_guardados').delete()
                        .eq('plan_id', item.planId)
                        .eq('usuario_id', item.userId);
                if (error && !(item.kind === 'save' && isUniqueViolation(error))) {
                    remaining.push(item);
                }
            } catch {
                remaining.push(item);
            }
        }
        const completed = new Set(q.filter((item) => !remaining.includes(item)).map((item) => item.id));
        await queue.update((latest) => generation === outboxGeneration ? latest.filter((item) => !completed.has(item.id)) : latest);
    })().catch(() => {
        // Leave the persisted queue intact when local storage/session lookup fails.
    }).finally(() => {
        flushInflight = null;
    });

    return flushInflight;
}

ensureNetworkHook();

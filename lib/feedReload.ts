import { FEED_CACHE_KEY, FEED_CACHE_TTL_MS } from './feedCache';
import { cacheGetStale, cacheSet } from './ttlCache';

type Listener = () => void;

const homeRetapListeners = new Set<Listener>();
/** Avisar al feed (si está enfocado) para recargar en silencio sin depender solo del focus. */
const refreshSignalListeners = new Set<Listener>();
let feedNeedsRefresh = false;
/** Tras crear: recarga al volver sin esperar 450ms. */
let feedNeedsRefreshUrgent = false;
/** Sticky: sobrevive al fetch del feed para no pisar join/leave optimista. */
const stickyMembership: Record<string, { membership: string; at: number }> = {};
const stickyInviteClears: Record<string, number> = {};
/** Borrados: el edge delete puede tardar; el fetch no debe reaparecer el plan. */
const stickyPlanDeletes: Record<string, number> = {};
let optimisticPlan: Record<string, unknown> | null = null;
/** Se mantiene hasta que el fetch del feed confirme el plan (evita flash “solo mi plan”). */
let stickyCreatedPlan: Record<string, unknown> | null = null;

const STICKY_TTL_MS = 90_000;
const DELETE_STICKY_TTL_MS = 180_000;

function pruneSticky(): void {
    const now = Date.now();
    for (const [id, row] of Object.entries(stickyMembership)) {
        if (now - row.at > STICKY_TTL_MS) delete stickyMembership[id];
    }
    for (const [id, at] of Object.entries(stickyInviteClears)) {
        if (now - at > STICKY_TTL_MS) delete stickyInviteClears[id];
    }
    for (const [id, at] of Object.entries(stickyPlanDeletes)) {
        if (now - at > DELETE_STICKY_TTL_MS) delete stickyPlanDeletes[id];
    }
}

function emitFeedRefreshSignal(): void {
    refreshSignalListeners.forEach((listener) => {
        try {
            listener();
        } catch {
            // ignore listener errors
        }
    });
}

/** Casita en el feed: scroll al inicio + recarga manual. */
export function subscribeFeedHomeRetap(listener: Listener): () => void {
    homeRetapListeners.add(listener);
    return () => {
        homeRetapListeners.delete(listener);
    };
}

export function emitFeedHomeRetap(): void {
    homeRetapListeners.forEach((listener) => {
        try {
            listener();
        } catch {
            // ignore listener errors
        }
    });
}

/** Feed enfocado: recarga quieta cuando hay refresh urgente (p. ej. tras publicar). */
export function subscribeFeedRefreshSignal(listener: Listener): () => void {
    refreshSignalListeners.add(listener);
    return () => {
        refreshSignalListeners.delete(listener);
    };
}

/**
 * Tras crear/editar plan: marca el feed para recargar al volver a enfocarse.
 * No dispara recarga inmediata (evita freeze al cerrar el modal de crear).
 * Si `urgent`, avisa a listeners (el feed programa un fetch quieto si está visible).
 */
export function markFeedNeedsRefresh(opts?: { urgent?: boolean }): void {
    feedNeedsRefresh = true;
    if (opts?.urgent) {
        feedNeedsRefreshUrgent = true;
        emitFeedRefreshSignal();
    }
}

export function consumeFeedNeedsRefresh(): boolean {
    if (!feedNeedsRefresh) return false;
    feedNeedsRefresh = false;
    return true;
}

export function consumeFeedNeedsRefreshUrgent(): boolean {
    if (!feedNeedsRefreshUrgent) return false;
    feedNeedsRefreshUrgent = false;
    return true;
}

/** Unirse / salir / aceptar invitación: sticky hasta que el fetch confirme o expire. */
export function noteFeedMembershipPatch(planId: string, membership: string): void {
    if (!planId) return;
    pruneSticky();
    stickyMembership[planId] = { membership, at: Date.now() };
    feedNeedsRefresh = true;
}

/** Invitación resuelta (join / accept / reject): quitar chip de invitado en el feed. */
export function noteFeedInviteCleared(planId: string): void {
    if (!planId) return;
    pruneSticky();
    stickyInviteClears[planId] = Date.now();
    feedNeedsRefresh = true;
}

/** Parches actuales (no se borran: el fetch debe fusionarlos). */
export function takeFeedMembershipPatches(): Record<string, string> {
    pruneSticky();
    const out: Record<string, string> = {};
    for (const [id, row] of Object.entries(stickyMembership)) {
        out[id] = row.membership;
    }
    return out;
}

export function takeFeedInviteClears(): string[] {
    pruneSticky();
    return Object.keys(stickyInviteClears);
}

/** Fusiona sticky membership en un mapa del feed (none = borrar clave). */
export function mergeStickyMembershipMap<T extends string>(
    map: Record<string, T | undefined>,
): Record<string, T> {
    const patches = takeFeedMembershipPatches();
    if (!Object.keys(patches).length) return map as Record<string, T>;
    const next: Record<string, T> = { ...map } as Record<string, T>;
    for (const [id, membership] of Object.entries(patches)) {
        if (membership === 'none') {
            delete next[id];
        } else {
            next[id] = membership as T;
        }
    }
    return next;
}

export function applyStickyInviteClears(ids: Iterable<string>): Set<string> {
    const clears = takeFeedInviteClears();
    if (!clears.length) return new Set(ids);
    const next = new Set(ids);
    for (const id of clears) next.delete(id);
    return next;
}

/** Plan eliminado: filtrar del feed hasta que el servidor confirme (o expire). */
export function noteFeedPlanDeleted(planId: string): void {
    if (!planId) return;
    pruneSticky();
    stickyPlanDeletes[planId] = Date.now();
    delete stickyMembership[planId];
    feedNeedsRefresh = true;
    try {
        const snap = cacheGetStale<{
            plans?: { id?: string }[];
            membershipMap?: Record<string, unknown>;
            savedPlans?: string[];
        }>(FEED_CACHE_KEY);
        if (!snap?.plans) return;
        const nextPlans = snap.plans.filter((p) => String(p.id) !== planId);
        if (nextPlans.length === snap.plans.length) return;
        const membershipMap = { ...(snap.membershipMap ?? {}) };
        delete membershipMap[planId];
        cacheSet(
            FEED_CACHE_KEY,
            {
                ...snap,
                plans: nextPlans,
                membershipMap,
                savedPlans: (snap.savedPlans ?? []).filter((id) => id !== planId),
            },
            60_000,
        );
    } catch {
        /* ignore */
    }
}

export function takeFeedPlanDeletes(): string[] {
    pruneSticky();
    return Object.keys(stickyPlanDeletes);
}

export function applyStickyPlanDeletes<T extends { id?: string | number | null }>(plans: T[]): T[] {
    const deletes = takeFeedPlanDeletes();
    if (!deletes.length) return plans;
    const ban = new Set(deletes);
    return plans.filter((p) => !ban.has(String(p.id)));
}

/** Plan recién creado: aparece en el feed al instante sin esperar la red. */
export function injectOptimisticFeedPlan(plan: Record<string, unknown>): void {
    if (!plan?.id) return;
    optimisticPlan = plan;
    stickyCreatedPlan = plan;
    feedNeedsRefresh = true;
    feedNeedsRefreshUrgent = true;
    // Parchear caché de forma síncrona: al volver al feed ya está el plan + el resto.
    try {
        const snap = cacheGetStale<{
            plans?: Record<string, unknown>[];
            membershipMap?: Record<string, string>;
            [k: string]: unknown;
        }>(FEED_CACHE_KEY);
        const oid = String(plan.id);
        if (snap?.plans?.length) {
            const without = snap.plans.filter((p) => String(p.id) !== oid);
            cacheSet(
                FEED_CACHE_KEY,
                {
                    ...snap,
                    plans: [plan, ...without],
                    membershipMap: {
                        ...(snap.membershipMap ?? {}),
                        [oid]: snap.membershipMap?.[oid] ?? 'joined',
                    },
                },
                FEED_CACHE_TTL_MS,
            );
        }
    } catch {
        /* ignore */
    }
    emitFeedRefreshSignal();
}

export function takeOptimisticFeedPlan(): Record<string, unknown> | null {
    const plan = optimisticPlan;
    optimisticPlan = null;
    return plan;
}

/** Fusiona el plan recién creado encima del fetch hasta que el servidor lo traiga. */
export function mergeStickyCreatedPlan<T extends { id?: string | number | null }>(plans: T[]): T[] {
    if (!stickyCreatedPlan?.id) return plans;
    const oid = String(stickyCreatedPlan.id);
    if (plans.some((p) => String(p.id) === oid)) {
        stickyCreatedPlan = null;
        return plans;
    }
    return [stickyCreatedPlan as T, ...plans];
}

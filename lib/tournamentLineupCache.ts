import {
    fetchAllLineupSlots,
    fetchTournamentConfig,
    type TournamentConfig,
    type TournamentOccupant,
} from './footballTournament';

export type TournamentLineupSnapshot = {
    config: TournamentConfig | null;
    slots: TournamentOccupant[];
    fetchedAt: number;
    /** No dejar que un fetch en vuelo borre un claim optimista (elegir clase). */
    protectUntil?: number;
};

/** Caché para paint instantáneo (link WhatsApp / volver al detalle). */
const FRESH_MS = 30_000;
const cache = new Map<string, TournamentLineupSnapshot>();
const inflight = new Map<string, Promise<TournamentLineupSnapshot>>();
const fetchGen = new Map<string, number>();
const listeners = new Map<string, Set<(snap: TournamentLineupSnapshot) => void>>();

function notifyLineup(planId: string) {
    const snap = cache.get(planId);
    if (!snap) return;
    listeners.get(planId)?.forEach((fn) => fn(snap));
}

export function subscribeTournamentLineup(
    planId: string,
    fn: (snap: TournamentLineupSnapshot) => void,
): () => void {
    let set = listeners.get(planId);
    if (!set) {
        set = new Set();
        listeners.set(planId, set);
    }
    set.add(fn);
    return () => {
        set!.delete(fn);
        if (set!.size === 0) listeners.delete(planId);
    };
}

export function peekTournamentLineup(planId: string): TournamentLineupSnapshot | null {
    return cache.get(planId) ?? null;
}

export function seedTournamentLineup(
    planId: string,
    config: TournamentConfig | null,
    slots?: TournamentOccupant[],
) {
    const prev = cache.get(planId);
    cache.set(planId, {
        config,
        slots: config ? (slots ?? prev?.slots ?? []) : [],
        fetchedAt: Date.now(),
        protectUntil: Date.now() + 2800,
    });
    notifyLineup(planId);
}

export function invalidateTournamentLineup(planId: string) {
    cache.delete(planId);
    inflight.delete(planId);
    fetchGen.set(planId, (fetchGen.get(planId) ?? 0) + 1);
}

/** True si ya sabemos que el plan NO es torneo (evita prefetch inútil). */
export function isKnownNonTournament(planId: string): boolean {
    const hit = cache.get(planId);
    return !!hit && hit.config === null;
}

async function fetchSnapshot(planId: string): Promise<TournamentLineupSnapshot> {
    const gen = (fetchGen.get(planId) ?? 0) + 1;
    fetchGen.set(planId, gen);
    const startedAt = Date.now();
    const [config, slots] = await Promise.all([
        fetchTournamentConfig(planId),
        fetchAllLineupSlots(planId),
    ]);
    const snap: TournamentLineupSnapshot = {
        config,
        slots: config ? slots : [],
        fetchedAt: Date.now(),
    };
    if (fetchGen.get(planId) === gen) {
        const prev = cache.get(planId);
        const protectedLocal =
            !!prev?.protectUntil && Date.now() < prev.protectUntil;
        const seededDuringFetch = !!prev && prev.fetchedAt >= startedAt;
        if (protectedLocal || seededDuringFetch) {
            return prev;
        }
        cache.set(planId, snap);
        notifyLineup(planId);
        if (snap.config && snap.slots.length) warmOccupantProfiles(snap.slots);
    }
    return cache.get(planId) ?? snap;
}

function runInflight(
    planId: string,
    factory: () => Promise<TournamentLineupSnapshot>,
): Promise<TournamentLineupSnapshot> {
    const existing = inflight.get(planId);
    if (existing) return existing;
    const work = factory().finally(() => {
        if (inflight.get(planId) === work) inflight.delete(planId);
    });
    inflight.set(planId, work);
    return work;
}

/**
 * Prefetch del feed/tarjeta:
 * - Partido ya conocido → no hace nada.
 * - Torneo fresco → no hace nada.
 * - Desconocido → primero solo config; si no es torneo, para (1 RTT).
 * - Torneo → luego slots.
 */
async function prefetchSnapshot(planId: string): Promise<TournamentLineupSnapshot> {
    const peek = cache.get(planId);
    if (peek && !peek.config) return peek;
    if (peek?.config && Date.now() - peek.fetchedAt < FRESH_MS) return peek;

    return runInflight(planId, async () => {
        const current = cache.get(planId);
        // Torneo stale: refresh completo en paralelo.
        if (current?.config) {
            return fetchSnapshot(planId);
        }

        const gen = (fetchGen.get(planId) ?? 0) + 1;
        fetchGen.set(planId, gen);
        const config = await fetchTournamentConfig(planId);
        if (fetchGen.get(planId) !== gen) {
            return cache.get(planId) ?? { config: null, slots: [], fetchedAt: Date.now() };
        }
        if (!config) {
            const snap: TournamentLineupSnapshot = {
                config: null,
                slots: [],
                fetchedAt: Date.now(),
            };
            cache.set(planId, snap);
            notifyLineup(planId);
            return snap;
        }
        const slots = await fetchAllLineupSlots(planId);
        if (fetchGen.get(planId) !== gen) {
            return cache.get(planId) ?? { config, slots, fetchedAt: Date.now() };
        }
        const prev = cache.get(planId);
        if (prev?.protectUntil && Date.now() < prev.protectUntil) {
            return prev;
        }
        const snap: TournamentLineupSnapshot = {
            config,
            slots,
            fetchedAt: Date.now(),
        };
        cache.set(planId, snap);
        notifyLineup(planId);
        if (slots.length) warmOccupantProfiles(slots);
        return snap;
    });
}

function warmOccupantProfiles(slots: TournamentOccupant[]): void {
    const ids = [...new Set(slots.map((s) => s.usuario_id).filter(Boolean))];
    if (!ids.length) return;
    void import('./profileData')
        .then(({ getPublicProfileCards }) => getPublicProfileCards(ids))
        .then((cards) => {
            const urls = cards
                .map((c) => (c.avatar_url || '').trim())
                .filter((u) => /^https?:\/\//i.test(u));
            if (!urls.length) return;
            void import('expo-image').then(({ Image }) => {
                urls.slice(0, 24).forEach((uri) => {
                    void Image.prefetch(uri);
                });
            });
        })
        .catch(() => undefined);
}

/**
 * Carga config+slots en paralelo (dedupe in-flight).
 * Nunca cancela un fetch ya en curso (el link de WhatsApp arrancaba 2-3 veces).
 * `force`: revalida en segundo plano si ya hay paint; no bloquea la UI.
 */
export function loadTournamentLineup(
    planId: string,
    opts?: { force?: boolean },
): Promise<TournamentLineupSnapshot> {
    const pending = inflight.get(planId);
    if (pending) return pending;

    const hit = cache.get(planId);
    if (hit && Date.now() - hit.fetchedAt < FRESH_MS) {
        if (opts?.force) void runInflight(planId, () => fetchSnapshot(planId));
        return Promise.resolve(hit);
    }
    if (hit?.config) {
        // Stale pero pintable: campo al instante, refresh detrás.
        void runInflight(planId, () => fetchSnapshot(planId));
        return Promise.resolve(hit);
    }
    return runInflight(planId, () => fetchSnapshot(planId));
}

/**
 * Prefetch fire-and-forget (feed).
 * No gasta slots en partidos normales; en torneos deja config+slots listos.
 */
export function prefetchTournamentLineup(planId: string): void {
    if (isKnownNonTournament(planId)) return;
    void prefetchSnapshot(planId);
}

/** Link WhatsApp / cold open: config+slots en paralelo y avatares en caché. */
export function warmTournamentFromLink(planId: string): void {
    if (!planId || isKnownNonTournament(planId)) return;
    void loadTournamentLineup(planId).then((snap) => {
        if (snap.config && snap.slots.length) warmOccupantProfiles(snap.slots);
    });
}

/**
 * Al pulsar la tarjeta: prioriza frescor si ya es torneo (plan clave del feed).
 */
export function prioritizeTournamentPrefetch(planId: string): void {
    if (isKnownNonTournament(planId)) return;
    const peek = cache.get(planId);
    if (peek?.config) {
        void loadTournamentLineup(planId, { force: true });
        return;
    }
    void prefetchSnapshot(planId);
}

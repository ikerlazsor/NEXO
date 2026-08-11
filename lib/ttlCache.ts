type CacheEntry<T> = {
    value: T;
    /** Fresh until this time. */
    expiresAt: number;
    /** Keep stale value for SWR until this time. */
    hardExpiresAt: number;
};

const store = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

const STALE_GRACE_MS = 30 * 60 * 1000;

export function cacheGet<T>(key: string): T | null {
    const entry = store.get(key);
    if (!entry) return null;
    const now = Date.now();
    if (now > entry.hardExpiresAt) {
        store.delete(key);
        return null;
    }
    if (now > entry.expiresAt) return null;
    return entry.value as T;
}

/** Returns cached value even if soft-TTL expired (for instant UI). */
export function cacheGetStale<T>(key: string): T | null {
    const entry = store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.hardExpiresAt) {
        store.delete(key);
        return null;
    }
    return entry.value as T;
}

export function cacheIsFresh(key: string): boolean {
    const entry = store.get(key);
    if (!entry) return false;
    return Date.now() <= entry.expiresAt;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
    const now = Date.now();
    store.set(key, {
        value,
        expiresAt: now + ttlMs,
        hardExpiresAt: now + Math.max(ttlMs * 20, STALE_GRACE_MS),
    });
}

export function cacheInvalidate(key: string): void {
    store.delete(key);
    inflight.delete(key);
}

export function cacheClearAll(): void {
    store.clear();
    inflight.clear();
}

export function cacheInvalidatePrefix(prefix: string): void {
    for (const key of store.keys()) {
        if (key.startsWith(prefix)) store.delete(key);
    }
    for (const key of inflight.keys()) {
        if (key.startsWith(prefix)) inflight.delete(key);
    }
}

/**
 * Dedupes concurrent fetches for the same key and stores the result.
 * Fresh cache hits return immediately; parallel callers share one in-flight promise.
 */
export async function cacheGetOrFetch<T>(
    key: string,
    ttlMs: number,
    fetcher: () => Promise<T>,
    opts?: { force?: boolean },
): Promise<T> {
    if (!opts?.force) {
        const hit = cacheGet<T>(key);
        if (hit !== null) return hit;
        const pending = inflight.get(key);
        if (pending) return pending as Promise<T>;
    }

    const promise = (async () => {
        try {
            const value = await fetcher();
            cacheSet(key, value, ttlMs);
            return value;
        } finally {
            inflight.delete(key);
        }
    })();

    inflight.set(key, promise);
    return promise;
}

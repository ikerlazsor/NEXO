import { getIsOnline } from './network';

export type RetryOptions = {
    retries?: number;
    baseMs?: number;
    /** Si false, no reintenta cuando no hay red. Default true. */
    skipWhenOffline?: boolean;
};

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(err: unknown): boolean {
    if (err == null) return false;
    const msg = String((err as { message?: string })?.message ?? err).toLowerCase();
    if (msg.includes('network') || msg.includes('timeout') || msg.includes('fetch')) return true;
    if (msg.includes('failed to fetch') || msg.includes('network request failed')) return true;
    const status = (err as { status?: number })?.status;
    if (typeof status === 'number' && (status === 408 || status === 429 || status >= 500)) return true;
    return true;
}

/** Reintento con backoff suave para lecturas / fire-and-forget. */
export async function withRetry<T>(
    fn: () => Promise<T>,
    opts: RetryOptions = {},
): Promise<T> {
    const retries = opts.retries ?? 2;
    const baseMs = opts.baseMs ?? 400;
    const skipWhenOffline = opts.skipWhenOffline !== false;

    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        if (skipWhenOffline && !getIsOnline() && attempt > 0) {
            throw lastErr ?? new Error('offline');
        }
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (attempt >= retries || !isRetryableError(err)) throw err;
            if (skipWhenOffline && !getIsOnline()) throw err;
            await sleep(baseMs * (attempt + 1));
        }
    }
    throw lastErr;
}

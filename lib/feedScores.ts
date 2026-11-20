import type { UserCoords } from './location';
import { supabase } from './supabase';

/**
 * Puntuación del feed calculada en el servidor (get_feed_scores).
 * Clave: `plan:<id>` o `event:<id>`. s = puntos, t = grupo (0 míos, 1 amigos, 2 resto).
 * El algoritmo y sus pesos viven en Supabase: cambiarlos no requiere actualizar la app.
 */
export type FeedScores = Record<string, { s: number; t: number }>;

const DEFAULT_TIMEOUT_MS = 2500;
const MAX_PLAN_IDS = 400;

export function feedScoreKey(kind: 'plan' | 'event', id: string): string {
    return `${kind}:${id}`;
}

/** Null si falla o tarda: la app ordena entonces con su ranking local. */
export async function fetchFeedScores(
    coords: UserCoords | null | undefined,
    planIds: string[],
    timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<FeedScores | null> {
    const ids = [...new Set(planIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))].slice(0, MAX_PLAN_IDS);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
        const { data, error } = await supabase
            .rpc('get_feed_scores', {
                p_lat: coords?.latitude ?? null,
                p_lon: coords?.longitude ?? null,
                p_plan_ids: ids,
            })
            .abortSignal(abort.signal);
        if (error || !Array.isArray(data)) return null;
        const scores: FeedScores = {};
        for (const row of data as Array<{ kind?: string; id?: string; score?: number; tier?: number }>) {
            if ((row.kind !== 'plan' && row.kind !== 'event') || !row.id) continue;
            const s = Number(row.score);
            const t = Number(row.tier);
            if (!Number.isFinite(s) || !Number.isFinite(t)) continue;
            scores[feedScoreKey(row.kind, row.id)] = { s, t };
        }
        return scores;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

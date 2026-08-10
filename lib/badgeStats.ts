import type { UserStats } from './stats';
import { EMPTY_STATS, getUserStats } from './stats';
import { cacheGet, cacheInvalidate, cacheSet } from './ttlCache';
import { supabase } from './supabase';
import { isFeedPlan } from './feedPlans';
import { normalizeMainCategory } from './categories';

const FEED_CATEGORIES = ['FOODIES', 'DEPORTES', 'AIRE_LIBRE', 'SHOWTIME', 'DESCUBRIR', 'VIBES'] as const;
const BADGE_STATS_TTL_MS = 90_000;

export interface BadgeStats extends UserStats {
    planesTapas: number;
    planesDeporte: number;
    planesFiesta: number;
    planesEstudio: number;
    planesSoloChicas: number;
    planesCreados: number;
    categoriasProbadas: number;
    personasDistintas: number;
    cuentaAntiguedadDias: number;
}

export const EMPTY_BADGE_STATS: BadgeStats = {
    ...EMPTY_STATS,
    planesTapas: 0,
    planesDeporte: 0,
    planesFiesta: 0,
    planesEstudio: 0,
    planesSoloChicas: 0,
    planesCreados: 0,
    categoriasProbadas: 0,
    personasDistintas: 0,
    cuentaAntiguedadDias: 0,
};

function badgeCacheKey(userId: string) {
    return `badgeStats:${userId}`;
}

function countByCategory(rows: { categoria?: string | null }[]): Pick<BadgeStats, 'planesTapas' | 'planesDeporte' | 'planesFiesta' | 'planesEstudio' | 'planesSoloChicas' | 'categoriasProbadas'> {
    const counts: Record<(typeof FEED_CATEGORIES)[number], number> = {
        FOODIES: 0,
        DEPORTES: 0,
        AIRE_LIBRE: 0,
        SHOWTIME: 0,
        DESCUBRIR: 0,
        VIBES: 0,
    };
    for (const row of rows) {
        const main = normalizeMainCategory(row.categoria);
        if (main) counts[main] += 1;
    }
    const tried = FEED_CATEGORIES.filter((c) => counts[c] > 0).length;
    return {
        planesTapas: counts.FOODIES,
        planesDeporte: counts.DEPORTES,
        planesFiesta: counts.VIBES,
        planesEstudio: counts.DESCUBRIR,
        planesSoloChicas: 0,
        categoriasProbadas: tried,
    };
}

function accountAgeDays(userCreatedAt?: string | null): number {
    if (!userCreatedAt) return 0;
    const created = new Date(userCreatedAt).getTime();
    if (!Number.isFinite(created)) return 0;
    return Math.floor((Date.now() - created) / (1000 * 60 * 60 * 24));
}

function parseRpcBadgeStats(raw: Record<string, unknown>): BadgeStats {
    return {
        ...EMPTY_BADGE_STATS,
        valoracionMedia: Number(raw.valoracionMedia) || 0,
        porcentajeRepetiria: Number(raw.porcentajeRepetiria) || 0,
        porcentajeAsistencia: Number(raw.porcentajeAsistencia) || 0,
        numeroValoraciones: Number(raw.numeroValoraciones) || 0,
        numeroEvaluadoresDistintos: Number(raw.numeroEvaluadoresDistintos) || 0,
        numeroPlanesRealizados: Number(raw.numeroPlanesRealizados) || 0,
        numeroAmistades: Number(raw.numeroAmistades) || 0,
        aspectoPositivoMasVotado: (raw.aspectoPositivoMasVotado as string | null) ?? null,
        aspectoNegativoMasVotado: (raw.aspectoNegativoMasVotado as string | null) ?? null,
        numeroExpulsiones: Number(raw.numeroExpulsiones) || 0,
        planesTapas: Number(raw.planesTapas) || 0,
        planesDeporte: Number(raw.planesDeporte) || 0,
        planesFiesta: Number(raw.planesFiesta) || 0,
        planesEstudio: Number(raw.planesEstudio) || 0,
        planesSoloChicas: Number(raw.planesSoloChicas) || 0,
        planesCreados: Number(raw.planesCreados) || 0,
        categoriasProbadas: Number(raw.categoriasProbadas) || 0,
        personasDistintas: Number(raw.personasDistintas) || 0,
        cuentaAntiguedadDias: Number(raw.cuentaAntiguedadDias) || 0,
    };
}

async function fetchBadgeStatsRpc(userId: string): Promise<BadgeStats | null> {
    const { data, error } = await supabase.rpc('get_badge_stats', { p_user_id: userId });
    if (error || data == null) return null;
    const raw = typeof data === 'string' ? JSON.parse(data) : data;
    if (!raw || typeof raw !== 'object') return null;
    return parseRpcBadgeStats(raw as Record<string, unknown>);
}

type MaterializedStatsRow = {
    valoracion_media: number | null;
    porcentaje_repetiria: number | null;
    numero_valoraciones: number | null;
    numero_planes_realizados: number | null;
    numero_amistades: number | null;
    planes_tapas?: number | null;
    planes_deporte?: number | null;
    planes_fiesta?: number | null;
    planes_estudio?: number | null;
    planes_solo_chicas?: number | null;
    categorias_probadas?: number | null;
    planes_creados?: number | null;
    personas_distintas?: number | null;
};

/** Lectura directa de columnas materializadas (sin RPC). */
async function fetchBadgeStatsTable(
    userId: string,
    userCreatedAt?: string | null,
): Promise<BadgeStats | null> {
    const { data, error } = await supabase
        .from('estadisticas_usuario')
        .select(
            'valoracion_media, porcentaje_repetiria, numero_valoraciones, numero_planes_realizados, numero_amistades, planes_tapas, planes_deporte, planes_fiesta, planes_estudio, planes_solo_chicas, categorias_probadas, planes_creados, personas_distintas',
        )
        .eq('usuario_id', userId)
        .maybeSingle();

    if (error || !data) return null;
    const row = data as MaterializedStatsRow;
    if (row.planes_tapas == null && row.planes_creados == null && row.personas_distintas == null) {
        return null;
    }

    return {
        ...EMPTY_STATS,
        valoracionMedia: Number(row.valoracion_media) || 0,
        porcentajeRepetiria: Number(row.porcentaje_repetiria) || 0,
        numeroValoraciones: row.numero_valoraciones ?? 0,
        numeroPlanesRealizados: row.numero_planes_realizados ?? 0,
        numeroAmistades: row.numero_amistades ?? 0,
        planesTapas: row.planes_tapas ?? 0,
        planesDeporte: row.planes_deporte ?? 0,
        planesFiesta: row.planes_fiesta ?? 0,
        planesEstudio: row.planes_estudio ?? 0,
        planesSoloChicas: row.planes_solo_chicas ?? 0,
        categoriasProbadas: row.categorias_probadas ?? 0,
        planesCreados: row.planes_creados ?? 0,
        personasDistintas: row.personas_distintas ?? 0,
        cuentaAntiguedadDias: accountAgeDays(userCreatedAt),
    };
}

async function fetchBadgeStatsClient(
    userId: string,
    options?: { baseStats?: UserStats; userCreatedAt?: string | null },
): Promise<BadgeStats> {
    const baseStatsPromise = options?.baseStats
        ? Promise.resolve(options.baseStats)
        : getUserStats(userId);

    const [baseStats, historialRes, creadosRes, personasRes] = await Promise.all([
        baseStatsPromise,
        supabase
            .from('historial_planes')
            .select('planes ( categoria )')
            .eq('usuario_id', userId),
        supabase
            .from('planes')
            .select('id, categoria')
            .eq('creador_id', userId),
        supabase
            .from('participantes')
            .select('plan_id')
            .eq('usuario_id', userId)
            .eq('estado', 'aceptado'),
    ]);

    const historialRows = (historialRes.data ?? []).map((r) => {
        const raw = r.planes;
        const plan = Array.isArray(raw) ? raw[0] : raw;
        return { categoria: (plan as { categoria?: string })?.categoria ?? null };
    });

    const categoryCounts = countByCategory(historialRows);
    const planesCreados = (creadosRes.data ?? []).filter((p) => isFeedPlan(p)).length;

    const myPlanIds = (personasRes.data ?? []).map((p) => p.plan_id);
    let personasDistintas = 0;
    if (myPlanIds.length > 0) {
        const { data: coParts } = await supabase
            .from('participantes')
            .select('usuario_id')
            .in('plan_id', myPlanIds)
            .eq('estado', 'aceptado')
            .neq('usuario_id', userId);
        personasDistintas = new Set((coParts ?? []).map((p) => p.usuario_id)).size;
    }

    return {
        ...baseStats,
        ...categoryCounts,
        planesCreados,
        personasDistintas,
        cuentaAntiguedadDias: accountAgeDays(options?.userCreatedAt),
    };
}

export function invalidateBadgeStatsCache(userId: string): void {
    cacheInvalidate(badgeCacheKey(userId));
}

export async function getBadgeStats(
    userId: string,
    options?: { baseStats?: UserStats; userCreatedAt?: string | null; skipCache?: boolean },
): Promise<BadgeStats> {
    if (!options?.skipCache) {
        const cached = cacheGet<BadgeStats>(badgeCacheKey(userId));
        if (cached) return cached;
    }

    const rpcStats = await fetchBadgeStatsRpc(userId);
    const tableStats =
        rpcStats ??
        (await fetchBadgeStatsTable(userId, options?.userCreatedAt));
    const stats =
        tableStats ?? (await fetchBadgeStatsClient(userId, options));
    cacheSet(badgeCacheKey(userId), stats, BADGE_STATS_TTL_MS);
    return stats;
}

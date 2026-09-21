import { cacheGet, cacheGetStale, cacheInvalidate, cacheSet } from './ttlCache';
import { screenCacheKey, ScreenCacheTTL } from './screenCaches';
import { supabase } from './supabase';

/** Cumplido / rasgo: con 1 voto ya se puede mostrar «la gente te ve». */
export const MIN_DISTINCT_RATERS_FOR_TRAIT = 1;
/** % de «repetirían»: hace falta un mínimo para no publicar un 100% de una sola persona. */
export const MIN_DISTINCT_RATERS_FOR_REPEAT = 3;
/** @deprecated Usar MIN_DISTINCT_RATERS_FOR_TRAIT / REPEAT */
export const MIN_DISTINCT_RATERS_FOR_REPUTATION = MIN_DISTINCT_RATERS_FOR_TRAIT;

export interface UserStats {
    valoracionMedia: number;
    porcentajeRepetiria: number;
    porcentajeAsistencia: number;
    numeroValoraciones: number;
    numeroEvaluadoresDistintos: number;
    numeroPlanesRealizados: number;
    numeroAmistades: number;
    aspectoPositivoMasVotado: string | null;
    aspectoNegativoMasVotado: string | null;
    numeroExpulsiones: number;
}

export const EMPTY_STATS: UserStats = {
    valoracionMedia: 0,
    porcentajeRepetiria: 0,
    porcentajeAsistencia: 0,
    numeroValoraciones: 0,
    numeroEvaluadoresDistintos: 0,
    numeroPlanesRealizados: 0,
    numeroAmistades: 0,
    aspectoPositivoMasVotado: null,
    aspectoNegativoMasVotado: null,
    numeroExpulsiones: 0,
};

const STATS_TTL_MS = 180_000;

function statsCacheKey(userId: string) {
    return `userStats:${userId}`;
}

/** Stats ya cacheadas (detalle de plan / perfil) sin red. */
export function peekUserStats(userId: string): UserStats | null {
    if (!userId) return null;
    return cacheGetStale<UserStats>(statsCacheKey(userId));
}

function distinctRaterCount(stats: UserStats): number {
    return stats.numeroEvaluadoresDistintos || stats.numeroValoraciones;
}

/** % público de «repetirían plan contigo». */
export function hasPublicRepeatStats(stats: UserStats): boolean {
    return distinctRaterCount(stats) >= MIN_DISTINCT_RATERS_FOR_REPEAT;
}

/** Rasgo «Spoiler» solo con el umbral de votantes. */
export function hasPublicTraitStats(stats: UserStats): boolean {
    return (
        !!stats.aspectoPositivoMasVotado &&
        distinctRaterCount(stats) >= MIN_DISTINCT_RATERS_FOR_TRAIT
    );
}

/** Sección de reputación: rasgo positivo o ya hay masa para el % . */
export function hasPublicReputationStats(stats: UserStats): boolean {
    return hasPublicRepeatStats(stats) || hasPublicTraitStats(stats);
}

/** Columna del medio en perfil persona: % o «Nuevo / Nueva». */
export function personRepeatStat(
    stats: UserStats,
    opts: { isSelf: boolean; genero?: string | null; t: (k: string, params?: Record<string, string | number>) => string },
): { middleText?: string; repeatPct: number | null; label: string } {
    if (hasPublicRepeatStats(stats)) {
        const label = opts.isSelf
            ? opts.t('profile.rep.wouldRepeatWithYou')
            : opts.genero === 'femenino'
              ? opts.t('profile.rep.wouldRepeatWithHer')
              : opts.t('profile.rep.wouldRepeatWithHim');
        return {
            repeatPct: Math.max(0, Math.min(100, Math.round(stats.porcentajeRepetiria))),
            label,
        };
    }
    const newKey =
        opts.genero === 'femenino'
            ? 'profile.rep.newF'
            : opts.genero === 'masculino'
              ? 'profile.rep.newM'
              : 'profile.rep.newN';
    return {
        middleText: opts.t(newKey),
        repeatPct: null,
        label: opts.t('profile.rep.warmingShort'),
    };
}

/** Entero si es .0 (3 → "3"); un decimal si no (3.4 → "3.4"). */
export function formatRatingScore(value: number): string {
    if (!Number.isFinite(value)) return '0';
    const rounded = (Math.round(value * 10) / 10).toFixed(1);
    return rounded.endsWith('.0') ? rounded.slice(0, -2) : rounded;
}

/** Estadísticas públicas del usuario (RPC SECURITY DEFINER + fallback tabla). */
export async function getUserStats(userId: string, options?: { skipCache?: boolean }): Promise<UserStats> {
    if (!options?.skipCache) {
        const cached = cacheGet<UserStats>(statsCacheKey(userId));
        if (cached) return cached;
    }

    let row: Record<string, unknown> | null = null;

    try {
        const { data, error } = await supabase.rpc('get_user_public_stats', { p_user_id: userId });
        if (!error && data != null) {
            const raw = typeof data === 'string' ? JSON.parse(data) : data;
            if (raw && typeof raw === 'object') row = raw as Record<string, unknown>;
        }
    } catch {
        // fallback abajo
    }

    if (!row) {
        const { data, error } = await supabase
            .from('estadisticas_usuario')
            .select(
                [
                    'valoracion_media',
                    'porcentaje_repetiria',
                    'porcentaje_asistencia',
                    'numero_valoraciones',
                    'numero_evaluadores_distintos',
                    'numero_planes_realizados',
                    'numero_amistades',
                    'aspecto_positivo_mas_votado',
                    'aspecto_negativo_mas_votado',
                ].join(', '),
            )
            .eq('usuario_id', userId)
            .maybeSingle();

        if (error || !data) {
            const fallback = await supabase
                .from('estadisticas_usuario')
                .select(
                    'valoracion_media, porcentaje_repetiria, numero_valoraciones, numero_planes_realizados, numero_amistades, aspecto_positivo_mas_votado, aspecto_negativo_mas_votado',
                )
                .eq('usuario_id', userId)
                .maybeSingle();
            if (fallback.error || !fallback.data) return EMPTY_STATS;
            row = fallback.data as unknown as Record<string, unknown>;
        } else {
            row = data as unknown as Record<string, unknown>;
        }
    }

    let numeroExpulsiones = 0;
    try {
        const { count } = await supabase
            .from('expulsiones_plan')
            .select('id', { count: 'exact', head: true })
            .eq('usuario_id', userId);
        numeroExpulsiones = count ?? 0;
    } catch {
        numeroExpulsiones = 0;
    }

    const stats: UserStats = {
        valoracionMedia: Number(row.valoracion_media) || 0,
        porcentajeRepetiria: Number(row.porcentaje_repetiria) || 0,
        porcentajeAsistencia: Number(row.porcentaje_asistencia) || 0,
        numeroValoraciones: Number(row.numero_valoraciones) || 0,
        numeroEvaluadoresDistintos: Number(row.numero_evaluadores_distintos) || 0,
        numeroPlanesRealizados: Number(row.numero_planes_realizados) || 0,
        numeroAmistades: Number(row.numero_amistades) || 0,
        aspectoPositivoMasVotado: (row.aspecto_positivo_mas_votado as string | null) ?? null,
        aspectoNegativoMasVotado: (row.aspecto_negativo_mas_votado as string | null) ?? null,
        numeroExpulsiones,
    };

    const cooled = await applyLowRatingCooling(userId, stats);
    cacheSet(statsCacheKey(userId), cooled, STATS_TTL_MS);
    return cooled;
}

/** Valoraciones ≤2 estrellas recientes no muestran el aspecto negativo un tiempo (evita broncas). */
const LOW_RATING_THRESHOLD = 2;
const LOW_RATING_HIDE_DAYS = 7;

async function applyLowRatingCooling(userId: string, stats: UserStats): Promise<UserStats> {
    if (!stats.aspectoNegativoMasVotado) return stats;
    try {
        const since = new Date(Date.now() - LOW_RATING_HIDE_DAYS * 24 * 60 * 60 * 1000).toISOString();
        const { data, error } = await supabase
            .from('valoraciones')
            .select('id')
            .eq('evaluado_id', userId)
            .lte('puntuacion_general', LOW_RATING_THRESHOLD)
            .gte('creado_en', since)
            .limit(1);
        if (!error && data && data.length > 0) {
            return { ...stats, aspectoNegativoMasVotado: null };
        }
    } catch {
        /* ignore */
    }
    return stats;
}

export function invalidateUserStatsCache(userId: string): void {
    cacheInvalidate(statsCacheKey(userId));
    cacheInvalidate(`badgeStats:v2:${userId}`);
    cacheInvalidate(`badgeStats:${userId}`);
}

/** Sube o baja el contador de planes hechos en caché (perfil + stats) al instante. */
export function bumpPlansDoneOptimistic(userId: string, delta = 1): void {
    if (!delta) return;

    const statsKey = statsCacheKey(userId);
    const profileKey = screenCacheKey.profileUI(userId);
    const profileSnap = cacheGetStale<{ stats?: UserStats; badgeStats?: UserStats }>(profileKey);
    const statsCached = cacheGet<UserStats>(statsKey);
    const base = profileSnap?.stats ?? statsCached ?? EMPTY_STATS;
    const nextCount = Math.max(0, base.numeroPlanesRealizados + delta);
    const nextStats: UserStats = { ...base, numeroPlanesRealizados: nextCount };

    cacheSet(statsKey, nextStats, STATS_TTL_MS);

    const badgeKey = `badgeStats:v2:${userId}`;
    const badgeCached = cacheGet<UserStats>(badgeKey);
    if (badgeCached) {
        cacheSet(badgeKey, { ...badgeCached, numeroPlanesRealizados: nextCount }, STATS_TTL_MS);
    }

    if (profileSnap) {
        cacheSet(
            profileKey,
            {
                ...profileSnap,
                stats: { ...(profileSnap.stats ?? EMPTY_STATS), numeroPlanesRealizados: nextCount },
                badgeStats: profileSnap.badgeStats
                    ? { ...profileSnap.badgeStats, numeroPlanesRealizados: nextCount }
                    : profileSnap.badgeStats,
            },
            ScreenCacheTTL.profileUI,
        );
    }
}

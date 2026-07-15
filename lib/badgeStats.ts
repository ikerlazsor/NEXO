import type { UserStats } from './stats';
import { EMPTY_STATS, getUserStats } from './stats';
import { supabase } from './supabase';
import { isFeedPlan } from './feedPlans';

const FEED_CATEGORIES = ['Tapas', 'Fiesta', 'Deporte', 'Estudio', 'Solo chicas'] as const;

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

function countByCategory(rows: { categoria?: string | null }[]): Pick<BadgeStats, 'planesTapas' | 'planesDeporte' | 'planesFiesta' | 'planesEstudio' | 'planesSoloChicas' | 'categoriasProbadas'> {
    const counts = { Tapas: 0, Deporte: 0, Fiesta: 0, Estudio: 0, 'Solo chicas': 0 };
    for (const row of rows) {
        const cat = row.categoria;
        if (cat && cat in counts) counts[cat as keyof typeof counts] += 1;
    }
    const tried = FEED_CATEGORIES.filter((c) => counts[c] > 0).length;
    return {
        planesTapas: counts.Tapas,
        planesDeporte: counts.Deporte,
        planesFiesta: counts.Fiesta,
        planesEstudio: counts.Estudio,
        planesSoloChicas: counts['Solo chicas'],
        categoriasProbadas: tried,
    };
}

export async function getBadgeStats(userId: string): Promise<BadgeStats> {
    const [baseStats, historialRes, creadosRes, personasRes, authRes] = await Promise.all([
        getUserStats(userId),
        supabase
            .from('historial_planes')
            .select('plan_id, planes ( categoria )')
            .eq('usuario_id', userId),
        supabase
            .from('planes')
            .select('id, categoria')
            .eq('creador_id', userId),
        supabase
            .from('participantes')
            .select('plan_id, usuario_id')
            .eq('usuario_id', userId)
            .eq('estado', 'aceptado'),
        supabase.auth.getUser(),
    ]);

    const historialRows = (historialRes.data ?? []).map((r) => {
        const raw = r.planes;
        const plan = Array.isArray(raw) ? raw[0] : raw;
        return { categoria: (plan as { categoria?: string })?.categoria ?? null };
    });

    const categoryCounts = countByCategory(historialRows);

    const planesCreados = (creadosRes.data ?? []).filter((p) => isFeedPlan(p)).length;

    let personasDistintas = 0;
    const myPlanIds = (personasRes.data ?? []).map((p) => p.plan_id);
    if (myPlanIds.length > 0) {
        const { data: coParts } = await supabase
            .from('participantes')
            .select('usuario_id')
            .in('plan_id', myPlanIds)
            .eq('estado', 'aceptado')
            .neq('usuario_id', userId);
        personasDistintas = new Set((coParts ?? []).map((p) => p.usuario_id)).size;
    }

    const createdAt = authRes.data.user?.created_at;
    const cuentaAntiguedadDias = createdAt
        ? Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24))
        : 0;

    return {
        ...baseStats,
        ...categoryCounts,
        planesCreados,
        personasDistintas,
        cuentaAntiguedadDias,
    };
}

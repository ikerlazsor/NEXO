import { supabase } from './supabase';
import { cacheGetOrFetch, cacheInvalidate } from './ttlCache';

const COINCIDED_TTL_MS = 120_000;

function coincidedKey(userId: string) {
    return `coincidedUsers:${userId}`;
}

export function invalidateCoincidencesCache(userId?: string): void {
    if (userId) cacheInvalidate(coincidedKey(userId));
}

/**
 * Personas con las que has coincidido de verdad:
 * plan en tu historial + valoración con asistencia=true (en cualquier sentido).
 */
export async function getCoincidedUserIds(userId: string): Promise<Set<string>> {
    return cacheGetOrFetch(coincidedKey(userId), COINCIDED_TTL_MS, async () => {
        const { data: history, error: histErr } = await supabase
            .from('historial_planes')
            .select('plan_id')
            .eq('usuario_id', userId);

        if (histErr || !history?.length) return new Set<string>();

        const planIds = history.map((h) => h.plan_id as string);
        const ids = new Set<string>();

        for (let i = 0; i < planIds.length; i += 80) {
            const chunk = planIds.slice(i, i + 80);
            const [asEvaluator, asEvaluated] = await Promise.all([
                supabase
                    .from('valoraciones')
                    .select('evaluado_id')
                    .eq('evaluador_id', userId)
                    .eq('asistencia', true)
                    .in('plan_id', chunk),
                supabase
                    .from('valoraciones')
                    .select('evaluador_id')
                    .eq('evaluado_id', userId)
                    .eq('asistencia', true)
                    .in('plan_id', chunk),
            ]);

            for (const row of asEvaluator.data ?? []) {
                if (row.evaluado_id && row.evaluado_id !== userId) ids.add(row.evaluado_id as string);
            }
            for (const row of asEvaluated.data ?? []) {
                if (row.evaluador_id && row.evaluador_id !== userId) ids.add(row.evaluador_id as string);
            }
        }

        return ids;
    });
}

/**
 * Planes hechos juntos:
 * - ambos en historial del mismo plan, o
 * - tú tienes el plan en historial y hubo valoración con asistencia=true entre vosotros.
 */
export async function countSharedAttendedPlans(
    userA: string,
    userB: string,
): Promise<number> {
    if (!userA || !userB || userA === userB) return 0;

    const shared = new Set<string>();

    const { data: myHist } = await supabase
        .from('historial_planes')
        .select('plan_id')
        .eq('usuario_id', userA);
    const myPlans = (myHist ?? []).map((h) => h.plan_id as string);
    if (myPlans.length === 0) return 0;

    const { data: theirHist } = await supabase
        .from('historial_planes')
        .select('plan_id')
        .eq('usuario_id', userB)
        .in('plan_id', myPlans);
    for (const row of theirHist ?? []) {
        if (row.plan_id) shared.add(row.plan_id as string);
    }

    for (let i = 0; i < myPlans.length; i += 80) {
        const chunk = myPlans.slice(i, i + 80);
        const [ab, ba] = await Promise.all([
            supabase
                .from('valoraciones')
                .select('plan_id')
                .eq('evaluador_id', userA)
                .eq('evaluado_id', userB)
                .eq('asistencia', true)
                .in('plan_id', chunk),
            supabase
                .from('valoraciones')
                .select('plan_id')
                .eq('evaluador_id', userB)
                .eq('evaluado_id', userA)
                .eq('asistencia', true)
                .in('plan_id', chunk),
        ]);
        for (const row of [...(ab.data ?? []), ...(ba.data ?? [])]) {
            if (row.plan_id) shared.add(row.plan_id as string);
        }
    }

    return shared.size;
}

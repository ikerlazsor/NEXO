import { supabase } from './supabase';

export const MAX_ACTIVE_PLANS = 3;
export const MAX_ACTIVE_PLANS_PLUS = 5;

/** Planes activos = creados por el usuario + unidos (estado aceptado). */
export async function countActivePlans(userId: string): Promise<number> {
    const nowIso = new Date().toISOString();
    const now = Date.now();

    const [createdRes, joinedRes] = await Promise.all([
        supabase
            .from('planes')
            .select('id', { count: 'exact', head: true })
            .eq('creador_id', userId)
            .or(`fecha_evento.is.null,fecha_evento.gte.${nowIso}`),
        supabase
            .from('participantes')
            .select('plan_id, planes!inner(id, creador_id, fecha_evento)')
            .eq('usuario_id', userId)
            .eq('estado', 'aceptado'),
    ]);

    const createdCount = createdRes.count ?? 0;
    type JoinedRow = { plan_id: string; planes: { creador_id: string; fecha_evento: string | null } | { creador_id: string; fecha_evento: string | null }[] | null };

    const joinedNotCreated = (joinedRes.data ?? []).filter((row: JoinedRow) => {
        const raw = row.planes;
        const plan = Array.isArray(raw) ? raw[0] : raw;
        if (!plan || plan.creador_id === userId) return false;
        if (!plan.fecha_evento) return true;
        return new Date(plan.fecha_evento).getTime() >= now;
    });

    const uniqueJoined = new Set(joinedNotCreated.map((r: JoinedRow) => r.plan_id));
    return createdCount + uniqueJoined.size;
}

export async function canJoinMorePlans(
    userId: string,
    planId?: string,
    maxPlans = MAX_ACTIVE_PLANS,
): Promise<{ allowed: boolean; count: number; max: number }> {
    if (planId) {
        const { data: existing } = await supabase
            .from('participantes')
            .select('estado')
            .eq('plan_id', planId)
            .eq('usuario_id', userId)
            .maybeSingle();

        if (existing?.estado === 'aceptado' || existing?.estado === 'pendiente' || existing?.estado === 'lista_espera') {
            return { allowed: true, count: 0, max: maxPlans };
        }

        const { data: plan } = await supabase
            .from('planes')
            .select('creador_id')
            .eq('id', planId)
            .maybeSingle();

        if (plan?.creador_id === userId) {
            return { allowed: true, count: 0, max: maxPlans };
        }
    }

    const count = await countActivePlans(userId);
    return { allowed: count < maxPlans, count, max: maxPlans };
}

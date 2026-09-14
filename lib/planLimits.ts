import { supabase } from './supabase';
import { isPlanActiveForFeed } from './planLifecycle';

export const MAX_ACTIVE_PLANS = 5;
export const MAX_ACTIVE_PLANS_PLUS = 5;
export const MAX_ACTIVE_PLANS_ORGANIZER = 10;

export function maxActivePlansFor(isOrganizer: boolean): number {
    return isOrganizer ? MAX_ACTIVE_PLANS_ORGANIZER : MAX_ACTIVE_PLANS;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label}_timeout`)), ms);
        promise.then(
            (v) => {
                clearTimeout(timer);
                resolve(v);
            },
            (e) => {
                clearTimeout(timer);
                reject(e);
            },
        );
    });
}

/**
 * Planes activos = creados + unidos (aceptado), futuros o sin fecha.
 * Si RLS oculta un plan unido, se cuenta como activo (no subestimar el límite).
 */
export async function countActivePlans(userId: string): Promise<number> {
    if (!userId) return 0;
    const now = Date.now();
    const nowIso = new Date().toISOString();

    const [createdRes, joinedRes] = await Promise.all([
        supabase
            .from('planes')
            .select('id, categoria, is_group_chat, is_direct_chat')
            .eq('creador_id', userId)
            .or(`fecha_evento.is.null,fecha_evento.gte.${nowIso}`),
        supabase
            .from('participantes')
            .select('plan_id, planes(id, fecha_evento, creador_id, categoria, is_group_chat, is_direct_chat)')
            .eq('usuario_id', userId)
            .eq('estado', 'aceptado'),
    ]);

    if (createdRes.error) throw createdRes.error;
    if (joinedRes.error) throw joinedRes.error;

    const isChatPlan = (plan: {
        categoria?: string | null;
        is_group_chat?: boolean | null;
        is_direct_chat?: boolean | null;
    } | null | undefined) =>
        !!plan &&
        (plan.is_group_chat === true ||
            plan.is_direct_chat === true ||
            plan.categoria === 'Grupo' ||
            plan.categoria === 'Chat');

    const createdIds = new Set(
        (createdRes.data ?? [])
            .filter((p) => !isChatPlan(p))
            .map((p) => String(p.id)),
    );

    type JoinedPlan = {
        id: string;
        fecha_evento: string | null;
        creador_id: string;
        categoria?: string | null;
        is_group_chat?: boolean | null;
        is_direct_chat?: boolean | null;
    };

    type JoinedRow = {
        plan_id: string;
        planes: JoinedPlan | JoinedPlan[] | null;
    };

    let activeJoined = 0;
    const missingPlanIds: string[] = [];

    for (const row of (joinedRes.data ?? []) as JoinedRow[]) {
        const planId = String(row.plan_id);
        if (!planId || createdIds.has(planId)) continue;

        const raw = row.planes;
        const plan = Array.isArray(raw) ? raw[0] : raw;
        if (!plan) {
            missingPlanIds.push(planId);
            continue;
        }
        if (isChatPlan(plan)) continue;
        // Ya contado como creado por mí.
        if (plan.creador_id === userId) continue;
        if (!plan.fecha_evento) {
            activeJoined += 1;
            continue;
        }
        if (new Date(plan.fecha_evento).getTime() >= now) activeJoined += 1;
    }

    // Fallback: planes no embebidos (RLS) → contar como activos (salvo chats).
    if (missingPlanIds.length > 0) {
        const uniqueMissing = [...new Set(missingPlanIds)];
        const { data: joinedPlans, error: plansError } = await supabase
            .from('planes')
            .select('id, fecha_evento, categoria, is_group_chat, is_direct_chat')
            .in('id', uniqueMissing);

        if (plansError) {
            // Sin poder leer detalles: no subestimar.
            activeJoined += uniqueMissing.length;
        } else {
            const found = new Map((joinedPlans ?? []).map((p) => [String(p.id), p]));
            for (const id of uniqueMissing) {
                const plan = found.get(id);
                if (!plan) {
                    activeJoined += 1;
                    continue;
                }
                if (isChatPlan(plan)) continue;
                const fecha = plan.fecha_evento as string | null;
                if (!fecha || new Date(fecha).getTime() >= now) activeJoined += 1;
            }
        }
    }

    return createdIds.size + activeJoined;
}

/** Conteo local para unirse sin red (no subestima si el plan no está en memoria). */
export function countLocalActivePlans(
    userId: string,
    plans: Array<{ id?: string; creador_id?: string; fecha_evento?: string | null }>,
    membershipMap: Record<string, string | undefined>,
): number {
    const ids = new Set<string>();
    for (const plan of plans) {
        const id = plan.id ? String(plan.id) : '';
        if (!id) continue;
        const mine = String(plan.creador_id) === userId;
        const joined = membershipMap[id] === 'joined';
        if ((mine || joined) && isPlanActiveForFeed(plan)) ids.add(id);
    }
    return ids.size;
}

export async function canJoinMorePlans(
    userId: string,
    planId?: string,
    maxPlans = MAX_ACTIVE_PLANS,
): Promise<{ allowed: boolean; count: number; max: number; reason?: 'organizer' }> {
    try {
        return await withTimeout(canJoinMorePlansInner(userId, planId, maxPlans), 4500, 'join_limit');
    } catch {
        // Ante timeout/red: permitir y dejar que el servidor valide (UI no se congela).
        return { allowed: true, count: 0, max: maxPlans };
    }
}

async function canJoinMorePlansInner(
    userId: string,
    planId: string | undefined,
    maxPlans: number,
): Promise<{ allowed: boolean; count: number; max: number; reason?: 'organizer' }> {
    const { data: profile } = await supabase
        .from('perfiles')
        .select('es_organizador')
        .eq('id', userId)
        .maybeSingle();
    if (profile?.es_organizador === true) {
        return { allowed: false, count: 0, max: maxPlans, reason: 'organizer' };
    }

    if (planId) {
        const { data: existing } = await supabase
            .from('participantes')
            .select('estado')
            .eq('plan_id', planId)
            .eq('usuario_id', userId)
            .maybeSingle();

        if (
            existing?.estado === 'aceptado'
            || existing?.estado === 'pendiente'
            || existing?.estado === 'lista_espera'
        ) {
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

/** Crear plan nuevo. Timeout para no dejar la UI colgada. */
export async function canCreateMorePlans(
    userId: string,
    maxPlans = MAX_ACTIVE_PLANS,
): Promise<{ allowed: boolean; count: number; max: number; error?: string }> {
    try {
        const count = await withTimeout(countActivePlans(userId), 8000, 'plan_limit');
        return { allowed: count < maxPlans, count, max: maxPlans };
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'limit_check_failed';
        return { allowed: false, count: maxPlans, max: maxPlans, error: msg };
    }
}

import { isFeedPlan } from './feedPlans';
import { invalidateProfileNotificationCount } from './profileNotificationBus';
import { planDetailKey } from './planDetailCache';
import { getPublicProfileCards } from './profileData';
import { screenCacheKey } from './screenCaches';
import { supabase } from './supabase';
import { cacheInvalidate } from './ttlCache';

export type PlanJoinRequest = {
    planId: string;
    planTitulo: string;
    userId: string;
    nombre?: string;
    avatar_url?: string | null;
};

type PendingRow = { plan_id: string; usuario_id: string };

function activeCreatorPlans(
    plans: Array<{ id: string; titulo?: string | null; categoria?: string | null; fecha_evento?: string | null }>,
): Map<string, string> {
    const now = Date.now();
    const out = new Map<string, string>();
    for (const p of plans) {
        if (!isFeedPlan(p)) continue;
        if (p.fecha_evento && new Date(p.fecha_evento).getTime() < now) continue;
        out.set(String(p.id), String(p.titulo ?? ''));
    }
    return out;
}

async function enrichPendingRows(
    rows: PendingRow[],
    planTitles: Map<string, string>,
    creatorId: string,
): Promise<PlanJoinRequest[]> {
    if (!rows.length) return [];

    const userIds = [
        ...new Set(
            rows
                .map((r) => String(r.usuario_id || ''))
                .filter((id) => id && id !== creatorId),
        ),
    ];
    const profiles = new Map<string, { nombre?: string; avatar_url?: string | null }>();
    if (userIds.length > 0) {
        const cards = await getPublicProfileCards(userIds);
        for (const card of cards) {
            profiles.set(card.id, {
                nombre: card.nombre ?? undefined,
                avatar_url: card.avatar_url,
            });
        }
    }

    const out: PlanJoinRequest[] = [];
    for (const row of rows) {
        const planId = String(row.plan_id);
        const userId = String(row.usuario_id || '');
        if (!planId || !userId || userId === creatorId) continue;
        const planTitulo = planTitles.get(planId);
        if (!planTitles.has(planId)) continue;
        const profile = profiles.get(userId);
        out.push({
            planId,
            planTitulo: planTitulo ?? '',
            userId,
            nombre: profile?.nombre,
            avatar_url: profile?.avatar_url ?? null,
        });
    }
    return out;
}

/** Solicitudes de unirse a planes activos que creaste. */
export async function fetchIncomingPlanJoinRequests(userId: string): Promise<PlanJoinRequest[]> {
    const { data: myPlans } = await supabase
        .from('planes')
        .select('id, titulo, categoria, fecha_evento')
        .eq('creador_id', userId);

    const planTitles = activeCreatorPlans(myPlans || []);
    if (planTitles.size === 0) return [];

    const { data: pendingRows, error } = await supabase
        .from('participantes')
        .select('plan_id, usuario_id')
        .in('plan_id', [...planTitles.keys()])
        .eq('estado', 'pendiente');

    if (error || !pendingRows?.length) return [];
    return enrichPendingRows(pendingRows as PendingRow[], planTitles, userId);
}

/** Pendientes de un plan concreto (pantalla de detalle). */
export async function fetchPlanJoinRequests(planId: string): Promise<PlanJoinRequest[]> {
    const { data: plan } = await supabase
        .from('planes')
        .select('id, titulo, creador_id')
        .eq('id', planId)
        .maybeSingle();
    if (!plan?.id) return [];

    const { data: pendingRows, error } = await supabase
        .from('participantes')
        .select('plan_id, usuario_id')
        .eq('plan_id', planId)
        .eq('estado', 'pendiente');

    if (error || !pendingRows?.length) return [];
    const titles = new Map([[String(plan.id), String(plan.titulo ?? '')]]);
    return enrichPendingRows(pendingRows as PendingRow[], titles, String(plan.creador_id ?? ''));
}

export type AcceptPlanJoinResult =
    | { ok: true }
    | { ok: false; error: string; code?: 'full' | 'rls' | 'other' };

export async function acceptPlanJoinRequest(
    planId: string,
    userId: string,
    maxParticipants: number,
): Promise<AcceptPlanJoinResult> {
    const { count, error: countError } = await supabase
        .from('participantes')
        .select('id', { count: 'exact', head: true })
        .eq('plan_id', planId)
        .eq('estado', 'aceptado');

    if (countError) return { ok: false, error: countError.message, code: 'other' };
    if ((count ?? 0) >= maxParticipants) return { ok: false, error: 'plan_full', code: 'full' };

    const { error } = await supabase
        .from('participantes')
        .update({ estado: 'aceptado' })
        .eq('plan_id', planId)
        .eq('usuario_id', userId)
        .eq('estado', 'pendiente');

    if (error) {
        const msg = error.message || '';
        const code =
            msg.includes('plan_full') || msg.includes('active_plan_limit')
                ? 'full'
                : msg.includes('policy') || msg.includes('RLS')
                  ? 'rls'
                  : 'other';
        return { ok: false, error: msg, code };
    }

    void import('./push').then(({ notifyPlanJoinDecision }) => {
        notifyPlanJoinDecision(planId, userId, true);
    });
    return { ok: true };
}

export async function rejectPlanJoinRequest(
    planId: string,
    userId: string,
): Promise<{ ok: boolean; error?: string }> {
    const { error } = await supabase
        .from('participantes')
        .delete()
        .eq('plan_id', planId)
        .eq('usuario_id', userId)
        .eq('estado', 'pendiente');

    return error ? { ok: false, error: error.message } : { ok: true };
}

/** Tras aceptar/rechazar: badges, Mis planes, Amigos y detalle del plan. */
export function invalidatePlanJoinRequestCaches(creatorId: string, planId?: string): void {
    invalidateProfileNotificationCount(creatorId);
    cacheInvalidate(screenCacheKey.myPlans(creatorId));
    cacheInvalidate(screenCacheKey.friends(creatorId));
    cacheInvalidate(screenCacheKey.profileUI(creatorId));
    if (planId) cacheInvalidate(planDetailKey(planId));
}

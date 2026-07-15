import { getPendingRequestsCount } from './friends';
import { isFeedPlan } from './feedPlans';
import { countPendingPlanInvites } from './planInvites';
import { supabase } from './supabase';

export async function getPlanJoinRequestCount(userId: string): Promise<number> {
    const { data: myPlans } = await supabase
        .from('planes')
        .select('id, categoria, fecha_evento')
        .eq('creador_id', userId);

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const activeFeedPlanIds = (myPlans || [])
        .filter((p) => {
            if (!isFeedPlan(p)) return false;
            if (!p.fecha_evento) return true;
            return new Date(p.fecha_evento) >= startOfToday;
        })
        .map((p) => p.id);

    if (activeFeedPlanIds.length === 0) return 0;

    const { count, error } = await supabase
        .from('participantes')
        .select('id', { count: 'exact', head: true })
        .in('plan_id', activeFeedPlanIds)
        .eq('estado', 'pendiente');

    if (error) return 0;
    return count ?? 0;
}

export async function getProfileNotificationCount(userId: string): Promise<{
    total: number;
    friendRequests: number;
    planRequests: number;
    planInvites: number;
}> {
    const [friendRequests, planRequests, planInvites] = await Promise.all([
        getPendingRequestsCount(userId),
        getPlanJoinRequestCount(userId),
        countPendingPlanInvites(userId),
    ]);
    return {
        friendRequests,
        planRequests,
        planInvites,
        total: friendRequests + planRequests + planInvites,
    };
}

import { getPendingRequestsCount } from './friends';
import { countPendingPlanInvites } from './planInvites';
import { supabase } from './supabase';

export async function getPlanJoinRequestCount(userId: string): Promise<number> {
    const { data: myPlans } = await supabase.from('planes').select('id').eq('user_id', userId);
    const ids = (myPlans || []).map((p) => p.id);
    if (ids.length === 0) return 0;

    const { count, error } = await supabase
        .from('participantes')
        .select('id', { count: 'exact', head: true })
        .in('plan_id', ids)
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

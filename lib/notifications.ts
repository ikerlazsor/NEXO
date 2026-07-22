import { getPendingRequestsCount } from './friends';
import { isFeedPlan } from './feedPlans';
import { countPendingPlanInvites } from './planInvites';
import { countOpenRatings } from './ratings';
import { supabase } from './supabase';
import { cacheGetOrFetch, cacheGetStale, cacheInvalidate } from './ttlCache';

const NOTIF_TTL_MS = 40_000;

function notifKey(userId: string) {
    return `notifCount:${userId}`;
}

export type ProfileNotificationCount = {
    total: number;
    friendRequests: number;
    planRequests: number;
    planInvites: number;
    openRatings: number;
};

export async function getPlanJoinRequestCount(userId: string): Promise<number> {
    const { data: myPlans } = await supabase
        .from('planes')
        .select('id, categoria, fecha_evento')
        .eq('creador_id', userId);

    const now = Date.now();

    const activeFeedPlanIds = (myPlans || [])
        .filter((p) => {
            if (!isFeedPlan(p)) return false;
            if (!p.fecha_evento) return true;
            return new Date(p.fecha_evento).getTime() >= now;
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

export function peekProfileNotificationCount(userId: string): ProfileNotificationCount | null {
    return cacheGetStale<ProfileNotificationCount>(notifKey(userId));
}

export function invalidateProfileNotificationCount(userId: string): void {
    cacheInvalidate(notifKey(userId));
}

export async function getProfileNotificationCount(
    userId: string,
    opts?: { force?: boolean },
): Promise<ProfileNotificationCount> {
    return cacheGetOrFetch(
        notifKey(userId),
        NOTIF_TTL_MS,
        async () => {
            const [friendRequests, planRequests, planInvites, openRatings] = await Promise.all([
                getPendingRequestsCount(userId),
                getPlanJoinRequestCount(userId),
                countPendingPlanInvites(userId),
                countOpenRatings(userId),
            ]);
            return {
                friendRequests,
                planRequests,
                planInvites,
                openRatings,
                total: friendRequests + planRequests + planInvites + openRatings,
            };
        },
        opts,
    );
}

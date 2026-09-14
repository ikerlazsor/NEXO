import type { Membership } from './participants';
import { noteFeedInviteCleared, noteFeedMembershipPatch } from './feedReload';
import { invalidatePlanDetailCache, patchPlanDetailMembership } from './planDetailCache';
import { invalidatePlanMembershipCaches, screenCacheKey } from './screenCaches';
import { cacheInvalidate } from './ttlCache';

export type BroadcastMembershipOpts = {
    userId?: string | null;
    /** Incrementa joinedCount en caché de detalle si pasamos a joined. */
    bumpJoined?: boolean;
    /** Decrementa joinedCount si salimos de joined. */
    dropJoined?: boolean;
    /** Quita invitación pendiente del feed / friends. */
    clearInvite?: boolean;
    /** Invalida caché de amigos (lista de invitaciones). */
    invalidateFriends?: boolean;
    /**
     * Si true, borra planDetail cache (forzar refetch completo).
     * Por defecto false: se parchea membership para no perder el estado optimista.
     */
    wipeDetail?: boolean;
};

/**
 * Una sola vía para que join/leave/invite actualicen feed, detalle, listas y badges.
 * Orden: patch de detalle → sticky feed → invalidar listas (sin pisar el patch).
 */
export function broadcastPlanMembership(
    planId: string,
    membership: Membership,
    opts: BroadcastMembershipOpts = {},
): void {
    if (!planId) return;

    if (opts.wipeDetail) {
        invalidatePlanDetailCache(planId);
    } else {
        patchPlanDetailMembership(planId, membership, {
            bumpJoined: opts.bumpJoined,
            dropJoined: opts.dropJoined,
        });
    }

    noteFeedMembershipPatch(planId, membership);

    if (opts.clearInvite) {
        noteFeedInviteCleared(planId);
    }

    if (opts.userId) {
        invalidatePlanMembershipCaches(opts.userId);
        if (opts.clearInvite || opts.invalidateFriends) {
            cacheInvalidate(screenCacheKey.friends(opts.userId));
            void import('./diskCache').then(({ diskRemove }) => {
                void diskRemove(screenCacheKey.friends(opts.userId!));
            });
        }
        void import('./prefetchHome').then(({ schedulePersonalRewarm }) => {
            schedulePersonalRewarm(opts.userId);
        });
        if (membership === 'joined') {
            void import('./prefetchChats').then(({ warmPlanChat }) => {
                void warmPlanChat(planId);
            });
            void import('./planDetailCache').then(({ prefetchPlanDetail }) => {
                void prefetchPlanDetail(planId);
            });
        }
    }
}

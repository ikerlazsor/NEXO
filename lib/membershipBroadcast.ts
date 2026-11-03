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
    /** Burbuja a pintar al instante en el detalle. */
    addParticipant?: {
        id: string;
        nombre: string;
        avatar_url: string | null;
        isCreator?: boolean;
    } | null;
    removeParticipantId?: string | null;
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
            addParticipant: opts.addParticipant ?? null,
            removeParticipantId: opts.removeParticipantId ?? null,
        });
    }

    noteFeedMembershipPatch(planId, membership);

    // Contador de plazas en tarjetas de invitación del chat (sin tocar su UI).
    if (opts.bumpJoined || opts.dropJoined || opts.addParticipant || opts.removeParticipantId) {
        void import('./planInviteCardStatus').then(({ peekInviteCardStatus, setInviteCardStatus }) => {
            const snap = peekInviteCardStatus(planId, opts.userId ?? null);
            if (!snap || snap.status === 'gone') return;
            const base = snap.joinedCount ?? 0;
            const nextJoined = opts.bumpJoined
                ? base + 1
                : opts.dropJoined
                  ? Math.max(0, base - 1)
                  : base;
            setInviteCardStatus(planId, opts.userId ?? null, {
                status: snap.status,
                invite: snap.invite,
                coverUrl: snap.coverUrl,
                joinedCount: nextJoined,
                maxCount: snap.maxCount,
            });
        });
        void import('./inviteCardPeopleBus').then(({ refreshInviteCardPeople }) => {
            void refreshInviteCardPeople(planId);
        });
    }

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

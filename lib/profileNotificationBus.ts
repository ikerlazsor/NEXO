import { cacheGetStale, cacheInvalidate, cacheSet } from './ttlCache';

const listeners = new Set<() => void>();
const NOTIF_COUNT_TTL_MS = 40_000;

export function profileNotifKey(userId: string) {
    return `notifCount:${userId}`;
}

export function subscribeProfileNotifications(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function emitProfileNotificationsChanged() {
    listeners.forEach((l) => {
        try {
            l();
        } catch {
            /* ignore */
        }
    });
}

/** Invalidar badge de notificaciones sin importar `notifications.ts` (rompe ciclos). */
export function invalidateProfileNotificationCount(userId: string): void {
    cacheInvalidate(profileNotifKey(userId));
    emitProfileNotificationsChanged();
}

export type ProfileNotifCountPatch = {
    friendRequests: number;
    planRequests: number;
    planInvites: number;
    openRatings: number;
};

/** Actualiza el badge en memoria y avisa a UI (sin esperar red). */
export function patchProfileNotificationCount(
    userId: string,
    patch: Partial<ProfileNotifCountPatch>,
): void {
    const key = profileNotifKey(userId);
    const prev = cacheGetStale<ProfileNotifCountPatch & { total?: number }>(key);
    const next: ProfileNotifCountPatch = {
        friendRequests: patch.friendRequests ?? prev?.friendRequests ?? 0,
        planRequests: patch.planRequests ?? prev?.planRequests ?? 0,
        planInvites: patch.planInvites ?? prev?.planInvites ?? 0,
        openRatings: patch.openRatings ?? prev?.openRatings ?? 0,
    };
    cacheSet(
        key,
        {
            ...next,
            total: next.friendRequests + next.planRequests + next.planInvites + next.openRatings,
        },
        NOTIF_COUNT_TTL_MS,
    );
    emitProfileNotificationsChanged();
}

export function peekProfileNotificationCountCache<T>(userId: string): T | null {
    return cacheGetStale<T>(profileNotifKey(userId));
}

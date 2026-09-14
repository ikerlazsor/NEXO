/** Claves y TTL compartidos entre pantallas y prefetch al entrar al feed. */

import { cacheInvalidate, cacheInvalidatePrefix } from './ttlCache';

export const ScreenCacheTTL = {
    profileUI: 90_000,
    chatsList: 90_000,
    myPlans: 90_000,
    friends: 45_000,
    savedPlans: 45_000,
    rankings: 90_000,
    feedSnapshot: 60_000,
} as const;

/** Id de caché para rankings globales precargados antes del login. */
export const RANKINGS_PUBLIC_USER = 'public';

export const screenCacheKey = {
    profileUI: (userId: string) => `profileUI:${userId}`,
    chatsList: (userId: string) => `chatsList:${userId}`,
    myPlans: (userId: string) => `myPlans:${userId}`,
    friends: (userId: string) => `friendsScreen:${userId}`,
    savedPlans: (userId: string) => `savedPlans:${userId}`,
    rankings: (userId: string, key: string, scope: string) => `rankings:v5:${userId}:${key}:${scope}`,
    feedSnapshot: 'feedSnapshot',
} as const;

/** Foto, portada, intereses: el perfil propio, el público y el detalle de planes no deben quedar stale. */
export function invalidateProfilePresentationCaches(userId: string | null | undefined): void {
    if (!userId) return;
    cacheInvalidate(screenCacheKey.profileUI(userId));
    cacheInvalidate(`userProfile:${userId}`);
    cacheInvalidate(screenCacheKey.feedSnapshot);
    cacheInvalidatePrefix('planDetail:');
}

/** Tras unirse/salir/crear: evita que Mis planes / Chats / feed / Guardados queden stale. */
export function invalidatePlanMembershipCaches(userId: string | null | undefined): void {
    if (!userId) return;
    cacheInvalidate(screenCacheKey.myPlans(userId));
    cacheInvalidate(screenCacheKey.chatsList(userId));
    cacheInvalidate(screenCacheKey.savedPlans(userId));
    cacheInvalidate(screenCacheKey.feedSnapshot);
    void import('./diskCache').then(({ diskRemove }) => {
        void diskRemove(screenCacheKey.myPlans(userId));
        void diskRemove(screenCacheKey.chatsList(userId));
        void diskRemove(screenCacheKey.savedPlans(userId));
        void diskRemove(screenCacheKey.feedSnapshot);
    });
}

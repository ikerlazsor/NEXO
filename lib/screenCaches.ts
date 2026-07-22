/** Claves y TTL compartidos entre pantallas y prefetch al entrar al feed. */

export const ScreenCacheTTL = {
    profileUI: 90_000,
    chatsList: 45_000,
    myPlans: 45_000,
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
    rankings: (userId: string, key: string, scope: string) => `rankings:${userId}:${key}:${scope}`,
    feedSnapshot: 'feedSnapshot',
} as const;

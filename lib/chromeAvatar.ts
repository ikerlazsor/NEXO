import { diskGet, diskSet } from './diskCache';
import { cacheGetStale, cacheSet } from './ttlCache';

export const CHROME_AVATAR_TTL_MS = 24 * 60 * 60 * 1000;
export const chromeAvatarKey = (userId: string) => `chromeAvatar:${userId}`;

/** Lee avatar ya conocido (memoria). */
export function peekChromeAvatar(userId: string | null | undefined): string | null {
    if (!userId) return null;
    const cached = cacheGetStale<string | null>(chromeAvatarKey(userId));
    return cached === undefined ? null : cached;
}

/** Guarda avatar para el chrome (memoria + disco). */
export function rememberChromeAvatar(userId: string | null | undefined, avatarUrl: string | null): void {
    if (!userId) return;
    cacheSet(chromeAvatarKey(userId), avatarUrl, CHROME_AVATAR_TTL_MS);
    void diskSet(chromeAvatarKey(userId), avatarUrl);
}

/** Hidrata memoria desde disco (cold start). */
export async function hydrateChromeAvatarFromDisk(
    userId: string | null | undefined,
): Promise<string | null> {
    if (!userId) return null;
    const mem = peekChromeAvatar(userId);
    if (mem) return mem;
    const fromDisk = await diskGet<string | null>(chromeAvatarKey(userId), CHROME_AVATAR_TTL_MS);
    if (fromDisk === null || fromDisk === undefined) return null;
    cacheSet(chromeAvatarKey(userId), fromDisk, CHROME_AVATAR_TTL_MS);
    return fromDisk;
}

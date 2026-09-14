import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { diskGet, diskSet } from './diskCache';
import { cacheGetStale, cacheIsFresh, cacheSet } from './ttlCache';

export type UserCoords = { latitude: number; longitude: number };

const COORDS_KEY = 'userCoords';
const COORDS_TTL_MS = 5 * 60 * 1000;
const COORDS_DISK_KEY = 'userCoords';
const COORDS_DISK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function isValidCoords(value: unknown): value is UserCoords {
    if (!value || typeof value !== 'object') return false;
    const c = value as UserCoords;
    return Number.isFinite(c.latitude) && Number.isFinite(c.longitude);
}

function rememberCoords(coords: UserCoords): UserCoords {
    cacheSet(COORDS_KEY, coords, COORDS_TTL_MS);
    void diskSet(COORDS_DISK_KEY, coords);
    return coords;
}

/** Restaura la última GPS conocida (feed “Cerca” / ranking sin red). */
export async function hydrateUserCoordsFromDisk(): Promise<UserCoords | null> {
    const live = cacheGetStale<UserCoords>(COORDS_KEY);
    if (isValidCoords(live)) return live;
    const stored = await diskGet<UserCoords>(COORDS_DISK_KEY, COORDS_DISK_MAX_AGE_MS);
    if (!isValidCoords(stored)) return null;
    cacheSet(COORDS_KEY, stored, COORDS_TTL_MS);
    return stored;
}

/** Pide permiso (si hace falta) y devuelve la ubicación actual. */
export async function getUserCoords(opts?: {
    requestPermission?: boolean;
    force?: boolean;
}): Promise<UserCoords | null> {
    if (Platform.OS === 'web') return null;

    if (!opts?.force && cacheIsFresh(COORDS_KEY)) {
        return cacheGetStale<UserCoords>(COORDS_KEY);
    }

    try {
        let { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted' && opts?.requestPermission !== false) {
            ({ status } = await Location.requestForegroundPermissionsAsync());
        }
        if (status !== 'granted') {
            return peekUserCoords() ?? (await hydrateUserCoordsFromDisk());
        }

        const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
        });
        return rememberCoords({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
        });
    } catch {
        return peekUserCoords() ?? (await hydrateUserCoordsFromDisk());
    }
}

export function peekUserCoords(): UserCoords | null {
    const live = cacheGetStale<UserCoords>(COORDS_KEY);
    return isValidCoords(live) ? live : null;
}

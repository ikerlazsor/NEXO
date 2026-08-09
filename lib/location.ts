import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { cacheGetStale, cacheIsFresh, cacheSet } from './ttlCache';

export type UserCoords = { latitude: number; longitude: number };

const COORDS_KEY = 'userCoords';
const COORDS_TTL_MS = 5 * 60 * 1000;

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
        if (status !== 'granted') return null;

        const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
        });
        const coords: UserCoords = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
        };
        cacheSet(COORDS_KEY, coords, COORDS_TTL_MS);
        return coords;
    } catch {
        return cacheGetStale<UserCoords>(COORDS_KEY);
    }
}

export function peekUserCoords(): UserCoords | null {
    return cacheGetStale<UserCoords>(COORDS_KEY);
}

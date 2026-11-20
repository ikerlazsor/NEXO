import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { diskGet, diskSet } from './diskCache';
import { cacheGetStale, cacheIsFresh, cacheSet } from './ttlCache';

export type UserCoords = { latitude: number; longitude: number };
/** Coordenadas guardadas con la hora en que se tomaron (las antiguas no la tienen). */
type StoredCoords = UserCoords & { at?: number };

const COORDS_KEY = 'userCoords';
const COORDS_TTL_MS = 5 * 60 * 1000;
const COORDS_DISK_KEY = 'userCoords';
const COORDS_DISK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** En Android real getCurrentPositionAsync a veces no resuelve nunca → mapa “pensando”. */
const POSITION_TIMEOUT_MS = 8_000;
/** La última posición del sistema solo vale como “actual” si es así de reciente. */
const LAST_KNOWN_MAX_AGE_MS = 2 * 60 * 1000;

function isValidCoords(value: unknown): value is UserCoords {
    if (!value || typeof value !== 'object') return false;
    const c = value as UserCoords;
    return Number.isFinite(c.latitude) && Number.isFinite(c.longitude);
}

function rememberCoords(coords: UserCoords, at = Date.now()): UserCoords {
    const stored: StoredCoords = { latitude: coords.latitude, longitude: coords.longitude, at };
    cacheSet(COORDS_KEY, stored, COORDS_TTL_MS);
    void diskSet(COORDS_DISK_KEY, stored);
    return stored;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('location_timeout')), ms);
        promise.then(
            (v) => {
                clearTimeout(t);
                resolve(v);
            },
            (e) => {
                clearTimeout(t);
                reject(e);
            },
        );
    });
}

/** Restaura la última GPS conocida (feed “Cerca” / ranking sin red). */
export async function hydrateUserCoordsFromDisk(): Promise<UserCoords | null> {
    const live = cacheGetStale<UserCoords>(COORDS_KEY);
    if (isValidCoords(live)) return live;
    const stored = await diskGet<StoredCoords>(COORDS_DISK_KEY, COORDS_DISK_MAX_AGE_MS);
    if (!isValidCoords(stored)) return null;
    // Sirve para ordenar el feed sin GPS, pero no cuenta como posición actual:
    // así la siguiente getUserCoords pide una nueva en vez de devolver esta.
    const age = typeof stored.at === 'number' ? Date.now() - stored.at : Number.POSITIVE_INFINITY;
    cacheSet(COORDS_KEY, stored, Math.max(1, COORDS_TTL_MS - age));
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

        // lastKnown primero: en testers Android evita quedar bloqueado en GPS frío.
        // Solo si es reciente: una de hace horas es otro sitio (el mapa abría allí).
        let stale: UserCoords | null = null;
        try {
            const last = await Location.getLastKnownPositionAsync();
            const fresh = last != null && Date.now() - last.timestamp <= LAST_KNOWN_MAX_AGE_MS;
            if (last?.coords && Number.isFinite(last.coords.latitude) && !fresh) {
                stale = { latitude: last.coords.latitude, longitude: last.coords.longitude };
            }
            if (last?.coords && Number.isFinite(last.coords.latitude) && fresh) {
                const quick = rememberCoords({
                    latitude: last.coords.latitude,
                    longitude: last.coords.longitude,
                }, last.timestamp);
                // Refresco en background (sin await).
                void Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
                    .then((pos) => {
                        rememberCoords({
                            latitude: pos.coords.latitude,
                            longitude: pos.coords.longitude,
                        });
                    })
                    .catch(() => undefined);
                return quick;
            }
        } catch {
            /* seguir a current */
        }

        try {
            const pos = await withTimeout(
                Location.getCurrentPositionAsync({
                    accuracy: Location.Accuracy.Balanced,
                }),
                POSITION_TIMEOUT_MS,
            );
            return rememberCoords({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
            });
        } catch (e) {
            // Sin GPS a tiempo: mejor la última conocida que nada (feed “Cerca”).
            if (stale) return stale;
            throw e;
        }
    } catch {
        return peekUserCoords() ?? (await hydrateUserCoordsFromDisk());
    }
}

/**
 * Posición tomada hace como mucho `maxAgeMs` (null si no hay o es vieja).
 * El mapa la usa para no abrir encima de un sitio donde estuviste hace días.
 */
export function peekRecentUserCoords(maxAgeMs: number): UserCoords | null {
    const live = cacheGetStale<StoredCoords>(COORDS_KEY);
    if (!isValidCoords(live) || typeof live.at !== 'number') return null;
    return Date.now() - live.at <= maxAgeMs ? live : null;
}

export function peekUserCoords(): UserCoords | null {
    const live = cacheGetStale<UserCoords>(COORDS_KEY);
    return isValidCoords(live) ? live : null;
}

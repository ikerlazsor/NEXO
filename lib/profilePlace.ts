import { shouldPreferProfileCache } from './profileOptimistic';
import { invalidateProfilePresentationCaches } from './screenCaches';
import { supabase } from './supabase';
import * as Location from 'expo-location';
import type { UserCoords } from './location';
import { getUserCoords, hydrateUserCoordsFromDisk, peekUserCoords } from './location';
import { reverseGeocodeCityCountry } from './geocoding';

export type ProfilePlace = {
    ciudad: string;
    pais: string;
};

const PLACE_CITY_MAX = 48;
const PLACE_COUNTRY_MAX = 48;

export function formatProfilePlace(place: ProfilePlace | null | undefined): string | null {
    if (!place?.ciudad) return null;
    const city = place.ciudad.trim();
    const country = (place.pais || '').trim();
    if (!city) return null;
    if (!country || country.toLowerCase() === city.toLowerCase()) return city;
    return `${city}, ${country}`;
}

export function parseProfilePlace(perfilGustos: unknown): ProfilePlace | null {
    if (!perfilGustos || typeof perfilGustos !== 'object') return null;
    const raw = (perfilGustos as Record<string, unknown>).ubicacion;
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const ciudad = typeof o.ciudad === 'string' ? o.ciudad.trim() : '';
    const pais = typeof o.pais === 'string' ? o.pais.trim() : '';
    if (!ciudad) return null;
    return {
        ciudad: ciudad.slice(0, PLACE_CITY_MAX),
        pais: pais.slice(0, PLACE_COUNTRY_MAX),
    };
}

export function isManualProfilePlace(perfilGustos: unknown): boolean {
    if (!perfilGustos || typeof perfilGustos !== 'object') return false;
    return (perfilGustos as Record<string, unknown>).ubicacion_manual === true;
}

export function mergePerfilGustosPlace(
    existing: unknown,
    place: ProfilePlace | null | undefined,
    opts?: { manual?: boolean; clear?: boolean },
): Record<string, unknown> {
    const base =
        existing && typeof existing === 'object' ? { ...(existing as Record<string, unknown>) } : {};
    if (place?.ciudad?.trim()) {
        base.ubicacion = {
            ciudad: place.ciudad.trim().slice(0, PLACE_CITY_MAX),
            pais: (place.pais || '').trim().slice(0, PLACE_COUNTRY_MAX),
        };
        if (opts?.manual) base.ubicacion_manual = true;
    } else if (opts?.clear) {
        // Solo borrar cuando se pide explícitamente (nunca en autosaves con place=null).
        delete base.ubicacion;
        delete base.ubicacion_manual;
    }
    // place null/undefined sin clear → dejar la ubicación que ya hubiera.
    return base;
}

/** Instagram handle sin @. */
export const INSTAGRAM_MIN = 3;
export const INSTAGRAM_MAX = 30;

export function parseInstagramHandle(perfilGustos: unknown): string | null {
    if (!perfilGustos || typeof perfilGustos !== 'object') return null;
    const raw = (perfilGustos as Record<string, unknown>).instagram;
    if (typeof raw !== 'string') return null;
    const handle = raw.trim().replace(/^@+/, '');
    return handle || null;
}

export function normalizeInstagramHandle(raw: string): string {
    return raw.trim().replace(/^@+/, '').replace(/\s+/g, '');
}

export function validateInstagramHandle(raw: string): 'ok' | 'short' | 'long' | 'invalid' {
    const handle = normalizeInstagramHandle(raw);
    if (!handle) return 'short';
    if (handle.length < INSTAGRAM_MIN) return 'short';
    if (handle.length > INSTAGRAM_MAX) return 'long';
    if (!/^[A-Za-z0-9._]+$/.test(handle)) return 'invalid';
    return 'ok';
}

export function mergePerfilGustosInstagram(
    existing: unknown,
    handle: string | null,
): Record<string, unknown> {
    const base =
        existing && typeof existing === 'object' ? { ...(existing as Record<string, unknown>) } : {};
    const normalized = handle ? normalizeInstagramHandle(handle) : '';
    if (normalized) base.instagram = normalized.slice(0, INSTAGRAM_MAX);
    else delete base.instagram;
    return base;
}

/** Ciudad/país aproximados a partir de coords (sin guardar lat/lng). */
export async function reverseGeocodePlace(coords: UserCoords): Promise<ProfilePlace | null> {
    const fromWeb = await reverseGeocodeCityCountry(coords.latitude, coords.longitude);
    if (fromWeb?.ciudad) {
        return {
            ciudad: fromWeb.ciudad.slice(0, PLACE_CITY_MAX),
            pais: fromWeb.pais.slice(0, PLACE_COUNTRY_MAX),
        };
    }

    try {
        const rows = await Location.reverseGeocodeAsync({
            latitude: coords.latitude,
            longitude: coords.longitude,
        });
        const row = rows[0];
        if (!row) return null;
        const ciudad =
            (row.city || row.subregion || row.district || row.region || '').trim();
        const pais = (row.country || '').trim();
        if (!ciudad) return null;
        return {
            ciudad: ciudad.slice(0, PLACE_CITY_MAX),
            pais: pais.slice(0, PLACE_COUNTRY_MAX),
        };
    } catch {
        return null;
    }
}

/**
 * Guarda la nacionalidad (ISO) sin pisar el resto de perfil_gustos.
 */
export async function setPerfilNacionalidad(
    countryCode: string | null,
): Promise<{ error: string | null }> {
    const { error } = await supabase.rpc('set_perfil_nacionalidad', {
        p_pais: countryCode ? countryCode.toUpperCase() : null,
    });
    return { error: error?.message ?? null };
}

/**
 * Guarda o limpia la ubicación del perfil (edición manual).
 * No pisa nacionalidad ni otros campos de perfil_gustos.
 */
export async function setPerfilUbicacion(
    place: ProfilePlace | null,
): Promise<{ error: string | null }> {
    const { error } = await supabase.rpc('set_perfil_ubicacion_manual', {
        p_ciudad: place?.ciudad?.trim() || null,
        p_pais: place?.pais?.trim() || null,
    });
    return { error: error?.message ?? null };
}

export function placesEqual(
    a: ProfilePlace | null | undefined,
    b: ProfilePlace | null | undefined,
): boolean {
    return (a?.ciudad || '').trim() === (b?.ciudad || '').trim()
        && (a?.pais || '').trim() === (b?.pais || '').trim();
}

/**
 * Si el usuario ya dio permiso de ubicación y no tiene ciudad guardada,
 * la rellena vía RPC (no pisa nacionalidad, ubicación manual ni otros campos).
 */
export async function ensureAutoProfilePlace(userId: string | null | undefined): Promise<ProfilePlace | null> {
    if (!userId) return null;
    if (shouldPreferProfileCache()) return null;
    try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') return null;

        const { data } = await supabase
            .from('perfiles')
            .select('perfil_gustos')
            .eq('id', userId)
            .maybeSingle();
        const gustos = (data?.perfil_gustos as Record<string, unknown> | null) ?? null;
        // Elegida a mano → nunca tocar.
        if (isManualProfilePlace(gustos)) {
            return parseProfilePlace(gustos);
        }
        const existing = parseProfilePlace(gustos);
        if (existing?.ciudad) return existing;

        const coords =
            (await getUserCoords({ requestPermission: false, force: true })) ??
            peekUserCoords() ??
            (await hydrateUserCoordsFromDisk());
        if (!coords) return null;
        const place = await reverseGeocodePlace(coords);
        if (!place) return null;
        if (shouldPreferProfileCache()) return null;
        // Releer: puede haberse guardado a mano mientras geocodificábamos.
        const { data: again } = await supabase
            .from('perfiles')
            .select('perfil_gustos')
            .eq('id', userId)
            .maybeSingle();
        const gustos2 = (again?.perfil_gustos as Record<string, unknown> | null) ?? null;
        if (isManualProfilePlace(gustos2) || parseProfilePlace(gustos2)?.ciudad) {
            return parseProfilePlace(gustos2);
        }

        const { error } = await supabase.rpc('set_perfil_ubicacion', {
            p_ciudad: place.ciudad,
            p_pais: place.pais || '',
        });
        if (error) return null;
        invalidateProfilePresentationCaches(userId);
        return place;
    } catch {
        return null;
    }
}

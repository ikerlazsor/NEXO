import { Linking, Platform } from 'react-native';

const EARTH_KM = 6371;

/** Comprueba si unas coordenadas están en España (península, Baleares o Canarias). */
export function isLocationInSpain(lat: number, lng: number): boolean {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    const peninsula =
        lat >= 35.9 && lat <= 43.85 && lng >= -9.45 && lng <= 4.45;
    const canarias =
        lat >= 27.5 && lat <= 29.5 && lng >= -18.3 && lng <= -13.2;
    return peninsula || canarias;
}

/** Distancia en km entre dos coordenadas (haversine). */
export function distanceKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
): number {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return EARTH_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistanceKm(km: number, lang: 'es' | 'en' | string = 'es'): string {
    if (!Number.isFinite(km)) return '—';
    if (km < 1) {
        const m = Math.max(1, Math.round(km * 1000));
        return lang === 'en' ? `${m} m away` : `A ${m} m`;
    }
    const rounded = km < 10 ? km.toFixed(1) : String(Math.round(km));
    return lang === 'en' ? `${rounded} km away` : `A ${rounded} km`;
}

/** Abre Apple Maps / Google Maps con indicaciones hasta el destino. */
export async function openDirectionsTo(
    latitude: number,
    longitude: number,
    label?: string | null,
): Promise<void> {
    const lat = latitude.toFixed(6);
    const lng = longitude.toFixed(6);
    const q = encodeURIComponent(label?.trim() || `${lat},${lng}`);

    const candidates =
        Platform.OS === 'ios'
            ? [
                  `maps://?daddr=${lat},${lng}&dirflg=d`,
                  `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`,
                  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=&travelmode=driving`,
              ]
            : [
                  `google.navigation:q=${lat},${lng}`,
                  `geo:0,0?q=${lat},${lng}(${q})`,
                  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
              ];

    for (const url of candidates) {
        try {
            const can = await Linking.canOpenURL(url);
            if (can) {
                await Linking.openURL(url);
                return;
            }
        } catch {
            // probar siguiente
        }
    }

    await Linking.openURL(
        `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
    );
}

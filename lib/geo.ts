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

/** Islas europeas al sur de lat 36 (el bbox principal las excluye a propósito). */
function isSouthernEuropeanException(lat: number, lng: number): boolean {
    const malta = lat >= 35.7 && lat <= 36.15 && lng >= 14.1 && lng <= 14.65;
    const crete = lat >= 34.8 && lat <= 35.75 && lng >= 23.4 && lng <= 26.4;
    const cyprus = lat >= 34.5 && lat <= 35.75 && lng >= 32.2 && lng <= 34.65;
    const southAegean =
        lat >= 35.3 && lat <= 36.0 && lng >= 26.3 && lng <= 28.3;
    return malta || crete || cyprus || southAegean;
}

/**
 * Europa (aprox.) sin el rectángulo que se comía el Magreb.
 * Caja principal desde lat 36 + islas atlánticas + excepciones mediterráneas.
 */
export function isLocationInEurope(lat: number, lng: number): boolean {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;

    const mainland =
        lat >= 36.0 && lat <= 71.5 && lng >= -25 && lng <= 45;
    const canarias =
        lat >= 27.5 && lat <= 29.5 && lng >= -18.3 && lng <= -13.2;
    const azores =
        lat >= 36.9 && lat <= 39.8 && lng >= -31.3 && lng <= -24.9;
    const madeira =
        lat >= 32.4 && lat <= 33.2 && lng >= -17.3 && lng <= -16.2;

    if (mainland || canarias || azores || madeira) return true;
    return isSouthernEuropeanException(lat, lng);
}

/** Distancia en km entre dos coordenadas (haversine). */
/** Caja aproximada de `km` alrededor de un punto (para consultas geo). */
export function boundingBox(
    lat: number,
    lng: number,
    km: number,
): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
    const dLat = km / 111;
    const cos = Math.cos((lat * Math.PI) / 180);
    const dLng = km / (111 * Math.max(0.2, Math.abs(cos)));
    return {
        minLat: lat - dLat,
        maxLat: lat + dLat,
        minLng: lng - dLng,
        maxLng: lng + dLng,
    };
}

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

export function formatDistanceKm(km: number, lang: string = 'es'): string {
    if (!Number.isFinite(km)) return '—';
    const code = (lang || 'en').toLowerCase().split('-')[0];
    if (km < 1) {
        const m = Math.max(1, Math.round(km * 1000));
        if (code === 'es') return `A ${m} m`;
        if (code === 'fr') return `À ${m} m`;
        if (code === 'de') return `${m} m entfernt`;
        if (code === 'pt') return `A ${m} m`;
        if (code === 'it') return `A ${m} m`;
        return `${m} m away`;
    }
    const rounded = km < 10 ? km.toFixed(1) : String(Math.round(km));
    if (code === 'es') return `A ${rounded} km`;
    if (code === 'fr') return `À ${rounded} km`;
    if (code === 'de') return `${rounded} km entfernt`;
    if (code === 'pt') return `A ${rounded} km`;
    if (code === 'it') return `A ${rounded} km`;
    return `${rounded} km away`;
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

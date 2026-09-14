import { Platform } from 'react-native';

export type GeocodeResult = {
    id: string;
    latitude: number;
    longitude: number;
    label: string;
    subtitle: string;
};

const USER_AGENT = `Nexo!/1.0 (${Platform.OS})`;

function formatPhotonFeature(feat: {
    geometry: { coordinates: [number, number] };
    properties: Record<string, string | undefined>;
}): GeocodeResult {
    const props = feat.properties;
    const name = props.name || props.street || props.city || '';
    const city = props.city || props.state || '';
    const country = props.country || '';
    const parts = [props.street, props.housenumber, city, country].filter(Boolean);
    const subtitle = parts.join(', ') || name;
    return {
        id: `photon-${feat.geometry.coordinates.join(',')}-${name}`,
        latitude: feat.geometry.coordinates[1],
        longitude: feat.geometry.coordinates[0],
        label: name || subtitle || '—',
        subtitle,
    };
}

async function searchPhoton(
    query: string,
    bias?: { lat: number; lon: number },
): Promise<GeocodeResult[]> {
    let url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=12`;
    if (bias) url += `&lat=${bias.lat}&lon=${bias.lon}`;
    const response = await fetch(url);
    if (!response.ok) return [];
    const data = await response.json();
    if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) return [];
    return data.features.map(formatPhotonFeature);
}

async function searchNominatim(query: string): Promise<GeocodeResult[]> {
    const url =
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}` +
        `&format=json&limit=8&addressdetails=1`;
    const response = await fetch(url, {
        headers: {
            Accept: 'application/json',
            'Accept-Language': 'en',
            'User-Agent': USER_AGENT,
        },
    });
    if (!response.ok) return [];
    const data = await response.json();
    if (!Array.isArray(data)) return [];
    return data.map((item: { place_id: number; lat: string; lon: string; name?: string; display_name: string }) => ({
        id: `nominatim-${item.place_id}`,
        latitude: parseFloat(item.lat),
        longitude: parseFloat(item.lon),
        label: item.name || item.display_name.split(',')[0]?.trim() || item.display_name,
        subtitle: item.display_name,
    }));
}

/** Busca lugares en todo el mundo (Photon + Nominatim). El bias acerca resultados al mapa actual. */
export async function searchPlaces(
    query: string,
    bias?: { lat: number; lon: number } | null,
): Promise<GeocodeResult[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    const photon = await searchPhoton(trimmed, bias ?? undefined);
    if (photon.length > 0) return photon.slice(0, 8);

    return (await searchNominatim(trimmed)).slice(0, 8);
}

/** Dirección legible a partir de coordenadas. */
export async function reverseGeocodePlace(lat: number, lon: number): Promise<string> {
    try {
        const response = await fetch(
            `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}`,
        );
        if (response.ok) {
            const data = await response.json();
            if (data?.features?.[0]) {
                const f = formatPhotonFeature(data.features[0]);
                return f.subtitle || f.label;
            }
        }
    } catch {
        /* try nominatim */
    }

    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`,
            {
                headers: {
                    Accept: 'application/json',
                    'Accept-Language': 'en',
                    'User-Agent': USER_AGENT,
                },
            },
        );
        if (response.ok) {
            const data = await response.json();
            if (data?.display_name) return data.display_name as string;
        }
    } catch {
        /* fallback coords */
    }

    return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

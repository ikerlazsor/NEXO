import { Platform } from 'react-native';

export type GeocodeResult = {
    id: string;
    latitude: number;
    longitude: number;
    label: string;
    subtitle: string;
};

export type CitySearchResult = {
    id: string;
    ciudad: string;
    pais: string;
    label: string;
};

const USER_AGENT = `Nexo!/1.0 (${Platform.OS})`;

const CITY_PLACE_TYPES = new Set([
    'city',
    'town',
    'village',
    'municipality',
    'borough',
    'suburb',
    'hamlet',
    'locality',
    'county',
]);

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

function photonCityFromFeature(feat: {
    geometry: { coordinates: [number, number] };
    properties: Record<string, string | number | undefined>;
}): CitySearchResult | null {
    const props = feat.properties;
    const type = String(props.type || props.osm_value || '').toLowerCase();
    const ciudad = String(props.name || props.city || '').trim();
    const pais = String(props.country || '').trim();
    if (!ciudad) return null;
    // Skip street-level hits
    if (props.street || props.housenumber) return null;
    if (type && !CITY_PLACE_TYPES.has(type)) return null;
    return {
        id: `city-photon-${feat.geometry.coordinates.join(',')}-${ciudad}-${pais}`,
        ciudad: ciudad.slice(0, 48),
        pais: pais.slice(0, 48),
        label: pais ? `${ciudad}, ${pais}` : ciudad,
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

async function searchPhotonCities(query: string): Promise<CitySearchResult[]> {
    const url =
        `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=15` +
        `&osm_tag=place:city&osm_tag=place:town&osm_tag=place:village&osm_tag=place:municipality`;
    const response = await fetch(url);
    if (!response.ok) return [];
    const data = await response.json();
    if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) return [];
    const out: CitySearchResult[] = [];
    const seen = new Set<string>();
    for (const feat of data.features) {
        const city = photonCityFromFeature(feat);
        if (!city) continue;
        const key = `${city.ciudad.toLowerCase()}|${city.pais.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(city);
    }
    return out;
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

async function searchNominatimCities(query: string): Promise<CitySearchResult[]> {
    const url =
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}` +
        `&format=json&limit=10&addressdetails=1&featuretype=city`;
    const response = await fetch(url, {
        headers: {
            Accept: 'application/json',
            'Accept-Language': 'es',
            'User-Agent': USER_AGENT,
        },
    });
    if (!response.ok) return [];
    const data = await response.json();
    if (!Array.isArray(data)) return [];
    const out: CitySearchResult[] = [];
    const seen = new Set<string>();
    for (const item of data as Array<{
        place_id: number;
        name?: string;
        display_name: string;
        address?: Record<string, string>;
    }>) {
        const addr = item.address || {};
        const ciudad = (
            addr.city ||
            addr.town ||
            addr.village ||
            addr.municipality ||
            item.name ||
            item.display_name.split(',')[0] ||
            ''
        ).trim();
        const pais = (addr.country || '').trim();
        if (!ciudad) continue;
        const key = `${ciudad.toLowerCase()}|${pais.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
            id: `city-nominatim-${item.place_id}`,
            ciudad: ciudad.slice(0, 48),
            pais: pais.slice(0, 48),
            label: pais ? `${ciudad}, ${pais}` : ciudad,
        });
    }
    return out;
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

/** Solo ciudades/pueblos (sin calles ni direcciones). */
export async function searchCities(query: string): Promise<CitySearchResult[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    const photon = await searchPhotonCities(trimmed);
    if (photon.length > 0) return photon.slice(0, 8);

    return (await searchNominatimCities(trimmed)).slice(0, 8);
}

/** Ciudad + país a partir de coordenadas (Photon → Nominatim). */
export async function reverseGeocodeCityCountry(
    lat: number,
    lon: number,
): Promise<{ ciudad: string; pais: string } | null> {
    try {
        const response = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}`);
        if (response.ok) {
            const data = await response.json();
            const props = data?.features?.[0]?.properties as Record<string, string | undefined> | undefined;
            if (props) {
                const ciudad = (
                    props.city ||
                    props.town ||
                    props.village ||
                    props.municipality ||
                    props.name ||
                    props.county ||
                    ''
                ).trim();
                const pais = (props.country || '').trim();
                if (ciudad) {
                    return {
                        ciudad: ciudad.slice(0, 48),
                        pais: pais.slice(0, 48),
                    };
                }
            }
        }
    } catch {
        /* nominatim */
    }

    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`,
            {
                headers: {
                    Accept: 'application/json',
                    'Accept-Language': 'es',
                    'User-Agent': USER_AGENT,
                },
            },
        );
        if (response.ok) {
            const data = await response.json();
            const addr = (data?.address || {}) as Record<string, string>;
            const ciudad = (
                addr.city ||
                addr.town ||
                addr.village ||
                addr.municipality ||
                addr.county ||
                ''
            ).trim();
            const pais = (addr.country || '').trim();
            if (ciudad) {
                return {
                    ciudad: ciudad.slice(0, 48),
                    pais: pais.slice(0, 48),
                };
            }
        }
    } catch {
        /* null */
    }
    return null;
}

/** Dirección legible a partir de coordenadas. */
export async function reverseGeocodePlace(lat: number, lon: number): Promise<string> {
    try {
        const response = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}`);
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

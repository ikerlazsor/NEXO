/** Provincias de España para filtros del feed. */

export const SPAIN_PROVINCES = [
    'Álava',
    'Albacete',
    'Alicante',
    'Almería',
    'Asturias',
    'Ávila',
    'Badajoz',
    'Barcelona',
    'Burgos',
    'Cáceres',
    'Cádiz',
    'Cantabria',
    'Castellón',
    'Ciudad Real',
    'Córdoba',
    'Cuenca',
    'Girona',
    'Granada',
    'Guadalajara',
    'Guipúzcoa',
    'Huelva',
    'Huesca',
    'Illes Balears',
    'Jaén',
    'La Coruña',
    'La Rioja',
    'Las Palmas',
    'León',
    'Lleida',
    'Lugo',
    'Madrid',
    'Málaga',
    'Murcia',
    'Navarra',
    'Ourense',
    'Palencia',
    'Pontevedra',
    'Salamanca',
    'Santa Cruz de Tenerife',
    'Segovia',
    'Sevilla',
    'Soria',
    'Tarragona',
    'Teruel',
    'Toledo',
    'Valencia',
    'Valladolid',
    'Vizcaya',
    'Zamora',
    'Zaragoza',
] as const;

export type SpainProvince = (typeof SPAIN_PROVINCES)[number];

function stripAccents(s: string): string {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function norm(s: string): string {
    return stripAccents(String(s || '').toLowerCase()).replace(/\s+/g, ' ').trim();
}

/** Alias frecuentes en direcciones geocodificadas. */
const PROVINCE_ALIASES: Record<string, string[]> = {
    Madrid: ['madrid', 'comunidad de madrid'],
    Barcelona: ['barcelona', 'barcelones', 'barcelonès'],
    Valencia: ['valencia', 'valència', 'comunitat valenciana'],
    Sevilla: ['sevilla'],
    Málaga: ['malaga', 'málaga', 'costa del sol'],
    Alicante: ['alicante', 'alacant'],
    Murcia: ['murcia', 'region de murcia'],
    Zaragoza: ['zaragoza'],
    'Illes Balears': ['baleares', 'illes balears', 'mallorca', 'menorca', 'ibiza', 'eivissa', 'palma'],
    'Las Palmas': ['las palmas', 'gran canaria', 'fuerteventura', 'lanzarote'],
    'Santa Cruz de Tenerife': ['tenerife', 'santa cruz de tenerife', 'la palma', 'la gomera', 'el hierro'],
    Asturias: ['asturias', 'oviedo', 'gijon', 'gijón'],
    Cantabria: ['cantabria', 'santander'],
    Navarra: ['navarra', 'navarre', 'pamplona', 'iruña', 'iruna'],
    'La Rioja': ['la rioja', 'logrono', 'logroño'],
    'La Coruña': ['a coruna', 'la coruna', 'coruña', 'coruna', 'galicia'],
    Pontevedra: ['pontevedra', 'vigo'],
    'Álava': ['alava', 'araba', 'vitoria', 'gasteiz'],
    Vizcaya: ['vizcaya', 'bizkaia', 'bilbao'],
    Guipúzcoa: ['guipuzcoa', 'gipuzkoa', 'san sebastian', 'donostia'],
    Castellón: ['castellon', 'castelló', 'castello'],
    Girona: ['girona', 'gerona'],
    Lleida: ['lleida', 'lerida'],
    Ourense: ['ourense', 'orense'],
    Cádiz: ['cadiz', 'cádiz'],
    Córdoba: ['cordoba', 'córdoba'],
    Jaén: ['jaen', 'jaén'],
    León: ['leon', 'león'],
    Cáceres: ['caceres', 'cáceres'],
    Ávila: ['avila', 'ávila'],
};

/** Centros aproximados + radio (km) para fallback por coordenadas. */
const PROVINCE_GEO: Partial<Record<string, { lat: number; lng: number; r: number }>> = {
    Madrid: { lat: 40.42, lng: -3.70, r: 65 },
    Barcelona: { lat: 41.39, lng: 2.17, r: 55 },
    Valencia: { lat: 39.47, lng: -0.38, r: 50 },
    Sevilla: { lat: 37.39, lng: -5.99, r: 55 },
    Málaga: { lat: 36.72, lng: -4.42, r: 50 },
    Alicante: { lat: 38.35, lng: -0.49, r: 45 },
    Murcia: { lat: 37.99, lng: -1.13, r: 50 },
    Zaragoza: { lat: 41.65, lng: -0.88, r: 55 },
    Bilbao: { lat: 43.26, lng: -2.93, r: 40 },
    Vizcaya: { lat: 43.26, lng: -2.93, r: 45 },
    'Álava': { lat: 42.85, lng: -2.67, r: 40 },
    Guipúzcoa: { lat: 43.32, lng: -1.98, r: 40 },
    Asturias: { lat: 43.36, lng: -5.85, r: 70 },
    Cantabria: { lat: 43.18, lng: -3.99, r: 55 },
    Navarra: { lat: 42.82, lng: -1.64, r: 55 },
    'La Rioja': { lat: 42.29, lng: -2.49, r: 40 },
    Granada: { lat: 37.18, lng: -3.60, r: 50 },
    Córdoba: { lat: 37.89, lng: -4.78, r: 50 },
    Cádiz: { lat: 36.52, lng: -6.28, r: 55 },
    'Illes Balears': { lat: 39.57, lng: 2.65, r: 90 },
    'Las Palmas': { lat: 28.12, lng: -15.43, r: 120 },
    'Santa Cruz de Tenerife': { lat: 28.47, lng: -16.25, r: 100 },
    Toledo: { lat: 39.86, lng: -4.02, r: 50 },
    Valladolid: { lat: 41.65, lng: -4.72, r: 45 },
    Salamanca: { lat: 40.97, lng: -5.66, r: 45 },
    'La Coruña': { lat: 43.37, lng: -8.40, r: 55 },
    Pontevedra: { lat: 42.43, lng: -8.64, r: 50 },
    Badajoz: { lat: 38.88, lng: -6.97, r: 70 },
    Cáceres: { lat: 39.48, lng: -6.37, r: 70 },
    Albacete: { lat: 38.99, lng: -1.86, r: 55 },
    Castellón: { lat: 39.99, lng: -0.04, r: 50 },
    Tarragona: { lat: 41.12, lng: 1.25, r: 45 },
    Girona: { lat: 41.98, lng: 2.82, r: 45 },
    Lleida: { lat: 41.62, lng: 0.62, r: 55 },
    Huelva: { lat: 37.26, lng: -6.95, r: 55 },
    Jaén: { lat: 37.77, lng: -3.79, r: 50 },
    Almería: { lat: 36.84, lng: -2.46, r: 55 },
    León: { lat: 42.60, lng: -5.57, r: 60 },
    Burgos: { lat: 42.34, lng: -3.70, r: 55 },
    Palencia: { lat: 42.01, lng: -4.53, r: 45 },
    Zamora: { lat: 41.50, lng: -5.75, r: 50 },
    Segovia: { lat: 40.95, lng: -4.12, r: 40 },
    Ávila: { lat: 40.66, lng: -4.70, r: 45 },
    Soria: { lat: 41.76, lng: -2.47, r: 50 },
    Guadalajara: { lat: 40.63, lng: -3.16, r: 50 },
    Cuenca: { lat: 40.07, lng: -2.13, r: 55 },
    'Ciudad Real': { lat: 38.99, lng: -3.93, r: 60 },
    Huesca: { lat: 42.14, lng: -0.41, r: 70 },
    Teruel: { lat: 40.34, lng: -1.11, r: 60 },
    Lugo: { lat: 43.01, lng: -7.56, r: 55 },
    Ourense: { lat: 42.34, lng: -7.86, r: 50 },
};

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function planMatchesProvince(
    plan: { nombre_ubicacion?: string | null; latitud?: number | null; longitud?: number | null },
    province: string | null | undefined,
): boolean {
    if (!province || province === 'all') return true;

    const loc = norm(plan.nombre_ubicacion || '');
    const provNorm = norm(province);

    if (loc && (loc.includes(provNorm) || provNorm.includes(loc))) return true;

    const aliases = PROVINCE_ALIASES[province] || [provNorm];
    if (loc && aliases.some((a) => loc.includes(norm(a)))) return true;

    const lat = Number(plan.latitud);
    const lng = Number(plan.longitud);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;

    const geo = PROVINCE_GEO[province];
    if (!geo) return false;
    return haversineKm(lat, lng, geo.lat, geo.lng) <= geo.r;
}

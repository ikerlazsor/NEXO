import { getCategoryColor } from './categories';

type MapItem = { id: string | number; latitud?: number | null; longitud?: number | null; categoria?: string | null; tipo_deporte?: string | null; titulo?: string | null };
export type MapViewport = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
export function validMapCoordinates(value: object): boolean {
    const item = value as { latitud?: unknown; longitud?: unknown };
    if (item.latitud == null || item.longitud == null || item.latitud === '' || item.longitud === '') return false;
    const lat = Number(item.latitud), lon = Number(item.longitud);
    return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(Math.abs(lat) < 0.01 && Math.abs(lon) < 0.01);
}

/** A bounded set of native markers. Nearby activities of the same category
 * share one marker until zoomed in; the full set stays available in the carousel. */
export function discoveryPins<T extends MapItem>(items: T[], region: MapViewport, selectedId: string | null = null) {
    const latStep = Math.max(0.00015, region.latitudeDelta / 7);
    const lonStep = Math.max(0.00015, region.longitudeDelta / 5);
    const groups = new Map<string, T[]>();
    for (const item of items) {
        if (!validMapCoordinates(item)) continue;
        const lat = Number(item.latitud), lon = Number(item.longitud);
        if (Math.abs(lat - region.latitude) > region.latitudeDelta * 0.65 || Math.abs(lon - region.longitude) > region.longitudeDelta * 0.65) continue;
        const color = getCategoryColor(item.categoria, item.tipo_deporte);
        const key = String(item.id) === selectedId ? `selected:${item.id}` : `${color}:${Math.floor(lat / latStep)}:${Math.floor(lon / lonStep)}`;
        const group = groups.get(key) ?? [];
        group.push(item); groups.set(key, group);
    }
    return [...groups].sort((a,b) => Number(b[1].some(x => String(x.id) === selectedId)) - Number(a[1].some(x => String(x.id) === selectedId))).slice(0, 36).map(([, members]) => ({
        // Grid coordinates change on every zoom. Native MapKit annotations keep
        // their identity when a group moves cells or its representative is selected.
        key: `pin:${members.map(item => String(item.id)).sort()[0]}`, members,
        latitude: members.reduce((n, p) => n + Number(p.latitud), 0) / members.length,
        longitude: members.reduce((n, p) => n + Number(p.longitud), 0) / members.length,
        color: getCategoryColor(members[0].categoria, members[0].tipo_deporte),
    }));
}

import { cacheGetStale } from './ttlCache';
import { FEED_CACHE_KEY, type FeedSnapshot } from './feedCache';
import { screenCacheKey } from './screenCaches';

export type MapWarmRegion = {
    latitude: number;
    longitude: number;
    latitudeDelta?: number;
    longitudeDelta?: number;
};

const DEFAULT_DELTA = 0.05;

let engineReady = false;
const engineListeners = new Set<() => void>();
const regionListeners = new Set<(region: MapWarmRegion) => void>();
const pendingRegions: MapWarmRegion[] = [];
const seenKeys = new Set<string>();

function regionKey(r: MapWarmRegion): string {
    return `${r.latitude.toFixed(3)},${r.longitude.toFixed(3)}`;
}

export function isMapEngineReady(): boolean {
    return engineReady;
}

export function markMapEngineReady(): void {
    if (engineReady) return;
    engineReady = true;
    engineListeners.forEach((l) => {
        try {
            l();
        } catch {
            /* ignore */
        }
    });
}

export function subscribeMapEngineReady(listener: () => void): () => void {
    if (engineReady) {
        try {
            listener();
        } catch {
            /* ignore */
        }
    }
    engineListeners.add(listener);
    return () => {
        engineListeners.delete(listener);
    };
}

export function subscribeMapWarmRegions(listener: (region: MapWarmRegion) => void): () => void {
    regionListeners.add(listener);
    return () => {
        regionListeners.delete(listener);
    };
}

/** Encola coordenadas para que el MapView oculto pida tiles (Madrid / planes del usuario). */
export function warmMapRegion(input: {
    latitude?: number | null;
    longitude?: number | null;
    latitudeDelta?: number;
    longitudeDelta?: number;
}): void {
    const lat = Number(input.latitude);
    const lng = Number(input.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01) return;
    const region: MapWarmRegion = {
        latitude: lat,
        longitude: lng,
        latitudeDelta: input.latitudeDelta ?? DEFAULT_DELTA,
        longitudeDelta: input.longitudeDelta ?? DEFAULT_DELTA,
    };
    const key = regionKey(region);
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    if (seenKeys.size > 80) {
        const first = seenKeys.values().next().value;
        if (first) seenKeys.delete(first);
    }
    pendingRegions.push(region);
    regionListeners.forEach((l) => {
        try {
            l(region);
        } catch {
            /* ignore */
        }
    });
}

export function takeNextWarmRegion(): MapWarmRegion | null {
    return pendingRegions.shift() ?? null;
}

export function warmMapRegionsFromPlans(
    plans: Array<{ latitud?: unknown; longitud?: unknown } | null | undefined>,
    limit = 16,
): void {
    let n = 0;
    for (const plan of plans) {
        if (!plan || n >= limit) break;
        const lat = Number(plan.latitud);
        const lng = Number(plan.longitud);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        warmMapRegion({ latitude: lat, longitude: lng });
        n += 1;
    }
}

/** Calienta mapa del feed + Mis planes (unidos / creados / pasados en caché). */
export function warmMapsForSignedInUser(userId: string): void {
    // Zona feed (Madrid amplio + planes visibles).
    warmMapRegion({
        latitude: 40.4168,
        longitude: -3.7038,
        latitudeDelta: 0.28,
        longitudeDelta: 0.28,
    });
    const feed = cacheGetStale<FeedSnapshot>(FEED_CACHE_KEY);
    if (feed?.plans?.length) warmMapRegionsFromPlans(feed.plans, 14);

    const myPlans = cacheGetStale<{ plans?: Array<{ latitud?: unknown; longitud?: unknown }> }>(
        screenCacheKey.myPlans(userId),
    );
    if (myPlans?.plans?.length) warmMapRegionsFromPlans(myPlans.plans, 16);
}

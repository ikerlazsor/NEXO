import type { MapViewport } from './mapDiscovery';

export function validMapRegion(region: MapViewport): boolean {
    return [region.latitude, region.longitude, region.latitudeDelta, region.longitudeDelta].every(Number.isFinite)
        && Math.abs(region.latitude) <= 90 && Math.abs(region.longitude) <= 180
        && region.latitudeDelta > 0 && region.latitudeDelta <= 180
        && region.longitudeDelta > 0 && region.longitudeDelta <= 360;
}

/** Camera commands belong to one mounted map, never an opening/closing sheet. */
export function createMapCameraLifecycle(move: (region: MapViewport, duration: number) => void) {
    let generation = 0, active = false, ready = false;
    let pending: { region: MapViewport; duration: number } | null = null;
    return {
        open() { generation++; active = true; ready = false; pending = null; return generation; },
        close() { active = false; ready = false; pending = null; },
        isActive(epoch: number) { return active && generation === epoch; },
        ready(epoch: number) {
            if (!active || generation !== epoch) return;
            ready = true;
            if (pending) { const command = pending; pending = null; move(command.region, command.duration); }
        },
        move(region: MapViewport, duration: number) {
            if (!active || !validMapRegion(region)) return;
            if (!ready) { pending = { region, duration }; return; }
            move(region, duration);
        },
    };
}

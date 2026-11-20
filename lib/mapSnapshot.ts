import * as FileSystem from 'expo-file-system/legacy';
import { distanceKm } from './geo';

/**
 * Captura del mapa del feed en su encuadre inicial. Se muestra al instante al
 * abrir el panel del mapa, mientras el mapa nativo se monta y carga sus
 * teselas; luego el mapa real entra con fundido encima. Así el panel nunca
 * aparece vacío.
 *
 * Guarda dónde se hizo: si ahora estás en otro sitio no se enseña (antes el
 * mapa abría un momento encima de donde estuviste la última vez).
 */
const FILE_NAME = 'feed-map-snapshot-v2.jpg';
const META_NAME = 'feed-map-snapshot-v2.json';
/** Más lejos que esto, la captura ya no se parece a lo que va a salir. */
const SAME_PLACE_KM = 0.8;

export type MapSnapshotFrame = { latitude: number; longitude: number; delta: number } | null;

let snapshotUri: string | null = null;
let snapshotFrame: MapSnapshotFrame = null;
let warmed = false;

function dir(): string | null {
    return FileSystem.documentDirectory ?? null;
}

function matches(frame: MapSnapshotFrame, wanted: MapSnapshotFrame): boolean {
    if (!frame || !wanted) return frame === wanted;
    return (
        Math.abs(frame.delta - wanted.delta) < 1e-6 &&
        distanceKm(frame.latitude, frame.longitude, wanted.latitude, wanted.longitude) <= SAME_PLACE_KM
    );
}

/** La captura solo si se hizo en este mismo encuadre (null = vista de Madrid). */
export function peekMapSnapshot(wanted: MapSnapshotFrame): string | null {
    return snapshotUri && matches(snapshotFrame, wanted) ? snapshotUri : null;
}

/** Comprueba en disco si hay captura previa. Barato; se llama al montar el host. */
export async function warmMapSnapshot(): Promise<void> {
    if (warmed) return;
    warmed = true;
    const base = dir();
    if (!base) return;
    try {
        // Las capturas antiguas no sabían dónde se hicieron: fuera.
        void FileSystem.deleteAsync(`${base}feed-map-snapshot.jpg`, { idempotent: true });
        const info = await FileSystem.getInfoAsync(`${base}${FILE_NAME}`);
        if (!info.exists) return;
        const meta = JSON.parse(await FileSystem.readAsStringAsync(`${base}${META_NAME}`)) as {
            frame?: MapSnapshotFrame;
        };
        snapshotFrame = meta.frame ?? null;
        snapshotUri = `${base}${FILE_NAME}?v=${Math.round((info.modificationTime ?? 0) * 1000)}`;
    } catch {
        /* sin captura: se usa el fondo liso */
    }
}

/** Guarda la captura temporal que devuelve MapView.takeSnapshot y su encuadre. */
export async function saveMapSnapshot(tmpUri: string, frame: MapSnapshotFrame): Promise<void> {
    const base = dir();
    if (!base) return;
    try {
        await FileSystem.deleteAsync(`${base}${FILE_NAME}`, { idempotent: true });
        await FileSystem.copyAsync({ from: tmpUri, to: `${base}${FILE_NAME}` });
        await FileSystem.writeAsStringAsync(`${base}${META_NAME}`, JSON.stringify({ frame }));
        snapshotUri = `${base}${FILE_NAME}?v=${Date.now()}`;
        snapshotFrame = frame;
    } catch {
        /* ignorar: se intentará en la próxima apertura */
    }
}

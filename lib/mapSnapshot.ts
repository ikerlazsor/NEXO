import * as FileSystem from 'expo-file-system/legacy';

/**
 * Captura del mapa del feed en su encuadre inicial (Madrid). Se muestra al
 * instante al abrir el panel del mapa, mientras el mapa nativo se monta y
 * carga sus teselas; luego el mapa real entra con fundido encima. Así el panel
 * nunca aparece vacío.
 */
const FILE_NAME = 'feed-map-snapshot.jpg';
let snapshotUri: string | null = null;
let warmed = false;

function destPath(): string | null {
    return FileSystem.documentDirectory ? `${FileSystem.documentDirectory}${FILE_NAME}` : null;
}

export function peekMapSnapshot(): string | null {
    return snapshotUri;
}

/** Comprueba en disco si hay captura previa. Barato; se llama al montar el host. */
export async function warmMapSnapshot(): Promise<void> {
    if (warmed) return;
    warmed = true;
    const dest = destPath();
    if (!dest) return;
    try {
        const info = await FileSystem.getInfoAsync(dest);
        if (info.exists) snapshotUri = `${dest}?v=${Math.round((info.modificationTime ?? 0) * 1000)}`;
    } catch {
        /* sin captura: se usa el fondo liso */
    }
}

/** Guarda la captura temporal que devuelve MapView.takeSnapshot. */
export async function saveMapSnapshot(tmpUri: string): Promise<void> {
    const dest = destPath();
    if (!dest) return;
    try {
        await FileSystem.deleteAsync(dest, { idempotent: true });
        await FileSystem.copyAsync({ from: tmpUri, to: dest });
        snapshotUri = `${dest}?v=${Date.now()}`;
    } catch {
        /* ignorar: se intentará en la próxima apertura */
    }
}

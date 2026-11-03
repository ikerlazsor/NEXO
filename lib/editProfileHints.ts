import AsyncStorage from '@react-native-async-storage/async-storage';

/** Primera visita a editar perfil tras campos nuevos (nacionalidad / insta / ubi). */
const SEEN_KEY = '@nexo_edit_profile_hints_v1';

let seenCache: boolean | null = null;
const listeners = new Set<(seen: boolean) => void>();

function notify(seen: boolean) {
    for (const listener of listeners) listener(seen);
}

export function peekEditProfileHintsSeen(): boolean | null {
    return seenCache;
}

/** true = ya vieron editar perfil → no mostrar badges. */
export function shouldShowEditProfileHints(): boolean {
    return seenCache !== true;
}

export function subscribeEditProfileHints(listener: (seen: boolean) => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export async function hydrateEditProfileHints(): Promise<boolean> {
    if (seenCache != null) return seenCache;
    try {
        const raw = await AsyncStorage.getItem(SEEN_KEY);
        seenCache = raw === '1';
    } catch {
        seenCache = false;
    }
    notify(seenCache);
    return seenCache;
}

/** Al salir de editar perfil: quitar todas las notis para siempre. */
export async function markEditProfileHintsSeen(): Promise<void> {
    if (seenCache === true) return;
    seenCache = true;
    notify(true);
    try {
        await AsyncStorage.setItem(SEEN_KEY, '1');
    } catch {
        /* ignore */
    }
}

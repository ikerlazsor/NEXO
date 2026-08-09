import { Platform } from 'react-native';

/**
 * Antes: overlay ~48% ancho que bloqueaba toques (amigos, mute, X…).
 * En Android el gesto atrás nativo del sistema basta; no montamos overlay.
 */
export function AndroidSwipeBack() {
    if (Platform.OS === 'android') return null;
    return null;
}

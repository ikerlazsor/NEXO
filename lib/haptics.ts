import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/** Feedback táctil seguro (no-op en web / si falla el nativo). */
async function run(fn: () => Promise<void>): Promise<void> {
    if (Platform.OS === 'web') return;
    try {
        await fn();
    } catch {
        // dispositivo sin motor / simulador
    }
}

const lastByKind = new Map<string, number>();

/** Evita spam (p. ej. toggles rápidos o re-renders). */
function throttle(kind: string, minMs: number): boolean {
    const now = Date.now();
    const prev = lastByKind.get(kind) ?? 0;
    if (now - prev < minMs) return false;
    lastByKind.set(kind, now);
    return true;
}

function softStyle(): Haptics.ImpactFeedbackStyle {
    const styles = Haptics.ImpactFeedbackStyle as typeof Haptics.ImpactFeedbackStyle & {
        Soft?: Haptics.ImpactFeedbackStyle;
    };
    return styles.Soft ?? Haptics.ImpactFeedbackStyle.Light;
}

function rigidStyle(): Haptics.ImpactFeedbackStyle {
    const styles = Haptics.ImpactFeedbackStyle as typeof Haptics.ImpactFeedbackStyle & {
        Rigid?: Haptics.ImpactFeedbackStyle;
    };
    return styles.Rigid ?? Haptics.ImpactFeedbackStyle.Medium;
}

/** Micro-toque al pulsar (press-in). Ideal para botones / filas. */
export function hapticSoft(): void {
    if (!throttle('soft', 28)) return;
    void run(() => Haptics.impactAsync(softStyle()));
}

/** Tab, toggle, tap ligero. */
export function hapticLight(): void {
    if (!throttle('light', 35)) return;
    void run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** Unirse, enviar, acción primaria. */
export function hapticMedium(): void {
    if (!throttle('medium', 50)) return;
    void run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** Confirmación fuerte / CTA importante. */
export function hapticHeavy(): void {
    if (!throttle('heavy', 80)) return;
    void run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy));
}

/** Toque más “seco” (iOS Rigid; fallback medium). */
export function hapticRigid(): void {
    if (!throttle('rigid', 50)) return;
    void run(() => Haptics.impactAsync(rigidStyle()));
}

/** Éxito: aceptar amigo, unirse OK, etc. */
export function hapticSuccess(): void {
    if (!throttle('success', 120)) return;
    void run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** Aviso / confirmación destructiva (salir, borrar…). */
export function hapticWarning(): void {
    if (!throttle('warning', 120)) return;
    void run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}

/** Error / límite alcanzado. */
export function hapticError(): void {
    if (!throttle('error', 120)) return;
    void run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}

/** Cambio de selección (filtros, chips, stars). */
export function hapticSelection(): void {
    if (!throttle('selection', 22)) return;
    void run(() => Haptics.selectionAsync());
}

/** Switch on/off — un tick claro. */
export function hapticToggle(enabled?: boolean): void {
    if (!throttle('toggle', 40)) return;
    if (enabled === true) {
        void run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
        return;
    }
    if (enabled === false) {
        void run(() => Haptics.impactAsync(softStyle()));
        return;
    }
    void run(() => Haptics.selectionAsync());
}

/**
 * Al abrir un diálogo / sheet importante.
 * `kind`: info suave | aviso | peligro.
 */
export function hapticAlert(kind: 'info' | 'warning' | 'danger' = 'info'): void {
    if (kind === 'danger') {
        hapticWarning();
        return;
    }
    if (kind === 'warning') {
        hapticMedium();
        return;
    }
    hapticSoft();
}

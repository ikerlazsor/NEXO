import { InteractionManager } from 'react-native';

/**
 * Duración aproximada de un push nativo (iOS ~350 ms, Android 280 ms) más margen.
 * Las pantallas de React Navigation nativas no siempre registran un "interaction
 * handle", así que `InteractionManager` por sí solo puede disparar al instante.
 */
export const NAV_TRANSITION_MS = 380;

/**
 * Ejecuta trabajo que no hace falta para pintar la pantalla (precargas de red,
 * cachés, cálculos) cuando el deslizamiento ya terminó. Si se lanza durante la
 * animación, las respuestas llegan a mitad del deslizamiento, ocupan el hilo de
 * JS y la animación se ve cortada.
 *
 * Devuelve una función para cancelar el trabajo pendiente.
 */
export function runAfterNavTransition(task: () => void, delayMs: number = NAV_TRANSITION_MS): () => void {
    let cancelled = false;
    let interaction: { cancel: () => void } | null = null;
    const timer = setTimeout(() => {
        interaction = InteractionManager.runAfterInteractions(() => {
            if (!cancelled) task();
        });
    }, delayMs);
    return () => {
        cancelled = true;
        clearTimeout(timer);
        interaction?.cancel();
    };
}

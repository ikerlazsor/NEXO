import { useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';

/**
 * Devuelve `true` cuando la animación de entrada de la pantalla (el deslizamiento)
 * ya ha terminado. Úsalo para retrasar lo pesado (peticiones de red, hidratar
 * cachés de disco, montar listas o mapas) hasta que la pantalla esté quieta:
 * si se hace durante el deslizamiento, el hilo de JS se satura y la animación
 * se ve cortada o a saltos.
 *
 * - Se activa con el evento `transitionEnd` del stack nativo.
 * - Hay un temporizador de seguridad por si ese evento no llega (animación
 *   `none`, pantalla ya visible, etc.), para que nunca se quede bloqueado.
 * - Solo pasa de `false` a `true` una vez por montaje; en cambios de foco
 *   posteriores ya vale `true` y todo se ejecuta al instante.
 */
export function useTransitionReady(fallbackMs = 520): boolean {
    const navigation = useNavigation();
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (ready) return;
        let done = false;
        let task: { cancel: () => void } | null = null;

        const finish = () => {
            if (done) return;
            done = true;
            // Esperar a que acaben las interacciones pendientes para no
            // robarle el último frame a la animación.
            task = InteractionManager.runAfterInteractions(() => setReady(true));
        };

        const nav = navigation as unknown as {
            addListener?: (
                type: string,
                cb: (e: { data?: { closing?: boolean } }) => void,
            ) => (() => void) | undefined;
        };
        const unsubscribe = nav.addListener?.('transitionEnd', (e) => {
            if (!e?.data?.closing) finish();
        });
        const timer = setTimeout(finish, fallbackMs);

        return () => {
            done = true;
            unsubscribe?.();
            clearTimeout(timer);
            task?.cancel();
        };
    }, [navigation, ready, fallbackMs]);

    return ready;
}

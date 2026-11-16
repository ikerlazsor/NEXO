import type { ReactNode } from 'react';
import Animated, { FadeIn } from 'react-native-reanimated';

/**
 * Secciones por debajo de la primera pantalla: no se montan durante el
 * deslizamiento de entrada (aligeran la primera pintada) y aparecen con un
 * fundido corto cuando `ready` pasa a true, en lugar de aparecer de golpe.
 */
export function DeferredSection({ ready, children }: { ready: boolean; children: ReactNode }) {
    if (!ready) return null;
    return <Animated.View entering={FadeIn.duration(220)}>{children}</Animated.View>;
}

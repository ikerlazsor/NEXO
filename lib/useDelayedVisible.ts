import { useEffect, useState } from 'react';

/**
 * El skeleton solo aparece si la espera pasa de `delayMs`.
 * Una caché que llega antes no llega a parpadear.
 */
export function useDelayedVisible(active: boolean, delayMs = 400): boolean {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (!active) {
            setVisible(false);
            return;
        }
        const timer = setTimeout(() => setVisible(true), delayMs);
        return () => clearTimeout(timer);
    }, [active, delayMs]);

    return visible;
}

import { useEffect, useState } from 'react';
import { useScreenTransitionReady } from './useScreenTransitionReady';

/**
 * Como useScreenTransitionReady, pero se queda en true una vez que termina el
 * deslizamiento de entrada. useScreenTransitionReady vuelve a false al perder el
 * foco (p. ej. al abrir otra pantalla encima); si las secciones dependieran de
 * él, se desmontarían al navegar y al volver el contenido "saltaría".
 */
export function useTransitionSettled(): boolean {
    const ready = useScreenTransitionReady();
    const [settled, setSettled] = useState(false);
    useEffect(() => {
        if (ready) setSettled(true);
    }, [ready]);
    return settled || ready;
}

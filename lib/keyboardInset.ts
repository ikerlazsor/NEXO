import { useEffect, useRef, useState } from 'react';
import {
    Keyboard,
    Platform,
    type KeyboardEvent,
    useWindowDimensions,
} from 'react-native';

/**
 * Android edge-to-edge + adjustResize se comporta como adjustNothing: la ventana
 * no encoge y el teclado tapa la barra de escribir.
 *
 * Calculamos el hueco real (preferimos screenY; height a veces miente en Samsung/Xiaomi).
 * Si la ventana SÍ encoge, restamos ese shrink para no duplicar padding.
 */
function keyboardInsetFromEvent(
    e: KeyboardEvent,
    windowHeight: number,
    fullWindowHeight: number,
): number {
    const coords = e.endCoordinates;
    if (!coords) return 0;

    const reported = Math.max(0, coords.height ?? 0);
    // Distancia desde el borde inferior de la ventana hasta la parte superior del teclado.
    const fromScreenY =
        typeof coords.screenY === 'number'
            ? Math.max(0, fullWindowHeight - coords.screenY)
            : 0;

    // Algunos OEM reportan height=0 en frames intermedios; screenY sigue siendo útil.
    const raw = Math.max(reported, fromScreenY);
    if (raw <= 0) return 0;

    const shrink = Math.max(0, fullWindowHeight - windowHeight);
    // Margen mínimo: si el teclado está abierto pero el cálculo falla, al menos ~220.
    const inset = Math.max(0, Math.round(raw - shrink));
    return inset;
}

export function useAndroidKeyboardInset(): number {
    const { height: windowHeight } = useWindowDimensions();
    const [inset, setInset] = useState(0);
    const fullHeightRef = useRef(windowHeight);
    const windowHeightRef = useRef(windowHeight);
    windowHeightRef.current = windowHeight;

    useEffect(() => {
        if (inset === 0 && windowHeight > fullHeightRef.current) {
            fullHeightRef.current = windowHeight;
        }
    }, [windowHeight, inset]);

    useEffect(() => {
        if (Platform.OS !== 'android') return;

        const apply = (e: KeyboardEvent) => {
            const next = keyboardInsetFromEvent(
                e,
                windowHeightRef.current,
                fullHeightRef.current,
            );
            setInset(next);
        };

        const show = Keyboard.addListener('keyboardDidShow', apply);
        const change = Keyboard.addListener('keyboardDidChangeFrame', (e) => {
            const h = e.endCoordinates?.height ?? 0;
            const y = e.endCoordinates?.screenY;
            // No borrar el inset en frames basura (height 0) mientras el teclado sigue abierto.
            if (h <= 0 && (typeof y !== 'number' || y >= fullHeightRef.current - 24)) {
                return;
            }
            apply(e);
        });
        const hide = Keyboard.addListener('keyboardDidHide', () => setInset(0));

        return () => {
            show.remove();
            change.remove();
            hide.remove();
        };
    }, []);

    if (Platform.OS !== 'android') return 0;
    return inset;
}

/** Teclado visible (iOS will*, Android did*). */
export function useKeyboardOpen(): boolean {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
        const show = Keyboard.addListener(showEvt, () => setOpen(true));
        const hide = Keyboard.addListener(hideEvt, () => setOpen(false));
        return () => {
            show.remove();
            hide.remove();
        };
    }, []);

    return open;
}

/**
 * Padding inferior del composer.
 * Con teclado abierto no sumar safe-area (home indicator): el teclado ya tapa esa zona
 * y deja un hueco enorme en iPhone. Solo un margen mínimo para que no lo pise.
 */
export function composerBottomPadding(opts: {
    keyboardOpen: boolean;
    androidKeyboardInset: number;
    safeBottom: number;
}): number {
    const { keyboardOpen, androidKeyboardInset, safeBottom } = opts;
    if (androidKeyboardInset > 0) return Math.max(4, androidKeyboardInset);
    if (keyboardOpen) return 6;
    return Math.max(safeBottom, 10) + 10;
}

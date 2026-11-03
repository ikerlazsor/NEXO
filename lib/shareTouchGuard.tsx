import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { holdAppUpdateReload } from './appUpdates';

type GuardSetter = (active: boolean) => void;

/** Tras cerrar el sheet nativo de iOS: ms que seguimos bloqueando taps fantasma. */
export const SHARE_TOUCH_GUARD_HOLD_MS = 10;

let setGuardActive: GuardSetter | null = null;
let guardHoldTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Capa absoluta (no Modal) sobre la app, debajo del sheet nativo de iOS.
 * Montar en el root junto al árbol de pantallas.
 * Siempre montada (invisible) para no provocar saltos de layout al activarse.
 */
export function ShareTouchGuardHost() {
    const [active, setActive] = useState(false);

    useEffect(() => {
        setGuardActive = setActive;
        return () => {
            if (setGuardActive === setActive) setGuardActive = null;
            if (guardHoldTimer) {
                clearTimeout(guardHoldTimer);
                guardHoldTimer = null;
            }
        };
    }, []);

    if (Platform.OS !== 'ios') return null;

    return (
        <View
            style={styles.block}
            pointerEvents={active ? 'auto' : 'none'}
            collapsable={false}
        />
    );
}

/**
 * El tap fuera del panel de compartir a veces atraviesa a la UI de debajo.
 * Bloqueamos la app (no el sheet del sistema) mientras está abierto y un poco después.
 */
export async function withShareTouchGuard<T>(fn: () => Promise<T>): Promise<T> {
    // Con el sheet del sistema abierto, un reinicio por OTA dejaría la UI descolocada.
    const releaseUpdateHold = holdAppUpdateReload();
    if (Platform.OS !== 'ios' || !setGuardActive) {
        try {
            return await fn();
        } finally {
            releaseUpdateHold();
        }
    }
    if (guardHoldTimer) {
        clearTimeout(guardHoldTimer);
        guardHoldTimer = null;
    }
    setGuardActive(true);
    try {
        return await fn();
    } finally {
        releaseUpdateHold();
        guardHoldTimer = setTimeout(() => {
            setGuardActive?.(false);
            guardHoldTimer = null;
        }, SHARE_TOUCH_GUARD_HOLD_MS);
    }
}

const styles = StyleSheet.create({
    block: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 9999,
        elevation: 9999,
        backgroundColor: 'transparent',
    },
});

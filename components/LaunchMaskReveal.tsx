import { hideNativeSplashOnce } from '../lib/nativeSplash';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Image, StyleSheet, View } from 'react-native';

/** Mismo fondo que expo-splash-screen / app.json */
export const LAUNCH_SPLASH_BG = '#E2EBF2';

/**
 * Debe coincidir con app.json → plugins → expo-splash-screen → imageWidth.
 * Glifo ~41.9% del canvas (como nexo-splash-full).
 */
export const LAUNCH_SPLASH_IMAGE_WIDTH = 300;

const SPLASH_LOGO = require('../assets/images/nexo-splash-logo.png');

/** Logo quieto tras appReady, antes del fade (solo esto acorta “hasta que entra”). */
const HOLD_MS = 50;

/** Fade splash → feed suave (solo overlay; el feed ya está debajo). No tocar. */
export const LAUNCH_SPLASH_FADE_MS = 420;

type Props = {
    /** true cuando la app ya puede mostrar feed (o hay que dejar de esperar). */
    appReady: boolean;
    onHoldEnd: () => void;
};

/**
 * Fondo continuo (sin placa) + logo.
 * El nativo solo se oculta cuando el logo JS ya está pintado → sin “tic”.
 * Montado desde el boot para matar el cuadrado nativo lo antes posible.
 */
export function LaunchSplashOverlay({ appReady, onHoldEnd }: Props) {
    const onHoldEndRef = useRef(onHoldEnd);
    onHoldEndRef.current = onHoldEnd;

    const nativeHiddenRef = useRef(false);
    const holdStartedRef = useRef(false);
    const logoPaintedRef = useRef(false);
    const appReadyRef = useRef(appReady);
    appReadyRef.current = appReady;

    const hideNativeWhenPainted = useCallback(() => {
        if (nativeHiddenRef.current || !logoPaintedRef.current) return;
        nativeHiddenRef.current = true;
        // Dos frames: el Image ya está en pantalla bajo el nativo.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                void hideNativeSplashOnce();
            });
        });
    }, []);

    const tryStartHold = useCallback(() => {
        if (holdStartedRef.current) return;
        if (!logoPaintedRef.current || !appReadyRef.current) return;
        holdStartedRef.current = true;
        // HOLD corto + 2 frames: el fade no pelea con el primer layout del feed (menos jank).
        setTimeout(() => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => onHoldEndRef.current());
            });
        }, HOLD_MS);
    }, []);

    const markLogoPainted = useCallback(() => {
        if (logoPaintedRef.current) return;
        logoPaintedRef.current = true;
        hideNativeWhenPainted();
        tryStartHold();
    }, [hideNativeWhenPainted, tryStartHold]);

    useEffect(() => {
        if (appReady) tryStartHold();
    }, [appReady, tryStartHold]);

    useEffect(() => {
        // Bundled asset: si onLoad no llega, no bloquear el arranque.
        const fallback = setTimeout(markLogoPainted, 80);
        return () => clearTimeout(fallback);
    }, [markLogoPainted]);

    return (
        <View style={styles.overlay} pointerEvents="none" collapsable={false}>
            <Image
                source={SPLASH_LOGO}
                style={styles.splashLogo}
                resizeMode="contain"
                fadeDuration={0}
                onLoad={markLogoPainted}
                onLoadEnd={markLogoPainted}
            />
        </View>
    );
}

/** @deprecated Usar LaunchSplashOverlay */
export function LaunchMaskReveal({ children, onDone }: { children: ReactNode; onDone: () => void }) {
    return (
        <View style={styles.root}>
            {children}
            <LaunchSplashOverlay appReady onHoldEnd={onDone} />
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    overlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: LAUNCH_SPLASH_BG,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        elevation: 9999,
    },
    splashLogo: {
        width: LAUNCH_SPLASH_IMAGE_WIDTH,
        height: LAUNCH_SPLASH_IMAGE_WIDTH,
        backgroundColor: 'transparent',
    },
});

import { useSegments } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
    Easing,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withSequence,
    withTiming,
} from 'react-native-reanimated';
import { hideNativeSplashOnce } from '../lib/nativeSplash';
import { LaunchSplashOverlay, LAUNCH_SPLASH_BG, LAUNCH_SPLASH_FADE_MS } from './LaunchMaskReveal';

let launchRevealConsumed = false;

export function willShowLaunchSplashOverlay(blocked: boolean, onMainFeed: boolean): boolean {
    return !blocked && onMainFeed && !launchRevealConsumed;
}

type Props = {
    /** Arranque auth/red aún en curso. */
    booting?: boolean;
    ready: boolean;
    blocked: boolean;
    children: ReactNode;
};

/**
 * Overlay desde el primer paint JS (también en boot) para quitar el cuadrado nativo
 * en cuanto el logo está listo, sin que desaparezca/reaparezca.
 *
 * Reveal: el feed queda ya a opacity 1 debajo; solo se desvanece el splash
 * (crossfade dual se percibe como corte).
 */
export function LaunchRevealHost({ booting = false, ready, blocked, children }: Props) {
    const segments = useSegments();
    const rootSegment = segments[0];
    const onMainFeed = rootSegment === '(tabs)' || rootSegment === undefined;

    const feedEligible = useMemo(
        () => ready && willShowLaunchSplashOverlay(blocked, onMainFeed),
        [ready, blocked, onMainFeed],
    );

    /** Mantener splash en boot o en el handoff al feed. */
    // El splash JS se mantiene hasta que termina su animación de salida (también en login),
    // así nunca se ve el corte del splash nativo.
    const keepSplash = !launchRevealConsumed;

    const [overlayDone, setOverlayDone] = useState(launchRevealConsumed);
    const [fading, setFading] = useState(false);

    const overlayOpacity = useSharedValue(1);
    // Salida tipo Instagram: el logo "respira" (encoge un poco) y crece mientras se
    // desvanece; el fondo se aclara y la app entra con un leve zoom (de 1,05 a 1).
    const bgOpacity = useSharedValue(1);
    const logoScale = useSharedValue(1);
    const logoOpacity = useSharedValue(1);
    const feedScale = useSharedValue(1);

    const completeReveal = useCallback(() => {
        launchRevealConsumed = true;
        setOverlayDone(true);
        setFading(false);
    }, []);

    const beginFadeOut = useCallback(() => {
        setFading(true);
        const out = Easing.out(Easing.cubic);
        feedScale.value = 1.05;
        logoScale.value = withSequence(
            withTiming(0.9, { duration: 150, easing: Easing.inOut(Easing.quad) }),
            withTiming(1.6, { duration: 380, easing: Easing.in(Easing.cubic) }),
        );
        logoOpacity.value = withDelay(260, withTiming(0, { duration: 270, easing: out }));
        bgOpacity.value = withDelay(170, withTiming(0, { duration: 360, easing: out }));
        feedScale.value = withDelay(170, withTiming(1, { duration: 520, easing: out }));
        overlayOpacity.value = withDelay(
            LAUNCH_SPLASH_FADE_MS + 140,
            withTiming(0, { duration: 1 }, (finished) => {
                if (finished) runOnJS(completeReveal)();
            }),
        );
    }, [completeReveal, overlayOpacity, bgOpacity, logoScale, logoOpacity, feedScale]);

    // Login / onboarding / etc.: misma salida suave (antes se cortaba de golpe).
    useEffect(() => {
        if (launchRevealConsumed || overlayDone || booting || fading) return;
        if (!ready) return;
        if (feedEligible) return;
        void hideNativeSplashOnce();
        requestAnimationFrame(() => beginFadeOut());
    }, [ready, booting, feedEligible, overlayDone, fading, beginFadeOut]);

    const showOverlay = !launchRevealConsumed && !overlayDone && (keepSplash || fading);
    /** El hold/fade al feed solo cuando la app ya está lista en tabs. */
    const appReadyForHold = feedEligible && !fading && !overlayDone;

    const feedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: feedScale.value }],
    }));

    const overlayWrapStyle = useAnimatedStyle(() => ({
        opacity: overlayOpacity.value,
    }));
    const bgStyle = useAnimatedStyle(() => ({ opacity: bgOpacity.value }));
    const logoStyle = useAnimatedStyle(() => ({
        opacity: logoOpacity.value,
        transform: [{ scale: logoScale.value }],
    }));

    return (
        <View style={[styles.root, { backgroundColor: LAUNCH_SPLASH_BG }]}>
            <Animated.View
                style={[styles.appShell, feedStyle]}
                pointerEvents={showOverlay && !fading ? 'none' : 'auto'}
            >
                {children}
            </Animated.View>
            {showOverlay ? (
                <Animated.View
                    style={[styles.overlayWrap, overlayWrapStyle]}
                    pointerEvents="none"
                    collapsable={false}
                >
                    <LaunchSplashOverlay
                        appReady={appReadyForHold}
                        onHoldEnd={beginFadeOut}
                        logoStyle={logoStyle}
                        backgroundStyle={bgStyle}
                    />
                </Animated.View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    appShell: {
        flex: 1,
    },
    overlayWrap: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 9999,
        elevation: 9999,
    },
});

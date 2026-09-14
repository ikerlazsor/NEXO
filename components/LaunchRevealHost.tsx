import { useSegments } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
    Easing,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
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
    const keepSplash = !launchRevealConsumed && (booting || feedEligible || (!ready && !blocked));

    const [overlayDone, setOverlayDone] = useState(launchRevealConsumed);
    const [fading, setFading] = useState(false);

    const overlayOpacity = useSharedValue(1);
    // Feed siempre listo debajo; no animamos su opacity en el reveal.
    const feedOpacity = useSharedValue(1);

    const completeReveal = useCallback(() => {
        launchRevealConsumed = true;
        setOverlayDone(true);
        setFading(false);
    }, []);

    const beginFadeOut = useCallback(() => {
        setFading(true);
        const easing = Easing.out(Easing.cubic);
        overlayOpacity.value = withTiming(
            0,
            { duration: LAUNCH_SPLASH_FADE_MS, easing },
            (finished) => {
                if (finished) runOnJS(completeReveal)();
            },
        );
    }, [completeReveal, overlayOpacity]);

    // Login / onboarding / etc.: soltar splash sin hold ni tic de logo.
    useEffect(() => {
        if (launchRevealConsumed || overlayDone || booting) return;
        if (!ready) return;
        if (feedEligible) return;
        overlayOpacity.value = 0;
        void hideNativeSplashOnce();
        completeReveal();
    }, [ready, booting, feedEligible, overlayDone, completeReveal, overlayOpacity]);

    const showOverlay = !launchRevealConsumed && !overlayDone && keepSplash;
    /** El hold/fade al feed solo cuando la app ya está lista en tabs. */
    const appReadyForHold = feedEligible && !fading && !overlayDone;

    const feedStyle = useAnimatedStyle(() => ({
        opacity: feedOpacity.value,
    }));

    const overlayWrapStyle = useAnimatedStyle(() => ({
        opacity: overlayOpacity.value,
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
                    <LaunchSplashOverlay appReady={appReadyForHold} onHoldEnd={beginFadeOut} />
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

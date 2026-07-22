import { useRouter, useSegments } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Dimensions, Platform, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS } from 'react-native-reanimated';

const SCREEN_W = Dimensions.get('window').width;
/** Franja izquierda: fácil de pillar sin cubrir casi toda la pantalla (scroll vertical). */
const EDGE_W = Math.round(SCREEN_W * 0.48);

/**
 * Swipe derecha → atrás en Android (native-stack no expone gesto configurable ahí).
 */
export function AndroidSwipeBack() {
    const router = useRouter();
    const segments = useSegments();

    const blocked = useMemo(() => {
        const root = segments[0];
        return root === '(tabs)' || root === 'login' || root === 'onboarding' || root === undefined;
    }, [segments]);

    const goBack = useCallback(() => {
        if (router.canGoBack()) router.back();
    }, [router]);

    const pan = useMemo(
        () =>
            Gesture.Pan()
                .enabled(!blocked && Platform.OS === 'android')
                .activeOffsetX(22)
                .failOffsetY([-14, 14])
                .onEnd((e) => {
                    if (e.translationX > SCREEN_W * 0.2 || e.velocityX > 700) {
                        runOnJS(goBack)();
                    }
                }),
        [blocked, goBack],
    );

    if (Platform.OS !== 'android' || blocked) return null;

    return (
        <GestureDetector gesture={pan}>
            <Animated.View style={styles.edge} collapsable={false} />
        </GestureDetector>
    );
}

const styles = StyleSheet.create({
    edge: {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: EDGE_W,
        zIndex: 100000,
    },
});

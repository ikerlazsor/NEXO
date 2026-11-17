import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EASE_OUT, SPRING } from '../lib/motion';
import { hapticMedium } from '../lib/haptics';
import {
    registerInAppToastDismiss,
    registerInAppToastPresenter,
    type InAppToast,
} from '../lib/inAppToast';
import { fallbackPushHref, navigateAppHref, resolvePushNavigation } from '../lib/push';
import { warmPushDestination } from '../lib/pushWarm';
import { ProfileAvatar } from './ProfileAvatar';
import { useThemedStyles } from '../lib/appTheme';
import { theme, type ThemeColors } from '../theme';

const SHOW_MS = 4800;
/** Fuera de pantalla hasta medir la altura real del aviso. */
const INITIAL_HIDDEN_Y = -200;

type Props = { children: React.ReactNode };

export function InAppToastHost({ children }: Props) {
    const insets = useSafeAreaInsets();
    const styles = useThemedStyles(createToastStyles);
    const [queue, setQueue] = useState<InAppToast[]>([]);
    const current = queue[0] ?? null;
    const top = Math.max(insets.top, 8) + 6;
    const reduced = useReducedMotion();
    const translateY = useSharedValue(INITIAL_HIDDEN_Y);
    const opacity = useSharedValue(0);
    const hiddenY = useSharedValue(INITIAL_HIDDEN_Y);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const popQueue = useCallback(() => {
        setQueue((prev) => prev.slice(1));
    }, []);

    const clearDismissTimer = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const dismiss = useCallback(() => {
        clearDismissTimer();
        if (reduced) {
            opacity.value = withTiming(0, { duration: 200, easing: EASE_OUT }, (finished) => {
                if (finished) scheduleOnRN(popQueue);
            });
            return;
        }
        translateY.value = withTiming(hiddenY.value, { duration: 200, easing: EASE_OUT }, (finished) => {
            if (finished) scheduleOnRN(popQueue);
        });
    }, [clearDismissTimer, reduced, opacity, translateY, hiddenY, popQueue]);

    const restartDismissTimer = useCallback(() => {
        clearDismissTimer();
        timerRef.current = setTimeout(dismiss, SHOW_MS);
    }, [clearDismissTimer, dismiss]);

    useEffect(() => {
        registerInAppToastPresenter((toast) => {
            setQueue((prev) => {
                const withoutDup = prev.filter((item) => item.id !== toast.id);
                return [...withoutDup, toast].slice(-3);
            });
        });
        registerInAppToastDismiss((predicate) => {
            setQueue((prev) => prev.filter((item) => !predicate(item)));
        });
        return () => {
            registerInAppToastPresenter(null);
            registerInAppToastDismiss(null);
        };
    }, []);

    useEffect(() => {
        if (!current) return;
        if (reduced) {
            translateY.value = 0;
            opacity.value = 0;
            opacity.value = withTiming(1, { duration: 200, easing: EASE_OUT });
        } else {
            opacity.value = 1;
            translateY.value = hiddenY.value;
            translateY.value = withTiming(0, { duration: 300, easing: EASE_OUT });
        }
        timerRef.current = setTimeout(dismiss, SHOW_MS);
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [current, dismiss, reduced, opacity, translateY, hiddenY]);

    const open = () => {
        if (!current) return;
        hapticMedium();
        const data = current.data;
        const target = resolvePushNavigation(data);
        dismiss();
        navigateAppHref(router, target?.href ?? fallbackPushHref(data));
        void warmPushDestination(data);
    };

    // Sigue el dedo 1:1 hacia arriba; hacia abajo ofrece resistencia. Se cierra por
    // distancia o por velocidad (un golpe corto basta). Mientras se sujeta, no se va solo.
    const pan = useMemo(
        () =>
            Gesture.Pan()
                .activeOffsetY([-8, 8])
                .onStart(() => {
                    scheduleOnRN(clearDismissTimer);
                })
                .onUpdate((e) => {
                    const dy = e.translationY;
                    translateY.value = dy < 0 ? dy : dy * 0.2;
                })
                .onEnd((e) => {
                    if (translateY.value < -24 || e.velocityY < -500) {
                        translateY.value = withTiming(
                            hiddenY.value,
                            { duration: 200, easing: EASE_OUT },
                            (finished) => {
                                if (finished) scheduleOnRN(popQueue);
                            },
                        );
                    } else {
                        translateY.value = withSpring(0, { ...SPRING.snapBack, velocity: e.velocityY });
                        scheduleOnRN(restartDismissTimer);
                    }
                }),
        [translateY, hiddenY, popQueue, clearDismissTimer, restartDismissTimer],
    );

    const animatedStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
        transform: [{ translateY: translateY.value }],
    }));

    const onToastLayout = useCallback(
        (e: LayoutChangeEvent) => {
            hiddenY.value = -(e.nativeEvent.layout.height + top + 20);
        },
        [hiddenY, top],
    );

    return (
        <>
            {children}
            {current ? (
                // Raíz de gestos propia: este host se pinta fuera del GestureHandlerRootView de la app.
                <GestureHandlerRootView style={[styles.wrap, { top }]}>
                <GestureDetector gesture={pan}>
                <Animated.View style={animatedStyle} onLayout={onToastLayout}>
                    <Pressable onPress={open} style={styles.card} accessibilityRole="button">
                        {current.avatarUrl ? (
                            <ProfileAvatar
                                uri={current.avatarUrl}
                                name={current.title || 'N'}
                                size={44}
                                recyclingKey={current.id}
                            />
                        ) : null}
                        <View style={styles.textCol}>
                            <Text style={styles.title} numberOfLines={1}>
                                {current.title}
                            </Text>
                            {current.body ? (
                                <Text style={styles.body} numberOfLines={2}>
                                    {current.body}
                                </Text>
                            ) : null}
                        </View>
                    </Pressable>
                </Animated.View>
                </GestureDetector>
                </GestureHandlerRootView>
            ) : null}
        </>
    );
}

function createToastStyles(c: ThemeColors) {
    return StyleSheet.create({
        wrap: {
            position: 'absolute',
            left: 12,
            right: 12,
            zIndex: 80,
            elevation: 20,
        },
        card: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            backgroundColor: c.surface,
            borderRadius: 18,
            paddingVertical: 12,
            paddingHorizontal: 12,
            borderWidth: 1,
            borderColor: c.border,
            ...theme.shadows.floating,
        },
        textCol: { flex: 1, minWidth: 0 },
        title: {
            fontSize: 15,
            fontWeight: '800',
            color: c.text,
            letterSpacing: -0.2,
        },
        body: {
            marginTop: 2,
            fontSize: 13,
            fontWeight: '600',
            color: c.textMuted,
            lineHeight: 18,
        },
    });
}

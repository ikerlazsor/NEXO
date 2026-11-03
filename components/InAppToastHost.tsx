import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    PanResponder,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

type Props = { children: React.ReactNode };

export function InAppToastHost({ children }: Props) {
    const insets = useSafeAreaInsets();
    const styles = useThemedStyles(createToastStyles);
    const [queue, setQueue] = useState<InAppToast[]>([]);
    const current = queue[0] ?? null;
    const translateY = useRef(new Animated.Value(-120)).current;
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const dismiss = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        Animated.timing(translateY, {
            toValue: -120,
            duration: 180,
            useNativeDriver: true,
        }).start(() => {
            setQueue((prev) => prev.slice(1));
        });
    }, [translateY]);

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
        translateY.setValue(-120);
        Animated.spring(translateY, {
            toValue: 0,
            damping: 18,
            stiffness: 220,
            useNativeDriver: true,
        }).start();
        timerRef.current = setTimeout(dismiss, SHOW_MS);
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [current, dismiss, translateY]);

    const open = () => {
        if (!current) return;
        hapticMedium();
        const data = current.data;
        const target = resolvePushNavigation(data);
        dismiss();
        navigateAppHref(router, target?.href ?? fallbackPushHref(data));
        void warmPushDestination(data);
    };

    const pan = useRef(
        PanResponder.create({
            onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 8 && g.dy < 0,
            onPanResponderRelease: (_, g) => {
                if (g.dy < -24 || g.vy < -0.6) dismiss();
            },
        }),
    ).current;

    return (
        <>
            {children}
            {current ? (
                <Animated.View
                    pointerEvents="box-none"
                    style={[
                        styles.wrap,
                        { top: Math.max(insets.top, 8) + 6, transform: [{ translateY }] },
                    ]}
                    {...pan.panHandlers}
                >
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

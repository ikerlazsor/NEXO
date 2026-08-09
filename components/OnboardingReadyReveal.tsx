import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import Animated, {
    Easing,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withSequence,
    withSpring,
    withTiming,
} from 'react-native-reanimated';

const INK = '#0F2A4A';
const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const PRIMARY_SOFT = '#93C5FD';
const PRIMARY_GLOW = '#60A5FA';

const LOAD_MS = 1500;
const TYPE_BASE_MS = 36;
const TYPE_COMMA_MS = 180;
const TYPE_PERIOD_MS = 420;
const DELETE_MS = 26;
const PAUSE_BEFORE_DELETE_MS = 650;
const PAUSE_BEFORE_INSERT_MS = 520;
const INSERT_BASE_MS = 62;

type Props = {
    message: string;
    cta: string;
    backLabel: string;
    busy: boolean;
    rewrite?: { remove: string; insert: string } | null;
    onBack: () => void;
    onFinish: () => void;
};

function delayAfterChar(ch: string): number {
    if (ch === '.' || ch === '!' || ch === '?' || ch === '—' || ch === '-') return TYPE_PERIOD_MS;
    if (ch === ',' || ch === ';' || ch === ':') return TYPE_COMMA_MS;
    return TYPE_BASE_MS;
}

function delayInsertChar(ch: string): number {
    if (ch === '.' || ch === '!' || ch === '?' || ch === '—' || ch === '-' || ch === ')') return TYPE_PERIOD_MS + 80;
    if (ch === ',' || ch === ';' || ch === ':') return TYPE_COMMA_MS + 40;
    return INSERT_BASE_MS;
}

function finishButtonAnim(
    buttonReveal: { value: number },
    lure: { value: number },
) {
    buttonReveal.value = withSpring(1, { damping: 13, stiffness: 90, mass: 0.85 });
    lure.value = withRepeat(
        withSequence(
            withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.sin) }),
            withTiming(0, { duration: 1200, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        false,
    );
}

function OrbitLoader() {
    const spin = useSharedValue(0);
    const spinRev = useSharedValue(0);
    const pulse = useSharedValue(0);

    useEffect(() => {
        spin.value = withRepeat(
            withTiming(1, { duration: 1600, easing: Easing.linear }),
            -1,
            false,
        );
        spinRev.value = withRepeat(
            withTiming(1, { duration: 2200, easing: Easing.linear }),
            -1,
            false,
        );
        pulse.value = withRepeat(
            withSequence(
                withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }),
                withTiming(0, { duration: 700, easing: Easing.inOut(Easing.quad) }),
            ),
            -1,
            false,
        );
    }, [spin, spinRev, pulse]);

    const ringStyle = useAnimatedStyle(() => ({
        transform: [{ rotate: `${spin.value * 360}deg` }],
    }));

    const ringRevStyle = useAnimatedStyle(() => ({
        transform: [{ rotate: `${-spinRev.value * 360}deg` }],
    }));

    const coreStyle = useAnimatedStyle(() => ({
        transform: [{ scale: interpolate(pulse.value, [0, 1], [0.88, 1.08]) }],
        opacity: interpolate(pulse.value, [0, 1], [0.75, 1]),
        shadowOpacity: interpolate(pulse.value, [0, 1], [0.25, 0.55]),
    }));

    const d0 = useAnimatedStyle(() => {
        const deg = spin.value * 360;
        const rad = (deg * Math.PI) / 180;
        return {
            transform: [{ translateX: Math.cos(rad) * 34 }, { translateY: Math.sin(rad) * 34 }],
        };
    });
    const d1 = useAnimatedStyle(() => {
        const deg = spin.value * 360 + 120;
        const rad = (deg * Math.PI) / 180;
        return {
            transform: [{ translateX: Math.cos(rad) * 34 }, { translateY: Math.sin(rad) * 34 }],
        };
    });
    const d2 = useAnimatedStyle(() => {
        const deg = spin.value * 360 + 240;
        const rad = (deg * Math.PI) / 180;
        return {
            transform: [{ translateX: Math.cos(rad) * 34 }, { translateY: Math.sin(rad) * 34 }],
        };
    });

    return (
        <View style={styles.loaderWrap}>
            <Animated.View style={[styles.ringOuter, ringStyle]} />
            <Animated.View style={[styles.ringInner, ringRevStyle]} />
            <Animated.View style={[styles.dot, d0]} />
            <Animated.View style={[styles.dot, styles.dotAlt, d1]} />
            <Animated.View style={[styles.dot, d2]} />
            <Animated.View style={[styles.core, coreStyle]}>
                <LinearGradient
                    colors={[PRIMARY_SOFT, PRIMARY, PRIMARY_DARK]}
                    start={{ x: 0.2, y: 0 }}
                    end={{ x: 0.9, y: 1 }}
                    style={styles.coreFill}
                />
            </Animated.View>
        </View>
    );
}

export function OnboardingReadyReveal({
    message,
    cta,
    backLabel,
    busy,
    rewrite = null,
    onBack,
    onFinish,
}: Props) {
    const cardEnter = useSharedValue(0);
    const buttonReveal = useSharedValue(0);
    const lure = useSharedValue(0);
    const loadingVis = useSharedValue(1);
    const [phase, setPhase] = useState<'loading' | 'content' | 'done'>('loading');
    const [layoutText, setLayoutText] = useState(message);
    const [typedCount, setTypedCount] = useState(0);
    const [showCaret, setShowCaret] = useState(false);
    const [caretOn, setCaretOn] = useState(true);

    const draftChars = useMemo(() => Array.from(message), [message]);
    const layoutChars = useMemo(() => Array.from(layoutText), [layoutText]);

    const rewritePlan = useMemo(() => {
        if (!rewrite?.remove || !rewrite.insert) return null;
        if (!message.endsWith(rewrite.remove)) return null;
        const prefix = message.slice(0, message.length - rewrite.remove.length);
        const finalText = prefix + rewrite.insert;
        return {
            prefix,
            prefixLen: Array.from(prefix).length,
            finalText,
            insertChars: Array.from(rewrite.insert),
        };
    }, [message, rewrite]);

    useEffect(() => {
        cardEnter.value = 0;
        buttonReveal.value = 0;
        lure.value = 0;
        loadingVis.value = 1;
        setPhase('loading');
        setLayoutText(message);
        setTypedCount(0);
        setShowCaret(false);
        cardEnter.value = withSpring(1, { damping: 14, stiffness: 70, mass: 0.85 });

        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let settleWait: (() => void) | null = null;

        const wait = (ms: number) =>
            new Promise<void>((resolve) => {
                settleWait = () => {
                    settleWait = null;
                    resolve();
                };
                timer = setTimeout(() => {
                    const done = settleWait;
                    settleWait = null;
                    done?.();
                }, ms);
            });

        const run = async () => {
            await wait(LOAD_MS);
            if (cancelled) return;

            loadingVis.value = withTiming(0, { duration: 220 });
            setPhase('content');
            setShowCaret(true);

            // Layout completo (draft) fijo → palabras ya nacen en su línea; lo escrito no se mueve.
            setLayoutText(message);
            for (let i = 1; i <= draftChars.length; i += 1) {
                if (cancelled) return;
                setTypedCount(i);
                await wait(delayAfterChar(draftChars[i - 1] ?? ''));
                if (cancelled) return;
            }

            if (rewritePlan) {
                await wait(PAUSE_BEFORE_DELETE_MS);
                if (cancelled) return;

                // Borra solo bajando opacidad: el layout no se reajusta.
                for (let i = draftChars.length - 1; i >= rewritePlan.prefixLen; i -= 1) {
                    if (cancelled) return;
                    setTypedCount(i);
                    await wait(DELETE_MS);
                    if (cancelled) return;
                }

                await wait(PAUSE_BEFORE_INSERT_MS);
                if (cancelled) return;

                // Sustituye el final en los mismos “huecos” (padding) → el prefijo no se recentra.
                const removeLen = draftChars.length - rewritePlan.prefixLen;
                const insertLen = rewritePlan.insertChars.length;
                const padLen = Math.max(0, removeLen - insertLen);
                const paddedFinal =
                    rewritePlan.prefix +
                    rewritePlan.insert +
                    '\u00a0'.repeat(padLen);
                setLayoutText(paddedFinal);
                setTypedCount(rewritePlan.prefixLen);

                for (let i = 0; i < insertLen; i += 1) {
                    if (cancelled) return;
                    setTypedCount(rewritePlan.prefixLen + i + 1);
                    await wait(delayInsertChar(rewritePlan.insertChars[i] ?? ''));
                    if (cancelled) return;
                }
            }

            if (cancelled) return;
            setShowCaret(false);
            setPhase('done');
            finishButtonAnim(buttonReveal, lure);
        };

        void run();

        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
            settleWait?.();
        };
    }, [cardEnter, buttonReveal, lure, loadingVis, draftChars, rewritePlan, message]);

    useEffect(() => {
        if (phase !== 'content') {
            setCaretOn(true);
            return;
        }
        const id = setInterval(() => setCaretOn((v) => !v), 530);
        return () => clearInterval(id);
    }, [phase]);

    const shellStyle = useAnimatedStyle(() => ({
        opacity: cardEnter.value,
        transform: [
            { scale: interpolate(cardEnter.value, [0, 1], [0.96, 1]) },
            { translateY: interpolate(cardEnter.value, [0, 1], [12, 0]) },
        ],
    }));

    const loaderAnimStyle = useAnimatedStyle(() => ({
        opacity: loadingVis.value,
        transform: [{ scale: interpolate(loadingVis.value, [0, 1], [0.92, 1]) }],
    }));

    const contentAnimStyle = useAnimatedStyle(() => ({
        opacity: 1 - loadingVis.value,
    }));

    const buttonStyle = useAnimatedStyle(() => {
        const appear = buttonReveal.value;
        const pulse = lure.value;
        return {
            opacity: appear,
            transform: [
                { translateY: interpolate(appear, [0, 1], [10, 0]) },
                { scale: appear * interpolate(pulse, [0, 1], [1, 1.018]) },
            ],
            shadowOpacity: appear * interpolate(pulse, [0, 1], [0.22, 0.36]),
            shadowRadius: interpolate(pulse, [0, 1], [8, 14]),
        };
    });

    return (
        <Animated.View style={shellStyle}>
            <Pressable onPress={onBack} style={styles.backLink} disabled={busy}>
                <Ionicons name="chevron-back" size={18} color={PRIMARY_DARK} />
                <Text style={styles.backText}>{backLabel}</Text>
            </Pressable>

            <View style={styles.stage}>
                <Animated.View
                    pointerEvents={phase === 'loading' ? 'auto' : 'none'}
                    style={[styles.loaderLayer, loaderAnimStyle]}
                >
                    <OrbitLoader />
                </Animated.View>

                <Animated.View style={[styles.contentLayer, contentAnimStyle]} pointerEvents="box-none">
                    <View style={styles.messageBlock}>
                        <Text style={styles.readyMessage} accessibilityLiveRegion="polite">
                            {layoutChars.map((ch, i) => (
                                <Text key={i}>
                                    {showCaret && caretOn && i === typedCount ? (
                                        <Text style={styles.caret}>|</Text>
                                    ) : null}
                                    <Text style={{ opacity: i < typedCount ? 1 : 0 }}>{ch}</Text>
                                </Text>
                            ))}
                            {showCaret && caretOn && typedCount >= layoutChars.length ? (
                                <Text style={styles.caret}>|</Text>
                            ) : null}
                        </Text>
                    </View>

                    <Animated.View
                        style={[styles.btnShadowWrap, buttonStyle]}
                        pointerEvents={phase === 'done' ? 'auto' : 'none'}
                    >
                        <TouchableOpacity
                            onPress={onFinish}
                            disabled={busy || phase !== 'done'}
                            activeOpacity={0.88}
                            style={styles.btnOuter}
                        >
                            <LinearGradient
                                colors={['#5BB0FF', PRIMARY, PRIMARY_DARK]}
                                locations={[0, 0.45, 1]}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 1 }}
                                style={styles.btn}
                            >
                                {busy ? (
                                    <ActivityIndicator color="#FFF" />
                                ) : (
                                    <Text style={styles.btnText}>{cta}</Text>
                                )}
                            </LinearGradient>
                        </TouchableOpacity>
                    </Animated.View>
                </Animated.View>
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    backLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 20 },
    backText: { color: PRIMARY_DARK, fontWeight: '700', fontSize: 14 },
    stage: {
        minHeight: 260,
        position: 'relative',
        justifyContent: 'center',
    },
    loaderLayer: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2,
    },
    contentLayer: {
        zIndex: 1,
    },
    loaderWrap: {
        width: 96,
        height: 96,
        alignItems: 'center',
        justifyContent: 'center',
    },
    ringOuter: {
        position: 'absolute',
        width: 88,
        height: 88,
        borderRadius: 44,
        borderWidth: 3,
        borderColor: 'transparent',
        borderTopColor: PRIMARY,
        borderRightColor: PRIMARY_SOFT,
        opacity: 0.95,
    },
    ringInner: {
        position: 'absolute',
        width: 64,
        height: 64,
        borderRadius: 32,
        borderWidth: 2.5,
        borderColor: 'transparent',
        borderBottomColor: PRIMARY_DARK,
        borderLeftColor: PRIMARY_SOFT,
        opacity: 0.85,
    },
    core: {
        width: 28,
        height: 28,
        borderRadius: 14,
        overflow: 'hidden',
        shadowColor: PRIMARY_DARK,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 0 },
        elevation: 6,
    },
    coreFill: { flex: 1 },
    dot: {
        position: 'absolute',
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: PRIMARY,
    },
    dotAlt: { backgroundColor: PRIMARY_SOFT, width: 8, height: 8, borderRadius: 4 },
    messageBlock: {
        width: '100%',
        alignSelf: 'stretch',
    },
    readyMessage: {
        fontSize: 24,
        fontWeight: '800',
        color: INK,
        textAlign: 'left',
        lineHeight: 34,
        marginBottom: 36,
        paddingHorizontal: 2,
    },
    caret: {
        color: PRIMARY_DARK,
        fontWeight: '400',
        opacity: 0.85,
    },
    btnShadowWrap: {
        borderRadius: 16,
        shadowColor: PRIMARY_GLOW,
        shadowOffset: { width: 0, height: 6 },
        elevation: 10,
        backgroundColor: 'transparent',
    },
    btnOuter: {
        borderRadius: 16,
        overflow: 'hidden',
    },
    btn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 16,
        borderRadius: 16,
        overflow: 'hidden',
    },
    btnText: { color: '#FFF', fontWeight: '800', fontSize: 16 },
});

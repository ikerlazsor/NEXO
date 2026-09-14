import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import Animated, {
    Easing,
    FadeIn,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withSequence,
    withTiming,
} from 'react-native-reanimated';
import { ProfileAvatar } from './ProfileAvatar';

const INK = '#0F2A4A';
const MUTED = '#64748B';
const PRIMARY_DARK = '#2563EB';

type Props = {
    name: string;
    avatarUri: string | null;
    preparingLabel: string;
    retryLabel: string;
    busy: boolean;
    onFinish: () => void;
};

export function OnboardingReadyReveal({
    name,
    avatarUri,
    preparingLabel,
    retryLabel,
    busy,
    onFinish,
}: Props) {
    const [started, setStarted] = useState(false);
    const pulse = useSharedValue(0);

    useEffect(() => {
        setStarted(true);
        onFinish();
        // Solo al montar: arranca el guardado del perfil.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        pulse.value = withRepeat(
            withSequence(
                withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
                withTiming(0, { duration: 900, easing: Easing.inOut(Easing.quad) }),
            ),
            -1,
            false,
        );
    }, [pulse]);

    const avatarPulse = useAnimatedStyle(() => ({
        transform: [{ scale: 1 + pulse.value * 0.03 }],
        opacity: 0.92 + pulse.value * 0.08,
    }));

    const pending = busy || !started;

    return (
        <Animated.View entering={FadeIn.duration(280)} style={styles.wrap}>
            <Animated.View style={[styles.avatarRing, avatarPulse]}>
                <ProfileAvatar uri={avatarUri} name={name} size={112} />
            </Animated.View>
            <Text style={styles.name} numberOfLines={2}>
                {name}
            </Text>
            <Text style={styles.hint}>{preparingLabel}</Text>
            {pending ? (
                <ActivityIndicator color={PRIMARY_DARK} style={styles.spinner} />
            ) : (
                <TouchableOpacity
                    onPress={onFinish}
                    activeOpacity={0.88}
                    style={styles.retryBtn}
                >
                    <Text style={styles.retryText}>{retryLabel}</Text>
                </TouchableOpacity>
            )}
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        alignItems: 'center',
        paddingVertical: 28,
        paddingHorizontal: 8,
    },
    avatarRing: {
        borderRadius: 64,
        padding: 4,
        backgroundColor: '#EFF6FF',
        borderWidth: 3,
        borderColor: '#BFDBFE',
        marginBottom: 18,
    },
    name: {
        fontSize: 26,
        fontWeight: '900',
        color: INK,
        textAlign: 'center',
        marginBottom: 10,
        paddingHorizontal: 8,
    },
    hint: {
        fontSize: 15,
        fontWeight: '600',
        color: MUTED,
        textAlign: 'center',
        marginBottom: 20,
    },
    spinner: { marginTop: 4 },
    retryBtn: {
        marginTop: 4,
        backgroundColor: PRIMARY_DARK,
        borderRadius: 16,
        paddingVertical: 14,
        paddingHorizontal: 28,
    },
    retryText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
});

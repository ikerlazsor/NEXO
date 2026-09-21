import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withTiming,
} from 'react-native-reanimated';

type Props = {
    /** Incrementar para disparar una ráfaga. */
    burstKey: number;
    color?: string;
};

type Particle = {
    id: string;
    x: number;
    delay: number;
    duration: number;
    size: number;
    drift: number;
    rise: number;
};

function HeartParticle({
    x,
    delay,
    duration,
    size,
    drift,
    rise,
    color,
}: Omit<Particle, 'id'> & { color: string }) {
    const progress = useSharedValue(0);
    const style = useAnimatedStyle(() => {
        const t = progress.value;
        const ease = 1 - (1 - t) * (1 - t);
        return {
            opacity: t < 0.12 ? t / 0.12 : Math.max(0, 1 - (t - 0.12) / 0.88),
            transform: [
                { translateX: x + drift * ease },
                { translateY: -12 - rise * ease },
                { scale: 0.4 + 0.75 * (1 - t) },
                { rotate: `${drift * 0.4 * t}deg` },
            ],
        };
    });

    useEffect(() => {
        progress.value = 0;
        progress.value = withDelay(
            delay,
            withTiming(1, { duration, easing: Easing.out(Easing.cubic) }),
        );
    }, [delay, duration, progress]);

    return (
        <Animated.View pointerEvents="none" style={[styles.particle, style]}>
            <Ionicons name="heart" size={size} color={color} />
        </Animated.View>
    );
}

/** Lluvia / explosión corta de corazones (detalle de plan). */
export function HeartRain({ burstKey, color = '#EF4444' }: Props) {
    const [particles, setParticles] = useState<Particle[]>([]);

    useEffect(() => {
        if (!burstKey) return;
        const next: Particle[] = Array.from({ length: 16 }, (_, i) => ({
            id: `${burstKey}-${i}`,
            x: -56 + Math.random() * 112,
            delay: Math.floor(Math.random() * 120),
            duration: 700 + Math.floor(Math.random() * 380),
            size: 10 + Math.floor(Math.random() * 12),
            drift: -48 + Math.random() * 96,
            rise: 120 + Math.random() * 110,
        }));
        setParticles(next);
        const clear = setTimeout(() => setParticles([]), 1300);
        return () => clearTimeout(clear);
    }, [burstKey]);

    const items = useMemo(() => particles, [particles]);
    if (!items.length) return null;

    return (
        <View pointerEvents="none" style={styles.host}>
            {items.map((p) => (
                <HeartParticle key={p.id} {...p} color={color} />
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    host: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 20,
        overflow: 'visible',
    },
    particle: {
        position: 'absolute',
    },
});

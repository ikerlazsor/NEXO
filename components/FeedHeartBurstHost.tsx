import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withTiming,
} from 'react-native-reanimated';
import { subscribeHeartBurst } from '../lib/heartBurst';

type Particle = {
    id: string;
    ox: number;
    oy: number;
    dx: number;
    dy: number;
    delay: number;
    duration: number;
    size: number;
    spin: number;
};

type Burst = {
    id: string;
    particles: Particle[];
};

function BurstParticle({
    ox,
    oy,
    dx,
    dy,
    delay,
    duration,
    size,
    spin,
}: Omit<Particle, 'id'>) {
    const progress = useSharedValue(0);
    const style = useAnimatedStyle(() => {
        const t = progress.value;
        const ease = 1 - (1 - t) * (1 - t);
        return {
            opacity: t < 0.1 ? t / 0.1 : Math.max(0, 1 - (t - 0.1) / 0.9),
            transform: [
                { translateX: ox + dx * ease },
                { translateY: oy + dy * ease },
                { scale: 0.45 + 0.85 * (1 - t) + 0.2 * Math.sin(t * Math.PI) },
                { rotate: `${spin * t}deg` },
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
            <Ionicons name="heart" size={size} color="#EF4444" />
        </Animated.View>
    );
}

function BurstLayer({ burst }: { burst: Burst }) {
    return (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {burst.particles.map((p) => (
                <BurstParticle key={p.id} {...p} />
            ))}
        </View>
    );
}

/** Overlay a pantalla completa: explosión radial desde el corazón. */
export function FeedHeartBurstHost() {
    const [bursts, setBursts] = useState<Burst[]>([]);

    useEffect(() => {
        return subscribeHeartBurst((evt) => {
            const id = `${evt.at}`;
            const particles: Particle[] = Array.from({ length: 26 }, (_, i) => {
                const angle = (i / 26) * Math.PI * 2 + (Math.random() - 0.5) * 0.45;
                const speed = 110 + Math.random() * 150;
                return {
                    id: `${id}-${i}`,
                    ox: evt.x,
                    oy: evt.y,
                    dx: Math.cos(angle) * speed,
                    dy: Math.sin(angle) * speed,
                    delay: Math.floor(Math.random() * 70),
                    duration: 720 + Math.floor(Math.random() * 380),
                    size: 14 + Math.floor(Math.random() * 16),
                    spin: -70 + Math.random() * 140,
                };
            });
            setBursts((prev) => [...prev.slice(-2), { id, particles }]);
            setTimeout(() => {
                setBursts((prev) => prev.filter((b) => b.id !== id));
            }, 1400);
        });
    }, []);

    if (!bursts.length) return null;

    return (
        <View pointerEvents="none" style={styles.host}>
            {bursts.map((b) => (
                <BurstLayer key={b.id} burst={b} />
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    host: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 80,
        elevation: 80,
    },
    particle: {
        position: 'absolute',
        left: 0,
        top: 0,
    },
});

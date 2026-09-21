import { Image } from 'expo-image';
import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
    type SharedValue,
    useAnimatedStyle,
    useSharedValue,
} from 'react-native-reanimated';

const IDLE = require('../assets/images/Pinguino idle.png');
const BLINK = require('../assets/images/pinguino pestaneando.png');
const LOOK_DOWN = require('../assets/images/pinguino mirando abajo.png');
const COVER_BOTH = require('../assets/images/Pinguino ojos tapados.png');
const COVER_ONE = require('../assets/images/Pinguino un ojo tapado.png');
const SAD = require('../assets/images/Pinguino triste.png');

export type PenguinMood = 'idle' | 'lookDown' | 'coverBoth' | 'coverOne' | 'sad';

const BLINK_HOLD_MS = 100;
export const PENGUIN_SIZE = 200;
/** Cuánto del alto del PNG queda por encima del borde del card (patas en la línea). */
export const PENGUIN_PERCH_RATIO = 0.82;

type Props = {
    mood: PenguinMood;
};

type PoseKey = PenguinMood | 'blink';

const POSES: { key: PoseKey; source: number }[] = [
    { key: 'idle', source: IDLE },
    { key: 'blink', source: BLINK },
    { key: 'lookDown', source: LOOK_DOWN },
    { key: 'coverBoth', source: COVER_BOTH },
    { key: 'coverOne', source: COVER_ONE },
    { key: 'sad', source: SAD },
];

function PoseLayer({ source, opacity }: { source: number; opacity: SharedValue<number> }) {
    const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
    return (
        <Animated.View style={[styles.pose, style]} pointerEvents="none">
            <Image
                source={source}
                style={styles.image}
                contentFit="contain"
                cachePolicy="memory-disk"
                transition={0}
            />
        </Animated.View>
    );
}

/**
 * Mascota login: cambio de pose instantáneo (sin bounce / sin crossfade).
 * Parpadeo = swap exclusivo idle↔blink (nunca ambas a la vez → sin cuerpo “más gordo”).
 */
export function LoginPenguin({ mood }: Props) {
    const idleOp = useSharedValue(1);
    const blinkOp = useSharedValue(0);
    const lookOp = useSharedValue(0);
    const bothOp = useSharedValue(0);
    const oneOp = useSharedValue(0);
    const sadOp = useSharedValue(0);
    const blinkingRef = useRef(false);
    const moodRef = useRef(mood);
    moodRef.current = mood;

    const opacities = useMemo(
        () =>
            ({
                idle: idleOp,
                blink: blinkOp,
                lookDown: lookOp,
                coverBoth: bothOp,
                coverOne: oneOp,
                sad: sadOp,
            }) as const,
        [idleOp, blinkOp, lookOp, bothOp, oneOp, sadOp],
    );

    useEffect(() => {
        blinkingRef.current = false;
        opacities.blink.value = 0;
        (Object.keys(opacities) as (keyof typeof opacities)[]).forEach((key) => {
            if (key === 'blink') return;
            opacities[key].value = key === mood ? 1 : 0;
        });
    }, [mood, opacities]);

    useEffect(() => {
        if (mood !== 'idle') return;

        let cancelled = false;
        let timeout: ReturnType<typeof setTimeout> | null = null;

        const schedule = () => {
            const delay = 2400 + Math.random() * 2200;
            timeout = setTimeout(() => {
                if (cancelled || moodRef.current !== 'idle' || blinkingRef.current) {
                    if (!cancelled) schedule();
                    return;
                }
                blinkingRef.current = true;
                // Swap duro: una sola pose visible (evita doble borde / cuerpo agrandado).
                opacities.idle.value = 0;
                opacities.blink.value = 1;
                timeout = setTimeout(() => {
                    if (cancelled) return;
                    opacities.blink.value = 0;
                    opacities.idle.value = moodRef.current === 'idle' ? 1 : 0;
                    blinkingRef.current = false;
                    if (!cancelled) schedule();
                }, BLINK_HOLD_MS);
            }, delay);
        };

        schedule();
        return () => {
            cancelled = true;
            if (timeout) clearTimeout(timeout);
        };
    }, [mood, opacities]);

    return (
        <View
            style={styles.wrap}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
        >
            {POSES.map((pose) => {
                const opacity =
                    pose.key === 'blink'
                        ? opacities.blink
                        : pose.key === 'idle'
                          ? opacities.idle
                          : pose.key === 'lookDown'
                            ? opacities.lookDown
                            : pose.key === 'coverBoth'
                              ? opacities.coverBoth
                              : pose.key === 'coverOne'
                                ? opacities.coverOne
                                : opacities.sad;
                return <PoseLayer key={pose.key} source={pose.source} opacity={opacity} />;
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        width: PENGUIN_SIZE,
        height: PENGUIN_SIZE,
        alignSelf: 'center',
    },
    pose: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
    },
    image: {
        width: PENGUIN_SIZE,
        height: PENGUIN_SIZE,
    },
});

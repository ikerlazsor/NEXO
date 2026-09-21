import { type ReactNode, useEffect } from 'react';
import {
    Pressable,
    StyleSheet,
    type GestureResponderEvent,
    type StyleProp,
    type ViewStyle,
} from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSequence,
    withSpring,
    withTiming,
    Easing,
} from 'react-native-reanimated';
import { hapticSoft } from '../lib/haptics';
import { theme } from '../theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = {
    children: ReactNode;
    onPress?: (event: GestureResponderEvent) => void;
    style?: StyleProp<ViewStyle>;
    pressedScale?: number;
    disabled?: boolean;
    accessibilityLabel?: string;
    accessibilityRole?: 'button' | 'link' | 'none';
    /** Feedback al empezar a pulsar (default true). */
    haptic?: boolean;
    hitSlop?: number | { top?: number; bottom?: number; left?: number; right?: number };
    /** Si cambia a truthy, hace un bounce elástico (p. ej. corazón guardado). */
    bounceKey?: string | number | boolean | null;
    /** Reserva zona táctil mínima (default true). */
    minTouch?: boolean;
    testID?: string;
};

const SPRING_OUT = { damping: 18, stiffness: 340 };
const BOUNCE = { damping: 14, stiffness: 320 };
const PRESS_IN = { duration: 55, easing: Easing.out(Easing.quad) };
const PRESS_OUT = { duration: 140, easing: Easing.out(Easing.cubic) };

/** Micro-escala al pulsar; opcional bounce al cambiar estado. */
export function PressScale({
    children,
    onPress,
    style,
    pressedScale = 0.96,
    disabled,
    accessibilityLabel,
    accessibilityRole = 'button',
    haptic = true,
    hitSlop,
    bounceKey,
    minTouch = true,
    testID,
}: Props) {
    const scale = useSharedValue(1);
    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));

    useEffect(() => {
        if (bounceKey === undefined || bounceKey === null || bounceKey === false) return;
        // Bounce suave (antes 1.18 agrandaba tabs / sombras).
        scale.value = withSequence(
            withSpring(1.06, BOUNCE),
            withSpring(1, SPRING_OUT),
        );
    }, [bounceKey, scale]);

    return (
        <AnimatedPressable
            testID={testID}
            accessibilityRole={accessibilityRole}
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ disabled }}
            disabled={disabled}
            hitSlop={hitSlop}
            onPress={onPress}
            onPressIn={() => {
                if (haptic && !disabled) hapticSoft();
                // Timing inmediato (no spring) para que no “espere” al JS del onPress.
                scale.value = withTiming(pressedScale, PRESS_IN);
            }}
            onPressOut={() => {
                scale.value = withTiming(1, PRESS_OUT);
            }}
            style={[minTouch ? styles.minimumTarget : null, style, animatedStyle]}
        >
            {children}
        </AnimatedPressable>
    );
}

const styles = StyleSheet.create({
    minimumTarget: {
        minWidth: theme.accessibility.minimumTouchTarget,
        minHeight: theme.accessibility.minimumTouchTarget,
    },
});

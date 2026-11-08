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
    cancelAnimation,
    useReducedMotion,
} from 'react-native-reanimated';
import { hapticSoft } from '../lib/haptics';
import { theme } from '../theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = {
    children: ReactNode;
    onPress?: (event: GestureResponderEvent) => void;
    onPressIn?: (event: GestureResponderEvent) => void;
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
const PRESS_OUT = { duration: 110, easing: Easing.out(Easing.cubic) };

/** Micro-escala al pulsar; opcional bounce al cambiar estado. */
export function PressScale({
    children,
    onPress,
    onPressIn,
    style,
    pressedScale = 0.975,
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
    const reducedMotion = useReducedMotion();
    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));

    useEffect(() => {
        if (reducedMotion || disabled) return;
        if (bounceKey === undefined || bounceKey === null || bounceKey === false) return;
        // Bounce suave (antes 1.18 agrandaba tabs / sombras).
        scale.value = withSequence(
            withSpring(1.025, BOUNCE),
            withSpring(1, SPRING_OUT),
        );
    }, [bounceKey, scale, reducedMotion, disabled]);
    useEffect(() => {
        if (disabled || reducedMotion) { cancelAnimation(scale); scale.value = 1; }
        return () => cancelAnimation(scale);
    },[disabled,reducedMotion,scale]);

    return (
        <AnimatedPressable
            testID={testID}
            accessibilityRole={accessibilityRole}
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ disabled }}
            disabled={disabled}
            hitSlop={hitSlop}
            onPress={onPress}
            onPressIn={(event) => {
                if (haptic && !disabled) hapticSoft();
                onPressIn?.(event);
                // Timing inmediato (no spring) para que no “espere” al JS del onPress.
                if (!disabled && !reducedMotion) scale.value = withTiming(pressedScale, PRESS_IN);
            }}
            onPressOut={() => {
                scale.value = reducedMotion ? 1 : withTiming(1, PRESS_OUT);
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

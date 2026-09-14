import { type ReactNode } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';
import { hapticSoft } from '../lib/haptics';
import { theme } from '../theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = {
    children: ReactNode;
    onPress?: () => void;
    style?: StyleProp<ViewStyle>;
    pressedScale?: number;
    disabled?: boolean;
    accessibilityLabel?: string;
    /** Feedback al empezar a pulsar (default true). */
    haptic?: boolean;
};

/** Micro-escala al pulsar para botones de la barra / CTAs. */
export function PressScale({
    children,
    onPress,
    style,
    pressedScale = 0.94,
    disabled,
    accessibilityLabel,
    haptic = true,
}: Props) {
    const scale = useSharedValue(1);
    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));

    return (
        <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={onPress}
            onPressIn={() => {
                if (haptic && !disabled) hapticSoft();
                scale.value = withSpring(pressedScale, { damping: 18, stiffness: 420 });
            }}
            onPressOut={() => {
                scale.value = withSpring(1, { damping: 16, stiffness: 380 });
            }}
            style={[styles.minimumTarget, style, animatedStyle]}
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

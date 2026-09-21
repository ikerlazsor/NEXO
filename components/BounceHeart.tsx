import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSequence,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { hapticSave } from '../lib/haptics';

type Props = {
    saved: boolean;
    onPress: () => void;
    size?: number;
    color?: string;
    savedColor?: string;
    style?: StyleProp<ViewStyle>;
    haptic?: boolean;
};

/** Guardar compacto (bookmark): press ligero + pop al guardar. */
export function BounceHeart({
    saved,
    onPress,
    size = 17,
    color = '#FFF',
    savedColor = '#FFF',
    style,
    haptic = true,
}: Props) {
    const scale = useSharedValue(1);
    const didMount = useRef(false);
    const animStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));

    useEffect(() => {
        if (!didMount.current) {
            didMount.current = true;
            return;
        }
        if (!saved) return;
        scale.value = withSequence(
            withSpring(1.14, { damping: 14, stiffness: 420 }),
            withSpring(1, { damping: 16, stiffness: 400 }),
        );
    }, [saved, scale]);

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={saved ? 'Unsave' : 'Save'}
            hitSlop={8}
            onPressIn={() => {
                scale.value = withTiming(0.88, { duration: 70 });
            }}
            onPressOut={() => {
                scale.value = withSpring(1, { damping: 16, stiffness: 400 });
            }}
            onPress={() => {
                if (haptic) hapticSave(!saved);
                onPress();
            }}
            style={[styles.wrap, style]}
        >
            <Animated.View style={animStyle}>
                <Ionicons
                    name={saved ? 'bookmark' : 'bookmark-outline'}
                    size={size}
                    color={saved ? savedColor : color}
                />
            </Animated.View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    wrap: {
        alignItems: 'center',
        justifyContent: 'center',
    },
});

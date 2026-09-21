import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, {
    SharedValue,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
} from 'react-native-reanimated';
import { useAppTheme } from '../lib/appTheme';

type Props = {
    pull: SharedValue<number>;
    refreshing: boolean;
};

/** Rueda clásica: se rellena al tirar; ActivityIndicator al refrescar. */
export function FeedRefreshBanner({ pull, refreshing }: Props) {
    const { colors } = useAppTheme();
    const refreshingSV = useSharedValue(refreshing ? 1 : 0);

    useEffect(() => {
        refreshingSV.value = refreshing ? 1 : 0;
    }, [refreshing, refreshingSV]);

    const pullStyle = useAnimatedStyle(() => {
        const p = Math.min(1, Math.max(0, pull.value));
        return {
            opacity: refreshingSV.value ? 0 : interpolate(p, [0, 0.08, 1], [0, 0.55, 1]),
            transform: [{ rotate: `${interpolate(p, [0, 1], [-40, 320])}deg` }],
        };
    });

    return (
        <View style={styles.host} pointerEvents="none">
            {refreshing ? (
                <ActivityIndicator size="small" color={colors.primary} />
            ) : (
                <Animated.View
                    style={[
                        styles.arc,
                        { borderTopColor: colors.primary, borderRightColor: colors.primary },
                        pullStyle,
                    ]}
                />
            )}
        </View>
    );
}

const SIZE = 26;
const STROKE = 2.5;

const styles = StyleSheet.create({
    host: {
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
    },
    arc: {
        width: SIZE,
        height: SIZE,
        borderRadius: SIZE / 2,
        borderWidth: STROKE,
        borderColor: 'transparent',
    },
});

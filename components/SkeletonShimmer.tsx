import { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
    Easing,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
} from 'react-native-reanimated';

const BASE = '#E8EEF5';
const HIGHLIGHT = '#F8FAFC';

type BoneProps = {
    width: number | `${number}%`;
    height: number;
    radius?: number;
    style?: StyleProp<ViewStyle>;
};

function Bone({ width, height, radius = 10, style }: BoneProps) {
    const t = useSharedValue(0);

    useEffect(() => {
        t.value = withRepeat(
            withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
            -1,
            true,
        );
    }, [t]);

    const animStyle = useAnimatedStyle(() => ({
        opacity: interpolate(t.value, [0, 1], [0.55, 1]),
        backgroundColor: t.value > 0.5 ? HIGHLIGHT : BASE,
    }));

    return (
        <Animated.View
            style={[
                {
                    width,
                    height,
                    borderRadius: radius,
                    backgroundColor: BASE,
                },
                animStyle,
                style,
            ]}
        />
    );
}

export function FeedSkeletonList({ count = 3 }: { count?: number }) {
    return (
        <View style={styles.feedList}>
            {Array.from({ length: count }, (_, i) => (
                <View key={i} style={styles.feedCard}>
                    <Bone width="100%" height={200} radius={0} />
                    <View style={styles.feedBody}>
                        <View style={styles.row}>
                            <Bone width={34} height={34} radius={17} />
                            <Bone width={34} height={34} radius={17} style={{ marginLeft: -10 }} />
                            <Bone width={34} height={34} radius={17} style={{ marginLeft: -10 }} />
                            <Bone width={90} height={14} style={{ marginLeft: 12 }} />
                        </View>
                        <Bone width="55%" height={14} style={{ marginTop: 14 }} />
                        <Bone width="70%" height={13} style={{ marginTop: 10 }} />
                        <Bone width="45%" height={13} style={{ marginTop: 8 }} />
                        <Bone width="100%" height={44} radius={14} style={{ marginTop: 16 }} />
                    </View>
                </View>
            ))}
        </View>
    );
}

export function ChatSkeletonList({ count = 7 }: { count?: number }) {
    return (
        <View style={styles.chatList}>
            {Array.from({ length: count }, (_, i) => (
                <View key={i} style={styles.chatRow}>
                    <Bone width={52} height={52} radius={26} />
                    <View style={styles.chatBody}>
                        <View style={styles.chatTop}>
                            <Bone width="48%" height={14} />
                            <Bone width={40} height={11} />
                        </View>
                        <Bone width="72%" height={12} style={{ marginTop: 10 }} />
                    </View>
                </View>
            ))}
        </View>
    );
}

export function MyPlansSkeletonList({ count = 4 }: { count?: number }) {
    return (
        <View style={styles.plansList}>
            {Array.from({ length: count }, (_, i) => (
                <View key={i} style={styles.planCard}>
                    <Bone width={64} height={64} radius={16} />
                    <View style={styles.planBody}>
                        <Bone width="70%" height={15} />
                        <Bone width="45%" height={12} style={{ marginTop: 8 }} />
                        <Bone width="55%" height={12} style={{ marginTop: 8 }} />
                    </View>
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    feedList: { paddingHorizontal: 20, paddingTop: 6, gap: 16 },
    feedCard: {
        backgroundColor: '#FFF',
        borderRadius: 28,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#E8EEF5',
    },
    feedBody: { padding: 18 },
    row: { flexDirection: 'row', alignItems: 'center' },
    chatList: { paddingHorizontal: 16, paddingTop: 8, gap: 4 },
    chatRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 8,
        gap: 12,
    },
    chatBody: { flex: 1 },
    chatTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    plansList: { paddingHorizontal: 20, paddingTop: 8, gap: 12 },
    planCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        backgroundColor: '#FFF',
        borderRadius: 18,
        padding: 14,
        borderWidth: 1,
        borderColor: '#E8EEF5',
    },
    planBody: { flex: 1 },
});

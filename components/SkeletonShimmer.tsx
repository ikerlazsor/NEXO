import { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useAppTheme, useThemedStyles } from '../lib/appTheme';
import { type ThemeColors } from '../theme';
import Animated, {
    Easing,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
} from 'react-native-reanimated';

type BoneProps = {
    width: number | `${number}%`;
    height: number;
    radius?: number;
    style?: StyleProp<ViewStyle>;
};

function Bone({ width, height, radius = 10, style }: BoneProps) {
    const { colors } = useAppTheme();
    const BASE = colors.surfaceSubtle;
    const HIGHLIGHT = colors.border;
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
    const styles = useThemedStyles(createSkeletonStyles);
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
    const styles = useThemedStyles(createSkeletonStyles);
    return (
        <View style={styles.chatList}>
            {Array.from({ length: count }, (_, i) => (
                <View key={i} style={styles.chatRow}>
                    <Bone width={56} height={56} radius={28} />
                    <View style={styles.chatBody}>
                        <View style={styles.chatTop}>
                            <Bone width="52%" height={16} />
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
    const styles = useThemedStyles(createSkeletonStyles);
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

export function PlanDetailSkeleton() {
    const styles = useThemedStyles(createSkeletonStyles);
    return (
        <View style={styles.planDetail}>
            <Bone width="100%" height={320} radius={0} />
            <View style={styles.planDetailBody}>
                <Bone width="75%" height={22} />
                <Bone width="50%" height={14} style={{ marginTop: 12 }} />
                <View style={styles.row}>
                    <Bone width={44} height={44} radius={22} />
                    <View style={{ flex: 1, marginLeft: 12, gap: 8 }}>
                        <Bone width="60%" height={14} />
                        <Bone width="40%" height={12} />
                    </View>
                </View>
                <Bone width="100%" height={160} radius={18} style={{ marginTop: 20 }} />
                <Bone width="100%" height={48} radius={16} style={{ marginTop: 24 }} />
            </View>
        </View>
    );
}

export function ProfileScreenSkeleton() {
    const styles = useThemedStyles(createSkeletonStyles);
    return (
        <View style={styles.profileShell}>
            <Bone width="100%" height={220} radius={0} />
            <View style={styles.profileBody}>
                <View style={[styles.row, { marginTop: -36 }]}>
                    <Bone width={92} height={92} radius={46} />
                    <View style={{ flex: 1, marginLeft: 16, gap: 8 }}>
                        <Bone width="55%" height={20} />
                        <Bone width="40%" height={14} />
                    </View>
                </View>
                <Bone width="100%" height={88} radius={20} style={{ marginTop: 20 }} />
                <Bone width="100%" height={120} radius={20} style={{ marginTop: 14 }} />
                <Bone width="100%" height={100} radius={20} style={{ marginTop: 14 }} />
            </View>
        </View>
    );
}

export function SettingsSkeletonList({ count = 8 }: { count?: number }) {
    const styles = useThemedStyles(createSkeletonStyles);
    return (
        <View style={styles.settingsCard}>
            {Array.from({ length: count }, (_, i) => (
                <View key={i}>
                    {i > 0 ? <View style={styles.settingsDivider} /> : null}
                    <View style={styles.settingsRow}>
                        <Bone width={40} height={40} radius={12} />
                        <View style={{ flex: 1, gap: 8 }}>
                            <Bone width="50%" height={14} />
                            <Bone width="70%" height={11} />
                        </View>
                    </View>
                </View>
            ))}
        </View>
    );
}

function createSkeletonStyles(c: ThemeColors) {
    return StyleSheet.create({
    feedList: { paddingHorizontal: 20, paddingTop: 6, gap: 16 },
    feedCard: {
        backgroundColor: c.surface,
        borderRadius: 26,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: c.border,
    },
    feedBody: { padding: 18 },
    row: { flexDirection: 'row', alignItems: 'center' },
    chatList: { paddingHorizontal: 0, paddingTop: 8, gap: 10 },
    chatRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 16,
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 12,
        backgroundColor: c.surface,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: c.border,
    },
    chatBody: { flex: 1 },
    chatTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    plansList: { paddingHorizontal: 20, paddingTop: 8, gap: 12 },
    planCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        backgroundColor: c.surface,
        borderRadius: 18,
        padding: 14,
        borderWidth: 1,
        borderColor: c.border,
    },
    planBody: { flex: 1 },
    planDetail: { flex: 1, backgroundColor: c.background },
    planDetailBody: { padding: 20, paddingTop: 16 },
    profileShell: { flex: 1, backgroundColor: c.backgroundAlt },
    profileBody: { paddingHorizontal: 20, paddingTop: 8 },
    settingsCard: {
        backgroundColor: c.surface,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: c.border,
        overflow: 'hidden',
    },
    settingsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    settingsDivider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: c.border,
        marginLeft: 70,
    },
    });
}

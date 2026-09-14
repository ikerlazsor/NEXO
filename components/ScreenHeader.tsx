import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../lib/appTheme';
import { StyleSheet, Text, View, type ReactNode } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressScale } from './PressScale';

export type ScreenHeaderMode = 'stack' | 'tab' | 'hero';

type ScreenHeaderProps = {
    title: string;
    onBack?: () => void;
    /** stack: back + título centrado. tab: título alineado a la izquierda. hero: overlay sobre imagen. */
    mode?: ScreenHeaderMode;
    subtitle?: string;
    compact?: boolean;
    /** Sin inset superior (p. ej. dentro de SafeAreaView). */
    embedded?: boolean;
    right?: ReactNode;
};

export function ScreenHeader({
    title,
    onBack,
    mode = 'stack',
    subtitle,
    compact = false,
    embedded = false,
    right,
}: ScreenHeaderProps) {
    const { colors } = useAppTheme();
    const insets = useSafeAreaInsets();
    const isHero = mode === 'hero';
    const isTab = mode === 'tab';
    const iconColor = isHero ? '#FFF' : colors.text;
    const titleColor = isHero ? '#FFF' : colors.text;

    return (
        <View
            style={[
                styles.wrap,
                compact && styles.wrapCompact,
                isTab && styles.wrapTab,
                { paddingTop: embedded ? (compact ? 0 : 4) : (compact ? 4 : 8) + insets.top },
            ]}
        >
            {!isTab && onBack ? (
                <PressScale
                    onPress={onBack}
                    pressedScale={0.92}
                    style={[
                        styles.backBtn,
                        {
                            backgroundColor: isHero ? 'rgba(255,255,255,0.14)' : colors.surface,
                            borderWidth: isHero ? 0 : StyleSheet.hairlineWidth,
                            borderColor: colors.border,
                        },
                    ]}
                >
                    <Ionicons name="chevron-back" size={22} color={iconColor} />
                </PressScale>
            ) : (
                <View style={styles.backSpacer} />
            )}
            <View style={[styles.titleWrap, isTab && styles.titleWrapTab]}>
                <Text style={[styles.title, { color: titleColor }, isTab && styles.titleTab]} numberOfLines={1}>
                    {title}
                </Text>
                {subtitle ? (
                    <Text
                        style={[
                            styles.subtitle,
                            { color: isHero ? 'rgba(255,255,255,0.75)' : colors.textMuted },
                        ]}
                        numberOfLines={1}
                    >
                        {subtitle}
                    </Text>
                ) : null}
            </View>
            {right ?? <View style={styles.backSpacer} />}
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingBottom: 12,
        gap: 12,
    },
    wrapCompact: {
        paddingBottom: 8,
    },
    wrapTab: {
        paddingBottom: 10,
    },
    backBtn: {
        width: 44,
        height: 44,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#1E3A8A',
        shadowOpacity: 0.08,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
    },
    backSpacer: { width: 44 },
    titleWrap: { flex: 1, alignItems: 'center' },
    titleWrapTab: { alignItems: 'flex-start' },
    title: { fontSize: 18, fontWeight: '900', letterSpacing: -0.3 },
    titleTab: { fontSize: 24, fontWeight: '900' },
    subtitle: { fontSize: 12, fontWeight: '600', marginTop: 2 },
});

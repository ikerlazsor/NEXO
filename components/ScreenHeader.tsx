import { Ionicons } from '@expo/vector-icons';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const INK = '#0F2A4A';

type ScreenHeaderProps = {
    title: string;
    onBack: () => void;
    variant?: 'light' | 'dark' | 'transparent';
    subtitle?: string;
};

export function ScreenHeader({ title, onBack, variant = 'light', subtitle }: ScreenHeaderProps) {
    const isDark = variant === 'dark';
    const isTransparent = variant === 'transparent';

    return (
        <View style={styles.wrap}>
            <TouchableOpacity
                onPress={onBack}
                style={[
                    styles.backBtn,
                    isDark && styles.backBtnDark,
                    isTransparent && styles.backBtnTransparent,
                ]}
                activeOpacity={0.8}
            >
                <Ionicons name="chevron-back" size={22} color={isDark || isTransparent ? '#FFF' : INK} />
            </TouchableOpacity>
            <View style={styles.titleWrap}>
                <Text style={[styles.title, (isDark || isTransparent) && styles.titleLight]} numberOfLines={1}>
                    {title}
                </Text>
                {subtitle ? (
                    <Text style={[styles.subtitle, (isDark || isTransparent) && styles.subtitleLight]} numberOfLines={1}>
                        {subtitle}
                    </Text>
                ) : null}
            </View>
            <View style={styles.spacer} />
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: Platform.OS === 'ios' ? 56 : 44,
        paddingBottom: 12,
        gap: 12,
    },
    backBtn: {
        width: 44,
        height: 44,
        borderRadius: 14,
        backgroundColor: '#FFF',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#1E3A8A',
        shadowOpacity: 0.08,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
    },
    backBtnDark: {
        backgroundColor: 'rgba(255,255,255,0.14)',
        shadowOpacity: 0,
        elevation: 0,
    },
    backBtnTransparent: {
        backgroundColor: 'rgba(255,255,255,0.18)',
        shadowOpacity: 0,
        elevation: 0,
    },
    titleWrap: { flex: 1, alignItems: 'center' },
    title: { fontSize: 18, fontWeight: '900', color: INK, letterSpacing: -0.3 },
    titleLight: { color: '#FFF' },
    subtitle: { fontSize: 12, fontWeight: '600', color: '#64748B', marginTop: 2 },
    subtitleLight: { color: 'rgba(255,255,255,0.75)' },
    spacer: { width: 44 },
});

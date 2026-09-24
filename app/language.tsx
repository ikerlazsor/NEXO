import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAppTheme, useThemedStyles } from '../lib/appTheme';
import { hapticSelection } from '../lib/haptics';
import { LANG_OPTIONS, useT } from '../lib/i18n';
import { type ThemeColors } from '../theme';

export default function LanguageScreen() {
    const router = useRouter();
    const { t, lang, setLang } = useT();
    const { colors } = useAppTheme();
    const styles = useThemedStyles(createStyles);

    return (
        <View style={styles.container}>
            <LinearGradient colors={[colors.gradientTop, colors.gradientBottom]} style={StyleSheet.absoluteFill} />
            <SafeAreaView style={{ flex: 1 }} edges={['top']}>
                <ScreenHeader compact embedded title={t('settings.language')} onBack={() => router.back()} />
                <ScrollView
                    contentContainerStyle={styles.content}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                >
                    <View style={styles.card}>
                        {LANG_OPTIONS.map((opt, index) => {
                            const active = lang === opt.code;
                            return (
                                <View key={opt.code}>
                                    {index > 0 ? <View style={styles.divider} /> : null}
                                    <TouchableOpacity
                                        style={styles.row}
                                        activeOpacity={0.7}
                                        onPress={() => {
                                            if (opt.code === lang) return;
                                            hapticSelection();
                                            setLang(opt.code);
                                            router.back();
                                        }}
                                        accessibilityRole="button"
                                        accessibilityState={{ selected: active }}
                                    >
                                        <Text style={styles.flag}>{opt.flag}</Text>
                                        <View style={styles.textCol}>
                                            <Text style={[styles.name, { color: colors.text }]}>{opt.name}</Text>
                                            <Text style={[styles.code, { color: colors.textSubtle }]}>{opt.label}</Text>
                                        </View>
                                        {active ? (
                                            <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                                        ) : (
                                            <View style={styles.checkPlaceholder} />
                                        )}
                                    </TouchableOpacity>
                                </View>
                            );
                        })}
                    </View>
                </ScrollView>
            </SafeAreaView>
        </View>
    );
}

function createStyles(c: ThemeColors) {
    return StyleSheet.create({
        container: { flex: 1, backgroundColor: c.backgroundAlt },
        content: { paddingHorizontal: 20, paddingBottom: 40 },
        card: {
            backgroundColor: c.surface,
            borderRadius: 20,
            overflow: 'hidden',
            elevation: 3,
            shadowColor: '#000',
            shadowOpacity: 0.12,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 6 },
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
        },
        row: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 14,
            paddingHorizontal: 16,
            gap: 14,
        },
        flag: { fontSize: 28, lineHeight: 34, width: 36, textAlign: 'center' },
        textCol: { flex: 1, minWidth: 0 },
        name: { fontSize: 16, fontWeight: '700' },
        code: { marginTop: 2, fontSize: 12, fontWeight: '600' },
        checkPlaceholder: { width: 22, height: 22 },
        divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 66 },
    });
}

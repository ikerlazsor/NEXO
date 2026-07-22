import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
    LayoutAnimation,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    UIManager,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '../components/ScreenHeader';
import { useT } from '../lib/i18n';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

const INK = '#0F2A4A';
const MUTED = '#64748B';
const BORDER = '#E2E8F0';
const BG = '#F8FAFC';
const CARD = '#FFFFFF';

const SECTIONS = [
    'terms.acceptance',
    'terms.service',
    'terms.accounts',
    'terms.plans',
    'terms.conduct',
    'terms.privacy',
    'terms.liability',
    'terms.changes',
] as const;

export default function TermsScreen() {
    const router = useRouter();
    const { t } = useT();
    const insets = useSafeAreaInsets();
    const [expanded, setExpanded] = useState<string | null>(null);

    const toggle = (key: string) => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpanded((prev) => (prev === key ? null : key));
    };

    return (
        <View style={styles.container}>
            <ScreenHeader title={t('settings.terms')} onBack={() => router.back()} />

            <ScrollView
                contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.intro}>
                    <Text style={styles.introMeta}>{t('terms.updated')}</Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionLabel}>{t('terms.toc')}</Text>
                    <View style={styles.card}>
                        {SECTIONS.map((key, idx) => {
                            const open = expanded === key;
                            const last = idx === SECTIONS.length - 1;
                            return (
                                <View key={key} style={!last ? styles.rowBorder : undefined}>
                                    <TouchableOpacity
                                        style={styles.faqHeader}
                                        onPress={() => toggle(key)}
                                        activeOpacity={0.7}
                                    >
                                        <Text style={styles.faqTitle}>{t(`${key}.title`)}</Text>
                                        <Ionicons
                                            name={open ? 'chevron-up' : 'chevron-down'}
                                            size={18}
                                            color="#94A3B8"
                                        />
                                    </TouchableOpacity>
                                    {open ? <Text style={styles.faqBody}>{t(`${key}.body`)}</Text> : null}
                                </View>
                            );
                        })}
                    </View>
                </View>

                <View style={styles.footerCard}>
                    <Text style={styles.footerTitle}>{t('terms.questions')}</Text>
                    <Text style={styles.footerDesc}>{t('terms.questionsDesc')}</Text>
                </View>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },
    scroll: { paddingHorizontal: 20, paddingTop: 8 },
    intro: { marginBottom: 20, paddingHorizontal: 2 },
    introMeta: {
        fontSize: 13,
        fontWeight: '600',
        color: MUTED,
    },
    section: { marginBottom: 24 },
    sectionLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: MUTED,
        letterSpacing: 0.5,
        textTransform: 'uppercase',
        marginBottom: 10,
        paddingHorizontal: 2,
    },
    card: {
        backgroundColor: CARD,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: BORDER,
        overflow: 'hidden',
    },
    rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
    faqHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 16,
    },
    faqTitle: {
        flex: 1,
        fontSize: 15,
        fontWeight: '600',
        color: INK,
        lineHeight: 21,
    },
    faqBody: {
        paddingHorizontal: 16,
        paddingBottom: 16,
        marginTop: -4,
        fontSize: 14,
        lineHeight: 22,
        color: MUTED,
        fontWeight: '500',
    },
    footerCard: {
        backgroundColor: CARD,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: BORDER,
        padding: 20,
    },
    footerTitle: { fontSize: 16, fontWeight: '700', color: INK },
    footerDesc: { marginTop: 8, fontSize: 14, lineHeight: 21, color: MUTED, fontWeight: '500' },
});

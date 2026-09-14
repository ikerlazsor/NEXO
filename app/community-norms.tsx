import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { markCommunityNormsSeen } from '../lib/firstRun';
import { useT } from '../lib/i18n';
import { APP_DISPLAY_NAME, NEXO_NORMS_URL } from '../lib/brand';
import { LegalWebLink } from '../components/LegalWebLink';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';

const RULES = [
    { icon: 'person-circle-outline' as const, key: 'norms.r6', accent: '#FEF3C7', iconColor: '#B45309' },
    { icon: 'heart-outline' as const, key: 'norms.r1', accent: '#FCE7F3', iconColor: '#BE185D' },
    { icon: 'person-outline' as const, key: 'norms.r2', accent: '#DBEAFE', iconColor: '#1D4ED8' },
    { icon: 'people-outline' as const, key: 'norms.r3', accent: '#D1FAE5', iconColor: '#047857' },
    { icon: 'shield-checkmark-outline' as const, key: 'norms.r4', accent: '#E0E7FF', iconColor: '#4338CA' },
    { icon: 'flag-outline' as const, key: 'norms.r5', accent: '#FFEDD5', iconColor: '#C2410C' },
];

export default function CommunityNormsScreen() {
    const router = useRouter();
    const { t } = useT();

    useEffect(() => {
        void markCommunityNormsSeen();
    }, []);

    return (
        <View style={styles.root}>
            <LinearGradient
                colors={['#B8D9FF', '#E8F2FF', '#F7FAFF']}
                locations={[0, 0.35, 1]}
                style={StyleSheet.absoluteFill}
            />
            <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={12}>
                        <Ionicons name="chevron-back" size={24} color={INK} />
                    </TouchableOpacity>
                    <View style={{ width: 40 }} />
                </View>

                <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                    <View style={styles.hero}>
                        <View style={styles.heroBadge}>
                            <Ionicons name="sparkles" size={18} color={PRIMARY_DARK} />
                        </View>
                        <Text style={styles.heroBrand}>{APP_DISPLAY_NAME}</Text>
                        <Text style={styles.title}>{t('norms.title')}</Text>
                        <Text style={styles.lead}>{t('norms.lead')}</Text>
                    </View>

                    <View style={styles.rulesBlock}>
                        {RULES.map((r, i) => (
                            <View key={r.key} style={styles.card}>
                                <View style={styles.cardTop}>
                                    <View style={[styles.iconWrap, { backgroundColor: r.accent }]}>
                                        <Ionicons name={r.icon} size={22} color={r.iconColor} />
                                    </View>
                                    <Text style={styles.ruleIndex}>{String(i + 1).padStart(2, '0')}</Text>
                                </View>
                                <Text style={styles.rule}>{t(r.key)}</Text>
                            </View>
                        ))}
                    </View>

                    <View style={styles.footerCard}>
                        <Text style={styles.footnote}>{t('norms.footnote')}</Text>
                        <LegalWebLink url={NEXO_NORMS_URL} />
                    </View>

                    <TouchableOpacity
                        style={styles.cta}
                        activeOpacity={0.9}
                        onPress={() => router.back()}
                    >
                        <Text style={styles.ctaText}>{t('norms.ok')}</Text>
                    </TouchableOpacity>
                </ScrollView>
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    safe: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
        paddingVertical: 4,
    },
    back: {
        width: 40,
        height: 40,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.55)',
    },
    content: { paddingHorizontal: 20, paddingBottom: 40 },
    hero: {
        alignItems: 'center',
        paddingTop: 8,
        paddingBottom: 28,
        paddingHorizontal: 8,
    },
    heroBadge: {
        width: 52,
        height: 52,
        borderRadius: 18,
        backgroundColor: 'rgba(255,255,255,0.85)',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 14,
        borderWidth: 1,
        borderColor: 'rgba(37,99,235,0.12)',
    },
    heroBrand: {
        fontSize: 13,
        fontWeight: '800',
        color: PRIMARY_DARK,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        marginBottom: 8,
    },
    title: {
        fontSize: 28,
        fontWeight: '800',
        color: INK,
        textAlign: 'center',
        letterSpacing: -0.6,
        marginBottom: 12,
    },
    lead: {
        fontSize: 15,
        lineHeight: 23,
        color: MUTED,
        textAlign: 'center',
        fontWeight: '500',
    },
    rulesBlock: { gap: 12 },
    card: {
        backgroundColor: 'rgba(255,255,255,0.92)',
        borderRadius: 22,
        padding: 18,
        borderWidth: 1,
        borderColor: 'rgba(226,232,240,0.9)',
        shadowColor: '#0F2A4A',
        shadowOpacity: 0.04,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 1,
    },
    cardTop: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    iconWrap: {
        width: 44,
        height: 44,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    ruleIndex: {
        fontSize: 13,
        fontWeight: '800',
        color: '#94A3B8',
        letterSpacing: 0.8,
    },
    rule: {
        fontSize: 15,
        lineHeight: 22,
        color: INK,
        fontWeight: '600',
    },
    footerCard: {
        marginTop: 20,
        padding: 16,
        borderRadius: 18,
        backgroundColor: 'rgba(255,255,255,0.65)',
        gap: 8,
    },
    footnote: { fontSize: 13, lineHeight: 19, color: MUTED, fontWeight: '500' },
    cta: {
        marginTop: 20,
        backgroundColor: PRIMARY,
        borderRadius: 18,
        paddingVertical: 16,
        alignItems: 'center',
        shadowColor: PRIMARY_DARK,
        shadowOpacity: 0.25,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 3,
    },
    ctaText: { color: '#FFF', fontWeight: '800', fontSize: 16 },
});

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '../components/ScreenHeader';
import { useT } from '../lib/i18n';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';
const GOLD = '#F5C451';
const GOLD_DARK = '#D4AF37';

const COMPARE_ROWS = ['activePlans', 'waitlist', 'badge', 'giveaways'] as const;

export default function NexoPlusScreen() {
    const router = useRouter();
    const { t } = useT();
    const insets = useSafeAreaInsets();

    return (
        <View style={styles.container}>
            <LinearGradient colors={['#060D1F', '#0F1F45', '#1E3A8A']} style={StyleSheet.absoluteFill}>
                <View style={styles.glowOrb} />
                <View style={[styles.glowOrb, styles.glowOrbSmall]} />
            </LinearGradient>

            <ScreenHeader title="Nexo Plus" onBack={() => router.back()} variant="transparent" />

            <ScrollView
                style={styles.scroll}
                contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 120 }]}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.heroContent}>
                    <LinearGradient colors={['#FDE68A', GOLD, GOLD_DARK]} style={styles.diamondWrap}>
                        <Ionicons name="diamond" size={32} color="#FFF" />
                    </LinearGradient>
                    <View style={styles.popularPill}>
                        <Ionicons name="star" size={12} color={GOLD} />
                        <Text style={styles.popularText}>{t('nexoPlus.mostPopular')}</Text>
                    </View>
                    <Text style={styles.heroTagline}>{t('nexoPlus.tagline')}</Text>

                    <View style={styles.priceCard}>
                        <Text style={styles.priceTrial}>{t('nexoPlus.trial')}</Text>
                        <View style={styles.priceRow}>
                            <Text style={styles.priceAmount}>2,99 €</Text>
                            <Text style={styles.pricePeriod}>/ {t('nexoPlus.perMonth')}</Text>
                        </View>
                        <Text style={styles.priceNote}>{t('nexoPlus.priceNote')}</Text>
                    </View>
                </View>

                <View style={styles.sheet}>
                    <Text style={styles.sectionLabel}>{t('nexoPlus.includes')}</Text>
                    <View style={styles.comingSoonCard}>
                        <Text style={styles.comingSoonBadge}>{t('nexoPlus.comingSoon')}</Text>
                        <Text style={styles.comingSoonTitle}>{t('nexoPlus.comingSoonTitle')}</Text>
                        <Text style={styles.comingSoonDesc}>{t('nexoPlus.comingSoonDesc')}</Text>
                    </View>

                    <View style={styles.compareCard}>
                        <Text style={styles.compareTitle}>{t('nexoPlus.compareTitle')}</Text>
                        <View style={styles.compareHeader}>
                            <Text style={styles.compareColLabel}>{t('nexoPlus.compareFeature')}</Text>
                            <Text style={styles.compareColFree}>{t('nexoPlus.planFree')}</Text>
                            <Text style={styles.compareColPlus}>{t('nexoPlus.planPlus')}</Text>
                        </View>
                        {COMPARE_ROWS.map((row) => (
                            <View key={row} style={styles.compareRow}>
                                <Text style={styles.compareFeature}>{t(`nexoPlus.compare.${row}.label`)}</Text>
                                <Text style={styles.compareFree}>{t(`nexoPlus.compare.${row}.free`)}</Text>
                                <View style={styles.comparePlusCell}>
                                    <Ionicons name="checkmark-circle" size={16} color={PRIMARY_DARK} />
                                    <Text style={styles.comparePlus}>{t(`nexoPlus.compare.${row}.plus`)}</Text>
                                </View>
                            </View>
                        ))}
                    </View>

                    <View style={styles.trustRow}>
                        <View style={styles.trustItem}>
                            <Ionicons name="shield-checkmark-outline" size={18} color={PRIMARY_DARK} />
                            <Text style={styles.trustText}>{t('nexoPlus.secure')}</Text>
                        </View>
                        <View style={styles.trustItem}>
                            <Ionicons name="close-circle-outline" size={18} color={PRIMARY_DARK} />
                            <Text style={styles.trustText}>{t('nexoPlus.cancelAnytime')}</Text>
                        </View>
                    </View>
                </View>
            </ScrollView>

            <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
                <TouchableOpacity style={[styles.ctaBtn, styles.ctaBtnDisabled]} activeOpacity={1} disabled>
                    <View style={styles.ctaDisabledInner}>
                        <Text style={styles.ctaText}>{t('nexoPlus.ctaUnavailable')}</Text>
                    </View>
                </TouchableOpacity>
                <Text style={styles.disclaimer}>{t('nexoPlus.disclaimer')}</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#060D1F' },
    glowOrb: {
        position: 'absolute',
        width: 220,
        height: 220,
        borderRadius: 110,
        backgroundColor: 'rgba(77,166,255,0.12)',
        top: -40,
        right: -60,
    },
    glowOrbSmall: {
        width: 120,
        height: 120,
        borderRadius: 60,
        top: 120,
        left: -30,
        backgroundColor: 'rgba(245,196,81,0.1)',
    },
    scroll: { flex: 1 },
    scrollContent: { flexGrow: 1 },
    heroContent: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 4, paddingBottom: 28 },
    diamondWrap: {
        width: 72,
        height: 72,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 12,
        shadowColor: GOLD_DARK,
        shadowOpacity: 0.45,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 8,
    },
    popularPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(245,196,81,0.15)',
        borderWidth: 1,
        borderColor: 'rgba(245,196,81,0.35)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
        marginBottom: 12,
    },
    popularText: { color: GOLD, fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
    heroTagline: {
        fontSize: 16,
        fontWeight: '600',
        color: 'rgba(255,255,255,0.88)',
        textAlign: 'center',
        lineHeight: 23,
        maxWidth: 300,
    },
    priceCard: {
        marginTop: 20,
        backgroundColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.18)',
        borderRadius: 20,
        paddingVertical: 16,
        paddingHorizontal: 24,
        alignItems: 'center',
        width: '100%',
    },
    priceTrial: { fontSize: 13, fontWeight: '800', color: GOLD, letterSpacing: 0.5, textTransform: 'uppercase' },
    priceRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 6, gap: 4 },
    priceAmount: { fontSize: 36, fontWeight: '900', color: '#FFF', letterSpacing: -1 },
    pricePeriod: { fontSize: 15, fontWeight: '600', color: 'rgba(255,255,255,0.7)' },
    priceNote: { fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 6 },
    sheet: {
        backgroundColor: '#F8FAFC',
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        paddingHorizontal: 20,
        paddingTop: 28,
        paddingBottom: 8,
        minHeight: 420,
    },
    sectionLabel: {
        fontSize: 12,
        fontWeight: '800',
        color: MUTED,
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 18,
    },
    comingSoonCard: {
        backgroundColor: '#FFF',
        borderRadius: 18,
        padding: 20,
        borderWidth: 1,
        borderColor: '#E8EEF5',
        marginBottom: 8,
    },
    comingSoonBadge: {
        alignSelf: 'flex-start',
        fontSize: 11,
        fontWeight: '800',
        color: GOLD_DARK,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        backgroundColor: 'rgba(245,196,81,0.15)',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 8,
        overflow: 'hidden',
        marginBottom: 12,
    },
    comingSoonTitle: { fontSize: 17, fontWeight: '800', color: INK },
    comingSoonDesc: { fontSize: 14, color: MUTED, marginTop: 8, lineHeight: 21 },
    compareCard: {
        backgroundColor: '#FFF',
        borderRadius: 20,
        padding: 18,
        marginTop: 12,
        borderWidth: 1,
        borderColor: '#E8EEF5',
        shadowColor: '#1E3A8A',
        shadowOpacity: 0.06,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 3,
    },
    compareTitle: { fontSize: 17, fontWeight: '900', color: INK, marginBottom: 14 },
    compareHeader: { flexDirection: 'row', paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
    compareColLabel: { flex: 1.4, fontSize: 11, fontWeight: '700', color: MUTED, textTransform: 'uppercase' },
    compareColFree: { flex: 0.8, fontSize: 11, fontWeight: '700', color: MUTED, textAlign: 'center', textTransform: 'uppercase' },
    compareColPlus: { flex: 1, fontSize: 11, fontWeight: '800', color: PRIMARY_DARK, textAlign: 'center', textTransform: 'uppercase' },
    compareRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#F8FAFC',
    },
    compareFeature: { flex: 1.4, fontSize: 13, fontWeight: '600', color: INK },
    compareFree: { flex: 0.8, fontSize: 13, color: MUTED, textAlign: 'center' },
    comparePlusCell: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
    comparePlus: { fontSize: 13, fontWeight: '800', color: PRIMARY_DARK },
    trustRow: { flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 20, flexWrap: 'wrap' },
    trustItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    trustText: { fontSize: 12, fontWeight: '600', color: MUTED },
    footer: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#FFF',
        paddingHorizontal: 20,
        paddingTop: 14,
        borderTopWidth: 1,
        borderTopColor: '#E8EEF5',
        shadowColor: '#000',
        shadowOpacity: 0.06,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: -4 },
        elevation: 8,
    },
    ctaBtn: { borderRadius: 16, overflow: 'hidden' },
    ctaBtnDisabled: { opacity: 1 },
    ctaDisabledInner: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 17,
        backgroundColor: '#CBD5E1',
        borderRadius: 16,
    },
    ctaText: { color: '#FFF', fontSize: 17, fontWeight: '900', letterSpacing: 0.2 },
    disclaimer: { fontSize: 11, color: MUTED, textAlign: 'center', marginTop: 10, lineHeight: 15 },
});

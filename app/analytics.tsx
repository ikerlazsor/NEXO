import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { fetchFunnelCounts, type FunnelCounts, type FunnelEvent } from '../lib/analytics';
import { useT } from '../lib/i18n';
import { fetchAccountAccess } from '../lib/roles';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const BG_TOP = '#DCEBFF';
const BG_BOTTOM = '#F2F7FF';

const STEPS: { key: FunnelEvent; labelKey: string }[] = [
    { key: 'signup_complete', labelKey: 'analytics.signup' },
    { key: 'onboarding_complete', labelKey: 'analytics.onboarding' },
    { key: 'plan_join', labelKey: 'analytics.planJoin' },
    { key: 'chat_open', labelKey: 'analytics.chatOpen' },
    { key: 'chat_send', labelKey: 'analytics.chatSend' },
    { key: 'rating_start', labelKey: 'analytics.ratingStart' },
    { key: 'rating_complete', labelKey: 'analytics.ratingComplete' },
];

export default function AnalyticsScreen() {
    const router = useRouter();
    const { t } = useT();
    const [loading, setLoading] = useState(true);
    const [allowed, setAllowed] = useState(false);
    const [counts, setCounts] = useState<FunnelCounts | null>(null);

    useFocusEffect(
        useCallback(() => {
            let alive = true;
            void (async () => {
                setLoading(true);
                const access = await fetchAccountAccess();
                if (!alive) return;
                if (!access.isOwner) {
                    setAllowed(false);
                    setLoading(false);
                    return;
                }
                setAllowed(true);
                const data = await fetchFunnelCounts(30);
                if (!alive) return;
                setCounts(data);
                setLoading(false);
            })();
            return () => {
                alive = false;
            };
        }, []),
    );

    const max = counts ? Math.max(1, ...STEPS.map((s) => counts[s.key])) : 1;

    return (
        <View style={styles.container}>
            <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={StyleSheet.absoluteFill} />
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={24} color={INK} />
                </TouchableOpacity>
                <Text style={styles.title}>{t('analytics.title')}</Text>
                <View style={{ width: 45 }} />
            </View>

            {loading ? (
                <ActivityIndicator color={PRIMARY_DARK} style={{ marginTop: 40 }} />
            ) : !allowed ? (
                <Text style={styles.denied}>{t('analytics.denied')}</Text>
            ) : (
                <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                    <Text style={styles.sub}>{t('analytics.subtitle')}</Text>
                    {STEPS.map((step, idx) => {
                        const n = counts?.[step.key] ?? 0;
                        const prev = idx > 0 ? (counts?.[STEPS[idx - 1].key] ?? 0) : n;
                        const drop = prev > 0 ? Math.round((1 - n / prev) * 100) : 0;
                        return (
                            <View key={step.key} style={styles.row}>
                                <View style={styles.rowTop}>
                                    <Text style={styles.rowLabel}>{t(step.labelKey)}</Text>
                                    <Text style={styles.rowValue}>{n}</Text>
                                </View>
                                <View style={styles.track}>
                                    <View style={[styles.fill, { width: `${Math.round((n / max) * 100)}%` }]} />
                                </View>
                                {idx > 0 && prev > 0 && drop > 0 ? (
                                    <Text style={styles.drop}>{t('analytics.drop', { pct: drop })}</Text>
                                ) : null}
                            </View>
                        );
                    })}
                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG_BOTTOM },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: Platform.OS === 'ios' ? 60 : 44,
        paddingBottom: 12,
    },
    backBtn: {
        width: 45,
        height: 45,
        borderRadius: 15,
        backgroundColor: '#FFF',
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: { fontSize: 20, fontWeight: '900', color: INK },
    sub: { fontSize: 13, color: '#64748B', marginBottom: 18, lineHeight: 18 },
    denied: { marginTop: 40, textAlign: 'center', color: '#64748B', fontWeight: '600' },
    content: { paddingHorizontal: 20, paddingBottom: 40 },
    row: {
        backgroundColor: '#FFF',
        borderRadius: 16,
        padding: 14,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    rowTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
    rowLabel: { fontSize: 15, fontWeight: '700', color: INK },
    rowValue: { fontSize: 16, fontWeight: '900', color: PRIMARY_DARK },
    track: { height: 8, borderRadius: 4, backgroundColor: '#E2E8F0', overflow: 'hidden' },
    fill: { height: '100%', backgroundColor: PRIMARY, borderRadius: 4 },
    drop: { marginTop: 6, fontSize: 12, fontWeight: '600', color: '#B45309' },
});

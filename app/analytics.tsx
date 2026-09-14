import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '../components/ScreenHeader';
import {
    convertPct,
    deltaPct,
    fetchOwnerAnalytics,
    fillRate,
    type AnalyticsRangeDays,
    type OwnerAnalytics,
} from '../lib/analytics';
import { useT } from '../lib/i18n';
import { fetchAccountAccess } from '../lib/roles';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';
const GREEN = '#16A34A';
const AMBER = '#B45309';
const DANGER = '#DC2626';
const CARD = '#FFFFFF';
const LINE = '#E2E8F0';

const FUNNEL: { key: keyof OwnerAnalytics['funnel']; labelKey: string }[] = [
    { key: 'signed_up', labelKey: 'analytics.funnel.signedUp' },
    { key: 'onboarded', labelKey: 'analytics.funnel.onboarded' },
    { key: 'activated', labelKey: 'analytics.funnel.activated' },
    { key: 'messaged', labelKey: 'analytics.funnel.messaged' },
    { key: 'rated', labelKey: 'analytics.funnel.rated' },
];

export default function AnalyticsScreen() {
    const router = useRouter();
    const { t } = useT();
    const insets = useSafeAreaInsets();
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [allowed, setAllowed] = useState(false);
    const [days, setDays] = useState<AnalyticsRangeDays>(7);
    const [data, setData] = useState<OwnerAnalytics | null>(null);
    const [failed, setFailed] = useState(false);

    const load = useCallback(async (range: AnalyticsRangeDays) => {
        const access = await fetchAccountAccess();
        if (!access.isOwner) {
            setAllowed(false);
            setData(null);
            setFailed(false);
            return;
        }
        setAllowed(true);
        const next = await fetchOwnerAnalytics(range);
        setFailed(!next);
        setData(next);
    }, []);

    useFocusEffect(
        useCallback(() => {
            let alive = true;
            setLoading(true);
            void load(days).finally(() => {
                if (alive) setLoading(false);
            });
            return () => {
                alive = false;
            };
        }, [days, load]),
    );

    const onRefresh = async () => {
        setRefreshing(true);
        await load(days);
        setRefreshing(false);
    };

    const fill = data ? fillRate(data.supply.filled, data.supply.plans) : null;
    const alerts = data
        ? [
              data.supply.plans === 0 ? t('analytics.alert.noPlans') : null,
              fill != null && fill < 40 && data.supply.plans >= 3
                  ? t('analytics.alert.lonely', { pct: fill })
                  : null,
              data.trust.reports_open > 0
                  ? t('analytics.alert.reports', { n: data.trust.reports_open })
                  : null,
              data.health.new_users === 0 ? t('analytics.alert.noSignups') : null,
          ].filter((x): x is string => Boolean(x))
        : [];

    return (
        <View style={styles.container}>
            <LinearGradient colors={['#DCEBFF', '#F2F7FF', '#F8FAFC']} style={StyleSheet.absoluteFill} />
            <ScreenHeader title={t('analytics.title')} onBack={() => router.back()} subtitle={t('analytics.subtitle')} />

            <View style={styles.toolbar}>
                {([7, 30] as const).map((d) => {
                    const on = days === d;
                    return (
                        <Pressable
                            key={d}
                            style={[styles.chip, on && styles.chipOn]}
                            onPress={() => setDays(d)}
                        >
                            <Text style={[styles.chipText, on && styles.chipTextOn]}>
                                {t(d === 7 ? 'analytics.range.7' : 'analytics.range.30')}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>

            {loading && !data ? (
                <ActivityIndicator color={PRIMARY_DARK} style={{ marginTop: 36 }} />
            ) : !allowed ? (
                <Text style={styles.denied}>{t('analytics.denied')}</Text>
            ) : failed || !data ? (
                <Text style={styles.denied}>{t('analytics.loadError')}</Text>
            ) : (
                <ScrollView
                    contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 36 }]}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
                    showsVerticalScrollIndicator={false}
                >
                    <View style={styles.liveRow}>
                        <LiveStat label={t('analytics.kpi.dau')} value={data.health.dau} />
                        <LiveStat label={t('analytics.kpi.wau')} value={data.health.wau} />
                        <LiveStat label={t('analytics.kpi.mau')} value={data.health.mau} />
                    </View>

                    {alerts.map((msg) => (
                        <Pressable
                            key={msg}
                            style={styles.alert}
                            onPress={() => {
                                if (msg === t('analytics.alert.reports', { n: data.trust.reports_open })) {
                                    router.push('/admin');
                                }
                            }}
                        >
                            <Ionicons name="warning-outline" size={16} color={AMBER} />
                            <Text style={styles.alertText}>{msg}</Text>
                        </Pressable>
                    ))}

                    <Text style={styles.section}>{t('analytics.section.period')}</Text>
                    <View style={styles.grid}>
                        <Kpi
                            label={t('analytics.kpi.newUsers')}
                            value={data.health.new_users}
                            previous={data.health.new_users_prev}
                            t={t}
                        />
                        <Kpi
                            label={t('analytics.kpi.plans')}
                            value={data.supply.plans}
                            previous={data.supply.plans_prev}
                            t={t}
                        />
                        <Kpi
                            label={t('analytics.kpi.joins')}
                            value={data.supply.joins}
                            previous={data.supply.joins_prev}
                            t={t}
                        />
                        <Kpi
                            label={t('analytics.kpi.fill')}
                            value={fill}
                            suffix="%"
                            hint={
                                data.supply.plans > 0
                                    ? t('analytics.kpi.fillHint', {
                                          filled: data.supply.filled,
                                          lonely: data.supply.lonely,
                                      })
                                    : t('analytics.na')
                            }
                            t={t}
                        />
                    </View>

                    <Text style={styles.section}>{t('analytics.section.funnel')}</Text>
                    <Text style={styles.funnelLead}>{t('analytics.funnel.lead')}</Text>
                    <View style={styles.card}>
                        {FUNNEL.map((step, idx) => {
                            const n = data.funnel[step.key];
                            const prev = idx === 0 ? n : data.funnel[FUNNEL[idx - 1].key];
                            const fromStart = convertPct(n, data.funnel.signed_up);
                            const stepPct = idx === 0 ? 100 : convertPct(n, prev);
                            const width = Math.max(6, fromStart ?? (n > 0 ? 8 : 6));
                            const drop = idx > 0 && prev > 0 && n < prev ? Math.round((1 - n / prev) * 100) : 0;
                            return (
                                <View key={step.key} style={[styles.funnelRow, idx > 0 && styles.funnelBorder]}>
                                    <View style={styles.funnelTop}>
                                        <View style={styles.funnelIndex}>
                                            <Text style={styles.funnelIndexText}>{idx + 1}</Text>
                                        </View>
                                        <Text style={styles.funnelLabel}>{t(step.labelKey)}</Text>
                                        <Text style={styles.funnelValue}>{n}</Text>
                                    </View>
                                    <View style={styles.track}>
                                        <View
                                            style={[
                                                styles.fillBar,
                                                {
                                                    width: `${width}%`,
                                                    backgroundColor: drop >= 40 ? DANGER : PRIMARY,
                                                },
                                            ]}
                                        />
                                    </View>
                                    {idx > 0 ? (
                                        <Text style={[styles.funnelMeta, drop >= 40 && styles.funnelMetaBad]}>
                                            {stepPct == null
                                                ? t('analytics.na')
                                                : drop > 0
                                                  ? t('analytics.funnel.drop', { pct: drop, keep: stepPct })
                                                  : t('analytics.funnel.keep', { pct: stepPct })}
                                        </Text>
                                    ) : (
                                        <Text style={styles.funnelMeta}>{t('analytics.funnel.cohort')}</Text>
                                    )}
                                </View>
                            );
                        })}
                    </View>

                    <Text style={styles.section}>{t('analytics.section.trend')}</Text>
                    <View style={styles.card}>
                        <Sparkline series={data.series} labelA={t('analytics.kpi.newUsers')} labelB={t('analytics.kpi.plans')} />
                    </View>

                    <Text style={styles.section}>{t('analytics.section.more')}</Text>
                    <View style={styles.grid}>
                        <StatCard
                            label={t('analytics.kpi.retentionD1')}
                            value={
                                data.health.retention_d1 == null
                                    ? t('analytics.retentionWait')
                                    : `${data.health.retention_d1}%`
                            }
                            hint={t('analytics.kpi.retentionN', { n: data.health.retention_d1_n })}
                        />
                        <StatCard
                            label={t('analytics.kpi.retentionD7')}
                            value={
                                data.health.retention_d7 == null
                                    ? t('analytics.retentionWait')
                                    : `${data.health.retention_d7}%`
                            }
                            hint={t('analytics.kpi.retentionN', { n: data.health.retention_d7_n })}
                        />
                        <StatCard label={t('analytics.kpi.upcoming')} value={String(data.supply.upcoming)} />
                        <StatCard
                            label={t('analytics.kpi.accounts')}
                            value={String(data.health.users_total)}
                            hint={t('analytics.kpi.onboardedOf', {
                                n: data.health.users_onboarded,
                            })}
                        />
                    </View>

                    {data.categories.length > 0 ? (
                        <View style={styles.card}>
                            <Text style={styles.cardTitle}>{t('analytics.section.categories')}</Text>
                            {data.categories.map((row) => {
                                const max = Math.max(1, ...data.categories.map((c) => c.n));
                                const label = t(`cat.main.${row.key}`);
                                return (
                                    <View key={row.key} style={styles.catRow}>
                                        <Text style={styles.catLabel} numberOfLines={1}>
                                            {label.startsWith('cat.main.') ? row.key : label}
                                        </Text>
                                        <View style={styles.catTrack}>
                                            <View style={[styles.catFill, { width: `${Math.round((row.n / max) * 100)}%` }]} />
                                        </View>
                                        <Text style={styles.catN}>{row.n}</Text>
                                    </View>
                                );
                            })}
                        </View>
                    ) : null}

                    <View style={styles.card}>
                        <Text style={styles.cardTitle}>{t('analytics.section.trust')}</Text>
                        <View style={styles.trustRow}>
                            <TrustCell
                                label={t('analytics.trust.reportsOpen')}
                                value={data.trust.reports_open}
                                danger={data.trust.reports_open > 0}
                                onPress={() => router.push('/admin')}
                            />
                            <TrustCell label={t('analytics.trust.reportsPeriod')} value={data.trust.reports_period} />
                            <TrustCell
                                label={t('analytics.trust.ticketsOpen')}
                                value={data.trust.tickets_open}
                                danger={data.trust.tickets_open > 0}
                                onPress={() => router.push('/admin')}
                            />
                            <TrustCell label={t('analytics.organizers')} value={data.organizers.approved} />
                        </View>
                        <Text style={styles.trustFoot}>
                            {t('analytics.trust.foot', {
                                tickets: data.trust.tickets_period,
                                orgPlans: data.organizers.plans,
                                pending: data.organizers.pending,
                                banned: data.health.users_banned,
                            })}
                        </Text>
                    </View>
                </ScrollView>
            )}
        </View>
    );
}

function LiveStat({ label, value }: { label: string; value: number }) {
    return (
        <View style={styles.live}>
            <Text style={styles.liveValue}>{value}</Text>
            <Text style={styles.liveLabel}>{label}</Text>
        </View>
    );
}

function Kpi({
    label,
    value,
    previous,
    suffix = '',
    hint,
    t,
}: {
    label: string;
    value: number | null;
    previous?: number;
    suffix?: string;
    hint?: string;
    t: (key: string, params?: Record<string, string | number>) => string;
}) {
    const delta = previous != null && value != null ? deltaPct(value, previous) : null;
    const up = delta != null && delta > 0;
    const down = delta != null && delta < 0;
    return (
        <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>{label}</Text>
            <Text style={styles.kpiValue}>{value == null ? t('analytics.na') : `${value}${suffix}`}</Text>
            {previous != null ? (
                <Text style={[styles.kpiDelta, up && styles.deltaUp, down && styles.deltaDown]}>
                    {delta == null
                        ? value && value > 0
                            ? t('analytics.deltaNew')
                            : t('analytics.deltaFlat')
                        : t(up ? 'analytics.deltaUp' : down ? 'analytics.deltaDown' : 'analytics.deltaFlat', {
                              pct: Math.abs(delta),
                          })}
                </Text>
            ) : hint ? (
                <Text style={styles.kpiHint}>{hint}</Text>
            ) : null}
        </View>
    );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>{label}</Text>
            <Text style={styles.kpiValueSm}>{value}</Text>
            {hint ? <Text style={styles.kpiHint}>{hint}</Text> : null}
        </View>
    );
}

function TrustCell({
    label,
    value,
    danger,
    onPress,
}: {
    label: string;
    value: number;
    danger?: boolean;
    onPress?: () => void;
}) {
    const inner = (
        <>
            <Text style={[styles.trustN, danger && { color: DANGER }]}>{value}</Text>
            <Text style={styles.trustL}>{label}</Text>
        </>
    );
    if (onPress) {
        return (
            <Pressable style={styles.trustCell} onPress={onPress}>
                {inner}
            </Pressable>
        );
    }
    return <View style={styles.trustCell}>{inner}</View>;
}

function Sparkline({
    series,
    labelA,
    labelB,
}: {
    series: { d: string; users: number; plans: number }[];
    labelA: string;
    labelB: string;
}) {
    const max = Math.max(1, ...series.map((s) => Math.max(s.users, s.plans)));
    return (
        <View>
            <View style={styles.sparkLegend}>
                <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: PRIMARY_DARK }]} />
                    <Text style={styles.legendText}>{labelA}</Text>
                </View>
                <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: PRIMARY }]} />
                    <Text style={styles.legendText}>{labelB}</Text>
                </View>
            </View>
            <View style={styles.spark}>
                {series.map((s) => (
                    <View key={s.d} style={styles.sparkCol}>
                        <View style={styles.sparkBars}>
                            <View
                                style={[
                                    styles.sparkBar,
                                    {
                                        height: Math.max(4, Math.round((s.users / max) * 80)),
                                        backgroundColor: PRIMARY_DARK,
                                    },
                                ]}
                            />
                            <View
                                style={[
                                    styles.sparkBar,
                                    {
                                        height: Math.max(4, Math.round((s.plans / max) * 80)),
                                        backgroundColor: PRIMARY,
                                    },
                                ]}
                            />
                        </View>
                    </View>
                ))}
            </View>
            {series.length > 0 ? (
                <View style={styles.sparkAxis}>
                    <Text style={styles.sparkAxisText}>{formatDay(series[0].d)}</Text>
                    <Text style={styles.sparkAxisText}>{formatDay(series[series.length - 1].d)}</Text>
                </View>
            ) : null}
        </View>
    );
}

function formatDay(iso: string) {
    const p = iso.split('-');
    if (p.length !== 3) return iso;
    return `${p[2]}/${p[1]}`;
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    toolbar: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginBottom: 8 },
    chip: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: CARD,
        borderWidth: 1,
        borderColor: LINE,
    },
    chipOn: { backgroundColor: PRIMARY_DARK, borderColor: PRIMARY_DARK },
    chipText: { fontSize: 13, fontWeight: '700', color: MUTED },
    chipTextOn: { color: '#FFF' },
    denied: { marginTop: 40, textAlign: 'center', color: MUTED, fontWeight: '600', paddingHorizontal: 24 },
    content: { paddingHorizontal: 20, gap: 12 },
    liveRow: { flexDirection: 'row', gap: 8 },
    live: {
        flex: 1,
        backgroundColor: CARD,
        borderRadius: 14,
        paddingVertical: 12,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: LINE,
    },
    liveValue: { fontSize: 22, fontWeight: '900', color: INK },
    liveLabel: { marginTop: 2, fontSize: 11, fontWeight: '700', color: MUTED, letterSpacing: 0.3 },
    alert: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#FFFBEB',
        borderColor: '#FDE68A',
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    alertText: { flex: 1, fontSize: 13, fontWeight: '600', color: AMBER, lineHeight: 18 },
    section: {
        marginTop: 6,
        fontSize: 12,
        fontWeight: '800',
        color: MUTED,
        letterSpacing: 0.5,
        textTransform: 'uppercase',
    },
    funnelLead: { marginTop: -6, fontSize: 13, color: MUTED, lineHeight: 18, fontWeight: '500' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    kpi: {
        width: '48%',
        flexGrow: 1,
        backgroundColor: CARD,
        borderRadius: 16,
        padding: 14,
        borderWidth: 1,
        borderColor: LINE,
    },
    kpiLabel: { fontSize: 12, fontWeight: '700', color: MUTED },
    kpiValue: { marginTop: 6, fontSize: 26, fontWeight: '900', color: INK },
    kpiValueSm: { marginTop: 6, fontSize: 20, fontWeight: '900', color: INK },
    kpiDelta: { marginTop: 4, fontSize: 12, fontWeight: '700', color: MUTED },
    kpiHint: { marginTop: 4, fontSize: 12, fontWeight: '600', color: MUTED, lineHeight: 16 },
    deltaUp: { color: GREEN },
    deltaDown: { color: DANGER },
    card: {
        backgroundColor: CARD,
        borderRadius: 16,
        padding: 14,
        borderWidth: 1,
        borderColor: LINE,
    },
    cardTitle: { fontSize: 14, fontWeight: '800', color: INK, marginBottom: 10 },
    funnelRow: { paddingVertical: 10 },
    funnelBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: LINE },
    funnelTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    funnelIndex: {
        width: 22,
        height: 22,
        borderRadius: 7,
        backgroundColor: '#EFF6FF',
        alignItems: 'center',
        justifyContent: 'center',
    },
    funnelIndexText: { fontSize: 11, fontWeight: '800', color: PRIMARY_DARK },
    funnelLabel: { flex: 1, fontSize: 14, fontWeight: '700', color: INK },
    funnelValue: { fontSize: 16, fontWeight: '900', color: PRIMARY_DARK },
    track: { height: 8, borderRadius: 4, backgroundColor: '#E2E8F0', overflow: 'hidden' },
    fillBar: { height: '100%', borderRadius: 4 },
    funnelMeta: { marginTop: 6, fontSize: 12, fontWeight: '600', color: MUTED },
    funnelMetaBad: { color: AMBER },
    sparkLegend: { flexDirection: 'row', gap: 14, marginBottom: 10 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendDot: { width: 8, height: 8, borderRadius: 4 },
    legendText: { fontSize: 12, fontWeight: '700', color: MUTED },
    spark: { flexDirection: 'row', alignItems: 'flex-end', height: 88, gap: 2 },
    sparkCol: { flex: 1, height: '100%', justifyContent: 'flex-end' },
    sparkBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 1, height: '100%', justifyContent: 'center' },
    sparkBar: { flex: 1, maxWidth: 7, borderRadius: 2 },
    sparkAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
    sparkAxisText: { fontSize: 11, fontWeight: '600', color: '#94A3B8' },
    catRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    catLabel: { width: 92, fontSize: 12, fontWeight: '700', color: INK },
    catTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: '#E2E8F0', overflow: 'hidden' },
    catFill: { height: '100%', backgroundColor: PRIMARY, borderRadius: 4 },
    catN: { width: 28, textAlign: 'right', fontSize: 12, fontWeight: '800', color: MUTED },
    trustRow: { flexDirection: 'row', flexWrap: 'wrap' },
    trustCell: { width: '50%', paddingVertical: 8 },
    trustN: { fontSize: 20, fontWeight: '900', color: INK },
    trustL: { fontSize: 12, fontWeight: '600', color: MUTED, marginTop: 2 },
    trustFoot: { marginTop: 6, fontSize: 12, fontWeight: '600', color: MUTED, lineHeight: 17 },
});

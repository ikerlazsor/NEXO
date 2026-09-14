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
import { useAuthSession } from '../lib/authSession';
import { useT } from '../lib/i18n';
import { getMyProfile } from '../lib/profileData';
import { formatRatingScore } from '../lib/stats';
import { renderRatingStars } from '../lib/profileRating';
import { getAspectLabel } from '../lib/ratings';
import {
    fetchOrganizerInsights,
    peekOrganizerInsights,
    genderKnownTotal,
    genderPct,
    type InsightAudience,
    type OrganizerInsights,
    type PeriodCount,
} from '../lib/organizerInsights';

const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';
const CARD = '#FFFFFF';
const LINE = '#E2E8F0';
const GREEN = '#059669';
const GREEN_SOFT = '#ECFDF5';
const RED = '#DC2626';
const RED_SOFT = '#FEF2F2';

export default function OrganizerInsightsScreen() {
    const router = useRouter();
    const { t } = useT();
    const insets = useSafeAreaInsets();
    const { userId } = useAuthSession();
    const [allowed, setAllowed] = useState(false);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [data, setData] = useState<OrganizerInsights | null>(() =>
        userId ? peekOrganizerInsights(userId) : null,
    );

    const load = useCallback(async (opts?: { force?: boolean }) => {
        const profile = await getMyProfile();
        if (profile.data?.es_organizador !== true) {
            setAllowed(false);
            setData(null);
            return;
        }
        setAllowed(true);
        const uid = profile.data.id ?? userId ?? undefined;
        setData(await fetchOrganizerInsights({ userId: uid ?? undefined, force: !!opts?.force }));
    }, [userId]);

    useFocusEffect(
        useCallback(() => {
            let alive = true;
            const cached = userId ? peekOrganizerInsights(userId) : null;
            if (cached) {
                setData(cached);
                setLoading(false);
            } else {
                setLoading(true);
            }
            void load().finally(() => {
                if (alive) setLoading(false);
            });
            return () => {
                alive = false;
            };
        }, [load, userId]),
    );

    const onRefresh = async () => {
        setRefreshing(true);
        await load({ force: true });
        setRefreshing(false);
    };

    return (
        <View style={styles.container}>
            <LinearGradient colors={['#DBEAFE', '#EFF6FF', '#F8FAFC']} style={StyleSheet.absoluteFill} />
            <ScreenHeader
                title={t('insights.title')}
                subtitle={t('insights.subtitle')}
                onBack={() => router.back()}
            />

            {loading && !data ? (
                <ActivityIndicator color={PRIMARY_DARK} style={{ marginTop: 36 }} />
            ) : !allowed || !userId ? (
                <Text style={styles.denied}>{t('insights.denied')}</Text>
            ) : data ? (
                <ScrollView
                    contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 36 }]}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
                    showsVerticalScrollIndicator={false}
                >
                    <View style={styles.grid}>
                        <Kpi
                            icon="people-outline"
                            label={t('insights.kpi.joins')}
                            values={data.activity.joins}
                            weekLabel={t('insights.range.week')}
                            monthLabel={t('insights.range.month')}
                        />
                        <Kpi
                            icon="eye-outline"
                            label={t('insights.kpi.views')}
                            values={data.activity.profileViews}
                            weekLabel={t('insights.range.week')}
                            monthLabel={t('insights.range.month')}
                        />
                        <Kpi
                            icon="heart-outline"
                            label={t('insights.kpi.saves')}
                            values={data.activity.saves}
                            weekLabel={t('insights.range.week')}
                            monthLabel={t('insights.range.month')}
                        />
                        <Kpi
                            icon="person-add-outline"
                            label={t('insights.kpi.follows')}
                            values={data.activity.follows}
                            hint={t('insights.kpi.followsHint', { n: data.followersTotal })}
                            weekLabel={t('insights.range.week')}
                            monthLabel={t('insights.range.month')}
                        />
                    </View>
                    <View style={styles.unfollowCard}>
                        <Ionicons name="person-remove-outline" size={18} color={RED} />
                        <View style={{ flex: 1 }}>
                            <Text style={styles.unfollowLabel}>{t('insights.kpi.unfollows')}</Text>
                            <Text style={styles.unfollowHint}>{t('insights.kpi.unfollowsHint')}</Text>
                            <View style={styles.periodRow}>
                                <Text style={styles.periodMini}>
                                    {t('insights.range.week')} {data.activity.unfollows.week}
                                </Text>
                                <Text style={styles.periodMini}>
                                    {t('insights.range.month')} {data.activity.unfollows.month}
                                </Text>
                            </View>
                        </View>
                    </View>

                    <Text style={styles.section}>{t('insights.section.rating')}</Text>
                    <View style={styles.card}>
                        <View style={styles.ratingHead}>
                            <Text style={styles.score}>{formatRatingScore(data.rating.score)}</Text>
                            <View style={{ flex: 1 }}>
                                <View style={{ flexDirection: 'row', gap: 2 }}>{renderRatingStars(data.rating.score, 16)}</View>
                                <Text style={styles.reviews}>
                                    {t(
                                        data.rating.reviews === 1 ? 'insights.reviewsOne' : 'insights.reviews',
                                        { n: data.rating.reviews },
                                    )}
                                </Text>
                            </View>
                        </View>
                        <AspectBlock
                            title={t('insights.positives')}
                            items={data.rating.positives}
                            tone="pos"
                            t={t}
                        />
                        <AspectBlock
                            title={t('insights.negatives')}
                            items={data.rating.negatives}
                            tone="neg"
                            t={t}
                        />
                    </View>

                    <Text style={styles.section}>{t('insights.section.audience')}</Text>
                    <View style={styles.audienceRow}>
                        <AudienceCard title={t('insights.audience.members')} data={data.members} t={t} />
                        <AudienceCard title={t('insights.audience.joiners')} data={data.joiners} t={t} />
                    </View>

                    <Text style={styles.section}>{t('insights.section.highlights')}</Text>
                    <View style={styles.card}>
                        <HighlightRow
                            icon="heart"
                            color="#DB2777"
                            label={t('insights.top.saved')}
                            plan={data.topSaved}
                            empty={t('insights.top.empty')}
                            onPress={(id) => router.push({ pathname: '/plan/[id]', params: { id } })}
                        />
                        <View style={styles.highlightRule} />
                        <HighlightRow
                            icon="people"
                            color={PRIMARY_DARK}
                            label={t('insights.top.joined')}
                            plan={data.topJoined}
                            empty={t('insights.top.empty')}
                            onPress={(id) => router.push({ pathname: '/plan/[id]', params: { id } })}
                        />
                    </View>
                </ScrollView>
            ) : null}
        </View>
    );
}

function Kpi({
    icon,
    label,
    values,
    hint,
    weekLabel,
    monthLabel,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    values: PeriodCount;
    hint?: string;
    weekLabel: string;
    monthLabel: string;
}) {
    return (
        <View style={styles.kpi}>
            <View style={styles.kpiIcon}>
                <Ionicons name={icon} size={18} color={PRIMARY_DARK} />
            </View>
            <Text style={styles.kpiLabel}>{label}</Text>
            <View style={styles.periodRow}>
                <View style={{ flex: 1 }}>
                    <Text style={styles.kpiValue}>{values.week}</Text>
                    <Text style={styles.periodMini}>{weekLabel}</Text>
                </View>
                <View style={{ flex: 1 }}>
                    <Text style={styles.kpiValue}>{values.month}</Text>
                    <Text style={styles.periodMini}>{monthLabel}</Text>
                </View>
            </View>
            {hint ? <Text style={styles.kpiHint}>{hint}</Text> : null}
        </View>
    );
}

function AspectBlock({
    title,
    items,
    tone,
    t,
}: {
    title: string;
    items: OrganizerInsights['rating']['positives'];
    tone: 'pos' | 'neg';
    t: (key: string, params?: Record<string, string | number>) => string;
}) {
    const max = Math.max(0, ...items.map((item) => item.n));
    return (
        <View style={styles.aspectBlock}>
            <Text style={styles.aspectTitle}>{title}</Text>
            {items.length === 0 ? (
                <Text style={styles.emptyLine}>{t('insights.aspectsEmpty')}</Text>
            ) : (
                <View style={styles.aspectWrap}>
                    {items.map((item) => {
                        const top = item.n > 0 && item.n === max;
                        const label = getAspectLabel(tone, item.key, null, t);
                        return (
                            <View
                                key={item.key}
                                style={[
                                    styles.aspectChip,
                                    tone === 'pos' ? styles.aspectChipPos : styles.aspectChipNeg,
                                    top && (tone === 'pos' ? styles.aspectChipPosOn : styles.aspectChipNegOn),
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.aspectText,
                                        tone === 'pos' ? styles.aspectTextPos : styles.aspectTextNeg,
                                        top && styles.aspectTextOn,
                                    ]}
                                >
                                    {label}
                                </Text>
                                <Text
                                    style={[
                                        styles.aspectN,
                                        top && styles.aspectTextOn,
                                        !top && (tone === 'pos' ? styles.aspectTextPos : styles.aspectTextNeg),
                                    ]}
                                >
                                    {item.n}
                                </Text>
                            </View>
                        );
                    })}
                </View>
            )}
        </View>
    );
}

function AudienceCard({
    title,
    data,
    t,
}: {
    title: string;
    data: InsightAudience;
    t: (key: string, params?: Record<string, string | number>) => string;
}) {
    const known = genderKnownTotal(data.gender);
    const rows: { key: string; n: number; color: string }[] = [
        { key: 'genero.femenino', n: data.gender.femenino, color: '#DB2777' },
        { key: 'genero.masculino', n: data.gender.masculino, color: PRIMARY_DARK },
        { key: 'genero.otro', n: data.gender.otro + data.gender.no_binario, color: '#0F766E' },
    ];
    return (
        <View style={styles.audienceCard}>
            <Text style={styles.audienceTitle}>{title}</Text>
            <Text style={styles.audienceN}>{t('insights.audience.people', { n: data.total })}</Text>
            <Text style={styles.audienceAge}>
                {data.ageAvg == null
                    ? t('insights.audience.ageEmpty')
                    : t('insights.audience.age', { age: data.ageAvg })}
            </Text>
            <View style={{ gap: 8, marginTop: 12 }}>
                {rows.map((row) => {
                    const pct = genderPct(row.n, known);
                    return (
                        <View key={row.key}>
                            <View style={styles.genderTop}>
                                <Text style={styles.genderLabel}>{t(row.key)}</Text>
                                <Text style={styles.genderPct}>{known > 0 ? `${pct}%` : t('insights.na')}</Text>
                            </View>
                            <View style={styles.genderTrack}>
                                <View
                                    style={[
                                        styles.genderFill,
                                        { width: `${Math.max(known > 0 && row.n > 0 ? 6 : 0, pct)}%`, backgroundColor: row.color },
                                    ]}
                                />
                            </View>
                        </View>
                    );
                })}
            </View>
            {data.gender.unknown > 0 ? (
                <Text style={styles.unknown}>{t('insights.audience.unknown', { n: data.gender.unknown })}</Text>
            ) : null}
        </View>
    );
}

function HighlightRow({
    icon,
    color,
    label,
    plan,
    empty,
    onPress,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    color: string;
    label: string;
    plan: OrganizerInsights['topSaved'];
    empty: string;
    onPress: (id: string) => void;
}) {
    return (
        <Pressable
            style={styles.highlightRow}
            disabled={!plan}
            onPress={() => {
                if (plan) onPress(plan.id);
            }}
        >
            <View style={[styles.highlightIcon, { backgroundColor: `${color}18` }]}>
                <Ionicons name={icon} size={16} color={color} />
            </View>
            <View style={{ flex: 1 }}>
                <Text style={styles.highlightLabel}>{label}</Text>
                <Text style={styles.highlightTitle} numberOfLines={1}>
                    {plan ? plan.title : empty}
                </Text>
            </View>
            {plan ? <Text style={styles.highlightN}>{plan.n}</Text> : null}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    denied: { marginTop: 40, textAlign: 'center', color: MUTED, fontWeight: '600', paddingHorizontal: 24 },
    content: { paddingHorizontal: 20, gap: 12 },
    section: {
        marginTop: 12,
        fontSize: 15,
        fontWeight: '800',
        color: INK,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
    },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
    kpi: {
        width: '48%',
        flexGrow: 1,
        backgroundColor: CARD,
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: LINE,
        minHeight: 118,
    },
    kpiIcon: {
        width: 32,
        height: 32,
        borderRadius: 10,
        backgroundColor: '#EFF6FF',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 10,
    },
    kpiValue: { fontSize: 28, fontWeight: '900', color: INK, letterSpacing: -0.6 },
    kpiLabel: { marginBottom: 10, fontSize: 15, fontWeight: '800', color: INK },
    kpiHint: { marginTop: 10, fontSize: 12, fontWeight: '600', color: MUTED, lineHeight: 16 },
    periodRow: { flexDirection: 'row', gap: 10 },
    periodMini: { marginTop: 3, fontSize: 12, fontWeight: '700', color: MUTED },
    unfollowCard: {
        backgroundColor: CARD,
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 16,
        borderWidth: 1,
        borderColor: LINE,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    unfollowLabel: { fontSize: 15, fontWeight: '800', color: INK },
    unfollowHint: { marginTop: 3, fontSize: 13, fontWeight: '600', color: MUTED },
    card: {
        backgroundColor: CARD,
        borderRadius: 18,
        padding: 18,
        borderWidth: 1,
        borderColor: LINE,
        gap: 16,
    },
    ratingHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    score: { fontSize: 40, fontWeight: '900', color: INK, letterSpacing: -1, minWidth: 68 },
    reviews: { marginTop: 4, fontSize: 14, fontWeight: '700', color: MUTED },
    aspectBlock: { gap: 10 },
    aspectTitle: { fontSize: 14, fontWeight: '800', color: INK },
    aspectWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    aspectChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderWidth: 1,
    },
    aspectChipPos: { backgroundColor: GREEN_SOFT, borderColor: '#A7F3D0' },
    aspectChipNeg: { backgroundColor: RED_SOFT, borderColor: '#FECACA' },
    aspectChipPosOn: { backgroundColor: GREEN, borderColor: GREEN },
    aspectChipNegOn: { backgroundColor: RED, borderColor: RED },
    aspectText: { fontSize: 13, fontWeight: '800' },
    aspectTextPos: { color: '#047857' },
    aspectTextNeg: { color: '#B91C1C' },
    aspectTextOn: { color: '#FFF' },
    aspectN: { fontSize: 13, fontWeight: '900' },
    emptyLine: { fontSize: 14, fontWeight: '600', color: MUTED },
    audienceRow: { flexDirection: 'row', gap: 10 },
    audienceCard: {
        flex: 1,
        backgroundColor: CARD,
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: LINE,
    },
    audienceTitle: { fontSize: 15, fontWeight: '800', color: INK },
    audienceN: { marginTop: 5, fontSize: 13, fontWeight: '700', color: MUTED },
    audienceAge: { marginTop: 10, fontSize: 17, fontWeight: '800', color: INK },
    genderTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
    genderLabel: { fontSize: 12, fontWeight: '700', color: MUTED },
    genderPct: { fontSize: 12, fontWeight: '800', color: INK },
    genderTrack: { height: 7, borderRadius: 99, backgroundColor: '#F1F5F9', overflow: 'hidden' },
    genderFill: { height: 7, borderRadius: 99 },
    unknown: { marginTop: 10, fontSize: 12, fontWeight: '600', color: MUTED },
    highlightRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    highlightIcon: {
        width: 38,
        height: 38,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    highlightLabel: { fontSize: 12, fontWeight: '800', color: MUTED, textTransform: 'uppercase' },
    highlightTitle: { marginTop: 3, fontSize: 16, fontWeight: '800', color: INK },
    highlightN: { fontSize: 22, fontWeight: '900', color: INK },
    highlightRule: { height: StyleSheet.hairlineWidth, backgroundColor: LINE },
});

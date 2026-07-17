import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { getAuthUser } from '../lib/auth';
import { useT } from '../lib/i18n';
import {
    EMPTY_RATING_DRAFT,
    NEGATIVE_ASPECTS,
    POSITIVE_ASPECTS,
    addPlanToHistory,
    dismissRatingWithoutHistory,
    getPendingRatingPlans,
    submitValoracion,
    type PendingRatingPlan,
    type RatingDraft,
    type RatingPeer,
    type Repetiria,
} from '../lib/ratings';

const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const BG_TOP = '#DCEBFF';
const BG_BOTTOM = '#F2F7FF';
const SUCCESS = '#16A34A';
const DANGER = '#DC2626';

type Stage = 'happened' | 'list' | 'person';

export default function RatePlanScreen() {
    const router = useRouter();
    const { t } = useT();
    const { planId } = useLocalSearchParams<{ planId: string }>();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);
    const [plan, setPlan] = useState<PendingRatingPlan | null>(null);
    const [stage, setStage] = useState<Stage>('happened');
    const [selectedPeer, setSelectedPeer] = useState<RatingPeer | null>(null);
    const [draft, setDraft] = useState<RatingDraft>(EMPTY_RATING_DRAFT);
    const [ratedIds, setRatedIds] = useState<Set<string>>(new Set());

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const user = await getAuthUser();
            if (!user) return;
            setUserId(user.id);
            const plans = await getPendingRatingPlans(user.id);
            const found = plans.find((p) => p.planId === planId && p.phase === 'open') ?? null;
            setPlan(found);
            setRatedIds(new Set(found?.ratedIds ?? []));
            setStage('happened');
            setSelectedPeer(null);
            setDraft(EMPTY_RATING_DRAFT);
        } finally {
            setLoading(false);
        }
    }, [planId]);

    useEffect(() => {
        void load();
    }, [load]);

    const pendingPeers = useMemo(
        () => (plan?.peers ?? []).filter((p) => !ratedIds.has(p.id)),
        [plan, ratedIds],
    );

    const step = useMemo(() => {
        if (draft.asistencia === null) return 1;
        if (draft.asistencia === false) return 1;
        if (draft.puntuacion_general < 1) return 2;
        if (!draft.repetiria_experiencia) return 3;
        return 4;
    }, [draft]);

    const finishAndArchive = async (messageKey: 'ratings.doneMsg' | 'ratings.skippedMsg' | 'ratings.notHappenedMsg') => {
        if (!userId || !plan) {
            router.back();
            return;
        }
        setSaving(true);
        try {
            await addPlanToHistory(userId, plan.planId);
            Alert.alert(t('ratings.doneTitle'), t(messageKey));
            router.back();
        } finally {
            setSaving(false);
        }
    };

    const omitFlow = () => {
        Alert.alert(t('ratings.omitTitle'), t('ratings.omitMsg'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('ratings.omitConfirm'),
                onPress: () => void finishAndArchive('ratings.skippedMsg'),
            },
        ]);
    };

    const onPlanHappened = async (happened: boolean) => {
        if (!happened) {
            if (userId && plan) {
                await dismissRatingWithoutHistory(userId, plan.planId);
            }
            Alert.alert(t('ratings.doneTitle'), t('ratings.notHappenedMsg'));
            router.back();
            return;
        }
        setStage('list');
    };

    const openPeer = (peer: RatingPeer) => {
        if (ratedIds.has(peer.id)) return;
        setSelectedPeer(peer);
        setDraft(EMPTY_RATING_DRAFT);
        setStage('person');
    };

    const toggleAspect = (list: 'aspectos_positivos' | 'aspectos_negativos', key: string) => {
        setDraft((prev) => {
            const cur = prev[list];
            const next = cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key];
            return { ...prev, [list]: next };
        });
    };

    const submitCurrent = async () => {
        if (!userId || !plan || !selectedPeer || draft.asistencia === null) return;
        if (draft.asistencia && (draft.puntuacion_general < 1 || !draft.repetiria_experiencia)) {
            Alert.alert(t('profile.error'), t('ratings.incomplete'));
            return;
        }
        setSaving(true);
        try {
            const { error } = await submitValoracion({
                planId: plan.planId,
                evaluadorId: userId,
                evaluadoId: selectedPeer.id,
                draft,
            });
            if (error) {
                Alert.alert(t('profile.error'), t('ratings.saveError'));
                return;
            }
            const nextRated = new Set(ratedIds);
            nextRated.add(selectedPeer.id);
            setRatedIds(nextRated);
            setSelectedPeer(null);
            setDraft(EMPTY_RATING_DRAFT);

            const stillPending = (plan.peers ?? []).filter((p) => !nextRated.has(p.id));
            if (stillPending.length === 0) {
                await finishAndArchive('ratings.doneMsg');
                return;
            }
            setStage('list');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator color={PRIMARY_DARK} size="large" />
            </View>
        );
    }

    if (!plan) {
        return (
            <View style={styles.center}>
                <Text style={styles.empty}>{t('ratings.noneOpen')}</Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={() => router.back()}>
                    <Text style={styles.primaryBtnText}>{t('common.back')}</Text>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={StyleSheet.absoluteFill} />
            <View style={styles.header}>
                <TouchableOpacity
                    onPress={() => {
                        if (stage === 'person') {
                            setStage('list');
                            setSelectedPeer(null);
                            setDraft(EMPTY_RATING_DRAFT);
                            return;
                        }
                        router.back();
                    }}
                    style={styles.backBtn}
                >
                    <Ionicons name="chevron-back" size={24} color={INK} />
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                    <Text style={styles.title} numberOfLines={1}>{t('ratings.rateTitle')}</Text>
                    <Text style={styles.sub} numberOfLines={1}>{plan.titulo}</Text>
                </View>
                {stage !== 'happened' ? (
                    <TouchableOpacity onPress={omitFlow} hitSlop={8}>
                        <Text style={styles.omitLink}>{t('ratings.omit')}</Text>
                    </TouchableOpacity>
                ) : null}
            </View>

            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                {stage === 'happened' && (
                    <>
                        <View style={styles.introCard}>
                            <Ionicons name="help-circle-outline" size={36} color={PRIMARY_DARK} />
                            <Text style={styles.introTitle}>{t('ratings.happenedQ')}</Text>
                            <Text style={styles.introSub}>{t('ratings.happenedHint')}</Text>
                        </View>
                        <View style={styles.row}>
                            <TouchableOpacity
                                style={[styles.choice, styles.choiceYes]}
                                onPress={() => onPlanHappened(true)}
                                disabled={saving}
                            >
                                <Text style={[styles.choiceText, styles.choiceTextOn]}>{t('ratings.yes')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.choice, styles.choiceNo]}
                                onPress={() => onPlanHappened(false)}
                                disabled={saving}
                            >
                                <Text style={[styles.choiceText, styles.choiceTextOn]}>{t('ratings.no')}</Text>
                            </TouchableOpacity>
                        </View>
                        <TouchableOpacity style={styles.secondaryBtn} onPress={omitFlow} disabled={saving}>
                            <Text style={styles.secondaryBtnText}>{t('ratings.omit')}</Text>
                        </TouchableOpacity>
                    </>
                )}

                {stage === 'list' && (
                    <>
                        <Text style={styles.q}>{t('ratings.pickPeople')}</Text>
                        <Text style={styles.hint}>{t('ratings.pickPeopleHint')}</Text>
                        {(plan.peers ?? []).map((peer) => {
                            const done = ratedIds.has(peer.id);
                            return (
                                <TouchableOpacity
                                    key={peer.id}
                                    style={[styles.peerRow, done && styles.peerRowDone]}
                                    onPress={() => openPeer(peer)}
                                    disabled={done}
                                    activeOpacity={0.85}
                                >
                                    <ProfileAvatar uri={peer.avatar_url} name={peer.nombre} size={48} />
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.peerRowName}>{peer.nombre}</Text>
                                        <Text style={styles.peerRowMeta}>
                                            {done ? t('ratings.alreadyRated') : t('ratings.tapToRate')}
                                        </Text>
                                    </View>
                                    {done ? (
                                        <Ionicons name="checkmark-circle" size={22} color={SUCCESS} />
                                    ) : (
                                        <Ionicons name="chevron-forward" size={18} color="#CBD5E1" />
                                    )}
                                </TouchableOpacity>
                            );
                        })}

                        <TouchableOpacity
                            style={[styles.primaryBtn, saving && { opacity: 0.7 }]}
                            onPress={() => void finishAndArchive('ratings.doneMsg')}
                            disabled={saving}
                        >
                            {saving ? (
                                <ActivityIndicator color="#FFF" />
                            ) : (
                                <Text style={styles.primaryBtnText}>
                                    {pendingPeers.length === plan.peers.length
                                        ? t('ratings.finishWithoutRating')
                                        : t('ratings.finish')}
                                </Text>
                            )}
                        </TouchableOpacity>
                    </>
                )}

                {stage === 'person' && selectedPeer && (
                    <>
                        <View style={styles.peerCard}>
                            <ProfileAvatar uri={selectedPeer.avatar_url} name={selectedPeer.nombre} size={72} />
                            <Text style={styles.peerName}>{selectedPeer.nombre}</Text>
                        </View>

                        <Text style={styles.q}>{t('ratings.attendedQ')}</Text>
                        <View style={styles.row}>
                            <TouchableOpacity
                                style={[styles.choice, draft.asistencia === true && styles.choiceYes]}
                                onPress={() => setDraft({ ...EMPTY_RATING_DRAFT, asistencia: true })}
                            >
                                <Text style={[styles.choiceText, draft.asistencia === true && styles.choiceTextOn]}>
                                    {t('ratings.yes')}
                                </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.choice, draft.asistencia === false && styles.choiceNo]}
                                onPress={() => setDraft({ ...EMPTY_RATING_DRAFT, asistencia: false })}
                            >
                                <Text style={[styles.choiceText, draft.asistencia === false && styles.choiceTextOn]}>
                                    {t('ratings.no')}
                                </Text>
                            </TouchableOpacity>
                        </View>

                        {draft.asistencia === true && (
                            <>
                                <Text style={styles.q}>{t('ratings.starsQ')}</Text>
                                <View style={styles.starsRow}>
                                    {[1, 2, 3, 4, 5].map((n) => (
                                        <TouchableOpacity
                                            key={n}
                                            onPress={() => setDraft((d) => ({ ...d, puntuacion_general: n }))}
                                            hitSlop={6}
                                        >
                                            <Ionicons
                                                name={draft.puntuacion_general >= n ? 'star' : 'star-outline'}
                                                size={36}
                                                color={draft.puntuacion_general >= n ? '#F59E0B' : '#CBD5E1'}
                                            />
                                        </TouchableOpacity>
                                    ))}
                                </View>

                                {step >= 3 && (
                                    <>
                                        <Text style={styles.q}>{t('ratings.repeatQ')}</Text>
                                        <View style={styles.rowWrap}>
                                            {([
                                                ['si', t('ratings.repeatYes')],
                                                ['tal_vez', t('ratings.repeatMaybe')],
                                                ['no', t('ratings.repeatNo')],
                                            ] as [Repetiria, string][]).map(([key, label]) => (
                                                <TouchableOpacity
                                                    key={key}
                                                    style={[
                                                        styles.chip,
                                                        draft.repetiria_experiencia === key && styles.chipOn,
                                                    ]}
                                                    onPress={() => setDraft((d) => ({ ...d, repetiria_experiencia: key }))}
                                                >
                                                    <Text
                                                        style={[
                                                            styles.chipText,
                                                            draft.repetiria_experiencia === key && styles.chipTextOn,
                                                        ]}
                                                    >
                                                        {label}
                                                    </Text>
                                                </TouchableOpacity>
                                            ))}
                                        </View>
                                    </>
                                )}

                                {step >= 4 && (
                                    <>
                                        <Text style={styles.q}>{t('ratings.positivesQ')}</Text>
                                        <View style={styles.rowWrap}>
                                            {POSITIVE_ASPECTS.map((key) => (
                                                <TouchableOpacity
                                                    key={key}
                                                    style={[
                                                        styles.chip,
                                                        draft.aspectos_positivos.includes(key) && styles.chipPos,
                                                    ]}
                                                    onPress={() => toggleAspect('aspectos_positivos', key)}
                                                >
                                                    <Text
                                                        style={[
                                                            styles.chipText,
                                                            draft.aspectos_positivos.includes(key) && styles.chipTextOn,
                                                        ]}
                                                    >
                                                        {t(`ratings.pos.${key}`)}
                                                    </Text>
                                                </TouchableOpacity>
                                            ))}
                                        </View>

                                        <Text style={styles.q}>{t('ratings.negativesQ')}</Text>
                                        <View style={styles.rowWrap}>
                                            {NEGATIVE_ASPECTS.map((key) => (
                                                <TouchableOpacity
                                                    key={key}
                                                    style={[
                                                        styles.chip,
                                                        draft.aspectos_negativos.includes(key) && styles.chipNeg,
                                                    ]}
                                                    onPress={() => toggleAspect('aspectos_negativos', key)}
                                                >
                                                    <Text
                                                        style={[
                                                            styles.chipText,
                                                            draft.aspectos_negativos.includes(key) && styles.chipTextOn,
                                                        ]}
                                                    >
                                                        {t(`ratings.neg.${key}`)}
                                                    </Text>
                                                </TouchableOpacity>
                                            ))}
                                        </View>
                                    </>
                                )}
                            </>
                        )}

                        {draft.asistencia !== null && (
                            <TouchableOpacity
                                style={[styles.primaryBtn, saving && { opacity: 0.7 }]}
                                onPress={submitCurrent}
                                disabled={saving}
                            >
                                {saving ? (
                                    <ActivityIndicator color="#FFF" />
                                ) : (
                                    <Text style={styles.primaryBtnText}>
                                        {draft.asistencia === false
                                            ? t('ratings.skipPerson')
                                            : t('ratings.submitPerson')}
                                    </Text>
                                )}
                            </TouchableOpacity>
                        )}
                    </>
                )}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG_BOTTOM },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: BG_BOTTOM },
    empty: { color: '#64748B', fontWeight: '600', marginBottom: 16, textAlign: 'center' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 16,
        paddingTop: 56,
        paddingBottom: 12,
    },
    backBtn: {
        width: 42,
        height: 42,
        borderRadius: 14,
        backgroundColor: '#FFF',
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: { fontSize: 18, fontWeight: '900', color: INK },
    sub: { fontSize: 13, color: '#64748B', fontWeight: '600', marginTop: 2 },
    omitLink: { fontSize: 13, fontWeight: '800', color: '#94A3B8' },
    content: { padding: 20, paddingBottom: 40 },
    introCard: {
        backgroundColor: '#FFF',
        borderRadius: 20,
        padding: 22,
        alignItems: 'center',
        gap: 10,
        marginBottom: 16,
    },
    introTitle: { fontSize: 18, fontWeight: '900', color: INK, textAlign: 'center' },
    introSub: { fontSize: 13, color: '#64748B', textAlign: 'center', lineHeight: 18 },
    peerCard: {
        backgroundColor: '#FFF',
        borderRadius: 20,
        padding: 20,
        alignItems: 'center',
        marginBottom: 20,
        gap: 10,
    },
    peerName: { fontSize: 18, fontWeight: '800', color: INK },
    peerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: '#FFF',
        borderRadius: 16,
        padding: 12,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    peerRowDone: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
    peerRowName: { fontSize: 15, fontWeight: '800', color: INK },
    peerRowMeta: { fontSize: 12, color: '#94A3B8', fontWeight: '600', marginTop: 2 },
    q: { fontSize: 15, fontWeight: '800', color: INK, marginBottom: 10, marginTop: 8 },
    hint: { fontSize: 13, color: '#64748B', marginBottom: 14, lineHeight: 18 },
    row: { flexDirection: 'row', gap: 10, marginBottom: 12 },
    rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
    choice: {
        flex: 1,
        backgroundColor: '#FFF',
        borderRadius: 14,
        paddingVertical: 14,
        alignItems: 'center',
        borderWidth: 1.5,
        borderColor: '#E2E8F0',
    },
    choiceYes: { backgroundColor: SUCCESS, borderColor: SUCCESS },
    choiceNo: { backgroundColor: DANGER, borderColor: DANGER },
    choiceText: { fontWeight: '800', color: '#64748B' },
    choiceTextOn: { color: '#FFF' },
    starsRow: { flexDirection: 'row', gap: 8, marginBottom: 12, justifyContent: 'center' },
    chip: {
        backgroundColor: '#FFF',
        borderRadius: 20,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    chipOn: { backgroundColor: PRIMARY_DARK, borderColor: PRIMARY_DARK },
    chipPos: { backgroundColor: '#16A34A', borderColor: '#16A34A' },
    chipNeg: { backgroundColor: '#DC2626', borderColor: '#DC2626' },
    chipText: { fontSize: 13, fontWeight: '700', color: '#475569' },
    chipTextOn: { color: '#FFF' },
    primaryBtn: {
        marginTop: 16,
        backgroundColor: PRIMARY_DARK,
        borderRadius: 16,
        paddingVertical: 16,
        alignItems: 'center',
    },
    primaryBtnText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
    secondaryBtn: {
        marginTop: 8,
        paddingVertical: 14,
        alignItems: 'center',
    },
    secondaryBtnText: { color: '#94A3B8', fontWeight: '700', fontSize: 14 },
});

import {
    Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams,
    useRouter } from 'expo-router';
import { useCallback,
    useEffect,
    useMemo,
    useRef,
    useState } from 'react';
import {
    ActivityIndicator,
    InteractionManager,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Alert } from '../lib/nexoAlert';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { trackFunnel } from '../lib/analytics';
import { getAuthUser } from '../lib/auth';
import { getFriendStatus, sendFriendRequest } from '../lib/friends';
import { hapticLight, hapticSelection, hapticSuccess } from '../lib/haptics';
import { useT } from '../lib/i18n';
import {
    EMPTY_RATING_DRAFT,
    MAX_ASPECTS,
    NEGATIVE_ASPECTS,
    POSITIVE_ASPECTS,
    STAR_LABEL_KEYS,
    addPlanToHistory,
    dismissRatingWithoutHistory,
    ensurePlanInHistory,
    getPendingRatingPlans,
    hasRatingSessionStarted,
    isPersonDraftComplete,
    markRatingSessionStarted,
    submitValoracion,
    type PendingRatingPlan,
    type RatingDraft,
    type RatingPeer,
    type Repetiria,
} from '../lib/ratings';

const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';
const BG_TOP = '#DCEBFF';
const BG_BOTTOM = '#F2F7FF';
const SUCCESS = '#16A34A';
const DANGER = '#DC2626';
const GOLD = '#F59E0B';

type Stage = 'happened' | 'list' | 'person' | 'friends';

function StepDots({ active }: { active: 1 | 2 | 3 }) {
    return (
        <View style={styles.stepsRow}>
            {[1, 2, 3].map((n) => (
                <View key={n} style={styles.stepItem}>
                    <View style={[styles.stepDot, n <= active && styles.stepDotOn, n < active && styles.stepDotDone]}>
                        {n < active ? (
                            <Ionicons name="checkmark" size={12} color="#FFF" />
                        ) : (
                            <Text style={[styles.stepDotText, n <= active && styles.stepDotTextOn]}>{n}</Text>
                        )}
                    </View>
                    {n < 3 ? <View style={[styles.stepLine, n < active && styles.stepLineOn]} /> : null}
                </View>
            ))}
        </View>
    );
}

export default function RatePlanScreen() {
    const router = useRouter();
    const { t } = useT();
    const insets = useSafeAreaInsets();
    const scrollRef = useRef<ScrollView>(null);
    const { planId } = useLocalSearchParams<{ planId: string }>();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);
    const [plan, setPlan] = useState<PendingRatingPlan | null>(null);
    const [stage, setStage] = useState<Stage>('happened');
    const [selectedPeer, setSelectedPeer] = useState<RatingPeer | null>(null);
    const [draft, setDraft] = useState<RatingDraft>(EMPTY_RATING_DRAFT);
    const [ratedIds, setRatedIds] = useState<Set<string>>(new Set());
    const [justSaved, setJustSaved] = useState(false);
    const [friendCandidates, setFriendCandidates] = useState<RatingPeer[]>([]);
    const [friendSentIds, setFriendSentIds] = useState<Set<string>>(new Set());
    const [friendBusyId, setFriendBusyId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const user = await getAuthUser();
            if (!user) return;
            setUserId(user.id);
            const plans = await getPendingRatingPlans(user.id);
            const found = plans.find((p) => p.planId === planId && p.phase === 'open') ?? null;
            setPlan(found);
            const alreadyRated = new Set(found?.ratedIds ?? []);
            setRatedIds(alreadyRated);

            const started = found ? await hasRatingSessionStarted(user.id, found.planId) : false;
            if (found && (started || alreadyRated.size > 0)) {
                setStage('list');
            } else {
                setStage('happened');
            }
            setSelectedPeer(null);
            setDraft(EMPTY_RATING_DRAFT);
            if (found) {
                trackFunnel('rating_start', { userId: user.id, props: { planId: found.planId } });
            }
        } finally {
            setLoading(false);
        }
    }, [planId]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        scrollRef.current?.scrollTo({ y: 0, animated: false });
    }, [stage, selectedPeer?.id]);

    const ratedCount = ratedIds.size;
    const totalPeers = plan?.peers.length ?? 0;
    const pendingCount = totalPeers - ratedCount;
    const progressPct = totalPeers > 0 ? ratedCount / totalPeers : 0;

    const stepActive: 1 | 2 | 3 =
        stage === 'happened' ? 1 : stage === 'list' || stage === 'friends' ? 2 : 3;
    const canSubmitPerson = isPersonDraftComplete(draft);

    const resolveFriendCandidates = async (peers: RatingPeer[], uid: string) => {
        const out: RatingPeer[] = [];
        // Limitar trabajo: muchas consultas seguidas congelan la UI (sobre todo en Expo Go).
        const slice = peers.slice(0, 12);
        await Promise.all(
            slice.map(async (peer) => {
                try {
                    const st = await getFriendStatus(uid, peer.id);
                    if (st.status === 'none') out.push(peer);
                } catch {
                    /* skip */
                }
            }),
        );
        return out;
    };

    const goBackSafe = () => {
        // Diferir el back: Alert modal + router.back() a la vez congela Expo Go.
        requestAnimationFrame(() => {
            InteractionManager.runAfterInteractions(() => {
                if (router.canGoBack()) router.back();
                else router.replace('/(tabs)/my-plans');
            });
        });
    };

    /** Nunca navegar en el mismo tick que abrir el Alert (modales anidados). */
    const doneAndLeave = (title: string, message: string) => {
        Alert.alert(title, message, [
            {
                text: t('common.ok'),
                onPress: () => goBackSafe(),
            },
        ]);
    };

    const finishAndArchive = async () => {
        if (!userId || !plan) {
            goBackSafe();
            return;
        }
        setSaving(true);
        try {
            const { error } = await addPlanToHistory(userId, plan.planId);
            if (error) {
                Alert.alert(t('profile.error'), t('ratings.saveError'));
                return;
            }
            trackFunnel('rating_complete', {
                userId,
                props: { planId: plan.planId, rated: ratedIds.size },
            });
            const peers = (plan.peers ?? []).filter((p) => ratedIds.has(p.id));
            // Mostrar primero la pantalla de amigos; filtrar en background (evita JS bloqueado).
            if (peers.length === 0) {
                doneAndLeave(t('ratings.doneTitle'), t('ratings.doneMsg'));
                return;
            }
            setFriendCandidates(peers);
            setFriendSentIds(new Set());
            setStage('friends');
            setSaving(false);
            try {
                const candidates = await Promise.race([
                    resolveFriendCandidates(peers, userId),
                    new Promise<RatingPeer[]>((resolve) => setTimeout(() => resolve(peers), 1500)),
                ]);
                if (candidates.length === 0) {
                    doneAndLeave(t('ratings.doneTitle'), t('ratings.doneMsg'));
                    return;
                }
                setFriendCandidates(candidates);
            } catch {
                /* dejar la lista provisional */
            }
        } finally {
            setSaving(false);
        }
    };

    const sendAddFriend = async (peer: RatingPeer) => {
        if (!userId || friendSentIds.has(peer.id)) return;
        setFriendBusyId(peer.id);
        try {
            const { error } = await sendFriendRequest(userId, peer.id);
            if (error) {
                Alert.alert(t('profile.error'), error);
                return;
            }
            setFriendSentIds((prev) => new Set(prev).add(peer.id));
        } finally {
            setFriendBusyId(null);
        }
    };

    const onPlanHappened = async (attended: boolean) => {
        if (!attended) {
            hapticLight();
            if (userId && plan) await dismissRatingWithoutHistory(userId, plan.planId);
            doneAndLeave(t('ratings.doneTitle'), t('ratings.notAttendedMsg'));
            return;
        }
        hapticSuccess();
        if (userId && plan) {
            await markRatingSessionStarted(userId, plan.planId);
            // Al confirmar asistencia, suma ya a planes hechos
            const { error } = await ensurePlanInHistory(userId, plan.planId);
            if (error) {
                Alert.alert(t('profile.error'), t('ratings.saveError'));
                return;
            }
        }
        setStage('list');
    };

    const openPeer = (peer: RatingPeer) => {
        if (ratedIds.has(peer.id)) return;
        hapticSelection();
        setSelectedPeer(peer);
        setDraft(EMPTY_RATING_DRAFT);
        setJustSaved(false);
        setStage('person');
    };

    const toggleAspect = (list: 'aspectos_positivos' | 'aspectos_negativos', key: string) => {
        setDraft((prev) => {
            const cur = prev[list];
            if (cur.includes(key)) {
                hapticSelection();
                return { ...prev, [list]: cur.filter((x) => x !== key) };
            }
            if (cur.length >= MAX_ASPECTS) return prev;
            hapticSelection();
            return { ...prev, [list]: [...cur, key] };
        });
    };

    const submitCurrent = async () => {
        if (!userId || !plan || !selectedPeer || !canSubmitPerson) return;
        setSaving(true);
        try {
            const { error } = await submitValoracion({
                planId: plan.planId,
                evaluadorId: userId,
                evaluadoId: selectedPeer.id,
                draft,
            });
            if (error) {
                console.warn('[rate-plan] submit failed', error);
                Alert.alert(
                    t('profile.error'),
                    `${t('ratings.saveError')}${error && error !== 'rpc_rejected' ? `\n\n${error}` : ''}`,
                );
                return;
            }
            hapticSuccess();
            const nextRated = new Set(ratedIds);
            nextRated.add(selectedPeer.id);
            setRatedIds(nextRated);
            setJustSaved(true);

            const stillPending = (plan.peers ?? []).filter((p) => !nextRated.has(p.id));
            if (stillPending.length === 0) {
                await finishAndArchive();
                return;
            }
            setSelectedPeer(null);
            setDraft(EMPTY_RATING_DRAFT);
            setStage('list');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <View style={[styles.center, { paddingTop: insets.top }]}>
                <ActivityIndicator color={PRIMARY_DARK} size="large" />
                <Text style={styles.loadingText}>{t('ratings.loading')}</Text>
            </View>
        );
    }

    if (!plan) {
        return (
            <View style={[styles.center, { paddingTop: insets.top }]}>
                <View style={styles.emptyIcon}>
                    <Ionicons name="star-outline" size={32} color={MUTED} />
                </View>
                <Text style={styles.empty}>{t('ratings.noneOpen')}</Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={goBackSafe}>
                    <Text style={styles.primaryBtnText}>{t('common.back')}</Text>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={StyleSheet.absoluteFill} />
            <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
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
            </View>

            <StepDots active={stepActive} />

            <ScrollView
                ref={scrollRef}
                contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                {stage === 'happened' && (
                    <>
                        <View style={styles.introCard}>
                            <View style={styles.introIcon}>
                                <Ionicons name="calendar-outline" size={28} color={PRIMARY_DARK} />
                            </View>
                            <Text style={styles.introTitle}>{t('ratings.attendedPlanQ')}</Text>
                        </View>

                        <TouchableOpacity
                            style={styles.bigChoiceYes}
                            onPress={() => void onPlanHappened(true)}
                            disabled={saving}
                            activeOpacity={0.88}
                        >
                            <Ionicons name="checkmark-circle" size={22} color="#FFF" />
                            <Text style={styles.bigChoiceText}>{t('ratings.attendedPlanYes')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.bigChoiceNo}
                            onPress={() => void onPlanHappened(false)}
                            disabled={saving}
                            activeOpacity={0.88}
                        >
                            <Ionicons name="close-circle" size={22} color={DANGER} />
                            <Text style={styles.bigChoiceNoText}>{t('ratings.attendedPlanNo')}</Text>
                        </TouchableOpacity>
                    </>
                )}

                {stage === 'friends' && (
                    <>
                        <View style={styles.introCard}>
                            <View style={styles.introIcon}>
                                <Ionicons name="people-outline" size={28} color={PRIMARY_DARK} />
                            </View>
                            <Text style={styles.introTitle}>{t('ratings.addFriendsTitle')}</Text>
                        </View>
                        {friendCandidates.map((peer) => {
                            const sent = friendSentIds.has(peer.id);
                            const busy = friendBusyId === peer.id;
                            return (
                                <View key={peer.id} style={styles.peerRow}>
                                    <ProfileAvatar uri={peer.avatar_url} name={peer.nombre} size={48} />
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.peerRowName}>{peer.nombre}</Text>
                                        {sent ? (
                                            <Text style={[styles.peerRowMeta, { color: SUCCESS }]}>
                                                {t('ratings.friendRequestSent')}
                                            </Text>
                                        ) : null}
                                    </View>
                                    <TouchableOpacity
                                        style={[styles.ratePill, sent && styles.donePill]}
                                        onPress={() => void sendAddFriend(peer)}
                                        disabled={sent || busy}
                                    >
                                        {busy ? (
                                            <ActivityIndicator size="small" color={PRIMARY_DARK} />
                                        ) : (
                                            <Text style={[styles.ratePillText, sent && { color: SUCCESS }]}>
                                                {sent ? t('ratings.friendSent') : t('ratings.addFriend')}
                                            </Text>
                                        )}
                                    </TouchableOpacity>
                                </View>
                            );
                        })}
                        <TouchableOpacity
                            style={styles.primaryBtn}
                            onPress={() => doneAndLeave(t('ratings.doneTitle'), t('ratings.doneMsg'))}
                        >
                            <Text style={styles.primaryBtnText}>{t('ratings.finish')}</Text>
                        </TouchableOpacity>
                    </>
                )}

                {stage === 'list' && (
                    <>
                        {justSaved ? (
                            <View style={styles.toastOk}>
                                <Ionicons name="checkmark-circle" size={18} color={SUCCESS} />
                                <Text style={styles.toastOkText}>{t('ratings.savedPerson')}</Text>
                            </View>
                        ) : null}

                        <View style={styles.progressCard}>
                            <View style={styles.progressTop}>
                                <Text style={styles.progressLabel}>{t('ratings.progress')}</Text>
                                <Text style={styles.progressCount}>
                                    {ratedCount}/{totalPeers}
                                </Text>
                            </View>
                            <View style={styles.progressTrack}>
                                <View style={[styles.progressFill, { width: `${Math.round(progressPct * 100)}%` }]} />
                            </View>
                            <Text style={styles.hint}>{t('ratings.pickPeopleHint')}</Text>
                        </View>

                        <Text style={styles.sectionLabel}>{t('ratings.pickPeople')}</Text>
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
                                        <Text style={[styles.peerRowMeta, done && styles.peerRowMetaDone]}>
                                            {done ? t('ratings.alreadyRated') : t('ratings.tapToRate')}
                                        </Text>
                                    </View>
                                    {done ? (
                                        <View style={styles.donePill}>
                                            <Ionicons name="checkmark" size={14} color={SUCCESS} />
                                        </View>
                                    ) : (
                                        <View style={styles.ratePill}>
                                            <Text style={styles.ratePillText}>{t('ratings.rateCta')}</Text>
                                        </View>
                                    )}
                                </TouchableOpacity>
                            );
                        })}

                        <TouchableOpacity
                            style={[styles.primaryBtn, saving && { opacity: 0.7 }]}
                            onPress={() => void finishAndArchive()}
                            disabled={saving}
                        >
                            {saving ? (
                                <ActivityIndicator color="#FFF" />
                            ) : (
                                <Text style={styles.primaryBtnText}>
                                    {ratedCount === 0
                                        ? t('ratings.finishWithoutRating')
                                        : pendingCount > 0
                                          ? t('ratings.finishPartial', { n: ratedCount })
                                          : t('ratings.finish')}
                                </Text>
                            )}
                        </TouchableOpacity>
                    </>
                )}

                {stage === 'person' && selectedPeer && (
                    <>
                        <View style={styles.peerCard}>
                            <ProfileAvatar uri={selectedPeer.avatar_url} name={selectedPeer.nombre} size={80} />
                            <Text style={styles.peerName}>{selectedPeer.nombre}</Text>
                            <Text style={styles.peerCardHint}>{t('ratings.personHint')}</Text>
                        </View>

                        <View style={styles.questionCard}>
                            <Text style={styles.qNum}>1</Text>
                            <View style={{ flex: 1 }}>
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
                            </View>
                        </View>

                        {draft.asistencia === true && (
                            <>
                                <View style={styles.questionCard}>
                                    <Text style={styles.qNum}>2</Text>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.q}>{t('ratings.starsQ')}</Text>
                                        <View style={styles.starsRow}>
                                            {[1, 2, 3, 4, 5].map((n) => (
                                                <TouchableOpacity
                                                    key={n}
                                                    onPress={() => {
                                                        hapticSelection();
                                                        setDraft((d) => ({ ...d, puntuacion_general: n }));
                                                    }}
                                                    hitSlop={8}
                                                    style={styles.starBtn}
                                                >
                                                    <Ionicons
                                                        name={draft.puntuacion_general >= n ? 'star' : 'star-outline'}
                                                        size={34}
                                                        color={draft.puntuacion_general >= n ? GOLD : '#CBD5E1'}
                                                    />
                                                </TouchableOpacity>
                                            ))}
                                        </View>
                                        {draft.puntuacion_general > 0 ? (
                                            <Text style={styles.starLabel}>
                                                {t(STAR_LABEL_KEYS[draft.puntuacion_general - 1])}
                                            </Text>
                                        ) : null}
                                    </View>
                                </View>

                                {draft.puntuacion_general >= 1 && (
                                    <View style={styles.questionCard}>
                                        <Text style={styles.qNum}>3</Text>
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.q}>{t('ratings.repeatQ')}</Text>
                                            <View style={styles.rowWrap}>
                                                {([
                                                    ['si', t('ratings.repeatYes'), SUCCESS],
                                                    ['indiferente', t('ratings.repeatMaybe'), PRIMARY_DARK],
                                                    ['no', t('ratings.repeatNo'), DANGER],
                                                ] as [Repetiria, string, string][]).map(([key, label, color]) => {
                                                    const on = draft.repetiria_experiencia === key;
                                                    return (
                                                        <TouchableOpacity
                                                            key={key}
                                                            style={[
                                                                styles.chip,
                                                                on && { backgroundColor: color, borderColor: color },
                                                            ]}
                                                            onPress={() =>
                                                                setDraft((d) => ({ ...d, repetiria_experiencia: key }))
                                                            }
                                                        >
                                                            <Text style={[styles.chipText, on && styles.chipTextOn]}>
                                                                {label}
                                                            </Text>
                                                        </TouchableOpacity>
                                                    );
                                                })}
                                            </View>
                                        </View>
                                    </View>
                                )}

                                {draft.repetiria_experiencia && (
                                    <>
                                        <View style={styles.questionCard}>
                                            <Text style={styles.qNum}>4</Text>
                                            <View style={{ flex: 1 }}>
                                                <Text style={styles.q}>{t('ratings.positivesQ')}</Text>
                                                <View style={styles.rowWrap}>
                                                    {POSITIVE_ASPECTS.map((key) => {
                                                        const on = draft.aspectos_positivos.includes(key);
                                                        return (
                                                            <TouchableOpacity
                                                                key={key}
                                                                style={[styles.chip, on && styles.chipPos]}
                                                                onPress={() => toggleAspect('aspectos_positivos', key)}
                                                            >
                                                                <Text style={[styles.chipText, on && styles.chipTextOn]}>
                                                                    {t(`ratings.pos.${key}`)}
                                                                </Text>
                                                            </TouchableOpacity>
                                                        );
                                                    })}
                                                </View>
                                            </View>
                                        </View>

                                        <View style={styles.questionCard}>
                                            <Text style={styles.qNum}>5</Text>
                                            <View style={{ flex: 1 }}>
                                                <Text style={styles.q}>{t('ratings.negativesQ')}</Text>
                                                <View style={styles.rowWrap}>
                                                    {NEGATIVE_ASPECTS.map((key) => {
                                                        const on = draft.aspectos_negativos.includes(key);
                                                        return (
                                                            <TouchableOpacity
                                                                key={key}
                                                                style={[styles.chip, on && styles.chipNeg]}
                                                                onPress={() => toggleAspect('aspectos_negativos', key)}
                                                            >
                                                                <Text style={[styles.chipText, on && styles.chipTextOn]}>
                                                                    {t(`ratings.neg.${key}`)}
                                                                </Text>
                                                            </TouchableOpacity>
                                                        );
                                                    })}
                                                </View>
                                            </View>
                                        </View>
                                    </>
                                )}
                            </>
                        )}

                        {draft.asistencia !== null && (
                            <TouchableOpacity
                                style={[
                                    styles.primaryBtn,
                                    (!canSubmitPerson || saving) && styles.primaryBtnDisabled,
                                ]}
                                onPress={submitCurrent}
                                disabled={!canSubmitPerson || saving}
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
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        backgroundColor: BG_BOTTOM,
    },
    loadingText: { marginTop: 12, color: MUTED, fontWeight: '600' },
    emptyIcon: {
        width: 64,
        height: 64,
        borderRadius: 20,
        backgroundColor: '#FFF',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 12,
    },
    empty: { color: MUTED, fontWeight: '600', marginBottom: 16, textAlign: 'center' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 16,
        paddingBottom: 8,
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
    sub: { fontSize: 13, color: MUTED, fontWeight: '600', marginTop: 2 },
    stepsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 40,
        marginBottom: 8,
    },
    stepItem: { flexDirection: 'row', alignItems: 'center' },
    stepDot: {
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: '#E2E8F0',
        alignItems: 'center',
        justifyContent: 'center',
    },
    stepDotOn: { backgroundColor: PRIMARY_DARK },
    stepDotDone: { backgroundColor: SUCCESS },
    stepDotText: { fontSize: 11, fontWeight: '800', color: MUTED },
    stepDotTextOn: { color: '#FFF' },
    stepLine: { width: 36, height: 3, backgroundColor: '#E2E8F0', marginHorizontal: 4, borderRadius: 2 },
    stepLineOn: { backgroundColor: SUCCESS },
    content: { padding: 20 },
    introCard: {
        backgroundColor: '#FFF',
        borderRadius: 22,
        padding: 24,
        alignItems: 'center',
        gap: 10,
        marginBottom: 18,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    introIcon: {
        width: 56,
        height: 56,
        borderRadius: 18,
        backgroundColor: '#EFF6FF',
        alignItems: 'center',
        justifyContent: 'center',
    },
    introTitle: { fontSize: 20, fontWeight: '900', color: INK, textAlign: 'center' },
    introSub: { fontSize: 14, color: MUTED, textAlign: 'center', lineHeight: 20 },
    bigChoiceYes: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        backgroundColor: SUCCESS,
        borderRadius: 16,
        paddingVertical: 16,
        marginBottom: 10,
    },
    bigChoiceText: { color: '#FFF', fontWeight: '800', fontSize: 16 },
    bigChoiceNo: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        backgroundColor: '#FFF',
        borderRadius: 16,
        paddingVertical: 16,
        borderWidth: 1.5,
        borderColor: '#FECACA',
        marginBottom: 12,
    },
    bigChoiceNoText: { color: DANGER, fontWeight: '800', fontSize: 16 },
    footerHint: { textAlign: 'center', color: '#94A3B8', fontSize: 12, fontWeight: '600', marginTop: 8, lineHeight: 17 },
    toastOk: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#F0FDF4',
        borderRadius: 12,
        padding: 12,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#BBF7D0',
    },
    toastOkText: { color: SUCCESS, fontWeight: '700', fontSize: 13 },
    progressCard: {
        backgroundColor: '#FFF',
        borderRadius: 18,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    progressTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
    progressLabel: { fontSize: 13, fontWeight: '700', color: MUTED },
    progressCount: { fontSize: 13, fontWeight: '900', color: PRIMARY_DARK },
    progressTrack: { height: 8, backgroundColor: '#E2E8F0', borderRadius: 4, overflow: 'hidden', marginBottom: 10 },
    progressFill: { height: '100%', backgroundColor: PRIMARY_DARK, borderRadius: 4 },
    sectionLabel: { fontSize: 15, fontWeight: '900', color: INK, marginBottom: 10 },
    hint: { fontSize: 13, color: MUTED, lineHeight: 18 },
    peerCard: {
        backgroundColor: '#FFF',
        borderRadius: 22,
        padding: 22,
        alignItems: 'center',
        marginBottom: 16,
        gap: 8,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    peerName: { fontSize: 20, fontWeight: '900', color: INK },
    peerCardHint: { fontSize: 13, color: MUTED, fontWeight: '600' },
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
    peerRowMeta: { fontSize: 12, color: MUTED, fontWeight: '600', marginTop: 2 },
    peerRowMetaDone: { color: SUCCESS },
    donePill: {
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: '#DCFCE7',
        alignItems: 'center',
        justifyContent: 'center',
    },
    ratePill: {
        backgroundColor: '#EFF6FF',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 10,
    },
    ratePillText: { color: PRIMARY_DARK, fontWeight: '800', fontSize: 12 },
    questionCard: {
        flexDirection: 'row',
        gap: 12,
        backgroundColor: '#FFF',
        borderRadius: 18,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    qNum: {
        width: 26,
        height: 26,
        borderRadius: 13,
        backgroundColor: '#EFF6FF',
        overflow: 'hidden',
        textAlign: 'center',
        lineHeight: 26,
        fontSize: 13,
        fontWeight: '900',
        color: PRIMARY_DARK,
    },
    q: { fontSize: 15, fontWeight: '800', color: INK, marginBottom: 10 },
    optionalHint: { fontSize: 12, color: '#94A3B8', fontWeight: '600', marginTop: -6, marginBottom: 8 },
    row: { flexDirection: 'row', gap: 10 },
    rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    choice: {
        flex: 1,
        backgroundColor: '#F8FAFC',
        borderRadius: 14,
        paddingVertical: 14,
        alignItems: 'center',
        borderWidth: 1.5,
        borderColor: '#E2E8F0',
    },
    choiceYes: { backgroundColor: SUCCESS, borderColor: SUCCESS },
    choiceNo: { backgroundColor: DANGER, borderColor: DANGER },
    choiceText: { fontWeight: '800', color: MUTED },
    choiceTextOn: { color: '#FFF' },
    starsRow: { flexDirection: 'row', gap: 6, marginBottom: 6 },
    starBtn: { padding: 2 },
    starLabel: { fontSize: 13, fontWeight: '800', color: GOLD, marginTop: 4 },
    starLabelMuted: { fontSize: 12, fontWeight: '600', color: '#94A3B8', marginTop: 4 },
    chip: {
        backgroundColor: '#F8FAFC',
        borderRadius: 20,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    chipPos: { backgroundColor: SUCCESS, borderColor: SUCCESS },
    chipNeg: { backgroundColor: DANGER, borderColor: DANGER },
    chipText: { fontSize: 13, fontWeight: '700', color: '#475569' },
    chipTextOn: { color: '#FFF' },
    infoBanner: {
        flexDirection: 'row',
        gap: 8,
        alignItems: 'flex-start',
        backgroundColor: '#F8FAFC',
        borderRadius: 12,
        padding: 12,
        marginBottom: 8,
    },
    infoBannerText: { flex: 1, fontSize: 13, color: MUTED, fontWeight: '600', lineHeight: 18 },
    primaryBtn: {
        marginTop: 16,
        backgroundColor: PRIMARY_DARK,
        borderRadius: 16,
        paddingVertical: 16,
        alignItems: 'center',
    },
    primaryBtnDisabled: { opacity: 0.45 },
    primaryBtnText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
});

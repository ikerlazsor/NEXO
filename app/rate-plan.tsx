import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDelayedVisible } from '../lib/useDelayedVisible';
import {
    ActivityIndicator,
    BackHandler,
    FlatList,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PlanImage } from '../components/PlanImage';
import { PressScale } from '../components/PressScale';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { trackFunnel } from '../lib/analytics';
import { getAuthUser } from '../lib/auth';
import { useAppTheme, useThemedStyles } from '../lib/appTheme';
import { hapticCelebrate, hapticLight, hapticSelection, hapticSuccess } from '../lib/haptics';
import { useT } from '../lib/i18n';
import { Alert } from '../lib/nexoAlert';
import { dismissPushForRating } from '../lib/presentedPush';
import { notifyCompliment } from '../lib/push';
import {
    EMPTY_RATING_DRAFT,
    MAX_ASPECTS,
    MAX_PEOPLE_RATINGS_COMPACT,
    NEGATIVE_ASPECTS,
    ORGANIZER_NEGATIVE_ASPECTS,
    ORGANIZER_POSITIVE_ASPECTS,
    POSITIVE_ASPECTS,
    STAR_LABEL_KEYS,
    addPlanToHistory,
    applyAttendanceConfirmedOptimistic,
    applyRatingFlowCompleteOptimistic,
    dismissRatingWithoutHistory,
    ensurePlanInHistory,
    findMutualSpark,
    getAspectLabel,
    getPendingRatingPlans,
    hasRatingSessionStarted,
    isOrganizerDraftComplete,
    isPersonDraftComplete,
    markRatingSessionStarted,
    submitValoracion,
    undoAttendanceSkip,
    type PendingRatingPlan,
    type RatingDraft,
    type RatingPeer,
    type Repetiria,
} from '../lib/ratings';
import { formatCountdown, resolveRatingUiPhase } from '../lib/planLifecycle';
import { resolvePlanImageSource } from '../lib/sports';
import { storageThumbUrl } from '../lib/storageImage';
import { type ThemeColors } from '../theme';
import { ScreenErrorBoundary } from '../components/ScreenErrorBoundary';

const GOLD = '#F59E0B';
const ACTION_BLUE = '#2563EB';
const INK = '#0F172A';
/** Tamaño de la burbuja en la pantalla de valorar a alguien. */
const PERSON_AVATAR = 200;
/** Tamaño de las caras de la lista: la miniatura ya está en caché al abrir el perfil. */
const FACE_AVATAR = 64;
type Stage = 'attendance' | 'org' | 'list' | 'person' | 'skipped';
function draftFromRepeat(key: Repetiria): RatingDraft {
    return {
        asistencia: true,
        puntuacion_general: key === 'si' ? 5 : key === 'no' ? 2 : 3,
        repetiria_experiencia: key,
        aspectos_positivos: key === 'no' ? [] : [],
        aspectos_negativos: key === 'no' ? [] : [],
    };
}

function ratingErrorCopy(t: (key: string) => string, error: string | null | undefined): string {
    if (error === 'not_participant') return t('ratings.errNotParticipant');
    if (error === 'incomplete_rating') return t('ratings.errIncomplete');
    return t('ratings.saveError');
}

function orderedSearchPeers(plan: PendingRatingPlan | null): RatingPeer[] {
    if (!plan) return [];
    const all = plan.searchPeers ?? [];
    if (all.length === 0) return [];
    const order = plan.peerRankIds ?? all.map((p) => p.id);
    const byId = new Map(all.map((p) => [p.id, p]));
    const sorted: RatingPeer[] = [];
    for (const id of order) {
        const peer = byId.get(id);
        if (peer) sorted.push(peer);
    }
    for (const peer of all) {
        if (!sorted.some((p) => p.id === peer.id)) sorted.push(peer);
    }
    return sorted;
}

export default function RatePlanScreen() {
    return (
        <ScreenErrorBoundary>
            <RatePlanScreenInner />
        </ScreenErrorBoundary>
    );
}

function RatePlanScreenInner() {
    const router = useRouter();
    const { t } = useT();
    const insets = useSafeAreaInsets();
    const { colors } = useAppTheme();
    const styles = useThemedStyles(createRatePlanStyles);
    const scrollRef = useRef<ScrollView>(null);
    const attendanceLockRef = useRef(false);
    const flowStartedRef = useRef(false);
    const leavingRef = useRef(false);
    const loadGenRef = useRef(0);
    const ratedIdsRef = useRef<Set<string>>(new Set());
    const { planId } = useLocalSearchParams<{ planId: string }>();

    const [loading, setLoading] = useState(true);
    const showRatingLoader = useDelayedVisible(loading);
    const [saving, setSaving] = useState(false);
    const [sparkPeer, setSparkPeer] = useState<RatingPeer | null>(null);
    const [userId, setUserId] = useState<string | null>(null);
    const [plan, setPlan] = useState<PendingRatingPlan | null>(null);
    const [stage, setStage] = useState<Stage>('attendance');
    const [selectedPeer, setSelectedPeer] = useState<RatingPeer | null>(null);
    const [draft, setDraft] = useState<RatingDraft>(EMPTY_RATING_DRAFT);
    const [ratedIds, setRatedIds] = useState<Set<string>>(new Set());
    ratedIdsRef.current = ratedIds;
    const [orgRated, setOrgRated] = useState(false);
    const [nowTick, setNowTick] = useState(() => Date.now());
    const [leaving, setLeaving] = useState(false);
    const [capNotice, setCapNotice] = useState(false);

    const applyPlan = useCallback((found: PendingRatingPlan | null, resetFlow: boolean, attendedAlready = false) => {
        setPlan(found);
        const nextRated = new Set(found?.ratedIds ?? []);
        ratedIdsRef.current = nextRated;
        setRatedIds(nextRated);
        setOrgRated(found?.organizerRated === true);
        if (resetFlow) {
            setSelectedPeer(null);
            setDraft(EMPTY_RATING_DRAFT);
            const skipAttendance = attendedAlready && !!found;
            attendanceLockRef.current = skipAttendance;
            flowStartedRef.current = skipAttendance;
            if (skipAttendance && found) {
                setStage(found.organizer && found.organizerRated !== true ? 'org' : 'list');
            } else {
                setStage('attendance');
            }
        }
    }, []);

    const load = useCallback(async (opts?: { silent?: boolean }) => {
        if (leavingRef.current) return;
        const gen = ++loadGenRef.current;
        if (!opts?.silent) setLoading(true);
        try {
            const user = await getAuthUser();
            if (!user || gen !== loadGenRef.current || leavingRef.current) return;
            setUserId(user.id);

            const pick = (plans: PendingRatingPlan[]) =>
                plans.find((p) => p.planId === planId && p.phase === 'open')
                ?? plans.find((p) => p.planId === planId && p.phase === 'waiting')
                ?? null;

            const attendedAlready = async (found: PendingRatingPlan | null) => {
                if (!found) return false;
                if ((found.ratedIds?.length ?? 0) > 0) return true;
                if (found.organizerRated === true) return true;
                return hasRatingSessionStarted(user.id, found.planId);
            };

            // Cache primero → botones usables sin esperar red.
            const cached = await getPendingRatingPlans(user.id);
            if (gen !== loadGenRef.current || leavingRef.current) return;
            const cachedFound = pick(cached);
            if (cachedFound && !flowStartedRef.current) {
                applyPlan(cachedFound, true, await attendedAlready(cachedFound));
                setLoading(false);
                trackFunnel('rating_start', { userId: user.id, props: { planId: cachedFound.planId } });
            }

            const plans = await getPendingRatingPlans(user.id, { force: !opts?.silent });
            if (gen !== loadGenRef.current || leavingRef.current) return;
            const found = pick(plans);
            if (flowStartedRef.current) {
                // Usuario ya avanzó: actualizar datos sin volver a "¿fuiste?".
                if (found) {
                    setPlan(found);
                    setRatedIds((prev) => {
                        const next = new Set(found.ratedIds ?? []);
                        for (const id of prev) next.add(id);
                        ratedIdsRef.current = next;
                        return next;
                    });
                    setOrgRated((prev) => prev || found.organizerRated === true);
                }
            } else {
                applyPlan(found, true, await attendedAlready(found));
                if (found && !cachedFound) {
                    trackFunnel('rating_start', { userId: user.id, props: { planId: found.planId } });
                }
            }
        } finally {
            if (gen === loadGenRef.current && !leavingRef.current) setLoading(false);
        }
    }, [planId, applyPlan]);

    useFocusEffect(
        useCallback(() => {
            if (planId && typeof planId === 'string') dismissPushForRating(planId);
            void load({ silent: flowStartedRef.current });
            return () => {
                loadGenRef.current += 1;
            };
        }, [planId, load]),
    );

    useEffect(() => {
        if (!plan || resolveRatingUiPhase(plan) !== 'waiting') return;
        const id = setInterval(() => setNowTick(Date.now()), 1000);
        return () => clearInterval(id);
    }, [plan?.planId, plan?.unlockAt]);

    useEffect(() => {
        scrollRef.current?.scrollTo({ y: 0, animated: false });
    }, [stage, selectedPeer?.id]);

    const listPeers = useMemo(() => orderedSearchPeers(plan), [plan]);

    const ratedCount = ratedIds.size;
    const canSubmitOrg = isOrganizerDraftComplete(draft);
    const canSubmitPerson = isPersonDraftComplete(draft);

    const goBackSafe = useCallback(() => {
        if (leavingRef.current) return;
        leavingRef.current = true;
        loadGenRef.current += 1;
        setCapNotice(false);
        setSparkPeer(null);
        setLeaving(true);
        requestAnimationFrame(() => {
            try {
                if (router.canGoBack()) router.back();
                else router.replace('/my-plans');
            } catch {
                router.replace('/my-plans');
            }
        });
    }, [router]);

    const goAfterAttendance = () => {
        if (plan?.organizer && !orgRated) setStage('org');
        else setStage('list');
    };

    const confirmAttendance = () => {
        if (!userId || !plan || resolveRatingUiPhase(plan) === 'waiting') return;
        if (attendanceLockRef.current) {
            goAfterAttendance();
            return;
        }
        attendanceLockRef.current = true;
        flowStartedRef.current = true;
        // UI primero: nada síncrono pesado antes (congelaba / expulsaba).
        goAfterAttendance();
        hapticSuccess();
        const uid = userId;
        const pid = plan.planId;
        const planSnap = plan;
        try {
            applyAttendanceConfirmedOptimistic(uid, planSnap);
        } catch {
            /* ya avanzó de pantalla */
        }
        void (async () => {
            try {
                await markRatingSessionStarted(uid, pid);
                // skipBump: el contador ya subió en applyAttendanceConfirmedOptimistic.
                const { error } = await ensurePlanInHistory(uid, pid, { skipBump: true });
                if (error) {
                    Alert.alert(t('profile.error'), t('ratings.saveError'));
                }
            } catch {
                Alert.alert(t('profile.error'), t('ratings.saveError'));
            }
        })();
    };

    const finishAndArchive = () => {
        if (!userId || !plan) {
            goBackSafe();
            return;
        }
        const uid = userId;
        const pid = plan.planId;
        const rated = ratedIds.size;
        // Cache + flag local YA; navegar en el mismo tick. Red después.
        applyRatingFlowCompleteOptimistic(uid, pid);
        goBackSafe();
        void (async () => {
            try {
                const { error } = await addPlanToHistory(uid, pid);
                if (error) {
                    Alert.alert(t('profile.error'), t('ratings.saveError'));
                    return;
                }
                trackFunnel('rating_complete', {
                    userId: uid,
                    props: { planId: pid, rated },
                });
            } catch {
                Alert.alert(t('profile.error'), t('ratings.saveError'));
            }
        })();
    };

    const skipAttendance = () => {
        if (!userId || !plan || attendanceLockRef.current) return;
        if (resolveRatingUiPhase(plan) === 'waiting') return;
        attendanceLockRef.current = true;
        flowStartedRef.current = true;
        applyRatingFlowCompleteOptimistic(userId, plan.planId, { skipped: true });
        setStage('skipped');
        hapticLight();
        void dismissRatingWithoutHistory(userId, plan.planId);
    };

    const undoSkip = () => {
        if (!userId || !plan) return;
        attendanceLockRef.current = false;
        flowStartedRef.current = false;
        hapticLight();
        setDraft(EMPTY_RATING_DRAFT);
        setStage('attendance');
        void undoAttendanceSkip(userId, plan.planId);
    };

    const openPeer = (peer: RatingPeer, opts?: { allowRerate?: boolean }) => {
        if (ratedIdsRef.current.has(peer.id) && !opts?.allowRerate) return;
        if (!opts?.allowRerate && ratedIdsRef.current.size >= MAX_PEOPLE_RATINGS_COMPACT) {
            hapticLight();
            setCapNotice(true);
            return;
        }
        hapticSelection();
        setSelectedPeer(peer);
        setDraft(EMPTY_RATING_DRAFT);
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

    const submitOrg = () => {
        if (!userId || !plan?.organizer || !canSubmitOrg || saving) return;
        const uid = userId;
        const pid = plan.planId;
        const orgId = plan.organizer.id;
        const payload = { ...draft, asistencia: true as const };
        hapticSuccess();
        setSaving(true);
        setOrgRated(true);
        setDraft(EMPTY_RATING_DRAFT);
        setStage('list');
        void (async () => {
            try {
                await markRatingSessionStarted(uid, pid);
                const { error: histError } = await ensurePlanInHistory(uid, pid, { skipBump: true });
                if (histError) {
                    setOrgRated(false);
                    Alert.alert(t('profile.error'), t('ratings.saveError'));
                    return;
                }
                const { error } = await submitValoracion({
                    planId: pid,
                    evaluadorId: uid,
                    evaluadoId: orgId,
                    draft: payload,
                    tipo: 'organizacion',
                });
                if (error) {
                    setOrgRated(false);
                    Alert.alert(t('profile.error'), ratingErrorCopy(t, error));
                    return;
                }
                const pos = (payload.aspectos_positivos ?? []).filter(Boolean);
                if (pos.length > 0) {
                    notifyCompliment({ toUserId: orgId, planId: pid, trait: pos[0] });
                }
            } catch {
                setOrgRated(false);
                Alert.alert(t('profile.error'), t('ratings.saveError'));
            } finally {
                setSaving(false);
            }
        })();
    };

    const submitCurrent = () => {
        if (!userId || !plan || !selectedPeer || !canSubmitPerson || saving) return;
        const uid = userId;
        const pid = plan.planId;
        const peer = selectedPeer;
        const payload = {
            ...draft,
            aspectos_positivos: [...draft.aspectos_positivos],
            aspectos_negativos: [...draft.aspectos_negativos],
        };
        hapticSuccess();
        setSaving(true);
        const nextRated = new Set(ratedIds);
        nextRated.add(peer.id);
        ratedIdsRef.current = nextRated;
        setRatedIds(nextRated);
        setSelectedPeer(null);
        setDraft(EMPTY_RATING_DRAFT);
        setStage('list');
        void (async () => {
            try {
                await markRatingSessionStarted(uid, pid);
                const { error: histError } = await ensurePlanInHistory(uid, pid, { skipBump: true });
                if (histError) {
                    setRatedIds((prev) => {
                        const next = new Set(prev);
                        next.delete(peer.id);
                        ratedIdsRef.current = next;
                        return next;
                    });
                    Alert.alert(t('profile.error'), t('ratings.saveError'));
                    return;
                }
                const { error } = await submitValoracion({
                    planId: pid,
                    evaluadorId: uid,
                    evaluadoId: peer.id,
                    draft: payload,
                });
                if (error) {
                    setRatedIds((prev) => {
                        const next = new Set(prev);
                        next.delete(peer.id);
                        ratedIdsRef.current = next;
                        return next;
                    });
                    Alert.alert(t('profile.error'), ratingErrorCopy(t, error));
                    return;
                }
                if (payload.aspectos_positivos.length > 0) {
                    notifyCompliment({
                        toUserId: peer.id,
                        planId: pid,
                        trait: payload.aspectos_positivos[0],
                    });
                }
                if (payload.repetiria_experiencia === 'si') {
                    try {
                        const mutual = await findMutualSpark(pid, uid, peer.id);
                        if (mutual) {
                            hapticCelebrate();
                            setSparkPeer(peer);
                        }
                    } catch {
                        /* ignore */
                    }
                }
            } catch {
                setRatedIds((prev) => {
                    const next = new Set(prev);
                    next.delete(peer.id);
                    ratedIdsRef.current = next;
                    return next;
                });
                Alert.alert(t('profile.error'), t('ratings.saveError'));
            } finally {
                setSaving(false);
            }
        })();
    };

    const closePersonSheet = () => {
        setSelectedPeer(null);
        setDraft(EMPTY_RATING_DRAFT);
        setStage('list');
    };

    const onHeaderBack = () => {
        if (capNotice) {
            setCapNotice(false);
            return;
        }
        if (sparkPeer) {
            setSparkPeer(null);
            return;
        }
        if (stage === 'skipped') {
            void undoSkip();
            return;
        }
        if (stage === 'person') {
            closePersonSheet();
            return;
        }
        goBackSafe();
    };

    useFocusEffect(
        useCallback(() => {
            const sub = BackHandler.addEventListener('hardwareBackPress', () => {
                if (capNotice) {
                    setCapNotice(false);
                    return true;
                }
                if (sparkPeer) {
                    setSparkPeer(null);
                    return true;
                }
                if (stage === 'skipped') {
                    void undoSkip();
                    return true;
                }
                if (stage === 'person') {
                    closePersonSheet();
                    return true;
                }
                goBackSafe();
                return true;
            });
            return () => sub.remove();
        }, [stage, undoSkip, capNotice, sparkPeer, goBackSafe]),
    );

    const renderFace = ({ item: peer }: { item: RatingPeer }) => {
        const done = ratedIds.has(peer.id);
        return (
            <PressScale
                disabled={done}
                onPress={() => openPeer(peer)}
                style={styles.faceCell}
            >
                <View style={[styles.faceRing, done && styles.faceRingOn]}>
                    <ProfileAvatar uri={peer.avatar_url} name={peer.nombre} size={64} />
                    {done ? (
                        <View style={styles.faceCheck}>
                            <Ionicons name="checkmark" size={16} color="#FFF" />
                        </View>
                    ) : null}
                </View>
                <Text style={styles.faceName} numberOfLines={2}>{peer.nombre}</Text>
            </PressScale>
        );
    };

    if (leaving) {
        return <View style={[styles.container, { paddingTop: insets.top }]} />;
    }

    if (loading && !showRatingLoader) {
        return <View style={[styles.container, { paddingTop: insets.top }]} />;
    }

    if (loading) {
        return (
            <View style={[styles.center, { paddingTop: insets.top }]}>
                <ActivityIndicator color={ACTION_BLUE} size="large" />
                <Text style={styles.loadingText}>{t('ratings.loading')}</Text>
            </View>
        );
    }

    if (!plan) {
        return (
            <View style={[styles.center, { paddingTop: insets.top }]}>
                <View style={styles.emptyIcon}>
                    <Ionicons name="sparkles-outline" size={32} color={colors.textMuted} />
                </View>
                <Text style={styles.empty}>{t('ratings.noneOpen')}</Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={goBackSafe}>
                    <Text style={styles.primaryBtnText}>{t('common.back')}</Text>
                </TouchableOpacity>
            </View>
        );
    }

    const waiting = resolveRatingUiPhase(plan, nowTick) === 'waiting';
    const cover = resolvePlanImageSource(plan.imagen_url);

    const renderHero = (subtitle?: string) => (
        <View style={styles.hero}>
            <PlanImage source={cover} style={styles.heroImg} recyclingKey={plan.planId} thumbWidth={440} />
            <LinearGradient
                colors={['rgba(15,23,42,0.08)', 'rgba(15,23,42,0.82)']}
                style={StyleSheet.absoluteFill}
            />
            <View style={styles.heroCopy}>
                <View style={styles.heroBadge}>
                    <Ionicons name="star" size={12} color={GOLD} />
                    <Text style={styles.heroBadgeText}>{t('ratings.closeKicker')}</Text>
                </View>
                <Text style={styles.heroTitle} numberOfLines={2}>{plan.titulo}</Text>
                {subtitle ? <Text style={styles.heroSub}>{subtitle}</Text> : null}
            </View>
        </View>
    );

    const aspectLabel = (kind: 'pos' | 'neg', key: string) =>
        getAspectLabel(kind, key, selectedPeer?.genero, t);

    const renderAspectBoard = (
        title: string,
        list: 'aspectos_positivos' | 'aspectos_negativos',
        kind: 'pos' | 'neg',
        keys: readonly string[],
    ) => {
        const selected = draft[list];
        const positive = kind === 'pos';
        return (
            <View style={styles.sheetCard}>
                <View style={styles.aspectHead}>
                    <Text style={styles.aspectTitle}>{title}</Text>
                    <Text style={styles.aspectMax}>{t('ratings.aspectMax')}</Text>
                </View>
                <View style={styles.aspectDeck}>
                    {keys.map((key) => {
                        const on = selected.includes(key);
                        return (
                            <PressScale
                                key={key}
                                haptic={false}
                                pressedScale={0.96}
                                style={[
                                    styles.aspectCard,
                                    positive ? styles.aspectPosIdle : styles.aspectNegIdle,
                                    on && (positive ? styles.aspectPosOn : styles.aspectNegOn),
                                ]}
                                onPress={() => toggleAspect(list, key)}
                            >
                                <Text
                                    style={[
                                        styles.aspectCardText,
                                        positive ? styles.aspectPosText : styles.aspectNegText,
                                        on && styles.aspectTextOn,
                                    ]}
                                >
                                    {aspectLabel(kind, key)}
                                </Text>
                            </PressScale>
                        );
                    })}
                </View>
            </View>
        );
    };

    return (
        <View style={styles.container}>
            <LinearGradient
                colors={['#EEF4FF', colors.backgroundAlt]}
                style={StyleSheet.absoluteFill}
            />
            <View
                pointerEvents="box-none"
                style={[styles.header, { paddingTop: insets.top + 2 }]}
            >
                <TouchableOpacity onPress={onHeaderBack} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={24} color={colors.text} />
                </TouchableOpacity>
            </View>

            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
            {stage === 'list' ? (
                <FlatList
                    data={listPeers}
                    keyExtractor={(peer) => peer.id}
                    numColumns={4}
                    renderItem={renderFace}
                    initialNumToRender={16}
                    maxToRenderPerBatch={12}
                    windowSize={6}
                    removeClippedSubviews={Platform.OS === 'android'}
                    columnWrapperStyle={styles.faceRow}
                    contentContainerStyle={[
                        styles.content,
                        { paddingBottom: insets.bottom + 28, paddingTop: insets.top + 50 },
                    ]}
                    ListHeaderComponent={
                        <View style={styles.sheetCard}>
                            <Text style={styles.sheetTitle}>{t('ratings.highlightTitle')}</Text>
                            <Text style={styles.sheetHint}>{t('ratings.highlightHint')}</Text>
                        </View>
                    }
                    ListFooterComponent={
                        <TouchableOpacity style={styles.primaryBtn} onPress={finishAndArchive}>
                            <Text style={styles.primaryBtnText}>
                                {ratedCount === 0 ? t('ratings.finishWithoutRating') : t('ratings.finish')}
                            </Text>
                        </TouchableOpacity>
                    }
                />
            ) : (
            <ScrollView
                ref={scrollRef}
                contentContainerStyle={[
                    styles.content,
                    {
                        paddingBottom: insets.bottom + 28,
                        paddingTop:
                            stage === 'person' || stage === 'skipped'
                                ? insets.top + 4
                                : insets.top + 72,
                    },
                ]}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                {stage === 'attendance' && waiting && (
                    <>
                        {renderHero()}
                        <View style={styles.sheetCard}>
                            <Text style={styles.sheetTitle}>{t('ratings.waitingTitle')}</Text>
                            <Text style={styles.sheetHint}>
                                {t('ratings.unlockIn', { time: formatCountdown(plan.unlockAt - nowTick) })}
                            </Text>
                            <TouchableOpacity style={styles.primaryBtn} onPress={goBackSafe}>
                                <Text style={styles.primaryBtnText}>{t('common.back')}</Text>
                            </TouchableOpacity>
                        </View>
                    </>
                )}

                {stage === 'attendance' && !waiting && (
                    <>
                        {renderHero()}
                        <View style={styles.sheetCard}>
                            <Text style={styles.sheetTitle}>{t('ratings.attendedPlanQ')}</Text>
                            <View style={styles.choiceRow}>
                                <Pressable
                                    style={({ pressed }) => [
                                        styles.choiceBtn,
                                        styles.choiceBtnYes,
                                        pressed && styles.choiceBtnPressed,
                                    ]}
                                    onPress={confirmAttendance}
                                    hitSlop={8}
                                >
                                    <Ionicons name="checkmark-circle" size={22} color="#FFF" />
                                    <Text style={styles.choiceBtnTextOn}>{t('ratings.attendedPlanYes')}</Text>
                                </Pressable>
                                <Pressable
                                    style={({ pressed }) => [
                                        styles.choiceBtn,
                                        styles.choiceBtnNo,
                                        pressed && styles.choiceBtnPressed,
                                    ]}
                                    onPress={skipAttendance}
                                    hitSlop={8}
                                >
                                    <Ionicons name="close-circle-outline" size={22} color={colors.textMuted} />
                                    <Text style={styles.choiceBtnText}>{t('ratings.attendedPlanNo')}</Text>
                                </Pressable>
                            </View>
                        </View>
                    </>
                )}

                {stage === 'skipped' && (
                    <View style={styles.sheetCard}>
                        <View style={styles.skippedIcon}>
                            <Ionicons name="information-circle-outline" size={28} color={colors.textMuted} />
                        </View>
                        <Text style={styles.sheetTitle}>{t('ratings.attendedPlanNo')}</Text>
                        <Text style={styles.sheetHint}>{t('ratings.notAttendedMsg')}</Text>
                        <TouchableOpacity style={styles.primaryBtn} onPress={goBackSafe} disabled={saving}>
                            <Text style={styles.primaryBtnText}>{t('common.ok')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.skipLink} onPress={() => void undoSkip()}>
                            <Text style={styles.undoText}>{t('ratings.undoDidNotGo')}</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {stage === 'org' && (
                    <>
                        {renderHero(t('ratings.orgHint'))}
                        <Text style={styles.anonPill}>{t('ratings.anonymous')}</Text>

                        <View style={styles.sheetCard}>
                            <Text style={styles.sheetTitle}>{t('ratings.orgStarsQ')}</Text>
                            <View style={styles.starsRow}>
                                {[1, 2, 3, 4, 5].map((n) => (
                                    <PressScale
                                        key={n}
                                        onPress={() => {
                                            hapticSelection();
                                            setDraft((d) => ({ ...d, asistencia: true, puntuacion_general: n }));
                                        }}
                                        hitSlop={8}
                                        style={styles.starBtn}
                                        pressedScale={0.82}
                                        minTouch={false}
                                        haptic={false}
                                        bounceKey={draft.puntuacion_general === n ? n : null}
                                    >
                                        <Ionicons
                                            name={draft.puntuacion_general >= n ? 'star' : 'star-outline'}
                                            size={38}
                                            color={draft.puntuacion_general >= n ? GOLD : colors.borderStrong}
                                        />
                                    </PressScale>
                                ))}
                            </View>
                            {draft.puntuacion_general > 0 ? (
                                <Text style={styles.starLabel}>{t(STAR_LABEL_KEYS[draft.puntuacion_general - 1])}</Text>
                            ) : null}
                        </View>

                        {draft.puntuacion_general >= 1 ? (
                            <>
                                <View style={styles.sheetCard}>
                                    <Text style={styles.q}>{t('ratings.orgPositivesQ')}</Text>
                                    <View style={styles.rowWrap}>
                                        {ORGANIZER_POSITIVE_ASPECTS.map((key) => {
                                            const on = draft.aspectos_positivos.includes(key);
                                            return (
                                                <TouchableOpacity
                                                    key={key}
                                                    style={[styles.chip, on && styles.chipPos]}
                                                    onPress={() => toggleAspect('aspectos_positivos', key)}
                                                >
                                                    <Text style={[styles.chipText, on && styles.chipTextOn]}>
                                                        {t(`ratings.orgPos.${key}`)}
                                                    </Text>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                </View>
                                <View style={styles.sheetCard}>
                                    <Text style={styles.q}>{t('ratings.orgNegativesQ')}</Text>
                                    <View style={styles.rowWrap}>
                                        {ORGANIZER_NEGATIVE_ASPECTS.map((key) => {
                                            const on = draft.aspectos_negativos.includes(key);
                                            return (
                                                <TouchableOpacity
                                                    key={key}
                                                    style={[styles.chip, on && styles.chipNeg]}
                                                    onPress={() => toggleAspect('aspectos_negativos', key)}
                                                >
                                                    <Text style={[styles.chipText, on && styles.chipTextOn]}>
                                                        {t(`ratings.orgNeg.${key}`)}
                                                    </Text>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                </View>
                            </>
                        ) : null}

                        <TouchableOpacity
                            style={[styles.primaryBtn, (!canSubmitOrg || saving) && styles.primaryBtnDisabled]}
                            onPress={() => void submitOrg()}
                            disabled={!canSubmitOrg || saving}
                        >
                            {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>{t('ratings.next')}</Text>}
                        </TouchableOpacity>
                    </>
                )}

                {stage === 'person' && selectedPeer && (
                    <>
                        <View style={styles.personHero}>
                            <ProfileAvatar
                                uri={selectedPeer.avatar_url}
                                name={selectedPeer.nombre}
                                size={PERSON_AVATAR}
                                recyclingKey={selectedPeer.id}
                                placeholderUri={storageThumbUrl(selectedPeer.avatar_url, FACE_AVATAR) ?? selectedPeer.avatar_url}
                            />
                            <Text style={styles.peerName}>{selectedPeer.nombre}</Text>
                        </View>

                        <View style={styles.sheetCard}>
                            <Text style={styles.sheetTitle}>{t('ratings.repeatQ')}</Text>
                            <View style={styles.choiceRow}>
                                {([
                                    ['si', t('ratings.repeatYes'), 'heart'],
                                    ['no', t('ratings.repeatNo'), 'close'],
                                ] as [Repetiria, string, 'heart' | 'close'][]).map(([key, label, icon]) => {
                                    const on = draft.repetiria_experiencia === key;
                                    const yes = key === 'si';
                                    return (
                                        <TouchableOpacity
                                            key={key}
                                            style={[
                                                styles.choiceBtn,
                                                yes ? styles.choiceYesIdle : styles.choiceNoIdle,
                                                on && (yes ? styles.choiceYesOn : styles.choiceNoOn),
                                            ]}
                                            onPress={() => {
                                                hapticSelection();
                                                setDraft({
                                                    ...draftFromRepeat(key),
                                                    aspectos_positivos: [],
                                                    aspectos_negativos: [],
                                                });
                                            }}
                                        >
                                            <Ionicons
                                                name={icon}
                                                size={20}
                                                color={on ? '#FFF' : yes ? '#166534' : '#B91C1C'}
                                            />
                                            <Text
                                                style={[
                                                    styles.choiceBtnText,
                                                    yes ? styles.aspectPosText : styles.aspectNegText,
                                                    on && styles.choiceBtnTextOn,
                                                ]}
                                            >
                                                {label}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        </View>

                        {draft.repetiria_experiencia === 'si' || draft.repetiria_experiencia === 'no' ? (
                            <>
                                {renderAspectBoard(
                                    t('ratings.positivesQ'),
                                    'aspectos_positivos',
                                    'pos',
                                    POSITIVE_ASPECTS,
                                )}
                                {renderAspectBoard(
                                    t('ratings.negativesQ'),
                                    'aspectos_negativos',
                                    'neg',
                                    NEGATIVE_ASPECTS,
                                )}
                            </>
                        ) : null}

                        {draft.repetiria_experiencia === 'si' || draft.repetiria_experiencia === 'no' ? (
                            <TouchableOpacity
                                style={[styles.primaryBtn, (!canSubmitPerson || saving) && styles.primaryBtnDisabled]}
                                onPress={() => void submitCurrent()}
                                disabled={!canSubmitPerson || saving}
                            >
                                {saving ? (
                                    <ActivityIndicator color="#FFF" />
                                ) : (
                                    <Text style={styles.primaryBtnText}>{t('ratings.savedPerson')}</Text>
                                )}
                            </TouchableOpacity>
                        ) : null}
                    </>
                )}
            </ScrollView>
            )}
            </KeyboardAvoidingView>
            {sparkPeer ? (
                <View style={styles.sparkOverlay}>
                    <View style={styles.sparkCard}>
                        <View style={styles.sparkHalo}>
                            <ProfileAvatar
                                uri={sparkPeer.avatar_url}
                                name={sparkPeer.nombre}
                                size={96}
                                recyclingKey={`spark-${sparkPeer.id}`}
                            />
                        </View>
                        <Text style={styles.sparkTitle}>{t('ratings.sparkTitle')}</Text>
                        <Text style={styles.sparkBody}>
                            {t('ratings.sparkBody', { name: sparkPeer.nombre })}
                        </Text>
                        <TouchableOpacity style={styles.sparkLaterBtn} onPress={() => setSparkPeer(null)}>
                            <Text style={styles.sparkLaterText}>{t('ratings.sparkLater')}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            ) : null}
            {capNotice ? (
                <Pressable style={styles.sparkOverlay} onPress={() => setCapNotice(false)}>
                    <Pressable style={styles.sparkCard} onPress={(e) => e.stopPropagation()}>
                        <Text style={styles.sparkTitle}>{t('ratings.peopleCapTitle')}</Text>
                        <Text style={styles.sparkBody}>
                            {t('ratings.peopleCapBody', { n: MAX_PEOPLE_RATINGS_COMPACT })}
                        </Text>
                        <TouchableOpacity style={styles.primaryBtn} onPress={() => setCapNotice(false)}>
                            <Text style={styles.primaryBtnText}>{t('common.ok')}</Text>
                        </TouchableOpacity>
                    </Pressable>
                </Pressable>
            ) : null}
        </View>
    );
}

function createRatePlanStyles(c: ThemeColors) {
    const MUTED = c.textMuted;
    const SURFACE = c.surface;
    const BORDER = c.border;
    return StyleSheet.create({
        container: { flex: 1, backgroundColor: c.backgroundAlt },
        center: {
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            backgroundColor: c.backgroundAlt,
        },
        loadingText: { marginTop: 12, color: MUTED, fontWeight: '600' },
        emptyIcon: {
            width: 64,
            height: 64,
            borderRadius: 20,
            backgroundColor: SURFACE,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 12,
        },
        empty: { color: MUTED, fontWeight: '600', marginBottom: 16, textAlign: 'center' },
        header: {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 5,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 12,
            paddingBottom: 0,
            gap: 12,
        },
        backBtn: {
            width: 42,
            height: 42,
            borderRadius: 14,
            backgroundColor: SURFACE,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: BORDER,
        },
        headerProgressWrap: { flex: 1, gap: 6 },
        headerProgressLabel: { fontSize: 12, fontWeight: '800', color: MUTED, textAlign: 'right' },
        headerProgressTrack: {
            height: 6,
            borderRadius: 999,
            backgroundColor: c.surfaceSubtle,
            overflow: 'hidden',
        },
        headerProgressFill: {
            height: '100%',
            borderRadius: 999,
            backgroundColor: ACTION_BLUE,
        },
        content: { paddingHorizontal: 20 },
        hero: {
            height: 220,
            borderRadius: 24,
            overflow: 'hidden',
            marginBottom: 16,
            backgroundColor: c.surfaceSubtle,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.6)',
        },
        heroImg: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
        heroCopy: { flex: 1, justifyContent: 'flex-end', padding: 20 },
        heroBadge: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            alignSelf: 'flex-start',
            backgroundColor: 'rgba(255,255,255,0.18)',
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: 999,
            marginBottom: 10,
        },
        heroBadgeText: { color: '#FFF', fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
        heroTitle: { color: '#FFF', fontSize: 24, fontWeight: '900', lineHeight: 30 },
        heroSub: { color: 'rgba(255,255,255,0.82)', fontSize: 13, fontWeight: '600', marginTop: 6 },
        sheetCard: {
            backgroundColor: SURFACE,
            borderRadius: 22,
            padding: 20,
            marginBottom: 14,
            borderWidth: 1,
            borderColor: BORDER,
            shadowColor: '#0F172A',
            shadowOpacity: 0.06,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 8 },
            elevation: 3,
        },
        sheetTitle: { fontSize: 22, fontWeight: '900', color: INK, marginBottom: 8, lineHeight: 28 },
        sheetHint: { fontSize: 14, color: MUTED, lineHeight: 21, fontWeight: '600', marginBottom: 16 },
        footerHint: {
            fontSize: 12,
            color: MUTED,
            lineHeight: 18,
            fontWeight: '600',
            textAlign: 'center',
            marginTop: 8,
            marginBottom: 4,
        },
        choiceRow: { flexDirection: 'row', gap: 10 },
        choiceBtn: {
            flex: 1,
            minHeight: 56,
            borderRadius: 16,
            borderWidth: 1.5,
            borderColor: BORDER,
            backgroundColor: c.surfaceSubtle,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 8,
            paddingHorizontal: 10,
        },
        choiceBtnYes: { backgroundColor: ACTION_BLUE, borderColor: ACTION_BLUE },
        choiceBtnNo: { backgroundColor: SURFACE },
        choiceBtnPressed: { opacity: 0.86, transform: [{ scale: 0.98 }] },
        choiceBtnText: { fontSize: 14, fontWeight: '800', color: INK },
        choiceBtnTextOn: { fontSize: 14, fontWeight: '800', color: '#FFF' },
        anonPill: {
            alignSelf: 'center',
            fontSize: 12,
            fontWeight: '700',
            color: MUTED,
            marginBottom: 12,
        },
        anonPillInline: {
            alignSelf: 'flex-start',
            fontSize: 11,
            fontWeight: '800',
            color: ACTION_BLUE,
            backgroundColor: c.primarySoft,
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: 999,
            overflow: 'hidden',
            marginBottom: 14,
        },
        skipLink: { alignItems: 'center', paddingVertical: 16 },
        undoText: { color: ACTION_BLUE, fontWeight: '700', fontSize: 14 },
        skippedIcon: {
            width: 56,
            height: 56,
            borderRadius: 18,
            backgroundColor: c.surfaceSubtle,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 12,
        },
        search: {
            backgroundColor: SURFACE,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: BORDER,
            paddingHorizontal: 14,
            paddingVertical: 12,
            fontSize: 15,
            fontWeight: '600',
            color: INK,
            marginBottom: 10,
        },
        searchResults: { marginBottom: 12 },
        faceRow: {
            marginHorizontal: -8,
        },
        faceCell: {
            flex: 1,
            alignItems: 'center',
            paddingHorizontal: 8,
            marginBottom: 18,
        },
        faceRing: {
            borderRadius: 999,
            padding: 3,
            borderWidth: 3,
            borderColor: 'transparent',
            position: 'relative',
        },
        faceRingOn: { borderColor: '#1D4ED8' },
        faceCheck: {
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: 26,
            height: 26,
            borderRadius: 13,
            backgroundColor: '#1D4ED8',
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: '#FFF',
        },
        faceTapHint: {
            position: 'absolute',
            right: 2,
            bottom: 2,
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: INK,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: SURFACE,
        },
        faceName: { marginTop: 8, fontSize: 13, fontWeight: '800', color: INK, textAlign: 'center' },
        faceMore: {
            width: 76,
            height: 76,
            borderRadius: 38,
            backgroundColor: c.surfaceSubtle,
            borderWidth: 1,
            borderColor: BORDER,
            alignItems: 'center',
            justifyContent: 'center',
        },
        faceMoreText: { fontSize: 16, fontWeight: '800', color: MUTED },
        personHero: {
            alignItems: 'center',
            marginBottom: 16,
            gap: 10,
        },
        choiceYesIdle: { backgroundColor: '#F0FDF4', borderColor: '#86EFAC' },
        choiceYesOn: { backgroundColor: '#16A34A', borderColor: '#14532D' },
        choiceNoIdle: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
        choiceNoOn: { backgroundColor: '#DC2626', borderColor: '#7F1D1D' },
        aspectHead: {
            flexDirection: 'row',
            alignItems: 'baseline',
            flexWrap: 'wrap',
            gap: 6,
            marginBottom: 10,
        },
        aspectTitle: { fontSize: 15, fontWeight: '800', color: INK },
        aspectMax: { fontSize: 13, fontWeight: '700', color: MUTED },
        aspectDeck: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
        },
        aspectCard: {
            borderRadius: 999,
            paddingHorizontal: 12,
            paddingVertical: 7,
            borderWidth: 1.5,
            alignItems: 'center',
            justifyContent: 'center',
        },
        aspectPosIdle: { backgroundColor: '#F0FDF4', borderColor: '#86EFAC' },
        aspectPosOn: { backgroundColor: '#16A34A', borderColor: '#14532D' },
        aspectNegIdle: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
        aspectNegOn: { backgroundColor: '#DC2626', borderColor: '#7F1D1D' },
        aspectPosText: { color: '#166534' },
        aspectNegText: { color: '#B91C1C' },
        aspectTextOn: { color: '#FFF' },
        aspectCardText: {
            fontSize: 13,
            fontWeight: '800',
            textAlign: 'center',
        },
        peerName: { fontSize: 24, fontWeight: '900', color: INK, textAlign: 'center' },
        peerRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            backgroundColor: SURFACE,
            borderRadius: 16,
            padding: 12,
            marginBottom: 8,
            borderWidth: 1,
            borderColor: BORDER,
        },
        peerRowName: { fontSize: 15, fontWeight: '800', color: INK },
        q: { fontSize: 15, fontWeight: '800', color: INK, marginBottom: 10 },
        rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
        starsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 6 },
        starBtn: { padding: 2 },
        starLabel: { fontSize: 13, fontWeight: '800', color: GOLD, marginTop: 4, textAlign: 'center' },
        chip: {
            backgroundColor: c.surfaceSubtle,
            borderRadius: 20,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderWidth: 1,
            borderColor: BORDER,
        },
        chipPos: { backgroundColor: ACTION_BLUE, borderColor: ACTION_BLUE },
        chipNeg: { backgroundColor: c.danger, borderColor: c.danger },
        chipText: { fontSize: 13, fontWeight: '700', color: MUTED },
        chipTextOn: { color: '#FFF' },
        sparkOverlay: {
            ...StyleSheet.absoluteFillObject,
            backgroundColor: 'rgba(15,23,42,0.55)',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 28,
            zIndex: 20,
        },
        sparkCard: {
            width: '100%',
            backgroundColor: SURFACE,
            borderRadius: 28,
            paddingHorizontal: 24,
            paddingTop: 28,
            paddingBottom: 20,
            alignItems: 'center',
        },
        sparkHalo: {
            width: 112,
            height: 112,
            borderRadius: 56,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#FEF3C7',
            marginBottom: 14,
        },
        sparkTitle: { fontSize: 26, fontWeight: '900', color: INK, textAlign: 'center' },
        sparkBody: {
            marginTop: 8,
            fontSize: 15,
            fontWeight: '600',
            color: MUTED,
            textAlign: 'center',
            lineHeight: 22,
        },
        sparkLaterBtn: { marginTop: 18, paddingVertical: 10 },
        sparkLaterText: { color: MUTED, fontWeight: '700', fontSize: 14 },
        primaryBtn: {
            marginTop: 4,
            borderRadius: 16,
            paddingVertical: 16,
            alignItems: 'center',
            backgroundColor: ACTION_BLUE,
        },
        primaryBtnDisabled: { opacity: 0.45 },
        primaryBtnText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
        savedBurst: {
            width: 56,
            height: 56,
            borderRadius: 18,
            backgroundColor: '#FEF3C7',
            alignItems: 'center',
            justifyContent: 'center',
            alignSelf: 'center',
            marginBottom: 12,
        },
    });
}

import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import {
    Ionicons } from '@expo/vector-icons';
import {
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react';
import { FlashList } from '@shopify/flash-list';
import {
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Alert } from '../lib/nexoAlert';
import { useThemedStyles, useAppTheme } from '../lib/appTheme';
import { type ThemeColors } from '../theme';
import { MyPlanListRow } from '../components/MyPlanListRow';
import { NexoEmptyState } from '../components/ui/NexoState';
import { MyPlansSkeletonList } from '../components/SkeletonShimmer';
import { useListScrollRestore } from '../hooks/useListScrollRestore';
import { prefetchPlanDetail, seedPlanDetailFromFeed } from '../lib/planDetailCache';
import { seedChatThreadPeek } from '../lib/prefetchChats';
import { useT } from '../lib/i18n';
import { FLASH_LIST_DRAW_DISTANCE } from '../lib/listConfig';
import { getAuthUser } from '../lib/auth';
import { useAuthSession } from '../lib/authSession';
import { GuestLockedPanel } from '../components/GuestLockedPanel';
import { useChromeHeaderLayout } from '../components/MainChrome';
import {
    acceptPlanJoinRequest,
    invalidatePlanJoinRequestCaches,
    rejectPlanJoinRequest,
} from '../lib/planJoinRequests';
import { dismissPushForMyPlans } from '../lib/presentedPush';
import { hapticLight, hapticSelection, hapticSuccess, hapticError } from '../lib/haptics';
import { type Genero } from '../lib/profileFields';
import { formatCountdown, resolveRatingUiPhase } from '../lib/planLifecycle';
import { subscribeMyPlanHide } from '../lib/myPlansHide';
import { subscribeRatingSession, type PendingRatingPlan } from '../lib/ratings';
import { fetchMyPlansSnapshot, type MyPlanItem } from '../lib/myPlansQuery';
import { ScreenKeys } from '../lib/screenState';
import { diskSet } from '../lib/diskCache';
import { screenCacheKey, ScreenCacheTTL } from '../lib/screenCaches';
import { cacheGetStale, cacheIsFresh, cacheSet } from '../lib/ttlCache';

type PlanItem = MyPlanItem;

export default function MyPlansScreen() {
    const router = useRouter();
    const { t, lang } = useT();
    const styles = useThemedStyles(createMyPlansStyles);
    const { colors } = useAppTheme();
    const { isGuest, userId } = useAuthSession();
    const chrome = useChromeHeaderLayout();
    const cachedMyPlans = userId
        ? cacheGetStale<{
            plans: PlanItem[];
            pendingCount: number;
            ratingByPlan: Record<string, PendingRatingPlan>;
        }>(screenCacheKey.myPlans(userId))
        : null;
    const [loading, setLoading] = useState(() => !cachedMyPlans);
    const [loadError, setLoadError] = useState(false);
    const [plans, setPlans] = useState<PlanItem[]>(() => cachedMyPlans?.plans ?? []);
    const [pendingCount, setPendingCount] = useState(() => cachedMyPlans?.pendingCount ?? 0);
    const [ratingByPlan, setRatingByPlan] = useState<Record<string, PendingRatingPlan>>(
        () => cachedMyPlans?.ratingByPlan ?? {},
    );
    const [userGenero, setUserGenero] = useState<Genero | null>(null);
    const [nowTick, setNowTick] = useState(() => Date.now());
    const hasDataRef = useRef(!!cachedMyPlans);
    const fetchGenRef = useRef(0);
    const { listRef, onScroll, scrollEventThrottle } = useListScrollRestore<PlanItem>(ScreenKeys.MY_PLANS);

    useEffect(() => {
        if (!userId) return;
        const cached = cacheGetStale<{
            plans: PlanItem[];
            pendingCount: number;
            ratingByPlan: Record<string, PendingRatingPlan>;
        }>(screenCacheKey.myPlans(userId));
        if (cached && !hasDataRef.current) {
            setPlans(cached.plans ?? []);
            setPendingCount(cached.pendingCount ?? 0);
            setRatingByPlan(cached.ratingByPlan ?? {});
            hasDataRef.current = true;
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        if (!userId) return;
        const unsubRating = subscribeRatingSession((evt) => {
            if (evt.userId !== userId) return;
            if (evt.type === 'removed') {
                setRatingByPlan((prev) => {
                    if (!(evt.planId in prev)) return prev;
                    const next = { ...prev };
                    delete next[evt.planId];
                    return next;
                });
            }
        });
        const unsubHide = subscribeMyPlanHide((evt) => {
            if (evt.userId !== userId) return;
            if (evt.type === 'my-list') {
                setPlans((prev) => prev.filter((p) => p.id !== evt.planId));
                setRatingByPlan((prev) => {
                    if (!(evt.planId in prev)) return prev;
                    const next = { ...prev };
                    delete next[evt.planId];
                    return next;
                });
            }
        });
        return () => {
            unsubRating();
            unsubHide();
        };
    }, [userId]);

    const locale = lang === 'en' ? 'en-GB' : 'es-ES';

    const fetchMyPlans = useCallback(async (opts?: { force?: boolean; silent?: boolean }) => {
        const gen = ++fetchGenRef.current;
        try {
            const user = await getAuthUser();
            if (!user) {
                setLoading(false);
                return;
            }

            const cacheKey = screenCacheKey.myPlans(user.id);
            const cached = cacheGetStale<{
                plans: PlanItem[];
                pendingCount: number;
                ratingByPlan: Record<string, PendingRatingPlan>;
            }>(cacheKey);
            if (cached && !hasDataRef.current && (cached.plans?.length ?? 0) > 0) {
                setPlans(cached.plans ?? []);
                setPendingCount(cached.pendingCount ?? 0);
                setRatingByPlan(cached.ratingByPlan ?? {});
                hasDataRef.current = true;
                setLoading(false);
            } else if (!hasDataRef.current && !opts?.silent) {
                setLoading(true);
            }

            // Con force (al enfocar) siempre vamos a red.
            if (!opts?.force && cacheIsFresh(cacheKey) && hasDataRef.current && (cached?.plans?.length ?? 0) > 0) {
                setLoading(false);
                return;
            }

            const loaded = await fetchMyPlansSnapshot(user.id, { applyHidden: true, forceRatings: true });
            if (gen !== fetchGenRef.current) return;

            setUserGenero(loaded.userGenero ?? null);
            setPendingCount(loaded.pendingCount);
            setRatingByPlan(loaded.ratingByPlan);
            setPlans(loaded.plans);
            hasDataRef.current = true;
            const snap = {
                plans: loaded.plans,
                pendingCount: loaded.pendingCount,
                ratingByPlan: loaded.ratingByPlan,
            };
            cacheSet(cacheKey, snap, ScreenCacheTTL.myPlans);
            void diskSet(cacheKey, snap);
            setLoadError(false);
        } catch (e) {
            if (__DEV__) console.error(e);
            if (!hasDataRef.current) setLoadError(true);
        } finally {
            if (gen === fetchGenRef.current) setLoading(false);
        }
    }, [router]);

    useFocusEffect(
        useCallback(() => {
            dismissPushForMyPlans();
            void fetchMyPlans({ silent: hasDataRef.current, force: false });
        }, [fetchMyPlans]),
    );

    useEffect(() => {
        if (!Object.values(ratingByPlan).some((p) => resolveRatingUiPhase(p, nowTick) === 'waiting')) return;
        const id = setInterval(() => setNowTick(Date.now()), 1000);
        return () => clearInterval(id);
    }, [ratingByPlan]);

    const syncMyPlansCache = useCallback((nextPlans: PlanItem[], nextPendingCount: number) => {
        if (!userId) return;
        const key = screenCacheKey.myPlans(userId);
        const snap = { plans: nextPlans, pendingCount: nextPendingCount, ratingByPlan };
        cacheSet(key, snap, ScreenCacheTTL.myPlans);
        void diskSet(key, snap);
    }, [userId, ratingByPlan]);

    const handleAccept = useCallback((planId: string, userId: string) => {
        const plan = plans.find((p) => p.id === planId);
        if (!plan) return;
        if (plan.joinedCount >= plan.maximo_participantes) {
            Alert.alert(t('profile.error'), t('myplans.full'));
            return;
        }
        hapticSuccess();

        let snapshot: PlanItem | undefined;
        const nextPendingCount = Math.max(0, pendingCount - 1);
        setPlans((prev) => {
            const next = prev.map((p) => {
                if (p.id !== planId) return p;
                snapshot = p;
                return {
                    ...p,
                    pending: p.pending.filter((u) => u.id !== userId),
                    joinedCount: p.joinedCount + 1,
                };
            });
            syncMyPlansCache(next, nextPendingCount);
            return next;
        });
        setPendingCount(nextPendingCount);

        void (async () => {
            const result = await acceptPlanJoinRequest(planId, userId, plan.maximo_participantes);
            if (!result.ok) {
                if (snapshot) {
                    setPlans((prev) => {
                        const restored = prev.map((p) => (p.id === planId ? snapshot! : p));
                        syncMyPlansCache(restored, pendingCount);
                        return restored;
                    });
                    setPendingCount(pendingCount);
                }
                hapticError();
                Alert.alert(
                    t('profile.error'),
                    result.code === 'full'
                        ? t('myplans.full')
                        : result.code === 'rls'
                          ? t('myplans.rlsHint')
                          : result.error,
                );
                return;
            }
            void getAuthUser().then((u) => {
                if (u) invalidatePlanJoinRequestCaches(u.id, planId);
            });
        })();
    }, [plans, pendingCount, syncMyPlansCache, t]);

    const handleReject = useCallback((planId: string, userId: string) => {
        hapticLight();
        let snapshot: PlanItem | undefined;
        const nextPendingCount = Math.max(0, pendingCount - 1);
        setPlans((prev) => {
            const next = prev.map((p) => {
                if (p.id !== planId) return p;
                snapshot = p;
                return {
                    ...p,
                    pending: p.pending.filter((u) => u.id !== userId),
                };
            });
            syncMyPlansCache(next, nextPendingCount);
            return next;
        });
        setPendingCount(nextPendingCount);

        void rejectPlanJoinRequest(planId, userId).then(({ ok, error }) => {
            if (!ok) {
                if (snapshot) {
                    setPlans((prev) => {
                        const restored = prev.map((p) => (p.id === planId ? snapshot! : p));
                        syncMyPlansCache(restored, pendingCount);
                        return restored;
                    });
                    setPendingCount(pendingCount);
                }
                Alert.alert(t('profile.error'), error || t('profile.error'));
                return;
            }
            void getAuthUser().then((u) => {
                if (u) invalidatePlanJoinRequestCaches(u.id, planId);
            });
        });
    }, [pendingCount, syncMyPlansCache, t]);

    const handleOpenPlan = useCallback((item: PlanItem) => {
        hapticSelection();
        seedPlanDetailFromFeed(item as unknown as Record<string, unknown>);
        prefetchPlanDetail(item.id);
        router.push({ pathname: '/plan/[id]', params: { id: item.id, from: 'my-plans' } });
    }, [router]);

    const handleOpenChat = useCallback((planId: string) => {
        const item = plans.find((p) => p.id === planId);
        seedChatThreadPeek(userId, {
            id: planId,
            title: item?.titulo ?? '',
            image_url: item?.imagen_url ?? null,
            kind: 'plan',
            creadorId: item?.creador_id,
            fechaEvento: item?.fecha_evento,
        });
        router.push(`/chat/${planId}`);
    }, [router, plans, userId]);

    const handleOpenRate = useCallback((planId: string) => {
        router.push({ pathname: '/rate-plan', params: { planId } });
    }, [router]);

    const handleOpenProfile = useCallback((userId: string) => {
        router.push({ pathname: '/user-profile/[id]', params: { id: userId } });
    }, [router]);

    const renderPlan = useCallback(({ item, index }: { item: PlanItem; index: number }) => {
        const rating = ratingByPlan[item.id];
        const ratedDone = rating ? rating.totalPeers - rating.pendingCount : 0;

        return (
            <MyPlanListRow
                item={item}
                showUpcomingHeader={!item.isPast && index === 0}
                showPastHeader={item.isPast && (index === 0 || !plans[index - 1]?.isPast)}
                pastHeaderExtraMargin={index > 0}
                upcomingLabel={t('myplans.upcoming')}
                pastLabel={t('myplans.past')}
                rating={rating}
                locale={locale}
                joinedLabel={t(userGenero === 'femenino' ? 'myplans.joinedF' : 'myplans.joined')}
                requestsTitle={t('myplans.requests', { n: item.pending.length })}
                viewProfileLabel={t('myplans.viewProfile')}
                fullHint={t('myplans.full')}
                closePlanLabel={t('myplans.closePlan')}
                rateProgressLabel={
                    rating
                        ? t('myplans.rateProgress', { done: ratedDone, total: rating.totalPeers })
                        : ''
                }
                rateUnlockLabel={
                    rating && resolveRatingUiPhase(rating, nowTick) === 'waiting'
                        ? t('ratings.unlockIn', {
                              time: formatCountdown(Math.max(0, rating.unlockAt - nowTick)),
                          })
                        : undefined
                }
                nowTick={nowTick}
                onOpenPlan={handleOpenPlan}
                onOpenChat={handleOpenChat}
                onOpenRate={handleOpenRate}
                onOpenProfile={handleOpenProfile}
                onAccept={handleAccept}
                onReject={handleReject}
            />
        );
    }, [
        plans,
        ratingByPlan,
        nowTick,
        userGenero,
        locale,
        t,
        handleOpenPlan,
        handleOpenChat,
        handleOpenRate,
        handleOpenProfile,
        handleAccept,
        handleReject,
    ]);

    if (isGuest) {
        return (
            <View style={styles.container}>
                <View
                    style={[
                        styles.pageHeader,
                        {
                            paddingTop: chrome.headerTop,
                            height: chrome.headerTop + chrome.headerRowHeight,
                            paddingRight: chrome.headerRight,
                        },
                    ]}
                >
                    <View style={styles.pageTitleWrap}>
                        <TouchableOpacity
                            onPress={() => router.back()}
                            hitSlop={12}
                            style={{ marginRight: 8, paddingVertical: 4 }}
                            accessibilityLabel={t('common.back')}
                        >
                            <Ionicons name="chevron-back" size={26} color={colors.text} />
                        </TouchableOpacity>
                        <Text style={styles.pageTitle}>{t('myplans.title')}</Text>
                    </View>
                </View>
                <GuestLockedPanel intent={{ type: 'my-plans' }} />
            </View>
        );
    }

    return (
            <View style={styles.container}>
                <View
                    style={[
                        styles.pageHeader,
                        {
                            paddingTop: chrome.headerTop,
                            height: chrome.headerTop + chrome.headerRowHeight,
                            paddingRight: chrome.headerRight,
                        },
                    ]}
                >
                    <View style={styles.pageTitleWrap}>
                        <TouchableOpacity
                            onPress={() => router.back()}
                            hitSlop={12}
                            style={{ marginRight: 8, paddingVertical: 4 }}
                            accessibilityLabel={t('common.back')}
                        >
                            <Ionicons name="chevron-back" size={26} color={colors.text} />
                        </TouchableOpacity>
                        <Text style={styles.pageTitle}>{t('myplans.title')}</Text>
                        {pendingCount > 0 && (
                            <View style={styles.headerBadge}>
                                <Text style={styles.headerBadgeText}>
                                    {pendingCount > 9 ? '9+' : pendingCount}
                                </Text>
                            </View>
                        )}
                    </View>
                </View>

                <View style={{ flex: 1 }}>
                    {loading && plans.length === 0 ? (
                        <MyPlansSkeletonList count={5} />
                    ) : (
                        <FlashList
                            ref={listRef}
                            style={{ flex: 1 }}
                            data={plans}
                            extraData={pendingCount}
                            keyExtractor={(item) => item.id}
                            renderItem={renderPlan}
                            getItemType={(item) => (item.isPast ? 'past' : item.role)}
                            showsVerticalScrollIndicator={false}
                            onScroll={onScroll}
                            scrollEventThrottle={scrollEventThrottle}
                            drawDistance={FLASH_LIST_DRAW_DISTANCE}
                            contentContainerStyle={styles.list}
                            ListEmptyComponent={
                                !loading ? (
                                    <NexoEmptyState
                                        icon={loadError ? 'cloud-offline-outline' : 'calendar-outline'}
                                        title={loadError ? t('myplans.loadError') : t('myplans.empty')}
                                        actionLabel={loadError ? t('myplans.retry') : t('feed.create')}
                                        onAction={() => {
                                            if (loadError) {
                                                setLoadError(false);
                                                void fetchMyPlans({ force: true });
                                            } else {
                                                router.push('/create-plan');
                                            }
                                        }}
                                        style={{ paddingTop: 48 }}
                                    />
                                ) : null
                            }
                        />
                    )}
                </View>
            </View>
    );
}

function createMyPlansStyles(c: ThemeColors) {
    const INK = c.text;
    const PRIMARY_DARK = c.primary;
    const MUTED = c.textMuted;
    return StyleSheet.create({
    container: { flex: 1, backgroundColor: 'transparent' },
    pageHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 20,
        marginBottom: 8,
    },
    pageTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    pageTitle: { fontSize: 22, fontWeight: '900', color: INK },
    headerBadge: {
        minWidth: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: c.primary,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 6,
    },
    headerBadgeText: { color: c.onPrimary, fontSize: 11, fontWeight: '800' },
    list: { paddingHorizontal: 20, paddingBottom: 148, paddingTop: 6 },
    sectionLabel: {
        fontSize: 12,
        fontWeight: '800',
        color: MUTED,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        marginBottom: 10,
        marginLeft: 2,
    },
    card: {
        backgroundColor: c.surface,
        borderRadius: 22,
        padding: 16,
        marginBottom: 16,
        elevation: 5,
        shadowColor: '#000',
        shadowOpacity: 0.14,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 8 },
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
    },
    cardPast: { opacity: 0.96 },
    cardHeader: { flexDirection: 'row', alignItems: 'center' },
    thumb: { width: 54, height: 54, borderRadius: 16, backgroundColor: c.surfaceSubtle },
    cardTitle: { fontSize: 16, fontWeight: '800', color: INK },
    memberTag: {
        backgroundColor: c.primarySoft,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 8,
        marginLeft: 4,
    },
    memberTagText: { fontSize: 10, fontWeight: '800', color: PRIMARY_DARK, textTransform: 'uppercase' },
    dateText: { fontSize: 12, fontWeight: '600', color: MUTED, marginTop: 3 },
    rateChip: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        marginTop: 8,
        backgroundColor: c.primarySoft,
        borderWidth: 1,
        borderColor: c.primaryBorder,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 10,
    },
    rateChipText: { fontSize: 12, fontWeight: '800', color: PRIMARY_DARK },
    countRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
    countText: { fontSize: 13, fontWeight: '700', color: PRIMARY_DARK },
    chatBtn: {
        width: 40,
        height: 40,
        borderRadius: 14,
        backgroundColor: c.surfaceSubtle,
        justifyContent: 'center',
        alignItems: 'center',
    },
    requestsBlock: { marginTop: 14, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    requestsTitle: {
        fontSize: 12,
        fontWeight: '800',
        color: PRIMARY_DARK,
        textTransform: 'uppercase',
        letterSpacing: 0.3,
        marginBottom: 10,
    },
    requestRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
    requestUser: { flexDirection: 'row', alignItems: 'center', flex: 1 },
    reqAvatar: { width: 42, height: 42, borderRadius: 21, marginRight: 10, backgroundColor: c.surfaceSubtle },
    reqName: { fontSize: 15, fontWeight: '700', color: INK },
    reqHint: { fontSize: 12, color: PRIMARY_DARK, fontWeight: '600', marginTop: 1 },
    reqActions: { flexDirection: 'row', gap: 8 },
    reqBtn: { width: 38, height: 38, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
    reqReject: { backgroundColor: c.dangerSoft },
    fullHint: { fontSize: 12, color: '#B45309', marginTop: 4 },
    center: { alignItems: 'center', marginTop: 70, paddingHorizontal: 30 },
    emptyIconWrap: {
        width: 110,
        height: 110,
        borderRadius: 55,
        backgroundColor: c.surface,
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 4,
        shadowColor: PRIMARY_DARK,
        shadowOpacity: 0.15,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        marginBottom: 20,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
    },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: INK, marginBottom: 20 },
    exploreBtn: { backgroundColor: PRIMARY_DARK, paddingHorizontal: 22, paddingVertical: 14, borderRadius: 16 },
    exploreBtnText: { color: c.onPrimary, fontWeight: '700' },
    });
}

/*
pantalla principal / home feed de planes
*/
import {
    Ionicons
} from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react';
import {
    AppState,
    Dimensions,
    Modal,
    Platform,
    Pressable,
    RefreshControl,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
    type AppStateStatus,
    type ViewToken
} from 'react-native';
import Animated, {
    cancelAnimation,
    Easing,
    Extrapolation,
    interpolate,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import {
    Gesture,
    GestureDetector,
    GestureHandlerRootView,
    ScrollView as GHScrollView,
} from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useChromeHeaderLayout } from '../../components/MainChrome';
import { PlanCard, type Membership } from '../../components/PlanCard';
import { FeedHeartBurstHost } from '../../components/FeedHeartBurstHost';
import { PressScale } from '../../components/PressScale';
import { FeedSkeletonList } from '../../components/SkeletonShimmer';
import { EmptySearch } from '../../features/feed/EmptyFeedState';
import {
    asStringArray,
    DATE_KEYS,
    smoothScrollListToTop,
    toDayKey,
    toggleInList,
} from '../../features/feed/feedModel';
import { createFeedStyles } from '../../features/feed/feedStyles';
import { useListScrollRestore } from '../../hooks/useListScrollRestore';
import { useAppTheme, useThemedStyles } from '../../lib/appTheme';
import { getAuthUser } from '../../lib/auth';
import { useAuthSession } from '../../lib/authSession';
import {
    MAIN_CATEGORY_COLORS,
    MAIN_CATEGORY_ICONS,
    MAIN_CATEGORY_IDS,
    resolvePlanCategories,
    resolvePlanSport,
    SUBCATEGORIES,
    type MainCategoryId,
} from '../../lib/categories';
import { deletePlanCompletely } from '../../lib/deletePlan';
import { diskRemove, diskSet } from '../../lib/diskCache';
import {
    emptyFeedTaste,
    feedFitPercent,
    type FeedTaste,
} from '../../lib/feedAffinity';
import {
    FEED_CACHE_KEY,
    FEED_CACHE_TTL_MS,
    type FeedSnapshot,
} from '../../lib/feedCache';
import { emptyGuestFeedSnapshot, fetchSignedInFeedSnapshot } from '../../lib/feedLoad';
import { attachFeedPlanPeople, fetchMoreFeedPlanRows, fetchSearchFeedPlans, type FeedMoreCursor } from '../../lib/feedQuery';
import {
    applyStickyInviteClears,
    applyStickyPlanDeletes,
    consumeFeedNeedsRefresh,
    consumeFeedNeedsRefreshUrgent,
    markFeedNeedsRefresh,
    mergeStickyCreatedPlan,
    mergeStickyMembershipMap,
    noteFeedMembershipPatch,
    subscribeFeedHomeRetap,
    subscribeFeedRefreshSignal,
    takeFeedInviteClears,
    takeFeedMembershipPatches,
    takeFeedPlanDeletes,
    takeOptimisticFeedPlan,
} from '../../lib/feedReload';
import { expandSearchQuery, planMatchesSearch } from '../../lib/feedSearch';
import { buildFeedRows, type FeedRow as SocialFeedRow } from '../../lib/feedSections';
import { consumeFirstRunPending } from '../../lib/firstRun';
import { rememberFriendsSet } from '../../lib/friendStatusPeek';
import { distanceKm, formatDistanceKm, parsePlanCoords } from '../../lib/geo';
import { fetchGuestFeedPlans } from '../../lib/guestFeed';
import { hapticError, hapticSave, hapticSelection, hapticSuccess } from '../../lib/haptics';
import { useT } from '../../lib/i18n';
import { FLASH_LIST_DRAW_DISTANCE } from '../../lib/listConfig';
import { getUserCoords, peekUserCoords, type UserCoords } from '../../lib/location';
import { broadcastPlanMembership } from '../../lib/membershipBroadcast';
import { deletePlanAdmin } from '../../lib/moderation';
import { getIsOnline } from '../../lib/network';
import { Alert } from '../../lib/nexoAlert';
import {
    persistJoinWithWaitlistFallback,
    persistLeave,
    persistSave,
    subscribeSaveState,
} from '../../lib/offlineActions';
import { peekViewerIsOrganizer, rememberViewerIsOrganizer } from '../../lib/organizer';
import { ownerActionsVisible } from '../../lib/ownerSecretActions';
import {
    canJoinWaitlist,
    membershipFromJoinEstado,
    promoteWaitlist,
    resolveJoinEstado
} from '../../lib/participants';
import {
    prefetchPlanDetail,
    seedPlanDetailFromFeed,
    syncPlanDetailParticipantsFromFeed,
} from '../../lib/planDetailCache';
import { prefetchTournamentLineup } from '../../lib/tournamentLineupCache';
import { isPlanActiveForFeed, runPlanLifecycleMaintenance } from '../../lib/planLifecycle';
import { canJoinMorePlans, countLocalActivePlans, MAX_ACTIVE_PLANS } from '../../lib/planLimits';
import { canSeePlanInFeed } from '../../lib/planVisibility';
import { type Genero } from '../../lib/profileFields';
import { ensureAutoProfilePlace } from '../../lib/profilePlace';
import { withRetry } from '../../lib/retry';
import { fetchAccountAccess } from '../../lib/roles';
import { runWhenIdle } from '../../lib/runWhenIdle';
import { invalidatePlanMembershipCaches } from '../../lib/screenCaches';
import {
    getScreenFilters,
    getScreenScrollOffset,
    ScreenKeys,
    setScreenFilters,
    setScreenScrollOffset,
} from '../../lib/screenState';
import { canJoinPlanByGender, isSoloChicasPlan } from '../../lib/soloChicas';
import { wasKickedFromPlan } from '../../lib/planKicks';
import { supabase } from '../../lib/supabase';
import { cacheGetStale, cacheInvalidate, cacheIsFresh, cacheSet } from '../../lib/ttlCache';
import { prefetchRemoteImages } from '../../lib/prefetchCovers';
import { useDelayedVisible } from '../../lib/useDelayedVisible';
import { prefetchUserProfile, seedUserProfilePeek } from '../../lib/userProfileCache';
import { prefetchPairAffinity } from '../../lib/pairAffinityCache';
import { theme } from '../../theme';
import { EventCard, EventTabs } from '../../features/events/EventCards';
import { useEvents } from '../../features/events/useEvents';
import { rankExternalEvents, interleaveSocialRows } from '../../features/events/ranking';
import type { EventSection, ExternalEvent, EventFilters } from '../../features/events/types';
type FeedRow = SocialFeedRow | {kind:'event';id:string;event:ExternalEvent};
const PRIMARY_DARK = theme.colors.primary;
const INK = theme.colors.text;

export default function HomeScreen() {
    const router = useRouter();
    const { t, lang } = useT();
    const { requireAccount, userId: sessionUserId } = useAuthSession();
    const { colors, scheme } = useAppTheme();
    const styles = useThemedStyles(createFeedStyles);
    const chrome = useChromeHeaderLayout();
    const insets = useSafeAreaInsets();
    const savedFilters = getScreenFilters<{
        search: string;
        selectedFilter: string;
        selectedCategories: string[];
        selectedSubcategory: string | null;
        selectedSubcategories: string[];
        dateFilter: string;
    }>(ScreenKeys.FEED);

    const cachedFeed = cacheGetStale<FeedSnapshot>(FEED_CACHE_KEY);

    const [eventSection, setEventSection] = useState<EventSection>('forYou');
    const [search, setSearch] = useState(savedFilters.search ?? '');
    const [selectedCategories, setSelectedCategories] = useState<string[]>(() => {
        if (Array.isArray(savedFilters.selectedCategories)) {
            return asStringArray(savedFilters.selectedCategories);
        }
        return asStringArray(savedFilters.selectedFilter);
    });
    const [selectedSubcategories, setSelectedSubcategories] = useState<string[]>(() => {
        if (Array.isArray(savedFilters.selectedSubcategories)) {
            return asStringArray(savedFilters.selectedSubcategories);
        }
        return asStringArray(savedFilters.selectedSubcategory);
    });
    const [dateFilter, setDateFilter] = useState(() => {
        const saved = savedFilters.dateFilter ?? 'all';
        return saved === 'month' || saved === 'custom' ? 'all' : saved;
    });
    const [showFiltersModal, setShowFiltersModal] = useState(false);
    const filtersSheetY = useSharedValue(0);
    const filtersScrollY = useSharedValue(0);
    const filtersClosing = useSharedValue(0);
    const filtersSheetHeight = useMemo(() => Dimensions.get('window').height * 0.72, []);

    const finishCloseFiltersModal = useCallback(() => {
        // Dejar el sheet abajo: si reseteamos Y a 0 con el Modal aún visible, parpadea un frame.
        setShowFiltersModal(false);
        filtersClosing.value = 0;
        filtersScrollY.value = 0;
    }, [filtersClosing, filtersScrollY]);

    const openFiltersModal = useCallback(() => {
        cancelAnimation(filtersSheetY);
        filtersClosing.value = 0;
        filtersScrollY.value = 0;
        filtersSheetY.value = filtersSheetHeight;
        setShowFiltersModal(true);
    }, [filtersClosing, filtersScrollY, filtersSheetHeight, filtersSheetY]);

    const closeFiltersModal = useCallback(() => {
        if (!showFiltersModal || filtersClosing.value) return;
        filtersClosing.value = 1;
        cancelAnimation(filtersSheetY);
        filtersSheetY.value = withTiming(
            filtersSheetHeight,
            { duration: 260, easing: Easing.inOut(Easing.cubic) },
            (finished) => {
                if (finished) runOnJS(finishCloseFiltersModal)();
            },
        );
    }, [
        finishCloseFiltersModal,
        filtersClosing,
        filtersSheetHeight,
        filtersSheetY,
        showFiltersModal,
    ]);

    useEffect(() => {
        if (!showFiltersModal) return;
        cancelAnimation(filtersSheetY);
        filtersSheetY.value = withTiming(0, {
            duration: 280,
            easing: Easing.out(Easing.cubic),
        });
    }, [showFiltersModal, filtersSheetY]);

    const filtersSheetStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: filtersSheetY.value }],
    }));

    const filtersBackdropStyle = useAnimatedStyle(() => ({
        opacity: interpolate(
            filtersSheetY.value,
            [0, filtersSheetHeight * 0.85],
            [1, 0],
            Extrapolation.CLAMP,
        ),
    }));

    const filtersPanGesture = useMemo(
        () =>
            Gesture.Pan()
                .activeOffsetY(8)
                .failOffsetX([-32, 32])
                .onUpdate((e) => {
                    if (filtersClosing.value) return;
                    filtersSheetY.value = Math.max(0, e.translationY);
                })
                .onEnd((e) => {
                    if (filtersClosing.value) return;
                    const dismiss = filtersSheetY.value > 100 || e.velocityY > 900;
                    if (dismiss) {
                        filtersClosing.value = 1;
                        const progress = Math.min(
                            1,
                            filtersSheetY.value / Math.max(1, filtersSheetHeight),
                        );
                        const duration = Math.round(200 + (1 - progress) * 100);
                        cancelAnimation(filtersSheetY);
                        filtersSheetY.value = withTiming(
                            filtersSheetHeight,
                            { duration, easing: Easing.inOut(Easing.cubic) },
                            (finished) => {
                                if (finished) runOnJS(finishCloseFiltersModal)();
                            },
                        );
                    } else {
                        filtersSheetY.value = withTiming(0, {
                            duration: 240,
                            easing: Easing.out(Easing.cubic),
                        });
                    }
                }),
        [finishCloseFiltersModal, filtersClosing, filtersSheetHeight, filtersSheetY],
    );

    const [nearbyKm, setNearbyKm] = useState<number | null>(null);
    const [userCoords, setUserCoords] = useState<UserCoords | null>(() => peekUserCoords());
    const [showFirstRun, setShowFirstRun] = useState(false);

    const [plans, setPlans] = useState<any[]>(() => cachedFeed?.plans ?? []);
    const [membershipMap, setMembershipMap] = useState<Record<string, Membership>>(
        () => cachedFeed?.membershipMap ?? {},
    );
    const [savedPlans, setSavedPlans] = useState<string[]>(() => cachedFeed?.savedPlans ?? []);
    const [currentUserId, setCurrentUserId] = useState<string | null>(() => cachedFeed?.currentUserId ?? null);
    const [isOrganizerAccount, setIsOrganizerAccount] = useState(
        () => peekViewerIsOrganizer() || cachedFeed?.isOrganizer === true,
    );
    const [currentUserGenero, setCurrentUserGenero] = useState<Genero | null>(
        () => cachedFeed?.currentUserGenero ?? null,
    );
    const [isOwner, setIsOwner] = useState(false);
    const secretOwnerUx = ownerActionsVisible(isOwner);
    const [loading, setLoading] = useState(() => cachedFeed == null);
    const showFeedSkeleton = useDelayedVisible(loading && plans.length === 0);
    const [refreshing, setRefreshing] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [joiningPlanId, setJoiningPlanId] = useState<string | null>(null);
    const joiningRef = useRef(false);
    const hasDataRef = useRef(cachedFeed != null);
    const [friendIds, setFriendIds] = useState<Set<string>>(
        () => new Set(cachedFeed?.friendIds ?? []),
    );
    const [coincidedIds, setCoincidedIds] = useState<Set<string>>(
        () => new Set(cachedFeed?.coincidedIds ?? []),
    );
    const [invitedPlanIds, setInvitedPlanIds] = useState<Set<string>>(
        () => new Set(cachedFeed?.invitedPlanIds ?? []),
    );
    const [feedTaste, setFeedTaste] = useState<FeedTaste>(
        () => cachedFeed?.feedTaste ?? emptyFeedTaste(),
    );
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMoreFeed, setHasMoreFeed] = useState(true);
    const feedCursorRef = useRef<FeedMoreCursor | null>(null);
    const loadingMoreRef = useRef(false);
    const eventFilters = useMemo<EventFilters>(() => {
        const now = new Date();
        const madridDay = (d: Date) =>
            new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Europe/Madrid',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }).format(d);
        return {
            categories: selectedCategories,
            query: search,
            latitude: userCoords?.latitude,
            longitude: userCoords?.longitude,
            radius: userCoords ? (nearbyKm ?? undefined) : undefined,
            from: dateFilter === 'all' ? undefined : madridDay(now),
            until:
                dateFilter === 'today'
                    ? madridDay(now)
                    : dateFilter === 'week'
                      ? madridDay(new Date(now.getTime() + 7 * 86400000))
                      : undefined,
        };
    }, [selectedCategories, search, userCoords, nearbyKm, dateFilter]);
    const external = useEvents(
        eventFilters,
        sessionUserId,
        eventSection !== 'plans',
    );
    const rankedEvents = useMemo(
        () =>
            rankExternalEvents(
                external.events.slice(0, 90),
                feedTaste,
                external.history,
                userCoords,
            ),
        [external.events, feedTaste, external.history, userCoords],
    );
    const openExternal = useCallback(
        (id: string) => router.push({ pathname: '/event/[id]', params: { id } }),
        [router],
    );
    const joinExternal = useCallback(
        (id: string) => {
            if (requireAccount({ type: 'event', eventId: id })) return;
            if (external.joined.has(id)) {
                openExternal(id);
                return;
            }
            Alert.alert(t('events.join'), t('events.socialNotice'), [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('events.join'),
                    onPress: () => {
                        void external
                            .toggleJoin(id)
                            .catch(() =>
                                Alert.alert(t('feed.error'), t('events.error')),
                            );
                    },
                },
            ]);
        },
        [requireAccount, external, openExternal, t],
    );

    const endReachedLockRef = useRef(false);
    const [searchExpanded, setSearchExpanded] = useState<string[]>([]);
    const [searchHits, setSearchHits] = useState<any[]>([]);
    const plansRef = useRef<any[]>([]);
    const currentUserIdRef = useRef<string | null>(null);
    const friendIdsRef = useRef<Set<string>>(new Set());
    const coincidedIdsRef = useRef<Set<string>>(new Set());
    const requestFeedLoadRef = useRef<(opts?: { refresh?: boolean; skipScrollJump?: boolean; quiet?: boolean }) => void>(() => {});
    const { listRef, onScroll, onListLayout, restoreScroll, scrollEventThrottle } = useListScrollRestore<FeedRow>(
        ScreenKeys.FEED,
        { restoreOnFocus: false },
    );

    const onFeedRefresh = useCallback(() => {
        hapticSelection();
        requestFeedLoadRef.current({ refresh: true });
    }, []);

    useEffect(() => {
        void consumeFirstRunPending().then((pending) => {
            if (pending) setShowFirstRun(true);
        });
        // Solo coords para mapa/distancias; no activar “Cerca” al abrir en frío.
        const hadPeek = !!peekUserCoords();
        void getUserCoords({ requestPermission: false }).then((c) => {
            if (!c) return;
            setUserCoords(c);
            if (!hadPeek) requestFeedLoadRef.current({ skipScrollJump: true });
        });
    }, []);

    const enableNearby = useCallback(async (radius = 10) => {
        const coords = await getUserCoords({ requestPermission: true, force: true });
        if (!coords) {
            Alert.alert(t('feed.error'), t('feed.enableLocation'));
            return;
        }
        setUserCoords(coords);
        setNearbyKm(radius);
        setShowFirstRun(false);
        hapticSelection();
        void getAuthUser().then((u) => {
            if (u?.id) void ensureAutoProfilePlace(u.id);
        });
        requestFeedLoadRef.current({ refresh: true, skipScrollJump: true });
    }, [t]);

    useEffect(() => {
        setScreenFilters(ScreenKeys.FEED, {
            search,
            selectedCategories,
            selectedSubcategories,
            dateFilter,
        });
    }, [search, selectedCategories, selectedSubcategories, dateFilter]);

    useEffect(() => {
        const q = search.trim();
        if (q.length < 2) {
            setSearchExpanded([]);
            setSearchHits([]);
            return;
        }
        let cancelled = false;
        const timer = setTimeout(() => {
            void expandSearchQuery(q).then((terms) => {
                if (!cancelled) setSearchExpanded(terms);
            });
            void fetchSearchFeedPlans(q)
                .then((hits) => {
                    if (!cancelled) setSearchHits(hits);
                })
                .catch(() => {
                    if (!cancelled) setSearchHits([]);
                });
        }, 520);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [search]);

    plansRef.current = plans;
    currentUserIdRef.current = currentUserId;
    friendIdsRef.current = friendIds;
    coincidedIdsRef.current = coincidedIds;

    const fetchData = useCallback(async (opts?: { refresh?: boolean; skipScrollJump?: boolean; quiet?: boolean }) => {
        let finished = false;
        const isRefresh = !!opts?.refresh;
        const quiet = !!opts?.quiet;
        const safetyTimer = setTimeout(() => {
            if (!finished) {
                setLoading(false);
                setRefreshing(false);
            }
        }, 8000);

        try {
            if (isRefresh && !quiet) {
                setRefreshing(true);
            } else if (!hasDataRef.current) {
                setLoading(true);
            }
            setLoadError(false);

            void runPlanLifecycleMaintenance();

            const userId = sessionUserId ?? (await getAuthUser())?.id ?? null;
            setCurrentUserId(userId);
            if (userId) {
                runWhenIdle(() => {
                    void fetchAccountAccess(userId).then((access) => setIsOwner(access.isOwner));
                }, 900);
            } else {
                setIsOwner(false);
            }

            let formattedPlans: any[];
            const coords = peekUserCoords() || userCoords;

            if (!userId) {
                formattedPlans = await withRetry(() => fetchGuestFeedPlans(coords));
            } else {
                const snap = await withRetry(() => fetchSignedInFeedSnapshot(userId, coords));
                formattedPlans = snap.plans;
                setIsOrganizerAccount(snap.isOrganizer);
                rememberViewerIsOrganizer(snap.isOrganizer);
                setCurrentUserGenero(snap.currentUserGenero);
                setFriendIds(new Set(snap.friendIds));
                rememberFriendsSet(snap.friendIds);
                setCoincidedIds(new Set(snap.coincidedIds));
                setInvitedPlanIds(applyStickyInviteClears(snap.invitedPlanIds));
                setMembershipMap(mergeStickyMembershipMap(snap.membershipMap));
                setSavedPlans(snap.savedPlans);
                setFeedTaste(snap.feedTaste);
                const visiblePlans = mergeStickyCreatedPlan(applyStickyPlanDeletes(formattedPlans));
                setPlans(visiblePlans);
                feedCursorRef.current = null;
                setHasMoreFeed(true);
                setLoading(false);
                const cachedSnap = {
                    ...snap,
                    plans: visiblePlans,
                    membershipMap: mergeStickyMembershipMap(snap.membershipMap),
                    invitedPlanIds: [...applyStickyInviteClears(snap.invitedPlanIds)],
                };
                cacheSet(FEED_CACHE_KEY, cachedSnap, FEED_CACHE_TTL_MS);
                void diskSet(FEED_CACHE_KEY, cachedSnap);
                return;
            }

            setPlans(applyStickyPlanDeletes(formattedPlans));
            feedCursorRef.current = null;
            setHasMoreFeed(false); // invitado: un solo lote vía RPC
            setLoading(false);

            const guestSnap: FeedSnapshot = emptyGuestFeedSnapshot(applyStickyPlanDeletes(formattedPlans));
            setIsOrganizerAccount(false);
            rememberViewerIsOrganizer(false);
            setMembershipMap({});
            setSavedPlans([]);
            setCurrentUserGenero(null);
            setFriendIds(new Set());
            setCoincidedIds(new Set());
            setInvitedPlanIds(new Set());
            setFeedTaste(emptyFeedTaste());
            cacheSet(FEED_CACHE_KEY, guestSnap, FEED_CACHE_TTL_MS);
            void diskSet(FEED_CACHE_KEY, guestSnap);
        } catch (error) {
            if (__DEV__) console.log(error);
            // Sin datos en memoria: mostrar error (no fingir “vacío”).
            if (!hasDataRef.current) setLoadError(true);
        } finally {
            finished = true;
            clearTimeout(safetyTimer);
            hasDataRef.current = true;
            setLoading(false);
            setRefreshing(false);
            // Tras recargar, ya se pueden reordenar los planes a los que te uniste.
            if (deferMineSortIdsRef.current.size > 0) {
                deferMineSortIdsRef.current.clear();
                setMineSortEpoch((n) => n + 1);
            }
            if (isRefresh && !opts?.skipScrollJump) {
                setScreenScrollOffset(ScreenKeys.FEED, 0);
                requestAnimationFrame(() => {
                    listRef.current?.scrollToOffset({ offset: 0, animated: false });
                });
            }
        }
    }, [listRef, sessionUserId]);

    const fetchDataRef = useRef(fetchData);
    fetchDataRef.current = fetchData;
    const fetchInFlightRef = useRef(false);
    const pendingFeedRefreshRef = useRef(false);
    const appStateRef = useRef<AppStateStatus>(AppState.currentState);
    const feedFocusedRef = useRef(false);
    const didSessionFeedLoadRef = useRef(false);
    /** Planes a los que te unes: UI “unido” ya, pero sin subir al tope hasta recargar el feed. */
    const deferMineSortIdsRef = useRef<Set<string>>(new Set());
    const [mineSortEpoch, setMineSortEpoch] = useState(0);

    const loadMoreFeed = useCallback(async () => {
        if (loadingMoreRef.current || !hasMoreFeed || loading || refreshing) return;
        if (search.trim() || selectedCategories.length > 0 || selectedSubcategories.length > 0) return;
        const known = plansRef.current;
        if (known.length === 0) return;

        loadingMoreRef.current = true;
        setLoadingMore(true);
        try {
            const nowIso = new Date().toISOString();
            const excludeIds = known.map((p) => String(p.id));
            let extraRaw: Awaited<ReturnType<typeof fetchMoreFeedPlanRows>>['rows'] = [];
            let hasMore = true;
            for (let attempt = 0; attempt < 4 && extraRaw.length === 0 && hasMore; attempt++) {
                const page = await fetchMoreFeedPlanRows({
                    nowIso,
                    excludeIds,
                    cursor: feedCursorRef.current,
                });
                feedCursorRef.current = page.nextCursor;
                hasMore = page.hasMore;
                extraRaw = page.rows;
                for (const row of page.rows) excludeIds.push(String(row.id));
            }
            if (extraRaw.length === 0) {
                setHasMoreFeed(hasMore);
                return;
            }
            // Diferir el trabajo pesado para no trabar el scroll al llegar al final.
            await new Promise<void>((resolve) => {
                requestAnimationFrame(() => resolve());
            });
            const withPeople = await attachFeedPlanPeople(extraRaw);
            if (withPeople.length === 0) {
                setHasMoreFeed(hasMore);
                return;
            }
            setPlans((prev) => {
                const seen = new Set(prev.map((p) => String(p.id)));
                const extra = withPeople
                    .filter((p) => !seen.has(String(p.id)))
                    .map((p) => ({ ...p, _feedTail: true }));
                if (extra.length === 0) return prev;
                return [...prev, ...extra];
            });
            setHasMoreFeed(hasMore);
        } catch (e) {
            if (__DEV__) console.warn('loadMoreFeed', e);
        } finally {
            loadingMoreRef.current = false;
            setLoadingMore(false);
        }
    }, [
        hasMoreFeed,
        loading,
        refreshing,
        search,
        selectedCategories.length,
        selectedSubcategories.length,
    ]);

    const requestFeedLoad = useCallback((opts?: { refresh?: boolean; skipScrollJump?: boolean; quiet?: boolean }) => {
        if (fetchInFlightRef.current) {
            // Casita / pull-to-refresh mientras ya carga: encolar una recarga al terminar.
            if (opts?.refresh) pendingFeedRefreshRef.current = true;
            return;
        }
        fetchInFlightRef.current = true;
        const safety = setTimeout(() => {
            fetchInFlightRef.current = false;
        }, 12_000);
        void fetchDataRef.current(opts).finally(() => {
            clearTimeout(safety);
            fetchInFlightRef.current = false;
            if (pendingFeedRefreshRef.current) {
                pendingFeedRefreshRef.current = false;
                requestFeedLoad({ refresh: true, skipScrollJump: true, quiet: true });
                return;
            }
            // Tras actualizar datos, recuperar scroll (si saliste a otra pantalla o volviste a la app).
            // En retap a casita ya vamos al tope con animación; no restaurar offset viejo.
            if (feedFocusedRef.current && !opts?.skipScrollJump) {
                restoreScroll();
            }
        });
    }, [restoreScroll]);
    requestFeedLoadRef.current = requestFeedLoad;

    useEffect(() => {
        let seenInitial = false;
        let lastId: string | null | undefined;
        const { data } = supabase.auth.onAuthStateChange((_event, session) => {
            const nextId = session?.user?.id ?? null;
            if (!seenInitial) {
                seenInitial = true;
                lastId = nextId;
                return;
            }
            if (lastId === nextId) return;
            lastId = nextId;
            cacheInvalidate(FEED_CACHE_KEY);
            void diskRemove(FEED_CACHE_KEY);
            didSessionFeedLoadRef.current = false;
            markFeedNeedsRefresh();
            requestFeedLoad({ refresh: true, skipScrollJump: true });
        });
        return () => data.subscription.unsubscribe();
    }, [requestFeedLoad]);

    // Tras crear un plan: recarga diferida (evita freeze al cerrar el modal).
    useFocusEffect(
        useCallback(() => {
            feedFocusedRef.current = true;
            let cancelled = false;
            let timer: ReturnType<typeof setTimeout> | null = null;

            const patches = takeFeedMembershipPatches();
            if (Object.keys(patches).length > 0) {
                setMembershipMap((prev) => mergeStickyMembershipMap(prev));
            }
            const inviteClears = takeFeedInviteClears();
            if (inviteClears.length > 0) {
                setInvitedPlanIds((prev) => applyStickyInviteClears(prev));
            }
            const planDeletes = takeFeedPlanDeletes();
            if (planDeletes.length > 0) {
                const deleteSet = new Set(planDeletes);
                setPlans((prev) => prev.filter((p) => !deleteSet.has(String(p.id))));
            }

            const optimistic = takeOptimisticFeedPlan();
            if (optimistic?.id) {
                const oid = String(optimistic.id);
                setPlans((prev) => {
                    // Si el estado en memoria está vacío, rehidratar desde caché para no dejar solo el plan nuevo.
                    let base = prev;
                    if (base.length === 0) {
                        const cached = cacheGetStale<FeedSnapshot>(FEED_CACHE_KEY);
                        if (cached?.plans?.length) base = cached.plans;
                    }
                    if (base.some((p) => String(p.id) === oid)) {
                        return base.map((p) => (String(p.id) === oid ? { ...p, ...optimistic } : p));
                    }
                    return [optimistic, ...base];
                });
                setMembershipMap((prev) => ({
                    ...prev,
                    [oid]: (patches[oid] as Membership) || prev[oid] || 'joined',
                }));
                hasDataRef.current = true;
            }

            const urgent = consumeFeedNeedsRefreshUrgent();
            if (consumeFeedNeedsRefresh() || urgent || optimistic) {
                didSessionFeedLoadRef.current = true;
                const delay = urgent || optimistic ? 700 : 450;
                timer = setTimeout(() => {
                    if (!cancelled) {
                        requestFeedLoad({ refresh: true, skipScrollJump: true, quiet: true });
                    }
                }, delay);
            } else if (!hasDataRef.current) {
                didSessionFeedLoadRef.current = true;
                requestFeedLoad();
            } else if (!didSessionFeedLoadRef.current) {
                didSessionFeedLoadRef.current = true;
                if (!cacheIsFresh(FEED_CACHE_KEY)) {
                    requestFeedLoad({ quiet: true, skipScrollJump: true });
                }
            }

            return () => {
                cancelled = true;
                if (timer) clearTimeout(timer);
                feedFocusedRef.current = false;
            };
        }, [requestFeedLoad]),
    );

    // Tras publicar: si el feed ya está visible, recarga quieta (sin depender solo del focus).
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const unsub = subscribeFeedRefreshSignal(() => {
            if (!feedFocusedRef.current) return;
            if (timer) clearTimeout(timer);
                timer = setTimeout(() => {
                    requestFeedLoad({ refresh: true, skipScrollJump: true, quiet: true });
                }, 520);
        });
        return () => {
            unsub();
            if (timer) clearTimeout(timer);
        };
    }, [requestFeedLoad]);

    // Fuera de la app → volver: una recarga (y luego restoreScroll).
    useEffect(() => {
        const sub = AppState.addEventListener('change', (next) => {
            const prev = appStateRef.current;
            appStateRef.current = next;
            const fromBackground = prev === 'background' || prev === 'inactive';
            if (fromBackground && next === 'active' && feedFocusedRef.current) {
                if (!cacheIsFresh(FEED_CACHE_KEY)) requestFeedLoad();
            }
        });
        return () => sub.remove();
    }, [requestFeedLoad]);

    // Sincronizar estado de corazón desde pantalla de detalle
    useEffect(() => {
        const saveUnsub = subscribeSaveState((evt) => {
            setSavedPlans((prev) => {
                if (evt.saved) {
                    return prev.includes(evt.planId) ? prev : [...prev, evt.planId];
                } else {
                    return prev.filter((id) => id !== evt.planId);
                }
            });
        });
        return saveUnsub;
    }, []);

    // Tu propia fila de participante: el botón de unido. El aforo de los demás
    // no se reconsulta aquí: escuchar toda la tabla no escala y el feed ya se refresca.
    useEffect(() => {
        if (!currentUserId) return;

        const channel = supabase
            .channel(`feed-participantes:${currentUserId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'participantes',
                    filter: `usuario_id=eq.${currentUserId}`,
                },
                (payload) => {
                    const rowNew = payload.new as
                        | { plan_id?: string; usuario_id?: string; estado?: string }
                        | null;
                    const rowOld = payload.old as
                        | { plan_id?: string; usuario_id?: string; estado?: string }
                        | null;
                    const planId = rowNew?.plan_id ?? rowOld?.plan_id;

                    const uid = currentUserIdRef.current;
                    const touchedUser = rowNew?.usuario_id ?? rowOld?.usuario_id;
                    if (!uid || !planId || touchedUser !== uid) return;

                    if (payload.eventType === 'DELETE' || !rowNew) {
                        setMembershipMap((prev) => {
                            if (!(planId in prev)) return prev;
                            const next = { ...prev };
                            delete next[planId];
                            return next;
                        });
                        noteFeedMembershipPatch(planId, 'none');
                        return;
                    }

                    const estado = String(rowNew.estado ?? '');
                    const membership: Membership =
                        estado === 'aceptado'
                            ? 'joined'
                            : estado === 'pendiente'
                              ? 'requested'
                              : estado === 'lista_espera'
                                ? 'waitlist'
                                : 'none';
                    setMembershipMap((prev) => {
                        if (membership === 'none') {
                            if (!(planId in prev)) return prev;
                            const next = { ...prev };
                            delete next[planId];
                            return next;
                        }
                        if (prev[planId] === membership) return prev;
                        return { ...prev, [planId]: membership };
                    });
                    noteFeedMembershipPatch(planId, membership);
                    if (membership !== 'none') {
                        setInvitedPlanIds((prev) => {
                            if (!prev.has(planId)) return prev;
                            const next = new Set(prev);
                            next.delete(planId);
                            return next;
                        });
                    }
                },
            )
            .subscribe();

        return () => {
            void supabase.removeChannel(channel);
        };
    }, [currentUserId]);

    const homeRetapBusyRef = useRef(false);

    useEffect(() => {
        return subscribeFeedHomeRetap(() => {
            if (homeRetapBusyRef.current) return;
            homeRetapBusyRef.current = true;
            const release = () => {
                homeRetapBusyRef.current = false;
            };

            const from = getScreenScrollOffset(ScreenKeys.FEED);
            // Ya arriba: solo recarga (sin pelear con el scroll).
            if (from <= 16) {
                requestFeedLoad({ refresh: true, skipScrollJump: true });
                setTimeout(release, 700);
                return;
            }
            // Primero sube; al terminar, recarga.
            smoothScrollListToTop(
                (opts) => listRef.current?.scrollToOffset(opts),
                from,
                () => {
                    requestFeedLoad({ refresh: true, skipScrollJump: true });
                    setTimeout(release, 400);
                },
            );
        });
    }, [listRef, requestFeedLoad]);

    const handleJoin = async (planId: string) => {
        if (requireAccount({ type: 'join', planId })) return;
        if (!currentUserId || joiningRef.current) return;
        if (isOrganizerAccount) {
            hapticError();
            Alert.alert(t('feed.error'), t('organizer.cannotJoin'));
            return;
        }
        const plan = plans.find(p => p.id === planId);
        if (!plan) return;

        if (!canJoinPlanByGender(plan, currentUserGenero)) {
            hapticError();
            Alert.alert(t('feed.error'), t('card.soloChicasOnly'));
            return;
        }

        if (await wasKickedFromPlan(planId, currentUserId)) {
            hapticError();
            Alert.alert(t('feed.error'), t('plan.kickedCannotJoin'));
            return;
        }

        const existingMembership = membershipMap[planId];
        const alreadyIn =
            existingMembership === 'joined' ||
            existingMembership === 'requested' ||
            existingMembership === 'waitlist';
        // Límite local primero: evita round-trip que congelaba el botón "Me apunto".
        if (!alreadyIn) {
            const localCount = countLocalActivePlans(currentUserId, plans, membershipMap);
            if (localCount >= MAX_ACTIVE_PLANS) {
                const limitCheck = getIsOnline()
                    ? await canJoinMorePlans(currentUserId, planId)
                    : { allowed: false as const, count: localCount, max: MAX_ACTIVE_PLANS };
                if (!limitCheck.allowed) {
                    hapticError();
                    Alert.alert(
                        t('feed.error'),
                        limitCheck.reason === 'organizer'
                            ? t('organizer.cannotJoin')
                            : t('feed.planLimitReached', { max: limitCheck.max }),
                    );
                    return;
                }
            }
        }

        joiningRef.current = true;
        setJoiningPlanId(planId);

        const estado = resolveJoinEstado({
            requiere_aprobacion: plan.requiere_aprobacion,
            maximo_participantes: plan.maximo_participantes,
            joinedCount: plan.joinedCount,
        });
        const nextMembership = membershipFromJoinEstado(estado);

        const prevMap = membershipMap;
        const prevPlans = plans;
        // Mantener posición en el feed hasta la próxima recarga.
        deferMineSortIdsRef.current.add(planId);
        setMembershipMap(prev => ({ ...prev, [planId]: nextMembership }));
        if (estado === 'aceptado') {
            setPlans(prev =>
                prev.map((p) => {
                    if (p.id !== planId) return p;
                    const list = Array.isArray(p.participantsList) ? [...p.participantsList] : [];
                    if (!list.some((x: { id?: string }) => String(x.id) === String(currentUserId))) {
                        list.push({
                            id: currentUserId,
                            nombre: t('chats.you'),
                            avatar_url: null,
                            isCreator: false,
                        });
                    }
                    return { ...p, joinedCount: p.joinedCount + 1, participantsList: list };
                }),
            );
            void import('../../lib/profileData').then(({ getMyProfile }) => {
                // getMyProfile no recibe id y devuelve { data, error }: leerlo mal
                // dejaba tu burbuja sin tu nombre ni tu foto al unirte.
                void getMyProfile().then(({ data: me }) => {
                    if (!me) return;
                    setPlans((prev) =>
                        prev.map((p) => {
                            if (p.id !== planId || !Array.isArray(p.participantsList)) return p;
                            return {
                                ...p,
                                participantsList: p.participantsList.map((x: { id?: string }) =>
                                    String(x.id) === String(currentUserId)
                                        ? {
                                              ...x,
                                              nombre: me.nombre || (x as { nombre?: string }).nombre,
                                              avatar_url: me.avatar_url ?? null,
                                          }
                                        : x,
                                ),
                            };
                        }),
                    );
                });
            });
        }
        try {
            const { queued, error, estado: applied } = await persistJoinWithWaitlistFallback(
                {
                    planId,
                    userId: currentUserId,
                    estado,
                    planTitle: plan.titulo,
                    fechaEvento: plan.fecha_evento,
                    categoria: plan.categoria,
                    locationName: plan.nombre_ubicacion,
                },
                canJoinWaitlist(plan.fecha_evento),
            );
            if (error) {
                deferMineSortIdsRef.current.delete(planId);
                setMembershipMap(prevMap);
                setPlans(prevPlans);
                hapticError();
                Alert.alert(
                    t('feed.error'),
                    String(error.message || '').toLowerCase().includes('plan_full')
                        ? t('feed.planFull')
                        : /active_plan_limit/i.test(String(error.message || ''))
                          ? t('feed.planLimitReached', { max: MAX_ACTIVE_PLANS })
                          : t('feed.joinError'),
                );
            } else {
                if (applied === 'lista_espera' && estado === 'aceptado') {
                    setMembershipMap((prev) => ({ ...prev, [planId]: 'waitlist' }));
                    setPlans(prevPlans);
                    Alert.alert(t('feed.joinedWaitlist'));
                }
                hapticSuccess();
                const finalMembership: Membership =
                    applied === 'lista_espera'
                        ? 'waitlist'
                        : applied === 'pendiente'
                          ? 'requested'
                          : nextMembership;
                broadcastPlanMembership(planId, finalMembership, {
                    userId: currentUserId,
                    bumpJoined: finalMembership === 'joined',
                    clearInvite: true,
                    addParticipant:
                        finalMembership === 'joined'
                            ? {
                                  id: currentUserId,
                                  nombre: t('chats.you'),
                                  avatar_url: null,
                              }
                            : null,
                });
                setInvitedPlanIds((prev) => {
                    if (!prev.has(planId)) return prev;
                    const next = new Set(prev);
                    next.delete(planId);
                    return next;
                });
                if (applied === 'aceptado' || nextMembership === 'joined') {
                    void import('../../lib/chatUnread').then(({ markPlanChatRead }) =>
                        markPlanChatRead(currentUserId, planId),
                    );
                }
                if (!queued) {
                    void import('../../lib/push').then(({ notifyPlanJoin, schedulePlanLifecycleReminders }) => {
                        notifyPlanJoin(planId, applied);
                        if (applied === 'aceptado') {
                            void schedulePlanLifecycleReminders({
                                planId,
                                planTitle: plan.titulo,
                                fechaEvento: plan.fecha_evento,
                                categoria: plan.categoria,
                                locationName: plan.nombre_ubicacion,
                            });
                            void import('../../lib/analytics').then(({ trackFunnel }) =>
                                trackFunnel('plan_join', {
                                    userId: currentUserId,
                                    props: { planId, estado: applied },
                                }),
                            );
                        }
                    });
                }
            }
        } finally {
            joiningRef.current = false;
            setJoiningPlanId(null);
        }
    };

    const handleLeave = async (planId: string) => {
        if (!currentUserId) return;
        const membership = membershipMap[planId];
        const wasJoined = membership === 'joined';
        const wasWaitlist = membership === 'waitlist';
        const title = wasJoined
            ? t('feed.leaveTitle')
            : wasWaitlist
              ? t('card.leaveWaitlistTitle')
              : t('feed.cancelRequestTitle');
        const message = wasJoined
            ? t('feed.leaveMsg')
            : wasWaitlist
              ? t('card.leaveWaitlistMsg')
              : t('feed.cancelRequestMsg');
        Alert.alert(title, message, [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('common.yes'),
                style: 'destructive',
                onPress: async () => {
                    const prevMap = membershipMap;
                    const prevPlans = plans;
                    setMembershipMap(prev => { const n = { ...prev }; delete n[planId]; return n; });
                    if (wasJoined) {
                        setPlans(prev => prev.map(p => p.id === planId ? { ...p, joinedCount: Math.max(0, p.joinedCount - 1) } : p));
                    }
                    const { queued, error } = await persistLeave(planId, currentUserId, wasJoined);
                    if (error) {
                        setMembershipMap(prevMap);
                        setPlans(prevPlans);
                        Alert.alert(t('feed.error'), t('feed.leaveError'));
                        return;
                    }
                    broadcastPlanMembership(planId, 'none', {
                        userId: currentUserId,
                        dropJoined: wasJoined,
                    });
                    if (wasJoined && !queued) {
                        await promoteWaitlist(planId);
                        requestFeedLoadRef.current({ skipScrollJump: true, quiet: true });
                    }
                },
            },
        ]);
    };

    const handleSave = async (planId: string) => {
        if (requireAccount({ type: 'save-plan', planId })) return;
        if (!currentUserId) return;
        const isAlreadySaved = savedPlans.includes(planId);
        const prevSaved = savedPlans;
        hapticSave(!isAlreadySaved);
        if (isAlreadySaved) {
            setSavedPlans(prev => prev.filter(id => id !== planId));
            const { error } = await persistSave(planId, currentUserId, false);
            if (error) {
                setSavedPlans(prevSaved);
                hapticError();
                Alert.alert(t('feed.error'), t('feed.saveError'));
            }
        } else {
            setSavedPlans(prev => [...prev, planId]);
            const { error } = await persistSave(planId, currentUserId, true);
            if (error) {
                setSavedPlans(prevSaved);
                hapticError();
                Alert.alert(t('feed.error'), t('feed.saveError'));
            }
        }
    };

    const handleDeletePlan = async (planId: string) => {
        Alert.alert(
            secretOwnerUx ? t('admin.deletePlanTitle') : t('feed.deletePlan'),
            secretOwnerUx ? t('admin.deletePlanMsg') : t('feed.deleteConfirm'),
            [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: secretOwnerUx ? t('admin.deletePlanConfirm') : t('feed.deletePlan'),
                style: 'destructive',
                // No async aquí: en Android el Alert espera el Promise y se queda abierto.
                onPress: () => {
                    const prevPlans = plans;
                    const prevMap = membershipMap;
                    const prevSaved = savedPlans;
                    setPlans(prev => prev.filter(p => p.id !== planId));
                    setMembershipMap(prev => { const n = { ...prev }; delete n[planId]; return n; });
                    setSavedPlans(prev => prev.filter(id => id !== planId));
                    setTimeout(() => {
                        void (async () => {
                            const { error } = secretOwnerUx
                                ? await deletePlanAdmin(planId)
                                : await deletePlanCompletely(planId);
                            if (error) {
                                setPlans(prevPlans);
                                setMembershipMap(prevMap);
                                setSavedPlans(prevSaved);
                                const msg =
                                    error === 'not_authorized'
                                        ? t('admin.err.not_authorized')
                                        : error === 'plan_not_found'
                                          ? t('admin.err.plan_not_found')
                                          : t('feed.deleteError');
                                Alert.alert(t('feed.error'), msg);
                            } else {
                                invalidatePlanMembershipCaches(currentUserId);
                            }
                        })();
                    }, 0);
                },
            },
        ]);
    };

    const handleEditPlan = (planId: string) => {
        router.push({ pathname: '/create-plan', params: { editId: planId } });
    };

    const planDistanceLabel = useCallback(
        (plan: any): string | undefined => {
            if (!userCoords) return undefined;
            const coords = parsePlanCoords(plan);
            if (!coords) return undefined;
            return formatDistanceKm(
                distanceKm(
                    userCoords.latitude,
                    userCoords.longitude,
                    coords.latitude,
                    coords.longitude,
                ),
                lang,
            );
        },
        [userCoords, lang],
    );

    const matchesDate = useCallback((plan: any) => {
        if (dateFilter === 'all') return true;
        if (!plan.fecha_evento) return false;
        const d = new Date(plan.fecha_evento);
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (dateFilter === 'today') {
            return toDayKey(d) === toDayKey(now);
        }
        if (dateFilter === 'week') {
            const endOfWeek = new Date(startOfToday);
            endOfWeek.setDate(endOfWeek.getDate() + 7);
            endOfWeek.setHours(23, 59, 59, 999);
            return d >= startOfToday && d <= endOfWeek;
        }
        return true;
    }, [dateFilter]);

    const filteredPlans = useMemo(() => {
        const membershipPlanIds = new Set(Object.keys(membershipMap));
        const hitIds = new Set(searchHits.map((p) => String(p.id)));
        const merged = search.trim().length < 2
            ? plans
            : (() => {
                const seen = new Set(plans.map((p) => String(p.id)));
                return [...plans, ...searchHits.filter((p) => !seen.has(String(p.id)))];
            })();

        return merged.filter(p => {
            const { main, sub } = resolvePlanCategories(p);
            const categoryOk =
                selectedCategories.length === 0
                || (main != null && selectedCategories.includes(main))
                || selectedCategories.includes(String(p.categoria || ''));
            const subcategoryOk =
                selectedSubcategories.length === 0
                || (sub != null && selectedSubcategories.includes(sub));

            let distanceOk = true;
            if (nearbyKm != null && userCoords) {
                const coords = parsePlanCoords(p);
                if (!coords) distanceOk = false;
                else {
                    const d = distanceKm(
                        userCoords.latitude,
                        userCoords.longitude,
                        coords.latitude,
                        coords.longitude,
                    );
                    distanceOk = d <= nearbyKm;
                }
            }

            return isPlanActiveForFeed(p)
                && canSeePlanInFeed(p, {
                    userId: currentUserId,
                    friendIds,
                    membershipPlanIds,
                    invitedPlanIds,
                    isOwner: secretOwnerUx,
                })
                && (secretOwnerUx || !isSoloChicasPlan(p) || currentUserGenero === 'femenino')
                && categoryOk
                && subcategoryOk
                && distanceOk
                && (hitIds.has(String(p.id)) || planMatchesSearch(p, search, searchExpanded))
                && matchesDate(p);
        });
    }, [
        plans,
        currentUserId,
        currentUserGenero,
        membershipMap,
        friendIds,
        invitedPlanIds,
        secretOwnerUx,
        selectedCategories,
        selectedSubcategories,
        search,
        searchExpanded,
        searchHits,
        matchesDate,
        nearbyKm,
        userCoords,
    ]);

    const feedFlatten = search.trim().length > 0
        || selectedCategories.length > 0
        || selectedSubcategories.length > 0;

    const feedRows = useMemo<SocialFeedRow[]>(() => buildFeedRows({
        plans: filteredPlans,
        currentUserId,
        membershipMap,
        friendIds,
        coincidedIds,
        taste: feedTaste,
        coords: userCoords,
        flatten: feedFlatten,
        searchQuery: search,
        deferMineIds: mineSortEpoch >= 0 ? deferMineSortIdsRef.current : undefined,
    }), [
        filteredPlans,
        currentUserId,
        membershipMap,
        friendIds,
        coincidedIds,
        feedTaste,
        userCoords,
        feedFlatten,
        search,
        mineSortEpoch,
    ]);

    const savedPlanIds = useMemo(() => new Set(savedPlans), [savedPlans]);

    const feedRowsUi = useMemo<FeedRow[]>(() => {
        const socialUi = feedRows.map((row) => {
            if (row.kind !== 'plan') return row;
            const pid = String(row.plan.id);
            return {
                ...row,
                membership: membershipMap[pid] || 'none',
                isSaved: savedPlanIds.has(pid),
                joining: joiningPlanId === pid,
                distanceLabel: planDistanceLabel(row.plan),
            };
        });
        if (eventSection === 'plans') return socialUi;
        if (eventSection === 'agenda')
            return external.events.map((event) => ({
                kind: 'event' as const,
                id: `event:${event.id}`,
                event,
            }));
        if (
            rankedEvents.length &&
            socialUi.some(
                (row) =>
                    row.kind === 'header' && row.titleKey === 'feed.sectionYours',
            ) &&
            !socialUi.some(
                (row) =>
                    row.kind === 'header' && row.titleKey === 'feed.sectionForYou',
            )
        ) {
            socialUi.push({
                kind: 'header',
                id: 'header:external-for-you',
                titleKey: 'feed.sectionForYou',
            });
        }
        return interleaveSocialRows(
            socialUi,
            rankedEvents,
            (row) => row.kind === 'plan',
            (row) =>
                row.kind === 'header'
                    ? row.titleKey === 'feed.sectionYours'
                        ? 'protected'
                        : 'open'
                    : null,
        );
    }, [
        feedRows,
        membershipMap,
        savedPlanIds,
        joiningPlanId,
        planDistanceLabel,
        eventSection,
        external.events,
        rankedEvents,
    ]);

    const feedRowsRef = useRef(feedRowsUi);
    feedRowsRef.current = feedRowsUi;
    const membershipMapRef = useRef(membershipMap);
    membershipMapRef.current = membershipMap;
    const prefetchedAheadRef = useRef(new Set<string>());

    const openPlanDetail = useCallback(
        (planId: string) => {
            try {
                const found = plansRef.current.find((p) => String(p.id) === String(planId));
                const mid = String(planId);
                if (found) {
                    const hostId = String(found.creador_id || found.host?.id || '');
                    if (hostId) {
                        seedUserProfilePeek({
                            id: hostId,
                            nombre: found.host?.nombre,
                            avatar_url: found.host?.avatar_url,
                            es_organizador: !!found.es_organizador,
                        });
                        prefetchUserProfile(hostId);
                        if (
                            currentUserId &&
                            hostId !== String(currentUserId) &&
                            !found.es_organizador
                        ) {
                            void prefetchPairAffinity(currentUserId, hostId, {
                                isFriends: friendIds.has(hostId),
                            });
                        }
                    }
                    seedPlanDetailFromFeed(found, {
                        membership: (membershipMapRef.current[mid] || 'none') as Membership,
                        friendIds: [...friendIds],
                        coincidedIds: [...coincidedIds],
                        currentUserId,
                        currentUserGenero,
                        isSaved: savedPlanIds.has(mid),
                        fitPct:
                            currentUserId &&
                            !found.es_organizador &&
                            String(found.creador_id || found.host?.id || '') !== String(currentUserId)
                                ? feedFitPercent(
                                      {
                                          categoria: found.categoria,
                                          tipo_deporte: found.tipo_deporte,
                                          fecha_evento: found.fecha_evento,
                                          solo_chicas: found.solo_chicas,
                                      },
                                      {
                                          personalityTags: feedTaste.personalityTags,
                                          viewerAge: feedTaste.viewerAge,
                                          viewerGenero: currentUserGenero,
                                      },
                                      found.id,
                                  )
                                : null,
                    });
                    // Feed people can be newer than a fresh plan-detail cache.
                    syncPlanDetailParticipantsFromFeed(
                        mid,
                        Array.isArray(found.participantsList) ? found.participantsList : null,
                        Number.isFinite(Number(found.joinedCount))
                            ? Number(found.joinedCount)
                            : undefined,
                    );
                }
                prefetchPlanDetail(mid);
            } catch (e) {
                if (__DEV__) console.warn('openPlanDetail seed', e);
            }
            try {
                router.push({ pathname: '/plan/[id]', params: { id: String(planId) } });
            } catch (e) {
                if (__DEV__) console.warn('openPlanDetail nav', e);
            }
        },
        [router, friendIds, coincidedIds, currentUserId, currentUserGenero, savedPlanIds, feedTaste],
    );

    const openProfile = useCallback(
        (userId: string) => {
            if (requireAccount({ type: 'view-profile', userId })) return;
            const fromPlan = plansRef.current.find(
                (p) =>
                    String(p.creador_id) === String(userId) ||
                    (Array.isArray(p.participantsList) &&
                        p.participantsList.some((x: { id?: string }) => String(x.id) === String(userId))),
            );
            const host = fromPlan?.host;
            const person =
                (host && String(host.id) === String(userId) ? host : null) ||
                (Array.isArray(fromPlan?.participantsList)
                    ? fromPlan.participantsList.find((x: { id?: string }) => String(x.id) === String(userId))
                    : null);
            seedUserProfilePeek({
                id: userId,
                nombre: person?.nombre,
                avatar_url: person?.avatar_url,
                es_organizador: !!fromPlan?.es_organizador && String(fromPlan?.creador_id) === String(userId),
                friendStatus: friendIds.has(userId) ? 'friends' : undefined,
            });
            prefetchUserProfile(userId);
            router.push({
                pathname: '/user-profile/[id]',
                params: { id: userId, isFriend: friendIds.has(userId) ? '1' : '0' },
            });
        },
        [requireAccount, router, friendIds],
    );

    const joinHandlerRef = useRef(handleJoin);
    joinHandlerRef.current = handleJoin;
    const leaveHandlerRef = useRef(handleLeave);
    leaveHandlerRef.current = handleLeave;
    const saveHandlerRef = useRef(handleSave);
    saveHandlerRef.current = handleSave;
    const deleteHandlerRef = useRef(handleDeletePlan);
    deleteHandlerRef.current = handleDeletePlan;
    const editHandlerRef = useRef(handleEditPlan);
    editHandlerRef.current = handleEditPlan;
    const onJoinStable = useCallback((id: string) => { void joinHandlerRef.current(id); }, []);
    const onLeaveStable = useCallback((id: string) => { void leaveHandlerRef.current(id); }, []);
    const onSaveStable = useCallback((id: string) => { void saveHandlerRef.current(id); }, []);
    const onDeleteStable = useCallback((id: string) => { void deleteHandlerRef.current(id); }, []);
    const onEditStable = useCallback((id: string) => { editHandlerRef.current(id); }, []);

    const renderPlanItem = useCallback(
        ({ item, index }: { item: FeedRow; index: number }) => {
            if (item.kind === 'event') {
                return <EventCard event={item.event} variant={eventSection==='agenda'?'editorial':'compact'} joined={external.joined.has(item.event.id)} busy={external.busy===item.event.id} onOpen={()=>openExternal(item.event.id)} onJoin={()=>joinExternal(item.event.id)}/>;
            }
            if (item.kind === 'header') {
                return <Text style={styles.feedSectionTitle}>{t(item.titleKey)}</Text>;
            }
            const plan = item.plan;
            return (
                <PlanCard
                    item={plan}
                    index={index}
                    currentUserId={currentUserId}
                    userGenero={currentUserGenero}
                    membership={(item.membership || 'none') as Membership}
                    isSaved={item.isSaved === true}
                    friendIds={friendIds}
                    coincidedIds={coincidedIds}
                    feedTaste={feedTaste}
                    isOwner={secretOwnerUx}
                    distanceLabel={item.distanceLabel}
                    viewerIsOrganizer={isOrganizerAccount}
                    onJoin={onJoinStable}
                    joining={item.joining === true}
                    onLeave={onLeaveStable}
                    onDelete={onDeleteStable}
                    onEdit={onEditStable}
                    onToggleSave={onSaveStable}
                    onOpenDetail={openPlanDetail}
                    onParticipantsChanged={() => requestFeedLoadRef.current({ skipScrollJump: true, quiet: true })}
                    onOpenProfile={openProfile}
                    router={router}
                />
            );
        },
        [
            t,
            styles.feedSectionTitle, eventSection, external.joined, external.busy, openExternal, joinExternal,
            currentUserId,
            currentUserGenero,
            friendIds,
            coincidedIds,
            feedTaste,
            secretOwnerUx,
            isOrganizerAccount,
            onJoinStable,
            onLeaveStable,
            onDeleteStable,
            onEditStable,
            onSaveStable,
            openPlanDetail,
            openProfile,
            router,
        ],
    );

    const nearestOutsideNearby = useMemo(() => {
        if (nearbyKm == null || !userCoords || filteredPlans.length > 0) return null;
        const membershipPlanIds = new Set(Object.keys(membershipMap));
        let best: { plan: any; km: number } | null = null;
        for (const p of plans) {
            if (!isPlanActiveForFeed(p)) continue;
            if (!canSeePlanInFeed(p, {
                userId: currentUserId,
                friendIds,
                membershipPlanIds,
                invitedPlanIds,
                isOwner: secretOwnerUx,
            })) continue;
            const coords = parsePlanCoords(p);
            if (!coords) continue;
            const km = distanceKm(
                userCoords.latitude,
                userCoords.longitude,
                coords.latitude,
                coords.longitude,
            );
            if (!best || km < best.km) best = { plan: p, km };
        }
        return best;
    }, [
        nearbyKm,
        userCoords,
        filteredPlans.length,
        plans,
        membershipMap,
        currentUserId,
        friendIds,
        invitedPlanIds,
        secretOwnerUx,
    ]);

    const warmFeedPlan = useCallback((row: FeedRow) => {
        if (row.kind !== 'plan' || !row.plan?.id) return;
        const mid = String(row.plan.id);
        if (prefetchedAheadRef.current.has(mid)) return;
        prefetchedAheadRef.current.add(mid);
        seedPlanDetailFromFeed(row.plan, {
            membership: membershipMapRef.current[mid] || 'none',
            friendIds: [...(friendIdsRef.current ?? [])],
            coincidedIds: [...(coincidedIdsRef.current ?? [])],
            currentUserId: currentUserIdRef.current,
            currentUserGenero,
        });
        prefetchPlanDetail(mid);
        if (resolvePlanSport(row.plan)?.tipo === 'futbol') {
            prefetchTournamentLineup(mid);
        }
        const host =
            row.plan.host ||
            (Array.isArray(row.plan.participantsList)
                ? row.plan.participantsList.find((p: { isCreator?: boolean }) => p.isCreator)
                : null);
        prefetchRemoteImages(
            [
                row.plan.imagen_url,
                host?.avatar_url,
                ...((Array.isArray(row.plan.participantsList)
                    ? row.plan.participantsList.slice(0, 6)
                    : []) as Array<{ avatar_url?: string | null }>).map((p) => p.avatar_url),
            ],
            8,
        );
        if (!host?.id) return;
        seedUserProfilePeek({
            id: host.id,
            nombre: host.nombre,
            avatar_url: host.avatar_url,
            es_organizador: !!row.plan.es_organizador,
        });
        prefetchUserProfile(host.id);
        const uid = currentUserIdRef.current;
        if (uid && String(host.id) !== String(uid) && !row.plan.es_organizador) {
            void prefetchPairAffinity(uid, String(host.id), {
                isFriends: friendIdsRef.current?.has(String(host.id)) === true,
            });
        }
    }, [currentUserGenero]);

    const warmFeedPlanRef = useRef(warmFeedPlan);
    warmFeedPlanRef.current = warmFeedPlan;

    const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
        const indices = viewableItems
            .map((v) => v.index)
            .filter((i): i is number => typeof i === 'number' && i >= 0);
        if (indices.length === 0) return;
        const maxIdx = Math.max(...indices);
        const rows = feedRowsRef.current;
        const warm = warmFeedPlanRef.current;
        for (const v of viewableItems) {
            const row = typeof v.index === 'number' ? rows[v.index] : null;
            if (row) warm(row);
        }
        let seeded = 0;
        for (let i = maxIdx + 1; i < rows.length && seeded < 6; i++) {
            const row = rows[i];
            if (row.kind !== 'plan' || !row.plan?.id) continue;
            warm(row);
            seeded += 1;
        }
    }).current;

    useEffect(() => {
        prefetchedAheadRef.current.clear();
    }, [currentUserId]);

    const lastWarmKeyRef = useRef('');
    useEffect(() => {
        const key = feedRowsUi
            .filter((row): row is Extract<FeedRow, { kind: 'plan' }> => row.kind === 'plan' && !!row.plan?.id)
            .slice(0, 8)
            .map((row) => row.plan.id)
            .join(',');
        if (!key || key === lastWarmKeyRef.current) return;
        lastWarmKeyRef.current = key;
        let n = 0;
        for (const row of feedRowsUi) {
            if (n >= 8) break;
            if (row.kind !== 'plan' || !row.plan?.id) continue;
            warmFeedPlan(row);
            n += 1;
        }
    }, [feedRowsUi, warmFeedPlan]);

    const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 20, minimumViewTime: 220 }).current;

    useEffect(() => {
        if (nearbyKm === 10) setNearbyKm(null);
    }, [nearbyKm]);

    const hasSheetFilters =
        selectedCategories.length > 0
        || selectedSubcategories.length > 0
        || dateFilter !== 'all'
        || nearbyKm != null;

    const subcategoryOptions = useMemo(() => {
        if (selectedCategories.length === 0) return [] as string[];
        const seen = new Set<string>();
        const options: string[] = [];
        for (const cat of selectedCategories) {
            if (!MAIN_CATEGORY_IDS.includes(cat as MainCategoryId)) continue;
            for (const sub of SUBCATEGORIES[cat as MainCategoryId]) {
                if (seen.has(sub)) continue;
                seen.add(sub);
                options.push(sub);
            }
        }
        return options;
    }, [selectedCategories]);

    const toggleCategory = (cat: string) => {
        hapticSelection();
        const next = toggleInList(selectedCategories, cat);
        const allowed = new Set<string>();
        for (const c of next) {
            if (!MAIN_CATEGORY_IDS.includes(c as MainCategoryId)) continue;
            for (const sub of SUBCATEGORIES[c as MainCategoryId]) allowed.add(sub);
        }
        setSelectedCategories(next);
        setSelectedSubcategories((subs) => subs.filter((sub) => allowed.has(sub)));
    };

    const clearCategories = () => {
        hapticSelection();
        setSelectedCategories([]);
        setSelectedSubcategories([]);
    };

    const clearAllFilters = () => {
        hapticSelection();
        setSelectedCategories([]);
        setSelectedSubcategories([]);
        setDateFilter('all');
        setNearbyKm(null);
    };

    return (
            <View style={{ flex: 1, backgroundColor: colors.backgroundAlt }}>
            <View style={styles.container}>
            <View
                style={[
                    styles.searchWrapper,
                    {
                        paddingTop: chrome.headerTop,
                        height: chrome.headerTop + chrome.headerRowHeight,
                        paddingRight: chrome.headerRight,
                    },
                ]}
            >
                <View style={[styles.searchContainer, { height: chrome.headerRowHeight }]}>
                    <Ionicons name="search" size={20} color={PRIMARY_DARK} />
                    <TextInput
                        placeholder={t('feed.searchPlaceholder')}
                        placeholderTextColor={colors.textSubtle}
                        style={styles.searchInput}
                        value={search}
                        onChangeText={setSearch}
                        keyboardAppearance={scheme}
                        autoCorrect={false}
                        autoCapitalize="none"
                        returnKeyType="search"
                    />
                    {search.length > 0 ? (
                        <Pressable
                            onPress={() => {
                                hapticSelection();
                                setSearch('');
                                setSearchHits([]);
                                setSearchExpanded([]);
                            }}
                            hitSlop={10}
                            accessibilityRole="button"
                            accessibilityLabel={t('feed.clearSearch')}
                            style={styles.searchClear}
                        >
                            <Ionicons name="close-circle" size={20} color={colors.textSubtle} />
                        </Pressable>
                    ) : null}
                </View>
            </View>

            {showFirstRun ? (
                <View style={styles.firstRunBanner}>
                    <Text style={styles.firstRunTitle}>{t('feed.firstRunTitle')}</Text>
                    <Text style={styles.firstRunBody}>{t('feed.firstRunBody')}</Text>
                    <View style={styles.firstRunActions}>
                        <TouchableOpacity
                            style={styles.firstRunPrimary}
                            onPress={() => setShowFirstRun(false)}
                            activeOpacity={0.9}
                        >
                            <Text style={styles.firstRunPrimaryText}>{t('feed.firstRunNearby')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.firstRunSecondary}
                            onPress={() => {
                                setShowFirstRun(false);
                                router.push('/create-plan');
                            }}
                            activeOpacity={0.9}
                        >
                            <Text style={styles.firstRunSecondaryText}>{t('feed.firstRunCreate')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={() => {
                                setShowFirstRun(false);
                                router.push('/community-norms');
                            }}
                        >
                            <Text style={styles.firstRunLink}>{t('feed.firstRunNorms')}</Text>
                        </TouchableOpacity>
                    </View>
                    <TouchableOpacity style={styles.firstRunClose} onPress={() => setShowFirstRun(false)} hitSlop={10}>
                        <Ionicons name="close" size={18} color={theme.colors.textMuted} />
                    </TouchableOpacity>
                </View>
            ) : null}

            <EventTabs value={eventSection} onChange={(section)=>{hapticSelection();setEventSection(section);listRef.current?.scrollToOffset({offset:0,animated:false});}}/>
            <View style={styles.listWrap}>
                <FlashList
                    ref={listRef}
                    style={{ flex: 1 }}
                    data={feedRowsUi}
                    keyExtractor={(item) => item.id}
                    getItemType={(item) => item.kind}
                    extraData={joiningPlanId}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                    nestedScrollEnabled
                    keyboardDismissMode="on-drag"
                    keyboardShouldPersistTaps="handled"
                    onLayout={onListLayout}
                    onScroll={onScroll}
                    scrollEventThrottle={scrollEventThrottle}
                    drawDistance={FLASH_LIST_DRAW_DISTANCE}
                    ListHeaderComponent={
                        <View style={styles.feedChromeHeader}>
                            {eventSection!=='plans'&&external.error&&<Pressable onPress={()=>void external.refresh()} style={{padding:16}} accessibilityRole="button"><Text style={{color:colors.textMuted}}>{t('events.unavailable')} · {t('events.retry')}</Text></Pressable>}
                            <View style={styles.quickFiltersRow}>
                                <PressScale
                                    style={[
                                        styles.quickFilterPill,
                                        styles.quickFilterBox,
                                        hasSheetFilters ? styles.quickFilterActive : null,
                                    ]}
                                    onPress={openFiltersModal}
                                    pressedScale={0.96}
                                    haptic={false}
                                >
                                    <Ionicons
                                        name="options"
                                        size={15}
                                        color={hasSheetFilters ? theme.colors.surface : PRIMARY_DARK}
                                    />
                                    <Text
                                        style={[
                                            styles.quickFilterText,
                                            hasSheetFilters ? { color: theme.colors.surface } : null,
                                        ]}
                                        numberOfLines={1}
                                    >
                                        {t('feed.filters')}
                                    </Text>
                                </PressScale>
                            </View>
                        </View>
                    }
                    ListEmptyComponent={
                        eventSection==='agenda' ? <View style={{padding:28,alignItems:'center'}}><Ionicons name="calendar-outline" size={40} color={colors.primary}/><Text style={{fontSize:20,fontWeight:'700',color:colors.text,marginTop:16}}>{t(external.loading?'events.loading':'events.empty')}</Text><Text style={{fontSize:14,lineHeight:22,color:colors.textMuted,marginTop:10,textAlign:'center'}}>{t('events.emptyBody')}</Text></View> : !loading ? (
                            <EmptySearch
                                loadError={loadError}
                                nearbyKm={nearbyKm}
                                nearestDistanceLabel={
                                    nearestOutsideNearby
                                        ? formatDistanceKm(nearestOutsideNearby.km, lang)
                                        : undefined
                                }
                                onRetry={() => requestFeedLoadRef.current({ refresh: true })}
                                onClear={() => {
                                    setSearch('');
                                    setSearchHits([]);
                                    setSearchExpanded([]);
                                    clearAllFilters();
                                    setLoadError(false);
                                }}
                                onWidenNearby={() => setNearbyKm(null)}
                                onCreate={() => router.push('/create-plan')}
                            />
                        ) : null
                    }
                    refreshControl={
                        <RefreshControl
                            refreshing={eventSection==='agenda'?external.loading:refreshing}
                            onRefresh={()=>{if(eventSection!=='agenda')onFeedRefresh();void external.refresh();}}
                            tintColor={theme.colors.textMuted}
                            colors={[theme.colors.primary]}
                            progressBackgroundColor={theme.colors.surface}
                        />
                    }
                    renderItem={renderPlanItem}
                    onViewableItemsChanged={onViewableItemsChanged}
                    viewabilityConfig={viewabilityConfig}
                    onEndReached={() => {
                        if (endReachedLockRef.current) return;
                        endReachedLockRef.current = true;
                        void Promise.all([eventSection!=='agenda'?loadMoreFeed():Promise.resolve(),eventSection!=='plans'?external.loadMore():Promise.resolve()]).finally(() => {
                            setTimeout(() => {
                                endReachedLockRef.current = false;
                            }, 650);
                        });
                    }}
                    onEndReachedThreshold={0.35}
                    ListFooterComponent={
                        (loadingMore||external.loading) ? (
                            <View style={styles.loadMoreFooter}>
                                <View style={styles.loadMoreDot} />
                                <View style={[styles.loadMoreDot, styles.loadMoreDotMid]} />
                                <View style={styles.loadMoreDot} />
                            </View>
                        ) : (
                            <View style={{ height: 12 }} />
                        )
                    }
                />
                {showFeedSkeleton && !refreshing && eventSection!=='agenda' ? (
                    <View style={styles.listLoadingOverlay} pointerEvents="none">
                        <FeedSkeletonList count={3} />
                    </View>
                ) : null}
            </View>

            <Modal
                visible={showFiltersModal}
                transparent
                animationType="none"
                onRequestClose={closeFiltersModal}
                statusBarTranslucent
            >
                <GestureHandlerRootView style={styles.modalOverlay}>
                    <Animated.View style={[styles.modalBackdrop, filtersBackdropStyle]}>
                        <Pressable style={StyleSheet.absoluteFill} onPress={closeFiltersModal} />
                    </Animated.View>
                    <Animated.View
                        style={[
                            styles.filtersSheet,
                            { paddingBottom: Math.max(insets.bottom, 16) + 12 },
                            filtersSheetStyle,
                        ]}
                    >
                        <GestureDetector gesture={filtersPanGesture}>
                            <Animated.View>
                                <View style={styles.filtersGrabberHit}>
                                    <View style={styles.filtersGrabber} />
                                </View>
                                <View style={styles.filtersHeader}>
                                    <View>
                                        <Text style={styles.modalTitle}>{t('feed.filters')}</Text>
                                        <Text style={styles.filtersSubtitle}>{t('feed.filtersHint')}</Text>
                                    </View>
                                    {hasSheetFilters ? (
                                        <TouchableOpacity
                                            onPress={() => {
                                                setSelectedCategories([]);
                                                setSelectedSubcategories([]);
                                                setDateFilter('all');
                                                setNearbyKm(null);
                                            }}
                                            hitSlop={8}
                                        >
                                            <Text style={styles.clearFiltersText}>{t('feed.clearFilters')}</Text>
                                        </TouchableOpacity>
                                    ) : null}
                                </View>
                            </Animated.View>
                        </GestureDetector>

                        <GHScrollView
                            style={styles.filtersScroll}
                            contentContainerStyle={styles.filtersScrollContent}
                            showsVerticalScrollIndicator={false}
                            keyboardShouldPersistTaps="handled"
                            nestedScrollEnabled
                            bounces={false}
                            scrollEventThrottle={16}
                            onScroll={(e) => {
                                filtersScrollY.value = e.nativeEvent.contentOffset.y;
                            }}
                        >
                            <View style={styles.filterSectionCard}>
                            <Text style={styles.filterSectionLabel}>{t('feed.category')}</Text>
                            <View style={styles.chipWrap}>
                                <TouchableOpacity
                                    style={[styles.filterChip, selectedCategories.length === 0 && styles.filterChipActive]}
                                    onPress={clearCategories}
                                >
                                    <Text style={[styles.filterChipText, selectedCategories.length === 0 && styles.filterChipTextActive]}>
                                        {t('cat.Todos')}
                                    </Text>
                                </TouchableOpacity>
                                {MAIN_CATEGORY_IDS.map((cat) => {
                                    const active = selectedCategories.includes(cat);
                                    const accent = MAIN_CATEGORY_COLORS[cat];
                                    return (
                                        <TouchableOpacity
                                            key={cat}
                                            style={[
                                                styles.filterChip,
                                                styles.filterChipRow,
                                                active && { backgroundColor: accent, borderColor: accent },
                                            ]}
                                            onPress={() => toggleCategory(cat)}
                                        >
                                            <Ionicons
                                                name={MAIN_CATEGORY_ICONS[cat] as keyof typeof Ionicons.glyphMap}
                                                size={15}
                                                color={active ? '#FFF' : accent}
                                            />
                                            <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                                                {t(`cat.main.${cat}`)}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                            </View>

                            <View style={styles.filterSectionCard}>
                            <Text style={styles.filterSectionLabel}>{t('feed.subcategory')}</Text>
                            {selectedCategories.length === 0 ? (
                                <Text style={styles.filterHint}>{t('feed.pickCategoryFirst')}</Text>
                            ) : (
                                <View style={styles.chipWrap}>
                                    <TouchableOpacity
                                        style={[styles.filterChip, selectedSubcategories.length === 0 && styles.filterChipActive]}
                                        onPress={() => {
                                            hapticSelection();
                                            setSelectedSubcategories([]);
                                        }}
                                    >
                                        <Text style={[styles.filterChipText, selectedSubcategories.length === 0 && styles.filterChipTextActive]}>
                                            {t('feed.allSubcategories')}
                                        </Text>
                                    </TouchableOpacity>
                                    {subcategoryOptions.map((sub) => {
                                        const active = selectedSubcategories.includes(sub);
                                        return (
                                            <TouchableOpacity
                                                key={sub}
                                                style={[styles.filterChip, active && styles.filterChipActive]}
                                                onPress={() => {
                                                    hapticSelection();
                                                    setSelectedSubcategories((prev) => toggleInList(prev, sub));
                                                }}
                                            >
                                                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                                                    {t(`cat.sub.${sub}`)}
                                                </Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                            )}
                            </View>

                            <View style={styles.filterSectionCard}>
                            <Text style={styles.filterSectionLabel}>{t('feed.date')}</Text>
                            <View style={styles.dateFilterRow}>
                                {DATE_KEYS.map((key) => {
                                    const active = dateFilter === key;
                                    return (
                                        <TouchableOpacity
                                            key={key}
                                            style={[styles.dateFilterChip, active && styles.dateFilterChipActive]}
                                            onPress={() => {
                                                hapticSelection();
                                                setDateFilter(key);
                                            }}
                                        >
                                            <Text style={[styles.dateFilterChipText, active && styles.dateFilterChipTextActive]}>
                                                {t('date.' + key)}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                            </View>

                            <View style={styles.filterSectionCard}>
                            <Text style={styles.filterSectionLabel}>{t('feed.nearby')}</Text>
                            <View style={styles.chipWrap}>
                                <TouchableOpacity
                                    style={[styles.filterChip, nearbyKm == null && styles.filterChipActive]}
                                    onPress={() => setNearbyKm(null)}
                                >
                                    <Text style={[styles.filterChipText, nearbyKm == null && styles.filterChipTextActive]}>
                                        {t('feed.nearbyAny')}
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.filterChip, nearbyKm === 4 && styles.filterChipActive]}
                                    onPress={() => void enableNearby(4)}
                                >
                                    <Text style={[styles.filterChipText, nearbyKm === 4 && styles.filterChipTextActive]}>
                                        {t('feed.nearbyNear')}
                                    </Text>
                                </TouchableOpacity>
                            </View>
                            </View>
                        </GHScrollView>

                        <TouchableOpacity
                            style={styles.applyFiltersBtn}
                            onPress={closeFiltersModal}
                        >
                            <Text style={styles.applyFiltersBtnText}>{t('feed.applyFilters')}</Text>
                        </TouchableOpacity>
                    </Animated.View>
                </GestureHandlerRootView>
            </Modal>

            <FeedHeartBurstHost />
            </View>
            </View>
    );
}

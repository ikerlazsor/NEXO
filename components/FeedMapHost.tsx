import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    BackHandler,
    Dimensions,
    FlatList,
    NativeScrollEvent,
    NativeSyntheticEvent,
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import Animated, {
    cancelAnimation,
    Easing,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NexoMapView } from './NexoMapView';
import { PlanImage } from './PlanImage';
import { ProfileAvatar } from './ProfileAvatar';
import { createFeedStyles } from '../features/feed/feedStyles';
import { useThemedStyles } from '../lib/appTheme';
import { useAuthSession } from '../lib/authSession';
import { getCategoryColor, getCategoryIcon, getPlanCategoryDisplay, resolvePlanCategories } from '../lib/categories';
import { FEED_CACHE_KEY, type FeedSnapshot } from '../lib/feedCache';
import { subscribeOpenFeedMap, consumePendingOpenFeedMap, peekPendingOpenFeedMap } from '../lib/feedMapIntent';
import { attachFeedPlanPeople, fetchUpcomingFeedPlanRows } from '../lib/feedQuery';
import { fetchGuestFeedPlans } from '../lib/guestFeed';
import { distanceKm } from '../lib/geo';
import { useT } from '../lib/i18n';
import { getUserCoords, peekUserCoords, type UserCoords } from '../lib/location';
import { hydrateFeedFromDisk } from '../lib/prefetchHome';
import { prefetchPlanDetail, seedPlanDetailFromFeed } from '../lib/planDetailCache';
import { formatProfilePlanWhen } from '../lib/profileSocial';
import { resolvePlanImageSource } from '../lib/sports';
import { theme } from '../theme';
import { cacheGetStale } from '../lib/ttlCache';
import { lockTabPager, unlockTabPager } from '../lib/tabPagerScroll';

const INK = theme.colors.text;
const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
const MAP_SLIDE_MS = 320;

/** Madrid ciudad + alrededores. */
const MADRID_REGION = {
    latitude: 40.4168,
    longitude: -3.7038,
    latitudeDelta: 0.28,
    longitudeDelta: 0.28,
};

/** Más zoom al seleccionar (delta más bajo = más cerca). */
const SELECT_DELTA = 0.052;
/** Fracción del delta que desplaza el centro al sur → el pin queda más arriba en pantalla. */
const SELECT_CENTER_LAT_SHIFT = 0.18;
/** Copias del carrusel para loop infinito (impar → el bloque del medio es el “real”). */
const CAROUSEL_LOOPS = 5;
const MAP_FOCUS_MS = 280;

type MapPlan = Record<string, unknown> & {
    id: string | number;
    latitud?: number | null;
    longitud?: number | null;
    titulo?: string | null;
    imagen_url?: string | null;
    fecha_evento?: string | null;
    categoria?: string | null;
    tipo_deporte?: string | null;
    maximo_participantes?: number | null;
    nombre_ubicacion?: string | null;
    joinedCount?: number;
    participantsList?: Array<{ id: string; avatar_url?: string | null; nombre?: string | null }>;
};

function planAccentColor(plan: { categoria?: string | null; tipo_deporte?: string | null }): string {
    return getCategoryColor(plan.categoria ?? null, plan.tipo_deporte ?? null);
}

function hasMapCoords(p: { latitud?: unknown; longitud?: unknown }): boolean {
    const lat = Number(p.latitud);
    const lng = Number(p.longitud);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    if (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01) return false;
    return true;
}

function sortMapPlans(plans: MapPlan[], userCoords: UserCoords | null): MapPlan[] {
    const out = [...plans];
    if (userCoords) {
        out.sort((a, b) => {
            const da = distanceKm(userCoords.latitude, userCoords.longitude, Number(a.latitud), Number(a.longitud));
            const db = distanceKm(userCoords.latitude, userCoords.longitude, Number(b.latitud), Number(b.longitud));
            return da - db;
        });
    }
    return out.slice(0, 80);
}

function readMapPlans(userCoords: UserCoords | null): MapPlan[] {
    const snap = cacheGetStale<FeedSnapshot>(FEED_CACHE_KEY);
    const plans = Array.isArray(snap?.plans) ? snap!.plans : [];
    const out: MapPlan[] = [];
    for (const p of plans) {
        if (!hasMapCoords(p)) continue;
        out.push(p as MapPlan);
    }
    return sortMapPlans(out, userCoords);
}

function formatDist(km: number, lang: string): string {
    if (km < 1) return `${Math.round(km * 1000)} m`;
    return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/**
 * Pin estático: no cambia de layout al seleccionar (evita el bug de iOS
 * donde el marker custom desaparece o deja un halo raro).
 */
function FeedMapPin({
    id,
    latitude,
    longitude,
    count,
    color,
    onPress,
}: {
    id: string;
    latitude: number;
    longitude: number;
    count: number;
    color: string;
    onPress: () => void;
}) {
    const styles = useThemedStyles(createFeedStyles);
    // iOS/Android a menudo pintan el marker custom vacío si tracksViewChanges
    // empieza en false; un frame en true fija el color de categoría.
    const [tracks, setTracks] = useState(true);
    useEffect(() => {
        const t = requestAnimationFrame(() => setTracks(false));
        return () => cancelAnimationFrame(t);
    }, [color, count]);

    return (
        <Marker
            identifier={id}
            coordinate={{ latitude, longitude }}
            tracksViewChanges={tracks}
            anchor={{ x: 0.5, y: 1 }}
            stopPropagation
            onPress={(e) => {
                e?.stopPropagation?.();
                onPress();
            }}
        >
            <View collapsable={false} style={styles.mapPinHit}>
                <View style={[styles.mapPinBubble, { backgroundColor: color }]}>
                    <Ionicons name="people" size={11} color="#FFF" />
                    <Text style={styles.mapPinCount}>{count}</Text>
                </View>
                <View style={[styles.mapPinTail, { borderTopColor: color }]} />
            </View>
        </Marker>
    );
}

export function FeedMapHost() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { t, lang } = useT();
    const styles = useThemedStyles(createFeedStyles);
    const { userId } = useAuthSession();
    const [visible, setVisible] = useState(false);
    const [userCoords, setUserCoords] = useState<UserCoords | null>(() => peekUserCoords());
    const [selectedId, setSelectedId] = useState<string | null>(null);
    /** Plan centrado en el carrusel (borde de color aunque no haya selección). */
    const [peekPlanId, setPeekPlanId] = useState<string | null>(null);
    const [tick, setTick] = useState(0);
    const [remotePlans, setRemotePlans] = useState<MapPlan[] | null>(null);
    const [loadingPlans, setLoadingPlans] = useState(false);
    const mapRef = useRef<any>(null);
    const carouselRef = useRef<FlatList>(null);
    const pendingPlanIdRef = useRef<string | null>(null);
    const closeHandledRef = useRef(false);
    const selectedIdRef = useRef<string | null>(null);
    const jumpingLoopRef = useRef(false);
    const mapAnimTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const didInitCarousel = useRef(false);
    /** Evita auto-seleccionar al abrir. */
    const userEngagedRef = useRef(false);
    const scrollOffsetRef = useRef(0);
    const loadGenRef = useRef(0);
    const slideY = useSharedValue(SCREEN_H);

    const sheetStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: slideY.value }],
    }));

    const resetAfterClose = useCallback(() => {
        setVisible(false);
        setSelectedId(null);
        setPeekPlanId(null);
        selectedIdRef.current = null;
        didInitCarousel.current = false;
        userEngagedRef.current = false;
    }, []);

    const animateSheetOpen = useCallback(() => {
        cancelAnimation(slideY);
        slideY.value = SCREEN_H;
        requestAnimationFrame(() => {
            slideY.value = withTiming(0, {
                duration: MAP_SLIDE_MS,
                easing: Easing.out(Easing.cubic),
            });
        });
    }, [slideY]);

    const animateSheetClose = useCallback(
        (onFinished?: () => void) => {
            cancelAnimation(slideY);
            slideY.value = withTiming(
                SCREEN_H,
                {
                    duration: MAP_SLIDE_MS,
                    easing: Easing.in(Easing.cubic),
                },
                (finished) => {
                    if (!finished) return;
                    runOnJS(resetAfterClose)();
                    if (onFinished) runOnJS(onFinished)();
                },
            );
        },
        [resetAfterClose, slideY],
    );

    const refreshPlansInBackground = useCallback(
        (gen: number, peeked: UserCoords | null) => {
            void (async () => {
                try {
                    let coords = peeked ?? (await getUserCoords({ requestPermission: false }));
                    if (gen !== loadGenRef.current) return;
                    if (coords) setUserCoords(coords);

                    const cached = readMapPlans(coords);
                    if (cached.length > 0) return;

                    await hydrateFeedFromDisk(userId);
                    if (gen !== loadGenRef.current) return;
                    setTick((n) => n + 1);
                    const fromDisk = readMapPlans(coords);
                    if (fromDisk.length > 0) return;

                    const nowIso = new Date().toISOString();
                    const fallbackCoords = coords ?? {
                        latitude: MADRID_REGION.latitude,
                        longitude: MADRID_REGION.longitude,
                    };

                    let enriched: MapPlan[] = [];
                    if (!userId) {
                        const guestRows = await fetchGuestFeedPlans(fallbackCoords);
                        enriched = guestRows.filter(hasMapCoords) as MapPlan[];
                    } else {
                        const rows = await fetchUpcomingFeedPlanRows({
                            nowIso,
                            coords: fallbackCoords,
                        });
                        const withCoords = rows.filter(hasMapCoords) as MapPlan[];
                        try {
                            enriched = withCoords.length > 0
                                ? ((await attachFeedPlanPeople(withCoords as any)) as MapPlan[])
                                : [];
                        } catch {
                            enriched = withCoords;
                        }
                    }
                    if (gen !== loadGenRef.current) return;
                    const sorted = sortMapPlans(enriched.filter(hasMapCoords) as MapPlan[], coords);
                    if (sorted.length > 0) setRemotePlans(sorted);
                } catch (e) {
                    if (__DEV__) console.error('map plans refresh:', e);
                }
            })();
        },
        [userId],
    );

    const mapCardWidth = Math.min(320, Math.max(268, SCREEN_W - 48));
    const mapCardGap = 12;
    const mapCardInterval = mapCardWidth + mapCardGap;
    const mapSidePad = Math.max(16, (SCREEN_W - mapCardWidth) / 2);

    const cachedPlans = useMemo(() => readMapPlans(userCoords), [userCoords, tick, visible]);
    const plans = remotePlans ?? cachedPlans;

    const loopedPlans = useMemo(() => {
        if (plans.length === 0) return [] as MapPlan[];
        if (plans.length === 1) return plans;
        const out: MapPlan[] = [];
        for (let i = 0; i < CAROUSEL_LOOPS; i++) out.push(...plans);
        return out;
    }, [plans]);

    const middleBlock = plans.length > 1 ? plans.length * Math.floor(CAROUSEL_LOOPS / 2) : 0;

    const snapOffsets = useMemo(
        () => loopedPlans.map((_, i) => i * mapCardInterval),
        [loopedPlans, mapCardInterval],
    );

    const open = useCallback(() => {
        const gen = ++loadGenRef.current;
        setTick((n) => n + 1);
        setVisible(true);
        animateSheetOpen();
        didInitCarousel.current = false;
        userEngagedRef.current = false;
        selectedIdRef.current = null;
        setSelectedId(null);
        setPeekPlanId(null);
        scrollOffsetRef.current = 0;
        consumePendingOpenFeedMap();

        const peeked = peekUserCoords();
        if (peeked) setUserCoords(peeked);

        const initial = readMapPlans(peeked);
        if (initial.length > 0) {
            setRemotePlans(null);
            setLoadingPlans(false);
            refreshPlansInBackground(gen, peeked);
            return;
        }

        setLoadingPlans(true);

        void (async () => {
            try {
                let coords = peeked ?? (await getUserCoords({ requestPermission: true }));
                if (gen !== loadGenRef.current) return;
                if (coords) setUserCoords(coords);

                let geo = readMapPlans(coords);
                if (geo.length === 0) {
                    await hydrateFeedFromDisk(userId);
                    if (gen !== loadGenRef.current) return;
                    setTick((n) => n + 1);
                    geo = readMapPlans(coords);
                }
                if (geo.length > 0) {
                    setRemotePlans(null);
                    setLoadingPlans(false);
                    return;
                }

                const nowIso = new Date().toISOString();
                const fallbackCoords = coords ?? {
                    latitude: MADRID_REGION.latitude,
                    longitude: MADRID_REGION.longitude,
                };

                let enriched: MapPlan[] = [];
                if (!userId) {
                    const guestRows = await fetchGuestFeedPlans(fallbackCoords);
                    enriched = guestRows.filter(hasMapCoords) as MapPlan[];
                } else {
                    const rows = await fetchUpcomingFeedPlanRows({
                        nowIso,
                        coords: fallbackCoords,
                    });
                    const withCoords = rows.filter(hasMapCoords) as MapPlan[];
                    try {
                        enriched = withCoords.length > 0
                            ? ((await attachFeedPlanPeople(withCoords as any)) as MapPlan[])
                            : [];
                    } catch {
                        enriched = withCoords;
                    }
                }
                if (gen !== loadGenRef.current) return;
                setRemotePlans(sortMapPlans(enriched.filter(hasMapCoords) as MapPlan[], coords));
            } catch (e) {
                if (__DEV__) console.error('map plans load:', e);
            } finally {
                if (gen === loadGenRef.current) setLoadingPlans(false);
            }
        })();
    }, [userId, refreshPlansInBackground, animateSheetOpen]);

    useEffect(() => {
        const unsub = subscribeOpenFeedMap(open);
        if (peekPendingOpenFeedMap()) open();
        return unsub;
    }, [open]);

    useEffect(() => {
        void getUserCoords({ requestPermission: false }).then((coords) => {
            if (coords) setUserCoords(coords);
        });
    }, []);

    useEffect(() => {
        if (!visible) return;
        closeHandledRef.current = false;
        lockTabPager();
        return () => unlockTabPager();
    }, [visible]);

    useEffect(() => {
        if (visible) return;
        if (closeHandledRef.current && !pendingPlanIdRef.current) return;
        const t = setTimeout(() => {
            if (closeHandledRef.current) return;
            closeHandledRef.current = true;
            const planId = pendingPlanIdRef.current;
            pendingPlanIdRef.current = null;
            if (!planId) return;
            router.push({ pathname: '/plan/[id]', params: { id: planId } });
        }, Platform.OS === 'ios' ? 360 : 280);
        return () => clearTimeout(t);
    }, [visible, router]);

    useEffect(() => {
        if (!visible) return;
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            pendingPlanIdRef.current = null;
            animateSheetClose();
            return true;
        });
        return () => sub.remove();
    }, [visible, animateSheetClose]);

    useEffect(() => {
        selectedIdRef.current = selectedId;
    }, [selectedId]);

    const animateMapToPlan = useCallback((plan: MapPlan, duration = MAP_FOCUS_MS) => {
        const lat = Number(plan.latitud);
        const lng = Number(plan.longitud);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        if (mapAnimTimer.current) clearTimeout(mapAnimTimer.current);
        mapAnimTimer.current = setTimeout(() => {
            try {
                const latShift = SELECT_DELTA * SELECT_CENTER_LAT_SHIFT;
                mapRef.current?.animateToRegion(
                    {
                        latitude: lat - latShift,
                        longitude: lng,
                        latitudeDelta: SELECT_DELTA,
                        longitudeDelta: SELECT_DELTA,
                    },
                    duration,
                );
            } catch {
                /* ignore */
            }
        }, 16);
    }, []);

    /** Scroll nativo a la copia más cercana (sin RAF custom = sin trabarse). */
    const scrollCarouselToPlan = useCallback(
        (planId: string, animated = true) => {
            if (plans.length === 0 || mapCardInterval <= 0) return;
            const realIdx = plans.findIndex((p) => String(p.id) === planId);
            if (realIdx < 0) return;

            let bestIdx = plans.length === 1 ? 0 : middleBlock + realIdx;
            if (plans.length > 1) {
                const currentRaw = scrollOffsetRef.current / mapCardInterval;
                let bestDist = Number.POSITIVE_INFINITY;
                for (let loop = 0; loop < CAROUSEL_LOOPS; loop++) {
                    const idx = loop * plans.length + realIdx;
                    const dist = Math.abs(idx - currentRaw);
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestIdx = idx;
                    }
                }
            }

            const offset = bestIdx * mapCardInterval;
            jumpingLoopRef.current = true;
            carouselRef.current?.scrollToOffset({ offset, animated });
            scrollOffsetRef.current = offset;
            setTimeout(() => {
                jumpingLoopRef.current = false;
            }, animated ? 320 : 0);
        },
        [plans, middleBlock, mapCardInterval],
    );

    const focusPlanId = useCallback(
        (planId: string, opts?: { scroll?: boolean; mapDuration?: number }) => {
            userEngagedRef.current = true;
            if (selectedIdRef.current !== planId) {
                selectedIdRef.current = planId;
                setSelectedId(planId);
            }
            setPeekPlanId(planId);
            const plan = plans.find((p) => String(p.id) === planId);
            if (plan) animateMapToPlan(plan, opts?.mapDuration ?? MAP_FOCUS_MS);
            if (opts?.scroll !== false) {
                scrollCarouselToPlan(planId, true);
            }
        },
        [plans, animateMapToPlan, scrollCarouselToPlan],
    );

    useEffect(() => {
        if (!visible || plans.length === 0) return;
        // Al abrir: sin plan seleccionado, mapa en Madrid; carrusel en el bloque medio.
        if (didInitCarousel.current) return;
        didInitCarousel.current = true;
        userEngagedRef.current = false;
        selectedIdRef.current = null;
        setSelectedId(null);
        const midPlan = plans[0];
        if (midPlan) setPeekPlanId(String(midPlan.id));
        const target = middleBlock;
        scrollOffsetRef.current = target * mapCardInterval;
        requestAnimationFrame(() => {
            carouselRef.current?.scrollToOffset({
                offset: target * mapCardInterval,
                animated: false,
            });
        });
    }, [visible, plans, middleBlock, mapCardInterval]);

    const openPlan = useCallback((plan: MapPlan) => {
        const planId = String(plan.id);
        const snap = cacheGetStale<FeedSnapshot>(FEED_CACHE_KEY);
        try {
            seedPlanDetailFromFeed(plan, {
                membership: snap?.membershipMap?.[planId] || 'none',
            });
            prefetchPlanDetail(planId);
        } catch {
            /* ignore */
        }
        pendingPlanIdRef.current = planId;
        closeHandledRef.current = false;
        animateSheetClose();
        setSelectedId(null);
        selectedIdRef.current = null;
        didInitCarousel.current = false;
        userEngagedRef.current = false;
    }, [animateSheetClose]);

    const onCardPress = useCallback(
        (plan: MapPlan) => {
            const planId = String(plan.id);
            if (selectedIdRef.current === planId) {
                openPlan(plan);
                return;
            }
            focusPlanId(planId, { scroll: true, mapDuration: MAP_FOCUS_MS });
        },
        [openPlan, focusPlanId],
    );

    const onCarouselScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
        scrollOffsetRef.current = e.nativeEvent.contentOffset.x;
    }, []);

    const rebalanceLoop = useCallback(
        (offsetX: number) => {
            if (plans.length <= 1) return;
            const raw = Math.round(offsetX / mapCardInterval);
            const realIdx = ((raw % plans.length) + plans.length) % plans.length;
            const nearStart = raw < plans.length;
            const nearEnd = raw >= plans.length * (CAROUSEL_LOOPS - 1);
            if (!nearStart && !nearEnd) return;
            const target = middleBlock + realIdx;
            const nextOffset = target * mapCardInterval;
            jumpingLoopRef.current = true;
            carouselRef.current?.scrollToOffset({
                offset: nextOffset,
                animated: false,
            });
            scrollOffsetRef.current = nextOffset;
            requestAnimationFrame(() => {
                jumpingLoopRef.current = false;
            });
        },
        [plans.length, mapCardInterval, middleBlock],
    );

    const onCarouselSettled = useCallback(
        (e: NativeSyntheticEvent<NativeScrollEvent>) => {
            if (plans.length === 0 || jumpingLoopRef.current) return;
            const offsetX = e.nativeEvent.contentOffset.x;
            scrollOffsetRef.current = offsetX;
            const snappedIdx = Math.round(offsetX / mapCardInterval);
            const realIdx = ((snappedIdx % plans.length) + plans.length) % plans.length;
            const plan = plans[realIdx];
            if (plan) {
                const planId = String(plan.id);
                setPeekPlanId(planId);
                if (userEngagedRef.current) {
                    if (selectedIdRef.current !== planId) {
                        selectedIdRef.current = planId;
                        setSelectedId(planId);
                    }
                    animateMapToPlan(plan, MAP_FOCUS_MS);
                }
            }
            rebalanceLoop(offsetX);
        },
        [plans, mapCardInterval, animateMapToPlan, rebalanceLoop],
    );

    const closeMap = useCallback(() => {
        pendingPlanIdRef.current = null;
        animateSheetClose();
    }, [animateSheetClose]);

    return (
        <View style={mapHostStyles.host} pointerEvents="box-none">
            <Animated.View
                style={[mapHostStyles.sheet, sheetStyle]}
                pointerEvents={visible ? 'auto' : 'none'}
            >
            <View style={styles.mapModalContainer}>
                <NexoMapView
                    ref={mapRef}
                    style={mapHostStyles.map}
                    loadingEnabled={false}
                    showsUserLocation={!!userCoords}
                    moveOnMarkerPress={false}
                    toolbarEnabled={false}
                    pitchEnabled={false}
                    rotateEnabled={false}
                    initialRegion={MADRID_REGION}
                    minZoomLevel={2}
                    maxZoomLevel={19}
                >
                    {plans.map((p) => {
                        const lat = Number(p.latitud);
                        const lng = Number(p.longitud);
                        const count = Number(p.joinedCount ?? p.participantsList?.length ?? 0);
                        const planId = String(p.id);
                        const accent = planAccentColor(p);
                        return (
                            <FeedMapPin
                                key={`${planId}:${accent}`}
                                id={planId}
                                latitude={lat}
                                longitude={lng}
                                count={count}
                                color={accent}
                                onPress={() => focusPlanId(planId, { scroll: true, mapDuration: MAP_FOCUS_MS })}
                            />
                        );
                    })}
                </NexoMapView>

                <View style={styles.mapModalHeader}>
                    <TouchableOpacity style={styles.mapCloseBtn} onPress={closeMap}>
                        <Ionicons name="chevron-back" size={24} color={INK} />
                    </TouchableOpacity>
                </View>

                {loadingPlans && plans.length === 0 ? (
                    <View style={styles.mapModalFooter}>
                        <ActivityIndicator color={theme.colors.brand} />
                        <Text style={[styles.mapFooterHint, { marginTop: 10 }]}>{t('feed.mapLoading')}</Text>
                    </View>
                ) : plans.length === 0 ? (
                    <View style={styles.mapModalFooter}>
                        <Text style={styles.mapFooterHint}>{t('feed.filterZoneEmpty')}</Text>
                    </View>
                ) : (
                    <View style={[styles.mapCarouselWrap, { bottom: Math.max(insets.bottom, 8) + 10 }]} pointerEvents="box-none">
                        <FlatList
                            ref={carouselRef}
                            data={loopedPlans}
                            keyExtractor={(item, index) => `${String(item.id)}:${index}`}
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            snapToOffsets={snapOffsets}
                            disableIntervalMomentum
                            decelerationRate="fast"
                            snapToAlignment="start"
                            directionalLockEnabled
                            nestedScrollEnabled
                            keyboardShouldPersistTaps="handled"
                            contentContainerStyle={[styles.mapCarousel, { paddingHorizontal: mapSidePad }]}
                            getItemLayout={(_, index) => ({
                                length: mapCardInterval,
                                offset: mapCardInterval * index,
                                index,
                            })}
                            onScrollBeginDrag={() => {
                                userEngagedRef.current = true;
                            }}
                            onScroll={onCarouselScroll}
                            scrollEventThrottle={32}
                            onMomentumScrollEnd={onCarouselSettled}
                            onScrollToIndexFailed={() => {}}
                            renderItem={({ item }) => {
                                const selected = selectedId != null && String(item.id) === String(selectedId);
                                const peeked =
                                    selectedId == null &&
                                    peekPlanId != null &&
                                    String(item.id) === String(peekPlanId);
                                const showAccent = selected || peeked;
                                const count = Number(item.joinedCount ?? item.participantsList?.length ?? 0);
                                const max = Number(item.maximo_participantes) || 0;
                                const people = Array.isArray(item.participantsList)
                                    ? item.participantsList.slice(0, 5)
                                    : [];
                                const when = formatProfilePlanWhen(item.fecha_evento, lang === 'en' ? 'en' : 'es');
                                const cat = typeof item.categoria === 'string' ? item.categoria : null;
                                const tipo =
                                    typeof item.tipo_deporte === 'string' ? item.tipo_deporte : null;
                                const catColor = planAccentColor({ categoria: cat, tipo_deporte: tipo });
                                const resolved = resolvePlanCategories({ categoria: cat, tipo_deporte: tipo });
                                const catLabel = getPlanCategoryDisplay(
                                    { categoria: cat, tipo_deporte: tipo },
                                    t,
                                );
                                const catIcon = getCategoryIcon(resolved.main ?? cat);
                                const loc = typeof item.nombre_ubicacion === 'string' ? item.nombre_ubicacion : '';
                                const dist =
                                    userCoords && Number.isFinite(Number(item.latitud)) && Number.isFinite(Number(item.longitud))
                                        ? distanceKm(
                                              userCoords.latitude,
                                              userCoords.longitude,
                                              Number(item.latitud),
                                              Number(item.longitud),
                                          )
                                        : null;
                                return (
                                    <TouchableOpacity
                                        activeOpacity={0.92}
                                        onPress={() => onCardPress(item)}
                                        style={[
                                            styles.mapMiniCard,
                                            { width: mapCardWidth, marginRight: mapCardGap },
                                            selected && styles.mapMiniCardOn,
                                            showAccent && { borderColor: catColor },
                                        ]}
                                    >
                                        <View>
                                            <PlanImage
                                                source={resolvePlanImageSource(item.imagen_url)}
                                                style={styles.mapMiniImage}
                                                recyclingKey={String(item.id)}
                                            />
                                            <LinearGradient
                                                colors={['rgba(15,23,42,0.15)', 'transparent', 'rgba(15,23,42,0.55)']}
                                                locations={[0, 0.45, 1]}
                                                style={styles.mapMiniImageScrim}
                                            >
                                                {catLabel ? (
                                                    <View style={[styles.mapMiniCatChip, { backgroundColor: catColor }]}>
                                                        <Ionicons
                                                            name={catIcon as keyof typeof Ionicons.glyphMap}
                                                            size={12}
                                                            color="#FFF"
                                                        />
                                                        <Text style={styles.mapMiniCatText} numberOfLines={1}>
                                                            {catLabel}
                                                        </Text>
                                                    </View>
                                                ) : (
                                                    <View />
                                                )}
                                                <View style={styles.mapMiniSpotsPill}>
                                                    <Ionicons name="people" size={12} color={INK} />
                                                    <Text style={styles.mapMiniSpotsText}>
                                                        {max > 0 ? `${count}/${max}` : String(count)}
                                                    </Text>
                                                </View>
                                            </LinearGradient>
                                        </View>
                                        <View style={styles.mapMiniBody}>
                                            <Text style={styles.mapMiniTitle} numberOfLines={2}>
                                                {item.titulo}
                                            </Text>
                                            {when ? (
                                                <View style={styles.mapMiniMetaRow}>
                                                    <Ionicons name="calendar-outline" size={14} color="#64748B" />
                                                    <Text style={styles.mapMiniWhen} numberOfLines={1}>
                                                        {when}
                                                    </Text>
                                                    {dist != null ? (
                                                        <Text style={styles.mapMiniDist}>{formatDist(dist, lang)}</Text>
                                                    ) : null}
                                                </View>
                                            ) : null}
                                            {loc ? (
                                                <View style={styles.mapMiniMetaRow}>
                                                    <Ionicons name="location-outline" size={14} color="#64748B" />
                                                    <Text style={styles.mapMiniLoc} numberOfLines={1}>
                                                        {loc}
                                                    </Text>
                                                </View>
                                            ) : null}
                                            <View style={styles.mapMiniPeopleRow}>
                                                <View style={styles.mapMiniAvatars}>
                                                    {people.map((person, index) => (
                                                        <View
                                                            key={person.id}
                                                            style={[
                                                                styles.mapMiniAvatarWrap,
                                                                { marginLeft: index === 0 ? 0 : -8, zIndex: 5 - index },
                                                            ]}
                                                        >
                                                            <ProfileAvatar
                                                                uri={person.avatar_url}
                                                                name={person.nombre ?? 'U'}
                                                                size={26}
                                                                recyclingKey={person.id}
                                                            />
                                                        </View>
                                                    ))}
                                                </View>
                                                <View style={[styles.mapMiniOpenBtn, { backgroundColor: catColor }]}>
                                                    <Text style={styles.mapMiniOpenText}>{t('feed.mapOpenPlan')}</Text>
                                                    <Ionicons name="chevron-forward" size={14} color="#FFF" />
                                                </View>
                                            </View>
                                        </View>
                                    </TouchableOpacity>
                                );
                            }}
                        />
                    </View>
                )}
            </View>
            </Animated.View>
        </View>
    );
}

const mapHostStyles = StyleSheet.create({
    host: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 200,
        elevation: 200,
    },
    sheet: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: theme.colors.background,
    },
    map: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
    },
});

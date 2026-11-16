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
import { Marker } from 'react-native-maps';
import Animated, { Easing, FadeIn, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NexoMapView } from './NexoMapView';
import { PlanImage } from './PlanImage';
import { runAfterNavTransition } from '../lib/afterTransition';
import { peekMapSnapshot, saveMapSnapshot, warmMapSnapshot } from '../lib/mapSnapshot';
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
import { ensureAutoProfilePlace } from '../lib/profilePlace';
import { resolvePlanImageSource } from '../lib/sports';
import { theme } from '../theme';
import { cacheGetStale } from '../lib/ttlCache';
import { lockTabPager, unlockTabPager } from '../lib/tabPagerScroll';

import { useEvents } from '../features/events/useEvents';
import { eventClassification, eventCoverSource } from '../features/events/covers';
import type { ExternalEvent } from '../features/events/types';
import { discoveryPins, validMapCoordinates } from '../lib/mapDiscovery';
import { createMapCameraLifecycle, validMapRegion } from '../lib/mapCameraLifecycle';
const INK = theme.colors.text;
const SCREEN_W = Dimensions.get('window').width;
/** El panel vive montado fuera de pantalla; abrir = deslizarlo, sin crear el mapa. */
const SHEET_HIDDEN_Y = Dimensions.get('screen').height + 40;

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
    externalEvent?: ExternalEvent;
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

const hasMapCoords = validMapCoordinates;

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

export function FeedMapHost() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { t, lang } = useT();
    const styles = useThemedStyles(createFeedStyles);
    const { userId } = useAuthSession();
    const [visible, setVisible] = useState(false);
    const [renderMap, setRenderMap] = useState(false);
    // Captura del mapa (última apertura) mientras el nativo carga teselas; el mapa
    // real entra con fundido al cargar, así el panel nunca aparece vacío.
    const [snapshotUri, setSnapshotUri] = useState<string | null>(() => peekMapSnapshot());
    const mapOpacity = useSharedValue(0);
    const mapFadeStyle = useAnimatedStyle(() => ({ opacity: mapOpacity.value }));
    const snapshotTakenRef = useRef(false);
    useEffect(() => {
        void warmMapSnapshot().then(() => setSnapshotUri(peekMapSnapshot()));
    }, []);
    const revealMap = useCallback(() => {
        mapOpacity.value = withTiming(1, { duration: 240 });
    }, [mapOpacity]);
    // Si onMapLoaded no llega (p. ej. sin red), mostrar el mapa igualmente.
    useEffect(() => {
        const timer = setTimeout(revealMap, 2500);
        return () => clearTimeout(timer);
    }, [revealMap]);
    // El mapa nativo se monta una vez (oculto bajo la pantalla) y carga sus teselas
    // en segundo plano: al abrir solo se desliza el panel, ya pintado.
    const sheetY = useSharedValue(SHEET_HIDDEN_Y);
    const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetY.value }] }));
    const mapReadyRef = useRef(false);
    const [viewport, setViewport] = useState(MADRID_REGION);
    const [userCoords, setUserCoords] = useState<UserCoords | null>(() => peekUserCoords());
    const [selectedId, setSelectedId] = useState<string | null>(null);
    /** Plan centrado en el carrusel (borde de color aunque no haya selección). */
    const [peekPlanId, setPeekPlanId] = useState<string | null>(null);
    const [tick, setTick] = useState(0);
    const [remotePlans, setRemotePlans] = useState<MapPlan[] | null>(null);
    const [loadingPlans, setLoadingPlans] = useState(false);
    // Eventos cargados desde que el panel se monta (no al abrir): los pines ya
    // están cuando el usuario pulsa el mapa.
    const external = useEvents({}, userId, true);
    const mapRef = useRef<any>(null);
    const carouselRef = useRef<FlatList>(null);
    const pendingPlanIdRef = useRef<string | null>(null);
    const closeHandledRef = useRef(false);
    const selectedIdRef = useRef<string | null>(null);
    const jumpingLoopRef = useRef(false);
    const didInitCarousel = useRef(false);
    /** Evita auto-seleccionar al abrir. */
    const userEngagedRef = useRef(false);
    const scrollOffsetRef = useRef(0);
    const loadGenRef = useRef(0);
    const closingRef = useRef(false);
    const visibleRef = useRef(false);
    const camera = useRef<ReturnType<typeof createMapCameraLifecycle> | null>(null);
    if (!camera.current) camera.current = createMapCameraLifecycle((region, duration) => {
        mapRef.current?.animateToRegion(region, duration);
    });
    const mapEpochRef = useRef(0);

    const finishDismiss = useCallback(() => {
        if (closeHandledRef.current || !closingRef.current) return;
        closeHandledRef.current = true;
        setRenderMap(false);
        setSelectedId(null);
        setPeekPlanId(null);
        selectedIdRef.current = null;
        didInitCarousel.current = false;
        userEngagedRef.current = false;
        closingRef.current = false;
        const planId = pendingPlanIdRef.current;
        pendingPlanIdRef.current = null;
        if (planId?.startsWith('event:')) router.push({ pathname: '/event/[id]', params: { id: planId.slice(6) } });
        else if (planId) router.push({ pathname: '/plan/[id]', params: { id: planId } });
    }, [router]);

    const animateSheetClose = useCallback(() => {
        if (!visibleRef.current || closingRef.current) return;
        closingRef.current = true;
        visibleRef.current = false;
        camera.current!.close();
        loadGenRef.current++;
        setVisible(false);
        // Al terminar de bajar el panel (y no antes) se abre el detalle, para que
        // dos transiciones nunca se solapen.
        sheetY.value = withTiming(
            SHEET_HIDDEN_Y,
            { duration: 280, easing: Easing.in(Easing.cubic) },
            (finished) => { if (finished) runOnJS(finishDismiss)(); },
        );
    }, [finishDismiss, sheetY]);
    const onSheetOpened = useCallback(() => {
        if (visibleRef.current && !closingRef.current) setRenderMap(true);
    }, []);
    useEffect(() => () => { camera.current?.close(); loadGenRef.current++; }, []);

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
                        enriched = guestRows.filter((row) => hasMapCoords(row)) as MapPlan[];
                    } else {
                        const rows = await fetchUpcomingFeedPlanRows({
                            nowIso,
                            coords: fallbackCoords,
                        });
                        const withCoords = rows.filter((row) => hasMapCoords(row)) as MapPlan[];
                        try {
                            enriched = withCoords.length > 0
                                ? ((await attachFeedPlanPeople(withCoords as any)) as MapPlan[])
                                : [];
                        } catch {
                            enriched = withCoords;
                        }
                    }
                    if (gen !== loadGenRef.current) return;
                    const sorted = sortMapPlans(enriched.filter((row) => hasMapCoords(row)) as MapPlan[], coords);
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
    // Keep both kinds represented even when the cached Nexo list fills the cap.
    const allPlans = useMemo(() => {
        const local = sortMapPlans(remotePlans ?? cachedPlans, userCoords);
        const events: MapPlan[] = external.events.map(event => ({
            id: `event:${event.id}`,
            externalEvent: event,
            latitud: event.latitude,
            longitud: event.longitude,
            titulo: event.title,
            fecha_evento: event.starts_at,
            categoria: eventClassification(event).category,
            tipo_deporte: eventClassification(event).subcategory,
            nombre_ubicacion: event.venue,
            joinedCount: external.social[event.id]?.count ?? 0,
            participantsList: external.social[event.id]?.people.map(person => ({
                id: person.user_id,
                nombre: person.nombre,
                avatar_url: person.avatar_url,
            })) ?? [],
        }));
        const nearbyEvents = sortMapPlans(events, userCoords);
        return sortMapPlans([
            ...local.slice(0, Math.max(40, 80 - nearbyEvents.length)),
            ...nearbyEvents.slice(0, Math.max(40, 80 - local.length)),
        ], userCoords);
    }, [remotePlans, cachedPlans, external.events, external.social, userCoords]);
    const plans = useMemo(() => allPlans.filter(hasMapCoords), [allPlans]);
    const pins = useMemo(() => discoveryPins(plans, MADRID_REGION, selectedId), [plans, selectedId]);
    const { loading: eventsLoading, error: eventsError, hasMore: moreEvents, loadMore: loadMoreEvents } = external;
    useEffect(() => {
        if (!eventsLoading && !eventsError && moreEvents && external.events.length < 90) {
            void loadMoreEvents();
        }
    }, [eventsLoading, eventsError, moreEvents, external.events.length, loadMoreEvents]);
    useEffect(() => {
        if (!visible) return;
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            pendingPlanIdRef.current = null;
            animateSheetClose();
            return true;
        });
        return () => sub.remove();
    }, [visible, animateSheetClose]);

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
        if (visibleRef.current || closingRef.current) return;
        visibleRef.current = true;
        closeHandledRef.current = false;
        mapEpochRef.current = camera.current!.open();
        // El mapa sigue montado de la vez anterior: la cámara ya puede moverse.
        if (mapReadyRef.current) camera.current!.ready(mapEpochRef.current);
        const gen = ++loadGenRef.current;
        setRenderMap(false);
        setSnapshotUri(peekMapSnapshot());
        setTick((n) => n + 1);
        setVisible(true);
        sheetY.value = withTiming(
            0,
            { duration: 340, easing: Easing.out(Easing.cubic) },
            (finished) => { if (finished) runOnJS(onSheetOpened)(); },
        );
        didInitCarousel.current = false;
        userEngagedRef.current = false;
        selectedIdRef.current = null;
        setSelectedId(null);
        setPeekPlanId(null);
        scrollOffsetRef.current = 0;
        consumePendingOpenFeedMap();

        const peeked = peekUserCoords();
        if (peeked) setUserCoords(peeked);
        else setUserCoords(null);

        const initial = readMapPlans(peeked);
        if (initial.length > 0) {
            setRemotePlans(null);
            setLoadingPlans(false);
            // Con planes ya en caché el panel se pinta al instante; la recarga espera
            // a que termine el deslizamiento para no repintarlo a mitad.
            runAfterNavTransition(() => {
                if (gen === loadGenRef.current) refreshPlansInBackground(gen, peeked);
            }, 420);
            return;
        }

        setLoadingPlans(true);

        void (async () => {
            try {
                // No bloquear el mapa si el GPS tarda: Madrid/fallback ya está en initialRegion.
                const coordsPromise = peeked
                    ? Promise.resolve(peeked)
                    : getUserCoords({ requestPermission: true });
                let coords = await coordsPromise;
                if (gen !== loadGenRef.current) return;
                setUserCoords(coords);
                if (coords && userId) void ensureAutoProfilePlace(userId);

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
                    enriched = guestRows.filter((row) => hasMapCoords(row)) as MapPlan[];
                } else {
                    const rows = await fetchUpcomingFeedPlanRows({
                        nowIso,
                        coords: fallbackCoords,
                    });
                    const withCoords = rows.filter((row) => hasMapCoords(row)) as MapPlan[];
                    try {
                        enriched = withCoords.length > 0
                            ? ((await attachFeedPlanPeople(withCoords as any)) as MapPlan[])
                            : [];
                    } catch {
                        enriched = withCoords;
                    }
                }
                if (gen !== loadGenRef.current) return;
                setRemotePlans(sortMapPlans(enriched.filter((row) => hasMapCoords(row)) as MapPlan[], coords));
            } catch (e) {
                if (__DEV__) console.error('map plans load:', e);
            } finally {
                if (gen === loadGenRef.current) setLoadingPlans(false);
            }
        })();
    }, [userId, refreshPlansInBackground, onSheetOpened, sheetY]);

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

    /** Misma distancia (delta) que Madrid; centro = usuario si hay permiso, si no Madrid. */
    const latitude = userCoords?.latitude, longitude = userCoords?.longitude;
    useEffect(() => {
        if (!visible) return;
        const target = latitude != null && longitude != null
            ? {
                  latitude,
                  longitude,
                  latitudeDelta: MADRID_REGION.latitudeDelta,
                  longitudeDelta: MADRID_REGION.longitudeDelta,
              }
            : MADRID_REGION;
        camera.current!.move(target, 280);
    }, [visible, latitude, longitude]);

    useEffect(() => {
        if (!visible) return;
        lockTabPager();
        return () => unlockTabPager();
    }, [visible]);

    useEffect(() => {
        selectedIdRef.current = selectedId;
    }, [selectedId]);

    const animateMapToPlan = useCallback((plan: MapPlan, duration = MAP_FOCUS_MS) => {
        const lat = Number(plan.latitud);
        const lng = Number(plan.longitud);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const latShift = SELECT_DELTA * SELECT_CENTER_LAT_SHIFT;
        camera.current!.move({ latitude: lat - latShift, longitude: lng,
            latitudeDelta: SELECT_DELTA, longitudeDelta: SELECT_DELTA }, duration);
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
        // El carrusel solo existe cuando el panel ya terminó de deslizarse (renderMap).
        if (!visible || !renderMap || plans.length === 0) return;
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
    }, [visible, renderMap, plans, middleBlock, mapCardInterval]);

    const openPlan = useCallback((plan: MapPlan) => {
        const planId = String(plan.id);
        const snap = cacheGetStale<FeedSnapshot>(FEED_CACHE_KEY);
        try {
            if (!plan.externalEvent) { seedPlanDetailFromFeed(plan, {
                membership: snap?.membershipMap?.[planId] || 'none',
            });
            prefetchPlanDetail(planId); }
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
        <Animated.View
            pointerEvents={visible ? 'auto' : 'none'}
            importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
            accessibilityElementsHidden={!visible}
            style={[StyleSheet.absoluteFill, mapHostStyles.sheet, sheetStyle]}>
            <View style={styles.mapModalContainer}>
                {/* Fondo siempre presente: captura del mapa (o fondo liso la primera vez).
                    El mapa real entra con fundido encima cuando ha cargado. */}
                {snapshotUri ? (
                    <Image
                        source={{ uri: snapshotUri }}
                        style={mapHostStyles.map}
                        contentFit="cover"
                        transition={0}
                        cachePolicy="none"
                        onError={() => setSnapshotUri(null)}
                    />
                ) : (
                    <View style={[mapHostStyles.map, { backgroundColor: theme.colors.backgroundAlt, alignItems: 'center', justifyContent: 'center', gap: 12 }]}>
                        <Ionicons name="map-outline" size={40} color={theme.colors.primary} />
                        <ActivityIndicator color={theme.colors.primary} />
                    </View>
                )}
                <Animated.View style={[mapHostStyles.map, mapFadeStyle]}><NexoMapView
                    ref={mapRef}
                    style={StyleSheet.absoluteFill}
                    loadingEnabled={false}
                    // Oculto no pide GPS (evita la flecha de ubicación y gasto de batería).
                    showsUserLocation={visible && !!userCoords}
                    moveOnMarkerPress={false}
                    toolbarEnabled={false}
                    pitchEnabled={false}
                    rotateEnabled={false}
                    initialRegion={MADRID_REGION}
                    minZoomLevel={2}
                    maxZoomLevel={19}
                    onRegionChangeComplete={region => {
                        if (camera.current!.isActive(mapEpochRef.current) && validMapRegion(region)) setViewport(region);
                    }}
                    onMapReady={() => {
                        mapReadyRef.current = true;
                        camera.current!.ready(mapEpochRef.current);
                    }}
                    onMapLoaded={() => {
                        revealMap();
                        // Una captura por sesión del encuadre inicial (respaldo visual).
                        if (snapshotTakenRef.current || userEngagedRef.current || !visibleRef.current) return;
                        snapshotTakenRef.current = true;
                        setTimeout(() => {
                            if (!visibleRef.current || userEngagedRef.current) return;
                            mapRef.current
                                ?.takeSnapshot({ format: 'jpg', quality: 0.7, result: 'file' })
                                .then((uri: string) => saveMapSnapshot(uri))
                                .catch(() => undefined);
                        }, 600);
                    }}
                >
                    {pins.map(pin => <Marker
                        key={pin.key}
                        identifier={pin.key}
                        coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
                        pinColor={pin.color}
                        tracksViewChanges={false}
                        title={pin.members.length > 1 ? t('feed.mapGroup', { n: pin.members.length }) : pin.members[0].titulo || ''}
                        onPress={() => {
                            if (pin.members.length === 1) focusPlanId(String(pin.members[0].id), { scroll: true, mapDuration: MAP_FOCUS_MS });
                            else camera.current!.move({ latitude: pin.latitude, longitude: pin.longitude, latitudeDelta: Math.max(0.001, viewport.latitudeDelta / 3), longitudeDelta: Math.max(0.001, viewport.longitudeDelta / 3) }, 250);
                        }}
                    />)}
                </NexoMapView></Animated.View>

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
                ) : !renderMap ? null : (
                    <Animated.View
                        entering={FadeIn.duration(260)}
                        style={[styles.mapCarouselWrap, { bottom: Math.max(insets.bottom, 8) + 10 }]}
                        pointerEvents="box-none"
                    >
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
                                const people: NonNullable<MapPlan['participantsList']> = Array.isArray(
                                    item.participantsList,
                                )
                                    ? item.participantsList.slice(0, 5)
                                    : [];
                                const when = formatProfilePlanWhen(item.fecha_evento, lang);
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
                                                source={item.externalEvent ? eventCoverSource(item.externalEvent) : resolvePlanImageSource(item.imagen_url)}
                                                style={styles.mapMiniImage}
                                                recyclingKey={String(item.id)}
                                                thumbWidth={280}
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
                                                {count > 0 && <View style={styles.mapMiniSpotsPill}>
                                                    <Ionicons name="people" size={12} color={INK} />
                                                    <Text style={styles.mapMiniSpotsText}>
                                                        {max > 0 ? `${count}/${max}` : String(count)}
                                                    </Text>
                                                </View>}
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
                    </Animated.View>
                )}
            </View>
        </Animated.View>
    );
}

const mapHostStyles = StyleSheet.create({
    // Por encima de la cabecera y la barra inferior del chrome (zIndex 30).
    sheet: { zIndex: 1000, elevation: 1000 },
    map: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
    },
});

/*
pantalla principal / home feed de planes
*/
import {
    Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback,
    useEffect,
    useMemo,
    useRef,
    useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import {
    AppState,
    type AppStateStatus,
    InteractionManager,
    Keyboard,
    Modal,
    Platform,
    Pressable,
    RefreshControl,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
    type ViewToken,
} from 'react-native';
import { Alert } from '../../lib/nexoAlert';
import MapView, { Marker } from 'react-native-maps';
import { NexoMapView } from '../../components/NexoMapView';
import { useListScrollRestore } from '../../hooks/useListScrollRestore';
import { PlanCard, type Membership } from '../../components/PlanCard';
import { PlanImage } from '../../components/PlanImage';
import { FeedSkeletonList } from '../../components/SkeletonShimmer';
import {
    consumeFeedNeedsRefresh,
    subscribeFeedHomeRetap,
} from '../../lib/feedReload';
import {
    invalidatePlanDetailCache,
    prefetchPlanDetail,
    seedPlanDetailFromFeed,
} from '../../lib/planDetailCache';
import { resolvePlanImageSource } from '../../lib/sports';
import { getAuthUser } from '../../lib/auth';
import { getCoincidedUserIds } from '../../lib/coincidences';
import { getFriends } from '../../lib/friends';
import { isFeedPlan } from '../../lib/feedPlans';
import { diskSet } from '../../lib/diskCache';
import { distanceKm, formatDistanceKm, isLocationInEurope } from '../../lib/geo';
import { consumeFirstRunPending } from '../../lib/firstRun';
import { hapticError, hapticLight, hapticSelection, hapticSuccess } from '../../lib/haptics';
import { useT } from '../../lib/i18n';
import { deletePlanCompletely } from '../../lib/deletePlan';
import { deletePlanAdmin } from '../../lib/moderation';
import { fetchAccountAccess } from '../../lib/roles';
import { getUserCoords, peekUserCoords, type UserCoords } from '../../lib/location';
import { withRetry } from '../../lib/retry';
import { getProfileNotificationCount } from '../../lib/notifications';
import { canSeePlanInFeed } from '../../lib/planVisibility';
import {
    MAIN_CATEGORY_IDS,
    SUBCATEGORIES,
    resolvePlanCategories,
    type MainCategoryId,
} from '../../lib/categories';
import {
    getScreenFilters,
    getScreenScrollOffset,
    ScreenKeys,
    setScreenFilters,
    setScreenScrollOffset,
} from '../../lib/screenState';
import { FLASH_LIST_DRAW_DISTANCE } from '../../lib/listConfig';
import { supabase } from '../../lib/supabase';
import { planMatchesProvince, SPAIN_PROVINCES } from '../../lib/provinces';
import {
    isAcceptedParticipant,
    mapEstadoToMembership,
    membershipFromJoinEstado,
    promoteWaitlist,
    resolveJoinEstado,
} from '../../lib/participants';
import type { Genero } from '../../lib/profileFields';
import { canJoinPlanByGender, isSoloChicasPlan } from '../../lib/soloChicas';
import { canJoinMorePlans } from '../../lib/planLimits';
import { isPlanActiveForFeed, runPlanLifecycleMaintenance } from '../../lib/planLifecycle';
import {
    buildFeedTaste,
    compareFeedAffinity,
    emptyFeedTaste,
    type FeedTaste,
} from '../../lib/feedAffinity';
import { expandSearchQuery, planMatchesSearch } from '../../lib/feedSearch';
import {
    FEED_CACHE_KEY,
    FEED_CACHE_TTL_MS,
    FEED_PLAN_COLUMNS,
    type FeedSnapshot,
} from '../../lib/feedCache';
import { cacheGetStale, cacheSet } from '../../lib/ttlCache';
import { invalidatePlanMembershipCaches } from '../../lib/screenCaches';
const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const BG_BOTTOM = '#F2F7FF';

const DATE_KEYS = ['all', 'today', 'week', 'month'];

function asStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
    }
    if (typeof value === 'string' && value && value !== 'Todos' && value !== 'all') {
        return [value];
    }
    return [];
}

function toggleInList(list: string[], item: string): string[] {
    return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

const EmptySearch = ({
    onClear,
    onCreate,
    loadError,
    onRetry,
}: {
    onClear: () => void;
    onCreate: () => void;
    loadError?: boolean;
    onRetry?: () => void;
}) => {
    const { t } = useT();
    if (loadError) {
        return (
            <View style={styles.emptyContainer}>
                <View style={styles.emptyIconWrap}>
                    <Ionicons name="cloud-offline-outline" size={56} color={PRIMARY} />
                </View>
                <Text style={styles.emptyTitle}>{t('feed.loadError')}</Text>
                <TouchableOpacity style={styles.createBtnEmpty} onPress={onRetry}>
                    <Text style={styles.createBtnEmptyText}>{t('feed.retry')}</Text>
                </TouchableOpacity>
            </View>
        );
    }
    return (
        <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}>
                <Ionicons name="compass-outline" size={56} color={PRIMARY} />
            </View>
            <Text style={styles.emptyTitle}>{t('feed.empty')}</Text>
            <Text style={styles.emptySubtitle}>{t('feed.emptySub')}</Text>
            <TouchableOpacity style={styles.createBtnEmpty} onPress={onCreate}>
                <Text style={styles.createBtnEmptyText}>{t('feed.emptyCreate')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClear} style={{ marginTop: 14 }}>
                <Text style={{ color: PRIMARY_DARK, fontWeight: '800' }}>{t('feed.emptySeeAll')}</Text>
            </TouchableOpacity>
        </View>
    );
};

let feedScrollTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Subida al tope del feed: una sola animación nativa.
 * (El RAF frame-a-frame congelaba FlashList, peor en Expo Go.)
 */
function smoothScrollListToTop(
    scrollToOffset: ((opts: { offset: number; animated?: boolean }) => void) | undefined,
    fromOffset: number,
    onDone?: () => void,
) {
    if (feedScrollTimer) {
        clearTimeout(feedScrollTimer);
        feedScrollTimer = null;
    }

    setScreenScrollOffset(ScreenKeys.FEED, 0);

    if (!scrollToOffset || fromOffset <= 16) {
        scrollToOffset?.({ offset: 0, animated: false });
        onDone?.();
        return;
    }

    scrollToOffset({ offset: 0, animated: true });
    const waitMs = Math.min(650, Math.max(280, 220 + Math.sqrt(fromOffset) * 10));
    feedScrollTimer = setTimeout(() => {
        feedScrollTimer = null;
        setScreenScrollOffset(ScreenKeys.FEED, 0);
        onDone?.();
    }, waitMs);
}

export default function HomeScreen() {
    const router = useRouter();
    const { t, lang } = useT();
    const savedFilters = getScreenFilters<{
        search: string;
        selectedFilter: string;
        selectedCategories: string[];
        selectedSubcategory: string | null;
        selectedSubcategories: string[];
        dateFilter: string;
        provinceFilter: string;
        selectedProvinces: string[];
    }>(ScreenKeys.FEED);

    const cachedFeed = cacheGetStale<FeedSnapshot>(FEED_CACHE_KEY);

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
    const [dateFilter, setDateFilter] = useState(savedFilters.dateFilter ?? 'all');
    const [selectedProvinces, setSelectedProvinces] = useState<string[]>(() => {
        if (Array.isArray(savedFilters.selectedProvinces)) {
            return asStringArray(savedFilters.selectedProvinces);
        }
        return asStringArray(savedFilters.provinceFilter);
    });
    const [showZoneModal, setShowZoneModal] = useState(false);
    const [mapSelectedId, setMapSelectedId] = useState<string | null>(null);
    const zoneMapRef = useRef<MapView | null>(null);
    const [showFiltersModal, setShowFiltersModal] = useState(false);
    const [showProvincePicker, setShowProvincePicker] = useState(false);
    const [nearbyKm, setNearbyKm] = useState<number | null>(null);
    const [userCoords, setUserCoords] = useState<UserCoords | null>(() => peekUserCoords());
    const [showFirstRun, setShowFirstRun] = useState(false);

    const [plans, setPlans] = useState<any[]>(() => cachedFeed?.plans ?? []);
    const [membershipMap, setMembershipMap] = useState<Record<string, Membership>>(
        () => cachedFeed?.membershipMap ?? {},
    );
    const [savedPlans, setSavedPlans] = useState<string[]>(() => cachedFeed?.savedPlans ?? []);
    const [currentUserId, setCurrentUserId] = useState<string | null>(() => cachedFeed?.currentUserId ?? null);
    const [currentUserGenero, setCurrentUserGenero] = useState<Genero | null>(
        () => cachedFeed?.currentUserGenero ?? null,
    );
    const [isOwner, setIsOwner] = useState(false);
    const [loading, setLoading] = useState(() => cachedFeed == null);
    const [refreshing, setRefreshing] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [joiningPlanId, setJoiningPlanId] = useState<string | null>(null);
    const joiningRef = useRef(false);
    const hasDataRef = useRef(cachedFeed != null);
    const [notifBreakdown, setNotifBreakdown] = useState(() => cachedFeed?.notifBreakdown ?? {
        friendRequests: 0,
        planRequests: 0,
        planInvites: 0,
    });
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
    const [searchExpanded, setSearchExpanded] = useState<string[]>([]);
    const plansRef = useRef<any[]>([]);
    const currentUserIdRef = useRef<string | null>(null);
    const { listRef, onScroll, restoreScroll, scrollEventThrottle } = useListScrollRestore(ScreenKeys.FEED);

    useEffect(() => {
        void consumeFirstRunPending().then((pending) => {
            if (pending) setShowFirstRun(true);
        });
        // Solo coords para mapa/distancias; no activar “Cerca” al abrir en frío.
        void getUserCoords({ requestPermission: false }).then((c) => {
            if (c) setUserCoords(c);
        });
    }, []);

    const enableNearby = useCallback(async (radius = 25) => {
        const coords = await getUserCoords({ requestPermission: true, force: true });
        if (!coords) {
            Alert.alert(t('feed.error'), t('feed.enableLocation'));
            return;
        }
        setUserCoords(coords);
        setNearbyKm(radius);
        setShowFirstRun(false);
        hapticSelection();
    }, [t]);

    useEffect(() => {
        setScreenFilters(ScreenKeys.FEED, {
            search,
            selectedCategories,
            selectedSubcategories,
            dateFilter,
            selectedProvinces,
        });
    }, [search, selectedCategories, selectedSubcategories, dateFilter, selectedProvinces]);

    useEffect(() => {
        const q = search.trim();
        if (q.length < 2) {
            setSearchExpanded([]);
            return;
        }
        let cancelled = false;
        const timer = setTimeout(() => {
            void expandSearchQuery(q).then((terms) => {
                if (!cancelled) setSearchExpanded(terms);
            });
        }, 280);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [search]);

    plansRef.current = plans;
    currentUserIdRef.current = currentUserId;

    const fetchData = useCallback(async (opts?: { refresh?: boolean; skipScrollJump?: boolean }) => {
        let finished = false;
        const isRefresh = !!opts?.refresh;
        const safetyTimer = setTimeout(() => {
            if (!finished) {
                setLoading(false);
                setRefreshing(false);
            }
        }, 12000);

        try {
            if (isRefresh) {
                setRefreshing(true);
            } else if (!hasDataRef.current) {
                setLoading(true);
            }
            setLoadError(false);

            const nowIso = new Date().toISOString();
            void runPlanLifecycleMaintenance();

            const userPromise = getAuthUser();
            const plansPromise = withRetry(async () => {
                const res = await supabase
                    .from('planes')
                    .select(FEED_PLAN_COLUMNS)
                    .or(`fecha_evento.is.null,fecha_evento.gte.${nowIso}`)
                    .order('fecha_evento', { ascending: true })
                    .limit(100);
                if (res.error) throw res.error;
                return res;
            });

            const [user, plansRes] = await Promise.all([userPromise, plansPromise]);
            setCurrentUserId(user?.id || null);
            if (user?.id) {
                void fetchAccountAccess(user.id).then((access) => setIsOwner(access.isOwner));
            } else {
                setIsOwner(false);
            }

            const safePlans = (plansRes.data || []).filter(isFeedPlan);
            const planIds = safePlans.map((p) => p.id);

            const partsPromise = planIds.length > 0
                ? supabase
                    .from('participantes')
                    .select('plan_id, usuario_id, estado, perfiles:usuario_id(id, nombre, avatar_url, genero)')
                    .in('plan_id', planIds)
                    .eq('estado', 'aceptado')
                : Promise.resolve({ data: [], error: null });

            const creatorIds = Array.from(new Set(safePlans.map((p) => p.creador_id).filter(Boolean)));
            const creatorsPromise = creatorIds.length > 0
                ? supabase
                    .from('perfiles')
                    .select('id, nombre, avatar_url, genero, ambientes_preferidos, etiquetas')
                    .in('id', creatorIds)
                : Promise.resolve({ data: [], error: null });

            const [partsRes, creatorsRes] = await Promise.all([partsPromise, creatorsPromise]);

            let partsByPlan: Record<string, any[]> = {};
            if (partsRes.error) {
                console.warn('Participantes del feed:', partsRes.error.message);
            } else {
                (partsRes.data || []).forEach((row: any) => {
                    if (!partsByPlan[row.plan_id]) partsByPlan[row.plan_id] = [];
                    partsByPlan[row.plan_id].push(row);
                });
            }

            const creatorMap = Object.fromEntries((creatorsRes.data || []).map((c) => [c.id, c]));

            const formattedPlans = safePlans.map((plan) => {
                const rawParticipants = partsByPlan[plan.id] || [];
                const accepted = rawParticipants.filter((p: any) => isAcceptedParticipant(p.estado));
                const list: any[] = [];
                const creator = creatorMap[plan.creador_id];
                if (creator) list.push({ ...creator, isCreator: true });
                accepted.forEach((p: any) => {
                    const prof = Array.isArray(p.perfiles) ? p.perfiles[0] : p.perfiles;
                    if (prof && prof.id !== plan.creador_id) list.push({ ...prof, isCreator: false });
                });
                return { ...plan, joinedCount: accepted.length, participantsList: list };
            });

            setPlans(formattedPlans);
            setLoading(false);

            let nextMembership: Record<string, Membership> = {};
            let nextSaved: string[] = [];
            let nextGenero: Genero | null = null;
            let nextFriends = new Set<string>();
            let nextCoincided = new Set<string>();
            let nextInvited = new Set<string>();
            let nextTaste = emptyFeedTaste();
            let nextNotifs = { friendRequests: 0, planRequests: 0, planInvites: 0 };

            if (user) {
                const [
                    profileRes,
                    notifs,
                    participantsRes,
                    savedRes,
                    friendsData,
                    createdPlansRes,
                    coincidedSet,
                    invitesRes,
                ] = await Promise.all([
                    supabase
                        .from('perfiles')
                        .select('genero, ambientes_preferidos, etiquetas')
                        .eq('id', user.id)
                        .maybeSingle(),
                    getProfileNotificationCount(user.id),
                    supabase.from('participantes').select('plan_id, estado').eq('usuario_id', user.id),
                    supabase.from('planes_guardados').select('plan_id').eq('usuario_id', user.id),
                    getFriends(user.id),
                    supabase
                        .from('planes')
                        .select('categoria, tipo_deporte')
                        .eq('creador_id', user.id)
                        .order('fecha_evento', { ascending: false })
                        .limit(40),
                    getCoincidedUserIds(user.id),
                    supabase
                        .from('invitaciones_planes')
                        .select('plan_id')
                        .eq('invitado_id', user.id)
                        .eq('estado', 'pendiente'),
                ]);

                nextGenero = (profileRes.data?.genero as Genero) ?? null;
                nextNotifs = {
                    friendRequests: notifs.friendRequests,
                    planRequests: notifs.planRequests,
                    planInvites: notifs.planInvites,
                };
                nextFriends = new Set(friendsData.map((f) => f.id));
                nextCoincided = coincidedSet;
                nextInvited = new Set((invitesRes.data ?? []).map((r) => r.plan_id as string));
                const map: Record<string, Membership> = {};
                (participantsRes.data || []).forEach((p: any) => {
                    const m = mapEstadoToMembership(p.estado);
                    if (m) map[p.plan_id] = m;
                });
                nextMembership = map;
                nextSaved = savedRes.data?.map((s) => s.plan_id) || [];

                setCurrentUserGenero(nextGenero);
                setNotifBreakdown(nextNotifs);
                setFriendIds(nextFriends);
                setCoincidedIds(nextCoincided);
                setInvitedPlanIds(nextInvited);
                setMembershipMap(nextMembership);
                setSavedPlans(nextSaved);

                const joinedPlanIds = (participantsRes.data || [])
                    .filter((p: any) => mapEstadoToMembership(p.estado) === 'joined')
                    .map((p: any) => p.plan_id as string);
                let joinedHistory: Array<{ categoria?: string | null; tipo_deporte?: string | null }> = [];
                if (joinedPlanIds.length > 0) {
                    const { data: joinedPlans } = await supabase
                        .from('planes')
                        .select('categoria, tipo_deporte')
                        .in('id', joinedPlanIds.slice(0, 50));
                    joinedHistory = joinedPlans || [];
                }
                const tags =
                    (Array.isArray(profileRes.data?.ambientes_preferidos) && profileRes.data.ambientes_preferidos.length
                        ? profileRes.data.ambientes_preferidos
                        : profileRes.data?.etiquetas) || [];
                nextTaste = buildFeedTaste(tags as string[], [
                    ...(createdPlansRes.data || []),
                    ...joinedHistory,
                ]);
                setFeedTaste(nextTaste);
            } else {
                nextNotifs = { friendRequests: 0, planRequests: 0, planInvites: 0 };
                nextFriends = new Set();
                nextCoincided = new Set();
                nextInvited = new Set();
                nextTaste = emptyFeedTaste();
                setNotifBreakdown(nextNotifs);
                setFriendIds(nextFriends);
                setCoincidedIds(nextCoincided);
                setInvitedPlanIds(nextInvited);
                setFeedTaste(nextTaste);
            }

            const snap: FeedSnapshot = {
                plans: formattedPlans,
                membershipMap: nextMembership,
                savedPlans: nextSaved,
                currentUserId: user?.id || null,
                currentUserGenero: nextGenero,
                friendIds: [...nextFriends],
                coincidedIds: [...nextCoincided],
                invitedPlanIds: [...nextInvited],
                feedTaste: nextTaste,
                notifBreakdown: nextNotifs,
            };
            cacheSet(FEED_CACHE_KEY, snap, FEED_CACHE_TTL_MS);
            void diskSet(FEED_CACHE_KEY, snap);
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
    }, []);

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

    const requestFeedLoad = useCallback((opts?: { refresh?: boolean; skipScrollJump?: boolean }) => {
        if (fetchInFlightRef.current) {
            // Casita / pull-to-refresh mientras ya carga: encolar una recarga al terminar.
            if (opts?.refresh) pendingFeedRefreshRef.current = true;
            return;
        }
        fetchInFlightRef.current = true;
        void fetchDataRef.current(opts).finally(() => {
            fetchInFlightRef.current = false;
            if (pendingFeedRefreshRef.current) {
                pendingFeedRefreshRef.current = false;
                requestFeedLoad({ refresh: true, skipScrollJump: true });
                return;
            }
            // Tras actualizar datos, recuperar scroll (si saliste a otra pantalla o volviste a la app).
            // En retap a casita ya vamos al tope con animación; no restaurar offset viejo.
            if (feedFocusedRef.current && !opts?.skipScrollJump) {
                restoreScroll();
            }
        });
    }, [restoreScroll]);

    // Tras crear un plan: recarga diferida (evita freeze al cerrar el modal).
    useFocusEffect(
        useCallback(() => {
            feedFocusedRef.current = true;
            let cancelled = false;
            let task: { cancel: () => void } | null = null;
            let timer: ReturnType<typeof setTimeout> | null = null;

            if (consumeFeedNeedsRefresh()) {
                didSessionFeedLoadRef.current = true;
                task = InteractionManager.runAfterInteractions(() => {
                    timer = setTimeout(() => {
                        if (!cancelled) {
                            requestFeedLoad({ refresh: true, skipScrollJump: true });
                        }
                    }, 280);
                });
            } else if (!hasDataRef.current || !didSessionFeedLoadRef.current) {
                didSessionFeedLoadRef.current = true;
                requestFeedLoad();
            }

            return () => {
                cancelled = true;
                task?.cancel?.();
                if (timer) clearTimeout(timer);
                feedFocusedRef.current = false;
            };
        }, [requestFeedLoad]),
    );

    // Fuera de la app → volver: una recarga (y luego restoreScroll).
    useEffect(() => {
        const sub = AppState.addEventListener('change', (next) => {
            const prev = appStateRef.current;
            appStateRef.current = next;
            const fromBackground = prev === 'background' || prev === 'inactive';
            if (fromBackground && next === 'active' && feedFocusedRef.current) {
                requestFeedLoad();
            }
        });
        return () => sub.remove();
    }, [requestFeedLoad]);

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
    }, [requestFeedLoad]);

    const handleJoin = async (planId: string) => {
        if (!currentUserId || joiningRef.current) return;
        const plan = plans.find(p => p.id === planId);
        if (!plan) return;

        if (!canJoinPlanByGender(plan, currentUserGenero)) {
            hapticError();
            Alert.alert(t('feed.error'), t('card.soloChicasOnly'));
            return;
        }

        const limitCheck = await canJoinMorePlans(currentUserId, planId);
        if (!limitCheck.allowed) {
            hapticError();
            Alert.alert(t('feed.error'), t('feed.planLimitReached', { max: limitCheck.max }));
            return;
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
            setPlans(prev => prev.map(p => p.id === planId ? { ...p, joinedCount: p.joinedCount + 1 } : p));
        }
        try {
            const { error } = await supabase.from('participantes').insert({ plan_id: planId, usuario_id: currentUserId, estado });
            if (error) {
                deferMineSortIdsRef.current.delete(planId);
                setMembershipMap(prevMap);
                setPlans(prevPlans);
                hapticError();
                Alert.alert(t('feed.error'), t('feed.joinError'));
            } else {
                hapticSuccess();
                invalidatePlanMembershipCaches(currentUserId);
                invalidatePlanDetailCache(planId);
                const { notifyPlanJoin, schedulePlanLifecycleReminders } = await import('../../lib/push');
                notifyPlanJoin(planId, estado);
                if (estado === 'aceptado') {
                    void schedulePlanLifecycleReminders({
                        planId,
                        planTitle: plan.titulo,
                        fechaEvento: plan.fecha_evento,
                        categoria: plan.categoria,
                        locationName: plan.nombre_ubicacion,
                    });
                    void import('../../lib/analytics').then(({ trackFunnel }) =>
                        trackFunnel('plan_join', { userId: currentUserId, props: { planId, estado } }),
                    );
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
                    const { error } = await supabase
                        .from('participantes')
                        .delete()
                        .eq('plan_id', planId)
                        .eq('usuario_id', currentUserId);
                    if (error) {
                        setMembershipMap(prevMap);
                        setPlans(prevPlans);
                        Alert.alert(t('feed.error'), t('feed.leaveError'));
                        return;
                    }
                    invalidatePlanMembershipCaches(currentUserId);
                    invalidatePlanDetailCache(planId);
                    if (wasJoined) {
                        await promoteWaitlist(planId);
                        fetchData();
                    }
                },
            },
        ]);
    };

    const handleSave = async (planId: string) => {
        if (!currentUserId) return;
        const isAlreadySaved = savedPlans.includes(planId);
        const prevSaved = savedPlans;
        hapticLight();
        if (isAlreadySaved) {
            setSavedPlans(prev => prev.filter(id => id !== planId));
            const { error } = await supabase.from('planes_guardados').delete().eq('plan_id', planId).eq('usuario_id', currentUserId);
            if (error) {
                setSavedPlans(prevSaved);
                hapticError();
                Alert.alert(t('feed.error'), t('feed.saveError'));
            }
        } else {
            setSavedPlans(prev => [...prev, planId]);
            const { error } = await supabase.from('planes_guardados').insert({ plan_id: planId, usuario_id: currentUserId });
            if (error) {
                setSavedPlans(prevSaved);
                hapticError();
                Alert.alert(t('feed.error'), t('feed.saveError'));
            }
        }
    };

    const handleDeletePlan = async (planId: string) => {
        Alert.alert(
            isOwner ? t('admin.deletePlanTitle') : t('feed.deletePlan'),
            isOwner ? t('admin.deletePlanMsg') : t('feed.deleteConfirm'),
            [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: isOwner ? t('admin.deletePlanConfirm') : t('feed.deletePlan'),
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
                            const { error } = isOwner
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
            const lat = Number(plan.latitud);
            const lng = Number(plan.longitud);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
            return formatDistanceKm(distanceKm(userCoords.latitude, userCoords.longitude, lat, lng), lang);
        },
        [userCoords, lang],
    );

    const renderPlanItem = useCallback(
        ({ item, index }: { item: any; index: number }) => (
            <PlanCard
                item={item}
                index={index}
                currentUserId={currentUserId}
                userGenero={currentUserGenero}
                membership={membershipMap[item.id] || 'none'}
                isSaved={savedPlans.includes(item.id)}
                friendIds={friendIds}
                coincidedIds={coincidedIds}
                isOwner={isOwner}
                distanceLabel={planDistanceLabel(item)}
                onJoin={handleJoin}
                joining={joiningPlanId === item.id}
                onLeave={handleLeave}
                onDelete={handleDeletePlan}
                onEdit={handleEditPlan}
                onToggleSave={handleSave}
                onOpenDetail={(planId) => {
                    const plan = plans.find((p) => String(p.id) === String(planId));
                    const mid = String(planId);
                    if (plan) {
                        seedPlanDetailFromFeed(plan, {
                            membership: membershipMap[mid] || 'none',
                        });
                    }
                    prefetchPlanDetail(mid);
                    router.push({ pathname: '/plan/[id]', params: { id: planId } });
                }}
                onParticipantsChanged={() => void fetchDataRef.current()}
                router={router}
            />
        ),
        [currentUserId, currentUserGenero, membershipMap, savedPlans, friendIds, coincidedIds, isOwner, router, planDistanceLabel, plans, joiningPlanId],
    );

    const matchesDate = (plan: any) => {
        if (dateFilter === 'all') return true;
        if (!plan.fecha_evento) return false;
        const d = new Date(plan.fecha_evento);
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (dateFilter === 'today') {
            return d.toDateString() === now.toDateString();
        }
        const days = dateFilter === 'week' ? 7 : 30;
        const limit = new Date(startOfToday);
        limit.setDate(limit.getDate() + days);
        return d >= startOfToday && d <= limit;
    };

    const filteredPlans = useMemo(() => {
        const isMinePlan = (p: any) => {
            // Tras unirte, el botón ya dice “unido”, pero no sube al tope hasta recargar.
            if (deferMineSortIdsRef.current.has(p.id)) return false;
            return (
                String(p.creador_id) === String(currentUserId)
                || membershipMap[p.id] === 'joined'
                || membershipMap[p.id] === 'requested'
            );
        };

        const membershipPlanIds = new Set(Object.keys(membershipMap));

        return plans
            .filter(p => {
                const { main, sub } = resolvePlanCategories(p);
                const categoryOk =
                    selectedCategories.length === 0
                    || (main != null && selectedCategories.includes(main))
                    || selectedCategories.includes(String(p.categoria || ''));
                const subcategoryOk =
                    selectedSubcategories.length === 0
                    || (sub != null && selectedSubcategories.includes(sub));
                const provinceOk =
                    selectedProvinces.length === 0
                    || selectedProvinces.some((prov) => planMatchesProvince(p, prov));

                let distanceOk = true;
                if (nearbyKm != null && userCoords) {
                    const lat = Number(p.latitud);
                    const lng = Number(p.longitud);
                    if (!Number.isFinite(lat) || !Number.isFinite(lng)) distanceOk = false;
                    else {
                        const d = distanceKm(userCoords.latitude, userCoords.longitude, lat, lng);
                        distanceOk = d <= nearbyKm;
                    }
                }

                return isPlanActiveForFeed(p)
                    && canSeePlanInFeed(p, {
                        userId: currentUserId,
                        friendIds,
                        membershipPlanIds,
                        invitedPlanIds,
                        isOwner,
                    })
                    && (isOwner || !isSoloChicasPlan(p) || currentUserGenero === 'femenino')
                    && categoryOk
                    && subcategoryOk
                    && provinceOk
                    && distanceOk
                    && planMatchesSearch(p, search, searchExpanded)
                    && matchesDate(p);
            })
            .sort((a, b) => {
                const am = isMinePlan(a) ? 0 : 1;
                const bm = isMinePlan(b) ? 0 : 1;
                if (am !== bm) return am - bm;
                if (userCoords) {
                    const da = Number.isFinite(Number(a.latitud))
                        ? distanceKm(userCoords.latitude, userCoords.longitude, Number(a.latitud), Number(a.longitud))
                        : Number.POSITIVE_INFINITY;
                    const db = Number.isFinite(Number(b.latitud))
                        ? distanceKm(userCoords.latitude, userCoords.longitude, Number(b.latitud), Number(b.longitud))
                        : Number.POSITIVE_INFINITY;
                    if (nearbyKm != null || Math.abs(da - db) > 0.05) {
                        if (da !== db) return da - db;
                    }
                }
                return compareFeedAffinity(a, b, feedTaste, friendIds);
            });
    }, [
        plans,
        currentUserId,
        currentUserGenero,
        membershipMap,
        friendIds,
        invitedPlanIds,
        isOwner,
        selectedCategories,
        selectedSubcategories,
        selectedProvinces,
        search,
        searchExpanded,
        dateFilter,
        feedTaste,
        nearbyKm,
        userCoords,
        mineSortEpoch,
    ]);

    /** Planes con coordenadas válidas en Europa para el mapa de zona. */
    const zoneMapPlans = useMemo(() => {
        const out: typeof filteredPlans = [];
        for (const p of filteredPlans) {
            const lat = Number(p.latitud);
            const lng = Number(p.longitud);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
            if (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01) continue;
            if (!isLocationInEurope(lat, lng)) continue;
            out.push(p);
            // Demasiados Marker nativos en Expo Go suelen crashear al tocar.
            if (out.length >= 80) break;
        }
        return out;
    }, [filteredPlans]);

    const filteredPlansRef = useRef(filteredPlans);
    filteredPlansRef.current = filteredPlans;
    const membershipMapRef = useRef(membershipMap);
    membershipMapRef.current = membershipMap;

    const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
        const indices = viewableItems
            .map((v) => v.index)
            .filter((i): i is number => typeof i === 'number' && i >= 0);
        if (indices.length === 0) return;
        const maxIdx = Math.max(...indices);
        const next = filteredPlansRef.current[maxIdx + 1];
        if (!next?.id) return;
        const mid = String(next.id);
        seedPlanDetailFromFeed(next, {
            membership: membershipMapRef.current[mid] || 'none',
        });
        prefetchPlanDetail(mid);
    }).current;

    const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 35, minimumViewTime: 120 }).current;

    const mapSelectedPlan = useMemo(
        () => zoneMapPlans.find((p) => String(p.id) === String(mapSelectedId)) ?? null,
        [zoneMapPlans, mapSelectedId],
    );

    const selectMapPlan = useCallback((planId: string) => {
        // Diferir el setState fuera del callback nativo del Marker (evita crash en Expo Go).
        requestAnimationFrame(() => {
            setMapSelectedId(planId);
        });
    }, []);

    const openPlanFromMap = useCallback((plan: (typeof zoneMapPlans)[number]) => {
        const planId = String(plan.id);
        try {
            seedPlanDetailFromFeed(plan, {
                membership: membershipMapRef.current[planId] || 'none',
            });
            prefetchPlanDetail(planId);
        } catch {
            /* ignore seed errors */
        }
        // Cerrar el mapa ANTES de navegar: MapView + Modal + push crashea a menudo en Expo Go.
        setShowZoneModal(false);
        setMapSelectedId(null);
        InteractionManager.runAfterInteractions(() => {
            setTimeout(() => {
                router.push({
                    pathname: '/plan/[id]',
                    params: { id: planId },
                });
            }, 80);
        });
    }, [router]);

    const scrollToPlanInFeed = (planId: string) => {
        const index = filteredPlans.findIndex((p) => String(p.id) === String(planId));
        setShowZoneModal(false);
        setMapSelectedId(null);
        if (index < 0) return;

        InteractionManager.runAfterInteractions(() => {
            requestAnimationFrame(() => {
                try {
                    listRef.current?.scrollToIndex({
                        index,
                        animated: true,
                        viewPosition: 0.12,
                    });
                } catch {
                    listRef.current?.scrollToOffset({
                        offset: Math.max(0, index * 320),
                        animated: true,
                    });
                }
            });
        });
    };

    const hasSheetFilters =
        selectedCategories.length > 0
        || selectedSubcategories.length > 0
        || dateFilter !== 'all'
        || selectedProvinces.length > 0
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
        setSelectedCategories([]);
        setSelectedSubcategories([]);
    };

    const clearAllFilters = () => {
        setSelectedCategories([]);
        setSelectedSubcategories([]);
        setDateFilter('all');
        setSelectedProvinces([]);
        setNearbyKm(null);
    };

    return (
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View style={{ flex: 1 }}>
            <StatusBar barStyle="dark-content" />
            <View style={styles.container}>
            <View style={styles.searchWrapper}>
                <View style={styles.searchContainer}>
                    <Ionicons name="search" size={20} color={PRIMARY_DARK} />
                    <TextInput placeholder={t('feed.searchPlaceholder')} placeholderTextColor="#94A3B8" style={styles.searchInput} value={search} onChangeText={setSearch} />
                </View>
            </View>

            <View style={styles.quickFiltersRow}>
                <TouchableOpacity
                    style={[styles.quickFilterPill, styles.quickFilterBox]}
                    onPress={() => setShowZoneModal(true)}
                >
                    <Ionicons name="map" size={15} color={PRIMARY_DARK} />
                    <Text style={styles.quickFilterText} numberOfLines={1}>
                        {t('feed.map')}
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.quickFilterPill, styles.quickFilterBox, hasSheetFilters ? styles.quickFilterActive : null]}
                    onPress={() => setShowFiltersModal(true)}
                >
                    <Ionicons name="options" size={15} color={hasSheetFilters ? '#FFF' : PRIMARY_DARK} />
                    <Text style={[styles.quickFilterText, hasSheetFilters ? { color: '#FFF' } : null]} numberOfLines={1}>
                        {t('feed.filters')}
                    </Text>
                </TouchableOpacity>
            </View>

            {showFirstRun ? (
                <View style={styles.firstRunBanner}>
                    <Text style={styles.firstRunTitle}>{t('feed.firstRunTitle')}</Text>
                    <Text style={styles.firstRunBody}>{t('feed.firstRunBody')}</Text>
                    <View style={styles.firstRunActions}>
                        <TouchableOpacity
                            style={styles.firstRunPrimary}
                            onPress={() => void enableNearby(25)}
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
                        <Ionicons name="close" size={18} color="#64748B" />
                    </TouchableOpacity>
                </View>
            ) : null}

            <View style={styles.listWrap}>
                <FlashList
                    ref={listRef}
                    style={{ flex: 1 }}
                    data={filteredPlans}
                    keyExtractor={(item) => item.id}
                    extraData={{ membershipMap, savedPlans, friendIds, coincidedIds, nearbyKm, userCoords }}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                    onScroll={onScroll}
                    scrollEventThrottle={scrollEventThrottle}
                    drawDistance={FLASH_LIST_DRAW_DISTANCE}
                    ListEmptyComponent={
                        !loading ? (
                            <EmptySearch
                                loadError={loadError}
                                onRetry={() => void fetchData({ refresh: true })}
                                onClear={() => {
                                    setSearch('');
                                    clearAllFilters();
                                    setLoadError(false);
                                }}
                                onCreate={() => router.push('/create-plan')}
                            />
                        ) : null
                    }
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={() => void fetchData({ refresh: true })}
                            tintColor={PRIMARY_DARK}
                        />
                    }
                    renderItem={renderPlanItem}
                    onViewableItemsChanged={onViewableItemsChanged}
                    viewabilityConfig={viewabilityConfig}
                />
                {loading && !refreshing && plans.length === 0 ? (
                    <View style={styles.listLoadingOverlay} pointerEvents="none">
                        <FeedSkeletonList count={3} />
                    </View>
                ) : null}
            </View>

            <Modal
                visible={showFiltersModal}
                transparent
                animationType="fade"
                onRequestClose={() => {
                    setShowFiltersModal(false);
                    setShowProvincePicker(false);
                }}
            >
                <View style={styles.modalOverlay}>
                    <Pressable
                        style={styles.modalBackdrop}
                        onPress={() => {
                            setShowFiltersModal(false);
                            setShowProvincePicker(false);
                        }}
                    />
                    <View style={styles.filtersSheet}>
                        <View style={styles.filtersHeader}>
                            <Text style={styles.modalTitle}>{t('feed.filters')}</Text>
                            {hasSheetFilters ? (
                                <TouchableOpacity
                                    onPress={() => {
                                        setSelectedCategories([]);
                                        setSelectedSubcategories([]);
                                        setDateFilter('all');
                                        setSelectedProvinces([]);
                                        setNearbyKm(null);
                                    }}
                                    hitSlop={8}
                                >
                                    <Text style={styles.clearFiltersText}>{t('feed.clearFilters')}</Text>
                                </TouchableOpacity>
                            ) : null}
                        </View>

                        <ScrollView
                            style={styles.filtersScroll}
                            contentContainerStyle={styles.filtersScrollContent}
                            showsVerticalScrollIndicator={false}
                            keyboardShouldPersistTaps="handled"
                            nestedScrollEnabled
                            bounces
                            alwaysBounceVertical
                            scrollEventThrottle={16}
                        >
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
                                    return (
                                        <TouchableOpacity
                                            key={cat}
                                            style={[styles.filterChip, active && styles.filterChipActive]}
                                            onPress={() => toggleCategory(cat)}
                                        >
                                            <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                                                {t(`cat.main.${cat}`)}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>

                            <Text style={styles.filterSectionLabel}>{t('feed.subcategory')}</Text>
                            {selectedCategories.length === 0 ? (
                                <Text style={styles.filterHint}>{t('feed.pickCategoryFirst')}</Text>
                            ) : (
                                <View style={styles.chipWrap}>
                                    <TouchableOpacity
                                        style={[styles.filterChip, selectedSubcategories.length === 0 && styles.filterChipActive]}
                                        onPress={() => setSelectedSubcategories([])}
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
                                                onPress={() => setSelectedSubcategories((prev) => toggleInList(prev, sub))}
                                            >
                                                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                                                    {t(`cat.sub.${sub}`)}
                                                </Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                            )}

                            <Text style={styles.filterSectionLabel}>{t('feed.date')}</Text>
                            <View style={styles.chipWrap}>
                                {DATE_KEYS.map((key) => {
                                    const active = dateFilter === key;
                                    return (
                                        <TouchableOpacity
                                            key={key}
                                            style={[styles.filterChip, active && styles.filterChipActive]}
                                            onPress={() => setDateFilter(key)}
                                        >
                                            <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                                                {t('date.' + key)}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>

                            <Text style={styles.filterSectionLabel}>{t('feed.province')}</Text>
                            {!showProvincePicker ? (
                                <TouchableOpacity
                                    style={styles.provinceToggle}
                                    onPress={() => setShowProvincePicker(true)}
                                    activeOpacity={0.75}
                                >
                                    <View style={styles.provinceToggleTextWrap}>
                                        <Text style={styles.provinceToggleTitle}>
                                            {selectedProvinces.length === 0
                                                ? t('feed.chooseProvinces')
                                                : selectedProvinces.length === 1
                                                    ? selectedProvinces[0]
                                                    : t('feed.provincesSelected', { n: selectedProvinces.length })}
                                        </Text>
                                        {selectedProvinces.length > 1 ? (
                                            <Text style={styles.provinceToggleHint} numberOfLines={1}>
                                                {selectedProvinces.join(', ')}
                                            </Text>
                                        ) : null}
                                    </View>
                                    <Ionicons name="chevron-down" size={18} color={PRIMARY_DARK} />
                                </TouchableOpacity>
                            ) : (
                                <View>
                                    <TouchableOpacity
                                        style={styles.provinceToggle}
                                        onPress={() => setShowProvincePicker(false)}
                                        activeOpacity={0.75}
                                    >
                                        <Text style={styles.provinceToggleTitle}>{t('feed.hideProvinces')}</Text>
                                        <Ionicons name="chevron-up" size={18} color={PRIMARY_DARK} />
                                    </TouchableOpacity>
                                    <View style={styles.chipWrap}>
                                        <TouchableOpacity
                                            style={[styles.filterChip, selectedProvinces.length === 0 && styles.filterChipActive]}
                                            onPress={() => setSelectedProvinces([])}
                                        >
                                            <Text style={[styles.filterChipText, selectedProvinces.length === 0 && styles.filterChipTextActive]}>
                                                {t('feed.allProvinces')}
                                            </Text>
                                        </TouchableOpacity>
                                        {SPAIN_PROVINCES.map((prov) => {
                                            const active = selectedProvinces.includes(prov);
                                            return (
                                                <TouchableOpacity
                                                    key={prov}
                                                    style={[styles.filterChip, active && styles.filterChipActive]}
                                                    onPress={() => setSelectedProvinces((prev) => toggleInList(prev, prov))}
                                                >
                                                    <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                                                        {prov}
                                                    </Text>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                </View>
                            )}

                            <Text style={styles.filterSectionLabel}>{t('feed.nearby')}</Text>
                            <Text style={styles.filterHint}>{t('feed.nearbyPickRadius')}</Text>
                            <View style={styles.chipWrap}>
                                <TouchableOpacity
                                    style={[styles.filterChip, nearbyKm == null && styles.filterChipActive]}
                                    onPress={() => setNearbyKm(null)}
                                >
                                    <Text style={[styles.filterChipText, nearbyKm == null && styles.filterChipTextActive]}>
                                        {t('feed.nearbyAny')}
                                    </Text>
                                </TouchableOpacity>
                                {([5, 10, 25] as const).map((n) => {
                                    const active = nearbyKm === n;
                                    return (
                                        <TouchableOpacity
                                            key={n}
                                            style={[styles.filterChip, active && styles.filterChipActive]}
                                            onPress={() => void enableNearby(n)}
                                        >
                                            <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                                                {t('feed.nearbyKm', { n })}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        </ScrollView>

                        <TouchableOpacity
                            style={styles.applyFiltersBtn}
                            onPress={() => {
                                setShowFiltersModal(false);
                                setShowProvincePicker(false);
                            }}
                        >
                            <Text style={styles.applyFiltersBtnText}>{t('feed.applyFilters')}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            <Modal
                visible={showZoneModal}
                animationType="slide"
                onRequestClose={() => {
                    setShowZoneModal(false);
                    setMapSelectedId(null);
                }}
            >
                <View style={styles.mapModalContainer}>
                    {showZoneModal ? (
                    <NexoMapView
                        ref={zoneMapRef}
                        style={StyleSheet.absoluteFill}
                        loadingEnabled
                        showsUserLocation={!!userCoords}
                        moveOnMarkerPress={false}
                        toolbarEnabled={false}
                        pitchEnabled={false}
                        rotateEnabled={false}
                        initialRegion={{
                            latitude: Number(
                                userCoords?.latitude
                                    ?? zoneMapPlans[0]?.latitud
                                    ?? 40.4168,
                            ),
                            longitude: Number(
                                userCoords?.longitude
                                    ?? zoneMapPlans[0]?.longitud
                                    ?? -3.7038,
                            ),
                            latitudeDelta: nearbyKm != null ? 0.35 : 0.22,
                            longitudeDelta: nearbyKm != null ? 0.35 : 0.22,
                        }}
                        onMapReady={() => {
                            if (zoneMapPlans.length === 0) return;
                            const coords = zoneMapPlans
                                .map((p) => ({
                                    latitude: Number(p.latitud),
                                    longitude: Number(p.longitud),
                                }))
                                .filter(
                                    (c) => Number.isFinite(c.latitude) && Number.isFinite(c.longitude),
                                );
                            if (coords.length === 0) return;
                            try {
                                zoneMapRef.current?.fitToCoordinates(coords, {
                                    edgePadding: { top: 90, right: 48, bottom: 160, left: 48 },
                                    animated: false,
                                });
                            } catch {
                                /* fitToCoordinates a veces falla en Expo Go */
                            }
                        }}
                    >
                        {zoneMapPlans.map((p) => {
                            const lat = Number(p.latitud);
                            const lng = Number(p.longitud);
                            return (
                                <Marker
                                    key={String(p.id)}
                                    identifier={String(p.id)}
                                    coordinate={{ latitude: lat, longitude: lng }}
                                    // Color fijo: mutar pinColor al tocar remonta el Marker nativo y crashea en Expo Go.
                                    pinColor="#2563EB"
                                    tracksViewChanges={false}
                                    stopPropagation
                                    onPress={(e) => {
                                        e?.stopPropagation?.();
                                        selectMapPlan(String(p.id));
                                    }}
                                />
                            );
                        })}
                    </NexoMapView>
                    ) : null}

                    <View style={styles.mapModalHeader}>
                        <TouchableOpacity
                            style={styles.mapCloseBtn}
                            onPress={() => {
                                setShowZoneModal(false);
                                setMapSelectedId(null);
                            }}
                        >
                            <Ionicons name="chevron-back" size={24} color={INK} />
                        </TouchableOpacity>
                    </View>

                    {zoneMapPlans.length === 0 ? (
                        <View style={styles.mapModalFooter}>
                            <Text style={styles.mapFooterHint}>{t('feed.filterZoneEmpty')}</Text>
                        </View>
                    ) : mapSelectedPlan ? (
                        <View style={styles.mapPreviewCard} pointerEvents="box-none">
                            <PlanImage
                                source={resolvePlanImageSource(mapSelectedPlan.imagen_url)}
                                style={styles.mapPreviewImage}
                                recyclingKey={String(mapSelectedPlan.id)}
                            />
                            <View style={styles.mapPreviewBody}>
                                <Text style={styles.mapPreviewTitle} numberOfLines={2}>
                                    {mapSelectedPlan.titulo}
                                </Text>
                                <Text style={styles.mapPreviewMeta} numberOfLines={1}>
                                    {mapSelectedPlan.nombre_ubicacion || t('card.location')}
                                    {planDistanceLabel(mapSelectedPlan)
                                        ? ` · ${planDistanceLabel(mapSelectedPlan)}`
                                        : ''}
                                </Text>
                                <View style={styles.mapPreviewActions}>
                                    <TouchableOpacity
                                        style={styles.mapPreviewSecondary}
                                        onPress={() => scrollToPlanInFeed(mapSelectedPlan.id)}
                                    >
                                        <Text style={styles.mapPreviewSecondaryText}>{t('feed.mapShowInList')}</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={styles.mapPreviewPrimary}
                                        onPress={() => openPlanFromMap(mapSelectedPlan)}
                                    >
                                        <Text style={styles.mapPreviewPrimaryText}>{t('feed.mapOpenPlan')}</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </View>
                    ) : null}
                </View>
            </Modal>
            </View>
            </View>
        </TouchableWithoutFeedback>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: 'transparent' },
    searchWrapper: { paddingHorizontal: 24, marginBottom: 12 },
    searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', paddingHorizontal: 16, paddingVertical: 14, borderRadius: 18, elevation: 3, shadowColor: PRIMARY_DARK, shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
    searchInput: { marginLeft: 10, flex: 1, fontSize: 16, color: INK },

    quickFiltersRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 24, marginBottom: 12 },
    quickFilterPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFF', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: '#E3ECFB' },
    quickFilterBox: { flex: 1, justifyContent: 'center' },
    quickFilterActive: { backgroundColor: PRIMARY_DARK, borderColor: PRIMARY_DARK },
    quickFilterText: { color: PRIMARY_DARK, fontWeight: '700', fontSize: 12, flexShrink: 1 },

    listContent: { paddingHorizontal: 20, paddingBottom: 130, paddingTop: 6 },
    listWrap: { flex: 1 },
    listLoadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: BG_BOTTOM },

    emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 60, paddingHorizontal: 20 },
    emptyIconWrap: { width: 110, height: 110, borderRadius: 55, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', elevation: 4, shadowColor: PRIMARY_DARK, shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: INK, textAlign: 'center', marginTop: 22 },
    emptySubtitle: { fontSize: 14, color: '#64748B', textAlign: 'center', marginTop: 8 },
    createBtnEmpty: { marginTop: 22, backgroundColor: PRIMARY_DARK, paddingHorizontal: 22, paddingVertical: 13, borderRadius: 16 },
    createBtnEmptySecondary: { marginTop: 10, backgroundColor: '#EEF3FB' },
    createBtnEmptyText: { color: '#FFF', fontWeight: '700' },
    firstRunBanner: {
        marginHorizontal: 16,
        marginBottom: 10,
        backgroundColor: '#FFF',
        borderRadius: 18,
        padding: 14,
        borderWidth: 1,
        borderColor: '#DBEAFE',
        position: 'relative',
    },
    firstRunTitle: { fontSize: 16, fontWeight: '800', color: INK, paddingRight: 24 },
    firstRunBody: { fontSize: 13, color: '#64748B', marginTop: 4, lineHeight: 18 },
    firstRunActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, alignItems: 'center' },
    firstRunPrimary: { backgroundColor: PRIMARY_DARK, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
    firstRunPrimaryText: { color: '#FFF', fontWeight: '800', fontSize: 13 },
    firstRunSecondary: { backgroundColor: '#EEF3FB', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
    firstRunSecondaryText: { color: PRIMARY_DARK, fontWeight: '800', fontSize: 13 },
    firstRunLink: { color: PRIMARY_DARK, fontWeight: '700', fontSize: 13, paddingHorizontal: 4 },
    firstRunClose: { position: 'absolute', top: 10, right: 10 },

    categoryOptionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },

    modalOverlay: { flex: 1, justifyContent: 'flex-end' },
    modalBackdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(15,42,74,0.4)',
    },
    modalSheet: { backgroundColor: '#FFF', borderRadius: 24, padding: 22 },
    modalTitle: { fontSize: 18, fontWeight: '800', color: INK, marginBottom: 0 },
    dateOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 15, paddingHorizontal: 16, borderRadius: 14, marginBottom: 8, backgroundColor: '#F2F7FF' },
    dateOptionActive: { backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: PRIMARY },
    dateOptionText: { fontSize: 15, color: '#475569', fontWeight: '600' },

    filtersSheet: {
        backgroundColor: '#FFF',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingTop: 18,
        paddingHorizontal: 20,
        paddingBottom: Platform.OS === 'ios' ? 34 : 20,
        maxHeight: '88%',
        width: '100%',
    },
    filtersHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 14,
        flexShrink: 0,
    },
    clearFiltersText: { color: PRIMARY_DARK, fontWeight: '700', fontSize: 13 },
    filtersScroll: { flexGrow: 0, flexShrink: 1 },
    filtersScrollContent: { paddingBottom: 16, flexGrow: 0 },
    filterSectionLabel: {
        fontSize: 12,
        fontWeight: '800',
        color: '#64748B',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        marginTop: 10,
        marginBottom: 10,
    },
    filterHint: { fontSize: 13, color: '#94A3B8', fontWeight: '600', marginBottom: 8 },
    provinceToggle: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        backgroundColor: '#F2F7FF',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#E3ECFB',
        paddingHorizontal: 14,
        paddingVertical: 12,
        marginBottom: 8,
    },
    provinceToggleTextWrap: { flex: 1, gap: 2 },
    provinceToggleTitle: { color: PRIMARY_DARK, fontWeight: '700', fontSize: 14 },
    provinceToggleHint: { color: '#94A3B8', fontWeight: '600', fontSize: 12 },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
    filterChip: {
        backgroundColor: '#F2F7FF',
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 9,
        borderWidth: 1,
        borderColor: '#E3ECFB',
    },
    filterChipActive: { backgroundColor: PRIMARY_DARK, borderColor: PRIMARY_DARK },
    filterChipText: { color: '#475569', fontWeight: '700', fontSize: 13 },
    filterChipTextActive: { color: '#FFF' },
    applyFiltersBtn: {
        marginTop: 14,
        backgroundColor: PRIMARY_DARK,
        borderRadius: 16,
        paddingVertical: 14,
        alignItems: 'center',
        flexShrink: 0,
    },
    applyFiltersBtnText: { color: '#FFF', fontWeight: '800', fontSize: 15 },

    mapModalContainer: { flex: 1, backgroundColor: '#E3ECFB' },
    mapModalHeader: { position: 'absolute', top: Platform.OS === 'ios' ? 56 : 44, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
    mapCloseBtn: { width: 46, height: 46, borderRadius: 16, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', elevation: 4, shadowColor: PRIMARY_DARK, shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
    mapModalFooter: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#FFF', paddingHorizontal: 24, paddingTop: 18, paddingBottom: Platform.OS === 'ios' ? 34 : 22, borderTopLeftRadius: 24, borderTopRightRadius: 24, elevation: 12 },
    mapFooterHint: { textAlign: 'center', color: '#64748B', fontWeight: '600', fontSize: 14 },
    mapPreviewCard: {
        position: 'absolute',
        left: 14,
        right: 14,
        bottom: Platform.OS === 'ios' ? 28 : 18,
        backgroundColor: '#FFF',
        borderRadius: 22,
        padding: 12,
        flexDirection: 'row',
        gap: 12,
        elevation: 14,
        shadowColor: '#0F2A4A',
        shadowOpacity: 0.18,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    mapPreviewImage: { width: 86, height: 86, borderRadius: 16, backgroundColor: '#E3ECFB' },
    mapPreviewBody: { flex: 1, justifyContent: 'center' },
    mapPreviewTitle: { fontSize: 16, fontWeight: '900', color: INK },
    mapPreviewMeta: { fontSize: 12, fontWeight: '600', color: '#64748B', marginTop: 4 },
    mapPreviewActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
    mapPreviewSecondary: {
        flex: 1,
        backgroundColor: '#EEF3FB',
        borderRadius: 12,
        paddingVertical: 10,
        alignItems: 'center',
    },
    mapPreviewSecondaryText: { color: PRIMARY_DARK, fontWeight: '800', fontSize: 12 },
    mapPreviewPrimary: {
        flex: 1,
        backgroundColor: PRIMARY_DARK,
        borderRadius: 12,
        paddingVertical: 10,
        alignItems: 'center',
    },
    mapPreviewPrimaryText: { color: '#FFF', fontWeight: '800', fontSize: 12 },
});

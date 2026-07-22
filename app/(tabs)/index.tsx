/*
pantalla principal / home feed de planes
*/
import {
    Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback,
    useEffect,
    useMemo,
    useRef,
    useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
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
} from 'react-native';
import { Alert } from '../../lib/nexoAlert';
import MapView, { Marker } from 'react-native-maps';
import { useListScrollRestore } from '../../hooks/useListScrollRestore';
import { MainChrome } from '../../components/MainChrome';
import { PlanCard, type Membership } from '../../components/PlanCard';
import { getAuthUser } from '../../lib/auth';
import { getCoincidedUserIds } from '../../lib/coincidences';
import { getFriends } from '../../lib/friends';
import { isFeedPlan } from '../../lib/feedPlans';
import { subscribeFeedHomeRetap } from '../../lib/feedReload';
import { useT } from '../../lib/i18n';
import { deletePlanCompletely } from '../../lib/deletePlan';
import { isLocationInSpain } from '../../lib/geo';
import { getProfileNotificationCount } from '../../lib/notifications';
import { canSeePlanInFeed } from '../../lib/planVisibility';
import {
    MAIN_CATEGORY_IDS,
    SUBCATEGORIES,
    resolvePlanCategories,
    type MainCategoryId,
} from '../../lib/categories';
import { getScreenFilters, ScreenKeys, setScreenFilters } from '../../lib/screenState';
import { OPTIMIZED_LIST_PROPS } from '../../lib/listConfig';
import { supabase } from '../../lib/supabase';
import { planMatchesProvince, SPAIN_PROVINCES } from '../../lib/provinces';
import {
    isAcceptedParticipant,
    mapEstadoToMembership,
    membershipFromJoinEstado,
    promoteWaitlist,
    resolveJoinEstado,
} from '../../lib/participants';
import { canJoinPlanByGender, isSoloChicasPlan } from '../../lib/soloChicas';
import { canJoinMorePlans } from '../../lib/planLimits';
import { isPlanActiveForFeed, runPlanLifecycleMaintenance } from '../../lib/planLifecycle';
import type { Genero } from '../../lib/profileFields';
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

const EmptySearch = ({ onClear }: { onClear: () => void }) => {
    const { t } = useT();
    return (
        <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}>
                <Ionicons name="compass-outline" size={56} color={PRIMARY} />
            </View>
            <Text style={styles.emptyTitle}>{t('feed.empty')}</Text>
            <Text style={styles.emptySubtitle}>{t('feed.emptySub')}</Text>
            <TouchableOpacity style={styles.createBtnEmpty} onPress={onClear}>
                <Text style={styles.createBtnEmptyText}>{t('cat.Todos')}</Text>
            </TouchableOpacity>
        </View>
    );
};

export default function HomeScreen() {
    const router = useRouter();
    const { t } = useT();
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
    const [showFiltersModal, setShowFiltersModal] = useState(false);
    const [showProvincePicker, setShowProvincePicker] = useState(false);

    const [plans, setPlans] = useState<any[]>(() => cachedFeed?.plans ?? []);
    const [membershipMap, setMembershipMap] = useState<Record<string, Membership>>(
        () => cachedFeed?.membershipMap ?? {},
    );
    const [savedPlans, setSavedPlans] = useState<string[]>(() => cachedFeed?.savedPlans ?? []);
    const [currentUserId, setCurrentUserId] = useState<string | null>(() => cachedFeed?.currentUserId ?? null);
    const [currentUserGenero, setCurrentUserGenero] = useState<Genero | null>(
        () => cachedFeed?.currentUserGenero ?? null,
    );
    const [loading, setLoading] = useState(() => cachedFeed == null);
    const [refreshing, setRefreshing] = useState(false);
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
    const { listRef, onScroll, scrollEventThrottle } = useListScrollRestore(ScreenKeys.FEED);

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

    const fetchData = useCallback(async (opts?: { refresh?: boolean }) => {
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

            const nowIso = new Date().toISOString();
            void runPlanLifecycleMaintenance();

            const userPromise = getAuthUser();
            const plansPromise = supabase
                .from('planes')
                .select(FEED_PLAN_COLUMNS)
                .or(`fecha_evento.is.null,fecha_evento.gte.${nowIso}`)
                .order('fecha_evento', { ascending: true })
                .limit(100);

            const [user, plansRes] = await Promise.all([userPromise, plansPromise]);
            setCurrentUserId(user?.id || null);

            if (plansRes.error) {
                console.error('Error cargando planes:', plansRes.error);
            }

            const safePlans = (plansRes.data || []).filter(isFeedPlan);
            const planIds = safePlans.map((p) => p.id);

            const partsPromise = planIds.length > 0
                ? supabase
                    .from('participantes')
                    .select('plan_id, usuario_id, estado, perfiles:usuario_id(id, nombre, avatar_url)')
                    .in('plan_id', planIds)
                    .eq('estado', 'aceptado')
                : Promise.resolve({ data: [], error: null });

            const creatorIds = Array.from(new Set(safePlans.map((p) => p.creador_id).filter(Boolean)));
            const creatorsPromise = creatorIds.length > 0
                ? supabase.from('perfiles').select('id, nombre, avatar_url').in('id', creatorIds)
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

            cacheSet(FEED_CACHE_KEY, {
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
            } satisfies FeedSnapshot, FEED_CACHE_TTL_MS);
        } catch (error) {
            console.log(error);
        } finally {
            finished = true;
            clearTimeout(safetyTimer);
            hasDataRef.current = true;
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    const fetchDataRef = useRef(fetchData);
    fetchDataRef.current = fetchData;

    // Carga inicial si no hay caché. Sin realtime: el feed solo se recarga a mano.
    useEffect(() => {
        if (!hasDataRef.current) {
            void fetchData();
        }
    }, [fetchData]);

    useEffect(() => {
        return subscribeFeedHomeRetap(() => {
            listRef.current?.scrollToOffset({ offset: 0, animated: true });
            void fetchDataRef.current({ refresh: true });
        });
    }, []);

    const handleJoin = async (planId: string) => {
        if (!currentUserId) return;
        const plan = plans.find(p => p.id === planId);
        if (!plan) return;

        if (!canJoinPlanByGender(plan, currentUserGenero)) {
            Alert.alert(t('feed.error'), t('card.soloChicasOnly'));
            return;
        }

        const limitCheck = await canJoinMorePlans(currentUserId, planId);
        if (!limitCheck.allowed) {
            Alert.alert(t('feed.error'), t('feed.planLimitReached', { max: limitCheck.max }));
            return;
        }

        const estado = resolveJoinEstado({
            requiere_aprobacion: plan.requiere_aprobacion,
            maximo_participantes: plan.maximo_participantes,
            joinedCount: plan.joinedCount,
        });
        const nextMembership = membershipFromJoinEstado(estado);

        const prevMap = membershipMap;
        const prevPlans = plans;
        setMembershipMap(prev => ({ ...prev, [planId]: nextMembership }));
        if (estado === 'aceptado') {
            setPlans(prev => prev.map(p => p.id === planId ? { ...p, joinedCount: p.joinedCount + 1 } : p));
        }
        const { error } = await supabase.from('participantes').insert({ plan_id: planId, usuario_id: currentUserId, estado });
        if (error) {
            setMembershipMap(prevMap);
            setPlans(prevPlans);
            Alert.alert(t('feed.error'), t('feed.joinError'));
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
        if (isAlreadySaved) {
            setSavedPlans(prev => prev.filter(id => id !== planId));
            const { error } = await supabase.from('planes_guardados').delete().eq('plan_id', planId).eq('usuario_id', currentUserId);
            if (error) {
                setSavedPlans(prevSaved);
                Alert.alert(t('feed.error'), t('feed.saveError'));
            }
        } else {
            setSavedPlans(prev => [...prev, planId]);
            const { error } = await supabase.from('planes_guardados').insert({ plan_id: planId, usuario_id: currentUserId });
            if (error) {
                setSavedPlans(prevSaved);
                Alert.alert(t('feed.error'), t('feed.saveError'));
            }
        }
    };

    const handleReportPlan = (planId: string) => {
        if (!currentUserId) return;
        router.push({ pathname: '/report-plan', params: { planId } });
    };

    const handleDeletePlan = async (planId: string) => {
        Alert.alert(t('feed.deletePlan'), t('feed.deleteConfirm'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('feed.deletePlan'),
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
                            const { error } = await deletePlanCompletely(planId);
                            if (error) {
                                setPlans(prevPlans);
                                setMembershipMap(prevMap);
                                setSavedPlans(prevSaved);
                                Alert.alert(t('feed.error'), t('feed.deleteError'));
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
                onJoin={handleJoin}
                onLeave={handleLeave}
                onDelete={handleDeletePlan}
                onEdit={handleEditPlan}
                onToggleSave={handleSave}
                onReport={currentUserId ? handleReportPlan : undefined}
                onOpenDetail={(planId) => router.push({ pathname: '/plan/[id]', params: { id: planId } })}
                onParticipantsChanged={() => void fetchDataRef.current()}
                router={router}
            />
        ),
        [currentUserId, currentUserGenero, membershipMap, savedPlans, friendIds, coincidedIds, router],
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
        const isMinePlan = (p: any) =>
            String(p.creador_id) === String(currentUserId)
            || membershipMap[p.id] === 'joined'
            || membershipMap[p.id] === 'requested';

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

                return isPlanActiveForFeed(p)
                    && canSeePlanInFeed(p, {
                        userId: currentUserId,
                        friendIds,
                        membershipPlanIds,
                        invitedPlanIds,
                    })
                    && (!isSoloChicasPlan(p) || currentUserGenero === 'femenino')
                    && categoryOk
                    && subcategoryOk
                    && provinceOk
                    && planMatchesSearch(p, search, searchExpanded)
                    && matchesDate(p);
            })
            .sort((a, b) => {
                const am = isMinePlan(a) ? 0 : 1;
                const bm = isMinePlan(b) ? 0 : 1;
                if (am !== bm) return am - bm;
                return compareFeedAffinity(a, b, feedTaste, friendIds);
            });
    }, [
        plans,
        currentUserId,
        currentUserGenero,
        membershipMap,
        friendIds,
        invitedPlanIds,
        selectedCategories,
        selectedSubcategories,
        selectedProvinces,
        search,
        searchExpanded,
        dateFilter,
        feedTaste,
    ]);

    /** Planes con coordenadas en España para el mapa de zona (se abre centrado en Madrid). */
    const zoneMapPlans = useMemo(() => {
        return filteredPlans.filter((p) => {
            const lat = Number(p.latitud);
            const lng = Number(p.longitud);
            return isLocationInSpain(lat, lng);
        });
    }, [filteredPlans]);

    const scrollToPlanInFeed = (planId: string) => {
        const index = filteredPlans.findIndex((p) => String(p.id) === String(planId));
        setShowZoneModal(false);
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

    const hasActiveFilters =
        selectedCategories.length > 0
        || selectedSubcategories.length > 0
        || dateFilter !== 'all'
        || selectedProvinces.length > 0;

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
    };

    return (
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <MainChrome active="feed">
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
                    style={[styles.quickFilterPill, styles.quickFilterBox, hasActiveFilters ? styles.quickFilterActive : null]}
                    onPress={() => setShowFiltersModal(true)}
                >
                    <Ionicons name="options" size={15} color={hasActiveFilters ? '#FFF' : PRIMARY_DARK} />
                    <Text style={[styles.quickFilterText, hasActiveFilters ? { color: '#FFF' } : null]} numberOfLines={1}>
                        {t('feed.filters')}
                    </Text>
                </TouchableOpacity>
            </View>

            <View style={styles.listWrap}>
                <FlatList
                    ref={listRef}
                    data={filteredPlans}
                    keyExtractor={(item) => item.id}
                    extraData={{ membershipMap, savedPlans, friendIds, coincidedIds }}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                    onScroll={onScroll}
                    scrollEventThrottle={scrollEventThrottle}
                    onScrollToIndexFailed={(info) => {
                        listRef.current?.scrollToOffset({
                            offset: Math.max(0, info.averageItemLength * info.index),
                            animated: true,
                        });
                        setTimeout(() => {
                            listRef.current?.scrollToIndex({
                                index: info.index,
                                animated: true,
                                viewPosition: 0.12,
                            });
                        }, 120);
                    }}
                    {...OPTIMIZED_LIST_PROPS}
                    ListEmptyComponent={
                        !loading ? (
                            <EmptySearch
                                onClear={() => {
                                    setSearch('');
                                    clearAllFilters();
                                }}
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
                />
                {loading && !refreshing && plans.length === 0 ? (
                    <View style={styles.listLoadingOverlay}>
                        <ActivityIndicator size="large" color={PRIMARY_DARK} />
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
                            {hasActiveFilters ? (
                                <TouchableOpacity onPress={clearAllFilters} hitSlop={8}>
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

            <Modal visible={showZoneModal} animationType="slide" onRequestClose={() => setShowZoneModal(false)}>
                <View style={styles.mapModalContainer}>
                    <MapView
                        style={StyleSheet.absoluteFill}
                        initialRegion={{
                            latitude: 40.4168,
                            longitude: -3.7038,
                            latitudeDelta: 0.22,
                            longitudeDelta: 0.22,
                        }}
                    >
                        {zoneMapPlans.map((p) => (
                            <Marker
                                key={p.id}
                                coordinate={{
                                    latitude: Number(p.latitud),
                                    longitude: Number(p.longitud),
                                }}
                                title={p.titulo}
                                description={p.nombre_ubicacion || undefined}
                                pinColor="#2563EB"
                                onPress={() => scrollToPlanInFeed(p.id)}
                            />
                        ))}
                    </MapView>

                    <View style={styles.mapModalHeader}>
                        <TouchableOpacity style={styles.mapCloseBtn} onPress={() => setShowZoneModal(false)}>
                            <Ionicons name="chevron-back" size={24} color={INK} />
                        </TouchableOpacity>
                        <View style={styles.mapHeaderTitleWrap}>
                            <Text style={styles.mapHeaderTitle}>{t('feed.filterZoneTitle')}</Text>
                        </View>
                    </View>

                    {zoneMapPlans.length === 0 ? (
                        <View style={styles.mapModalFooter}>
                            <Text style={styles.mapFooterHint}>{t('feed.filterZoneEmpty')}</Text>
                        </View>
                    ) : null}
                </View>
            </Modal>
            </View>
        </MainChrome>
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
    listLoadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', paddingTop: 40 },

    emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 60, paddingHorizontal: 20 },
    emptyIconWrap: { width: 110, height: 110, borderRadius: 55, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', elevation: 4, shadowColor: PRIMARY_DARK, shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: INK, textAlign: 'center', marginTop: 22 },
    emptySubtitle: { fontSize: 14, color: '#64748B', textAlign: 'center', marginTop: 8 },
    createBtnEmpty: { marginTop: 22, backgroundColor: PRIMARY_DARK, paddingHorizontal: 22, paddingVertical: 13, borderRadius: 16 },
    createBtnEmptyText: { color: '#FFF', fontWeight: '700' },

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
    mapHeaderTitleWrap: { backgroundColor: '#FFF', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 10, elevation: 4, shadowColor: PRIMARY_DARK, shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
    mapHeaderTitle: { fontSize: 16, fontWeight: '900', color: INK },
    mapHeaderSub: { fontSize: 12, color: '#64748B', fontWeight: '600' },
    mapModalFooter: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#FFF', paddingHorizontal: 24, paddingTop: 18, paddingBottom: Platform.OS === 'ios' ? 34 : 22, borderTopLeftRadius: 24, borderTopRightRadius: 24, elevation: 12 },
    mapFooterHint: { textAlign: 'center', color: '#64748B', fontWeight: '600', fontSize: 14 },
    mapSelectedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    mapSelectedText: { flex: 1, fontSize: 16, fontWeight: '800', color: INK },
    mapClearBtn: { backgroundColor: '#F1F5F9', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
    mapClearText: { color: '#64748B', fontWeight: '700' },
});

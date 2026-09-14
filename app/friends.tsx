import {
    Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect,
    useLocalSearchParams,
    useRouter } from 'expo-router';
import { useCallback,
    useRef,
    useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import {
    ActivityIndicator,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { seedUserProfilePeek, prefetchUserProfile } from '../lib/userProfileCache';
import { prefetchPlanDetail, seedPlanDetailFromFeed } from '../lib/planDetailCache';
import { broadcastPlanMembership } from '../lib/membershipBroadcast';
import { markFeedNeedsRefresh, noteFeedInviteCleared } from '../lib/feedReload';
import { rememberFriendsSet, rememberFriendStatus } from '../lib/friendStatusPeek';
import { Alert } from '../lib/nexoAlert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ProfileAvatar } from '../components/ProfileAvatar';
import {
    acceptFriendRequest,
    cancelFriendRequest,
    getFriends,
    getIncomingRequests,
    getOutgoingRequests,
    rejectFriendRequest,
    sendFriendRequest,
    type FriendProfile,
    type FriendRequest,
} from '../lib/friends';
import {
    dismissFriendSuggestion,
    friendSuggestionsCacheKey,
    getFriendSuggestions,
    FRIEND_SUGGESTIONS_MAX,
    type FriendSuggestion,
} from '../lib/friendSuggestions';
import { hapticError, hapticLight, hapticSelection, hapticSuccess } from '../lib/haptics';
import { dismissPushForFriends } from '../lib/presentedPush';
import { useT } from '../lib/i18n';
import { FLASH_LIST_DRAW_DISTANCE } from '../lib/listConfig';
import { ScreenKeys } from '../lib/screenState';
import { useListScrollRestore } from '../hooks/useListScrollRestore';
import { useScrollViewRestore } from '../hooks/useScrollViewRestore';
import {
    acceptPlanInvite,
    getIncomingPlanInvites,
    rejectPlanInvite,
    type PlanInvite,
} from '../lib/planInvites';
import {
    acceptPlanJoinRequest,
    fetchIncomingPlanJoinRequests,
    invalidatePlanJoinRequestCaches,
    rejectPlanJoinRequest,
    type PlanJoinRequest,
} from '../lib/planJoinRequests';
import { getAuthUser } from '../lib/auth';
import { useAuthSession } from '../lib/authSession';
import { screenCacheKey, ScreenCacheTTL } from '../lib/screenCaches';
import { cacheGetStale, cacheInvalidate, cacheIsFresh, cacheSet } from '../lib/ttlCache';
import { supabase } from '../lib/supabase';
import { useAppTheme, useThemedStyles } from '../lib/appTheme';
import { type ThemeColors } from '../theme';

const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const BG_TOP = '#DCEBFF';
const BG_BOTTOM = '#F2F7FF';
const SUCCESS = '#22C55E';
const DANGER = '#EF4444';

type TabKey = 'friends' | 'requests';

type FriendsScreenSnapshot = {
    friends: (FriendProfile & { friendshipId: string })[];
    incoming: FriendRequest[];
    outgoing: FriendRequest[];
    planInvites: PlanInvite[];
    planJoinRequests: PlanJoinRequest[];
};

export default function FriendsScreen() {
    const router = useRouter();
    const { t } = useT();
    const { userId: sessionUserId } = useAuthSession();
    const { colors } = useAppTheme();
    const styles = useThemedStyles(createFriendsStyles);
    const { tab } = useLocalSearchParams<{ tab?: string }>();
    const [activeTab, setActiveTab] = useState<TabKey>('friends');
    const cachedFriends = sessionUserId
        ? cacheGetStale<FriendsScreenSnapshot>(screenCacheKey.friends(sessionUserId))
        : null;
    const [loading, setLoading] = useState(() => !cachedFriends);
    const [refreshing, setRefreshing] = useState(false);
    const { listRef, onScroll, scrollEventThrottle } = useListScrollRestore<FriendProfile & { friendshipId: string }>(ScreenKeys.FRIENDS);
    const { scrollRef: requestsScrollRef, onScroll: onRequestsScroll, scrollEventThrottle: requestsScrollThrottle } =
        useScrollViewRestore(`${ScreenKeys.FRIENDS}-requests`);
    const [friends, setFriends] = useState<(FriendProfile & { friendshipId: string })[]>(
        () => cachedFriends?.friends ?? [],
    );
    const [incoming, setIncoming] = useState<FriendRequest[]>(() => cachedFriends?.incoming ?? []);
    const [outgoing, setOutgoing] = useState<FriendRequest[]>(() => cachedFriends?.outgoing ?? []);
    const [planInvites, setPlanInvites] = useState<PlanInvite[]>(() => cachedFriends?.planInvites ?? []);
    const [planJoinRequests, setPlanJoinRequests] = useState<PlanJoinRequest[]>(
        () => cachedFriends?.planJoinRequests ?? [],
    );
    const [suggestions, setSuggestions] = useState<FriendSuggestion[]>([]);
    const [suggestBusyId, setSuggestBusyId] = useState<string | null>(null);
    const [suggestSentIds, setSuggestSentIds] = useState<Set<string>>(new Set());
    /** Solo para aceptar invitación a plan (hay que validar cupo/límite antes de cambiar UI). */
    const [inviteAcceptId, setInviteAcceptId] = useState<string | null>(null);
    const hasLoadedRef = useRef(!!cachedFriends);
    const userIdRef = useRef<string | null>(sessionUserId);
    const loadGenRef = useRef(0);
    const refreshingRef = useRef(false);
    const joinRequestBusyRef = useRef<Set<string>>(new Set());

    const joinRequestKey = (req: Pick<PlanJoinRequest, 'planId' | 'userId'>) => `${req.planId}:${req.userId}`;

    const filterActiveJoinRequests = useCallback(
        (rows: PlanJoinRequest[]) =>
            rows.filter((r) => !joinRequestBusyRef.current.has(joinRequestKey(r))),
        [],
    );

    const syncFriendsCache = useCallback((patch: Partial<FriendsScreenSnapshot>) => {
        const uid = userIdRef.current;
        if (!uid) return;
        const key = screenCacheKey.friends(uid);
        const cached = cacheGetStale<FriendsScreenSnapshot>(key);
        if (!cached) return;
        cacheSet(key, { ...cached, ...patch }, ScreenCacheTTL.friends);
    }, []);

    const openPersonProfile = useCallback(
        (person: { id: string; nombre?: string | null; nombre_usuario?: string | null; avatar_url?: string | null }) => {
            seedUserProfilePeek({
                id: person.id,
                nombre: person.nombre,
                nombre_usuario: person.nombre_usuario,
                avatar_url: person.avatar_url,
            });
            prefetchUserProfile(person.id);
            router.push({ pathname: '/user-profile/[id]', params: { id: person.id } });
        },
        [router],
    );

    const loadData = useCallback(async (opts?: { force?: boolean }) => {
        const gen = ++loadGenRef.current;
        try {
            const userId = sessionUserId ?? (await getAuthUser())?.id ?? null;
            if (!userId) {
                router.replace('/login');
                return;
            }
            const user = { id: userId };

            const cacheKey = screenCacheKey.friends(user.id);
            const cached = cacheGetStale<{
                friends: (FriendProfile & { friendshipId: string })[];
                incoming: FriendRequest[];
                outgoing: FriendRequest[];
                planInvites: PlanInvite[];
                planJoinRequests: PlanJoinRequest[];
            }>(cacheKey);
            if (cached && !hasLoadedRef.current) {
                setFriends(cached.friends);
                rememberFriendsSet(cached.friends.map((f) => f.id));
                setIncoming(cached.incoming);
                setOutgoing(cached.outgoing);
                setPlanInvites(cached.planInvites);
                setPlanJoinRequests(cached.planJoinRequests ?? []);
                hasLoadedRef.current = true;
                setLoading(false);
            } else if (!refreshingRef.current && !hasLoadedRef.current) {
                setLoading(true);
            }

            userIdRef.current = user.id;

            const cachedLooksPopulated =
                (cached?.friends?.length ?? 0) > 0
                || (cached?.incoming?.length ?? 0) > 0
                || (cached?.outgoing?.length ?? 0) > 0
                || (cached?.planInvites?.length ?? 0) > 0
                || (cached?.planJoinRequests?.length ?? 0) > 0;

            // Caché vacía “fresca” no debe saltarse la red (semilla antigua / sin amigos aún).
            if (
                !opts?.force
                && cacheIsFresh(cacheKey)
                && hasLoadedRef.current
                && cachedLooksPopulated
            ) {
                setLoading(false);
                setRefreshing(false);
                refreshingRef.current = false;
                void getFriendSuggestions(user.id, FRIEND_SUGGESTIONS_MAX)
                    .then((rows) => {
                        if (gen === loadGenRef.current) setSuggestions(rows);
                    })
                    .catch(() => {});
                void fetchIncomingPlanJoinRequests(user.id)
                    .then((rows) => {
                        if (gen === loadGenRef.current) {
                            setPlanJoinRequests(filterActiveJoinRequests(rows));
                        }
                    })
                    .catch(() => {});
                return;
            }

            // Si la caché estaba vacía, fuerza red siempre al enfocar.
            const [friendsData, incomingData, outgoingData, invitesData, joinReqData, suggestData] = await Promise.all([
                getFriends(user.id),
                getIncomingRequests(user.id),
                getOutgoingRequests(user.id),
                getIncomingPlanInvites(user.id).catch(() => [] as PlanInvite[]),
                fetchIncomingPlanJoinRequests(user.id).catch(() => [] as PlanJoinRequest[]),
                getFriendSuggestions(user.id, FRIEND_SUGGESTIONS_MAX).catch(() => [] as FriendSuggestion[]),
            ]);
            if (gen !== loadGenRef.current) return;

            setFriends(friendsData);
            rememberFriendsSet(friendsData.map((f) => f.id));
            setIncoming(incomingData);
            setOutgoing(outgoingData);
            setPlanInvites(invitesData);
            const visibleJoinReqData = filterActiveJoinRequests(joinReqData);
            setPlanJoinRequests(visibleJoinReqData);
            setSuggestions(suggestData);
            for (const f of friendsData.slice(0, 8)) prefetchUserProfile(f.id);
            for (const s of suggestData.slice(0, 6)) prefetchUserProfile(s.id);
            for (const inv of invitesData.slice(0, 4)) {
                if (inv.plan) {
                    seedPlanDetailFromFeed({
                        id: inv.plan_id,
                        titulo: inv.plan.titulo,
                        imagen_url: inv.plan.imagen_url,
                        maximo_participantes: inv.plan.maximo_participantes,
                        requiere_aprobacion: inv.plan.requiere_aprobacion,
                        categoria: inv.plan.categoria ?? '',
                    });
                    prefetchPlanDetail(inv.plan_id);
                }
            }
            cacheSet(cacheKey, {
                friends: friendsData,
                incoming: incomingData,
                outgoing: outgoingData,
                planInvites: invitesData,
                planJoinRequests: visibleJoinReqData,
            }, ScreenCacheTTL.friends);
        } catch {
            if (gen === loadGenRef.current) {
                Alert.alert(t('profile.error'), t('friends.loadError'));
            }
        } finally {
            if (gen === loadGenRef.current) {
                hasLoadedRef.current = true;
                setLoading(false);
                setRefreshing(false);
                refreshingRef.current = false;
            }
        }
    }, [router, sessionUserId, t, filterActiveJoinRequests]);

    useFocusEffect(
        useCallback(() => {
            dismissPushForFriends();
            if (tab === 'requests') setActiveTab('requests');
            else if (tab === 'friends') setActiveTab('friends');
            void loadData();
        }, [loadData, tab])
    );

    const onRefresh = () => {
        refreshingRef.current = true;
        setRefreshing(true);
        void loadData({ force: true });
    };

    const invalidatePeerProfile = (peerId: string | undefined) => {
        if (!peerId) return;
        cacheInvalidate(`userProfile:${peerId}`);
    };

    const handleAccept = (requestId: string) => {
        hapticSuccess();
        const removed = incoming.find((r) => r.id === requestId);
        setIncoming((prev) => prev.filter((r) => r.id !== requestId));
        if (removed) {
            setFriends((prev) =>
                prev.some((f) => f.id === removed.perfil.id)
                    ? prev
                    : [...prev, { ...removed.perfil, friendshipId: requestId }],
            );
            invalidatePeerProfile(removed.perfil.id);
        }
        void acceptFriendRequest(requestId).then(({ error }) => {
            if (error) {
                if (removed) {
                    setIncoming((prev) => [removed, ...prev]);
                    setFriends((prev) => prev.filter((f) => f.friendshipId !== requestId));
                }
                hapticError();
                Alert.alert(t('profile.error'), error.message);
            } else {
                markFeedNeedsRefresh();
                rememberFriendStatus(removed?.perfil.id, 'friends', requestId);
                if (userIdRef.current) cacheInvalidate(screenCacheKey.friends(userIdRef.current));
            }
        });
    };

    const handleReject = (requestId: string) => {
        hapticLight();
        const removed = incoming.find((r) => r.id === requestId);
        setIncoming((prev) => prev.filter((r) => r.id !== requestId));
        invalidatePeerProfile(removed?.perfil.id);
        void rejectFriendRequest(requestId).then(({ error }) => {
            if (error) {
                if (removed) setIncoming((prev) => [removed, ...prev]);
                hapticError();
                Alert.alert(t('profile.error'), error.message);
            }
        });
    };

    const handleCancel = (requestId: string) => {
        hapticLight();
        const removed = outgoing.find((r) => r.id === requestId);
        setOutgoing((prev) => prev.filter((r) => r.id !== requestId));
        invalidatePeerProfile(removed?.perfil.id);
        void cancelFriendRequest(requestId).then(({ error }) => {
            if (error) {
                if (removed) setOutgoing((prev) => [removed, ...prev]);
                hapticError();
                Alert.alert(t('profile.error'), error.message);
            }
        });
    };

    const handleAcceptPlanInvite = (invite: PlanInvite) => {
        if (inviteAcceptId) return;
        setInviteAcceptId(invite.id);
        const removed = invite;
        // UI + navegación al instante; validar cupo en segundo plano.
        setPlanInvites((prev) => prev.filter((i) => i.id !== invite.id));
        const requiere = !!invite.plan?.requiere_aprobacion;
        const optimisticMembership = requiere ? 'requested' : 'joined';
        broadcastPlanMembership(invite.plan_id, optimisticMembership, {
            bumpJoined: optimisticMembership === 'joined',
            clearInvite: true,
        });
        if (invite.plan) {
            seedPlanDetailFromFeed(
                {
                    id: invite.plan_id,
                    titulo: invite.plan.titulo,
                    imagen_url: invite.plan.imagen_url,
                    maximo_participantes: invite.plan.maximo_participantes,
                    requiere_aprobacion: invite.plan.requiere_aprobacion,
                    categoria: invite.plan.categoria ?? '',
                },
                { membership: optimisticMembership },
            );
        }
        prefetchPlanDetail(invite.plan_id);
        router.push({ pathname: '/plan/[id]', params: { id: invite.plan_id } });
        setInviteAcceptId(null);

        void (async () => {
            try {
                const user = await getAuthUser();
                if (!user) {
                    setPlanInvites((prev) => [removed, ...prev]);
                    broadcastPlanMembership(invite.plan_id, 'none', { dropJoined: true });
                    return;
                }
                const { error, max, estado, alreadyMember } = await acceptPlanInvite(invite, user.id);
                if (error === 'full' || error === 'limit' || error === 'organizer_cannot_join' || error) {
                    hapticError();
                    setPlanInvites((prev) => [removed, ...prev]);
                    broadcastPlanMembership(invite.plan_id, 'none', {
                        userId: user.id,
                        dropJoined: true,
                        invalidateFriends: true,
                    });
                    if (error === 'full') Alert.alert(t('profile.error'), t('friends.inviteFull'));
                    else if (error === 'limit') {
                        Alert.alert(t('profile.error'), t('feed.planLimitReached', { max: max ?? 5 }));
                    } else if (error === 'organizer_cannot_join') {
                        Alert.alert(t('profile.error'), t('organizer.cannotJoin'));
                    } else if (error) Alert.alert(t('profile.error'), error);
                    return;
                }
                hapticSuccess();
                const membership =
                    estado === 'pendiente' ? 'requested' : estado === 'lista_espera' ? 'waitlist' : 'joined';
                const bumpJoined = !alreadyMember && estado === 'aceptado';
                broadcastPlanMembership(invite.plan_id, membership, {
                    userId: user.id,
                    bumpJoined,
                    clearInvite: true,
                    invalidateFriends: true,
                });
            } catch {
                setPlanInvites((prev) => [removed, ...prev]);
                broadcastPlanMembership(invite.plan_id, 'none', { dropJoined: true });
                hapticError();
            }
        })();
    };

    const handleRejectPlanInvite = (inviteId: string) => {
        hapticLight();
        const removed = planInvites.find((i) => i.id === inviteId);
        setPlanInvites((prev) => prev.filter((i) => i.id !== inviteId));
        if (removed?.plan_id) noteFeedInviteCleared(removed.plan_id);
        void rejectPlanInvite(inviteId).then(({ error }) => {
            if (error) {
                if (removed) setPlanInvites((prev) => [removed, ...prev]);
                hapticError();
                Alert.alert(t('profile.error'), error);
            }
        });
    };

    const refillSuggestions = useCallback(async () => {
        const uid = userIdRef.current;
        if (!uid) return;
        cacheInvalidate(friendSuggestionsCacheKey(uid));
        try {
            const rows = await getFriendSuggestions(uid, FRIEND_SUGGESTIONS_MAX);
            setSuggestions(rows);
        } catch {
            /* ignore */
        }
    }, []);

    const pendingCount = incoming.length + planInvites.length + planJoinRequests.length;

    const renderFriend = ({ item, index }: { item: FriendProfile & { friendshipId: string }; index: number }) => {
        const accentPair =
            index % 3 === 0
                ? (['#2563EB', '#7C3AED'] as const)
                : index % 3 === 1
                  ? (['#0EA5E9', '#2563EB'] as const)
                  : (['#6366F1', '#4DA6FF'] as const);

        return (
            <View style={styles.premiumCardOuter}>
                <View style={styles.premiumCard}>
                    <LinearGradient
                        colors={[accentPair[0], accentPair[1]]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.premiumHeaderBand}
                    >
                        <TouchableOpacity
                            style={styles.premiumHeaderTouch}
                            onPress={() => openPersonProfile(item)}
                            onPressIn={() => prefetchUserProfile(item.id)}
                            activeOpacity={0.9}
                        >
                            <View style={styles.avatarRingWrap}>
                                    <ProfileAvatar
                                    uri={item.avatar_url}
                                    name={item.nombre}
                                    size={46}
                                    recyclingKey={item.id}
                                />
                            </View>
                            <View style={styles.premiumHeaderText}>
                                <Text style={styles.premiumNameLight} numberOfLines={1}>
                                    {item.nombre}
                                </Text>
                                <Text style={styles.premiumSubLight}>{t('friends.viewProfile')}</Text>
                            </View>
                            <View style={styles.premiumChevronLight}>
                                <Ionicons name="chevron-forward" size={18} color="#FFF" />
                            </View>
                        </TouchableOpacity>
                    </LinearGradient>
                </View>
            </View>
        );
    };

    const renderIncoming = (item: FriendRequest) => {
        return (
            <View key={item.id} style={styles.card}>
                <TouchableOpacity
                    style={styles.rowMain}
                    onPress={() => openPersonProfile(item.perfil)}
                    onPressIn={() => prefetchUserProfile(item.perfil.id)}
                    activeOpacity={0.85}
                >
                    <ProfileAvatar
                        uri={item.perfil.avatar_url}
                        name={item.perfil.nombre}
                        size={54}
                        recyclingKey={item.perfil.id}
                    />
                    <View style={styles.rowText}>
                        <Text style={styles.name} numberOfLines={1}>{item.perfil.nombre}</Text>
                        <View style={styles.hintPill}>
                            <Ionicons name="person-add" size={12} color={PRIMARY_DARK} />
                            <Text style={styles.hintPillText}>{t('friends.wantsToBe')}</Text>
                        </View>
                    </View>
                </TouchableOpacity>
                <View style={styles.rowActions}>
                    <TouchableOpacity
                        style={[styles.actionBtn, styles.actionSuccess]}
                        onPress={() => handleAccept(item.id)}
                        activeOpacity={0.85}
                    >
                        <Ionicons name="checkmark" size={18} color="#FFF" />
                        <Text style={styles.actionSuccessText}>{t('friends.accept')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.iconCircle, styles.iconMuted]}
                        onPress={() => handleReject(item.id)}
                    >
                        <Ionicons name="close" size={22} color={colors.textMuted} />
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    const renderOutgoing = (item: FriendRequest) => {
        return (
            <View key={item.id} style={styles.outgoingRow}>
                <TouchableOpacity
                    style={styles.outgoingProfileTap}
                    onPress={() => openPersonProfile(item.perfil)}
                    onPressIn={() => prefetchUserProfile(item.perfil.id)}
                    activeOpacity={0.85}
                >
                    <ProfileAvatar
                        uri={item.perfil.avatar_url}
                        name={item.perfil.nombre}
                        size={42}
                        recyclingKey={item.perfil.id}
                    />
                    <View style={styles.rowText}>
                        <Text style={styles.name} numberOfLines={1}>{item.perfil.nombre}</Text>
                        <Text style={styles.outgoingHint}>{t('friends.sent')}</Text>
                    </View>
                </TouchableOpacity>
                <TouchableOpacity
                    style={styles.cancelChip}
                    onPress={() => handleCancel(item.id)}
                >
                    <Text style={styles.cancelChipText}>{t('friends.cancel')}</Text>
                </TouchableOpacity>
            </View>
        );
    };

    const handleRejectPlanJoin = (req: PlanJoinRequest) => {
        hapticLight();
        const uid = userIdRef.current;
        const busyKey = joinRequestKey(req);
        joinRequestBusyRef.current.add(busyKey);
        setPlanJoinRequests((prev) => {
            const next = prev.filter((r) => !(r.planId === req.planId && r.userId === req.userId));
            syncFriendsCache({ planJoinRequests: next });
            return next;
        });
        void rejectPlanJoinRequest(req.planId, req.userId).then(({ ok, error }) => {
            if (!ok) {
                joinRequestBusyRef.current.delete(busyKey);
                setPlanJoinRequests((prev) => {
                    if (prev.some((r) => r.planId === req.planId && r.userId === req.userId)) return prev;
                    const next = [req, ...prev];
                    syncFriendsCache({ planJoinRequests: next });
                    return next;
                });
                hapticError();
                if (error) Alert.alert(t('profile.error'), error);
                return;
            }
            joinRequestBusyRef.current.delete(busyKey);
            if (uid) invalidatePlanJoinRequestCaches(uid, req.planId);
        });
    };

    const handleAcceptPlanJoin = (req: PlanJoinRequest) => {
        const uid = userIdRef.current;
        const busyKey = joinRequestKey(req);
        hapticSuccess();
        joinRequestBusyRef.current.add(busyKey);
        setPlanJoinRequests((prev) => {
            const next = prev.filter((r) => !(r.planId === req.planId && r.userId === req.userId));
            syncFriendsCache({ planJoinRequests: next });
            return next;
        });
        void (async () => {
            try {
                const { data: planRow } = await supabase
                    .from('planes')
                    .select('maximo_participantes')
                    .eq('id', req.planId)
                    .maybeSingle();
                const max = Number(planRow?.maximo_participantes) || 0;
                const result = await acceptPlanJoinRequest(req.planId, req.userId, max);
                if (!result.ok) {
                    joinRequestBusyRef.current.delete(busyKey);
                    setPlanJoinRequests((prev) => {
                        if (prev.some((r) => r.planId === req.planId && r.userId === req.userId)) return prev;
                        const next = [req, ...prev];
                        syncFriendsCache({ planJoinRequests: next });
                        return next;
                    });
                    hapticError();
                    Alert.alert(
                        t('profile.error'),
                        result.code === 'full'
                            ? t('friends.inviteFull')
                            : result.code === 'rls'
                              ? t('myplans.rlsHint')
                              : result.error,
                    );
                    return;
                }
                if (uid) invalidatePlanJoinRequestCaches(uid, req.planId);
            } finally {
                joinRequestBusyRef.current.delete(busyKey);
            }
        })();
    };

    const renderPlanJoinRequest = (req: PlanJoinRequest) => {
        const key = `${req.planId}:${req.userId}`;
        return (
            <View key={key} style={styles.card}>
                <TouchableOpacity
                    style={styles.rowMain}
                    onPress={() => router.push({ pathname: '/plan/[id]', params: { id: req.planId } })}
                    activeOpacity={0.85}
                >
                    <ProfileAvatar
                        uri={req.avatar_url}
                        name={req.nombre || 'U'}
                        size={54}
                        recyclingKey={req.userId}
                    />
                    <View style={styles.rowText}>
                        <Text style={styles.name} numberOfLines={1}>{req.nombre || t('profile.user')}</Text>
                        <View style={styles.hintPill}>
                            <Ionicons name="calendar" size={12} color={PRIMARY_DARK} />
                            <Text style={styles.hintPillText} numberOfLines={2}>
                                {t('friends.wantsToJoinPlan', { plan: req.planTitulo || '—' })}
                            </Text>
                        </View>
                    </View>
                </TouchableOpacity>
                <View style={styles.rowActions}>
                    <TouchableOpacity
                        style={[styles.actionBtn, styles.actionSuccess]}
                        onPress={() => handleAcceptPlanJoin(req)}
                        activeOpacity={0.85}
                    >
                        <Ionicons name="checkmark" size={18} color="#FFF" />
                        <Text style={styles.actionSuccessText}>{t('friends.accept')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.iconCircle, styles.iconMuted]}
                        onPress={() => handleRejectPlanJoin(req)}
                    >
                        <Ionicons name="close" size={22} color={colors.textMuted} />
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    const renderPlanInvite = (invite: PlanInvite) => {
        const busy = inviteAcceptId === invite.id;
        const title = invite.plan?.titulo || '—';
        const inviterName = invite.invitador?.nombre || t('chats.user');
        const isGroup = invite.tipo === 'grupo';

        const openPlanInvite = () => {
            if (invite.plan) {
                seedPlanDetailFromFeed({
                    id: invite.plan_id,
                    titulo: invite.plan.titulo,
                    imagen_url: invite.plan.imagen_url,
                    maximo_participantes: invite.plan.maximo_participantes,
                    requiere_aprobacion: invite.plan.requiere_aprobacion,
                    categoria: invite.plan.categoria ?? '',
                    creador_id: invite.invitador_id,
                    host: invite.invitador
                        ? {
                              id: invite.invitador_id,
                              nombre: invite.invitador.nombre ?? 'Usuario',
                              avatar_url: invite.invitador.avatar_url ?? null,
                              isCreator: true,
                          }
                        : null,
                });
            } else {
                seedPlanDetailFromFeed({ id: invite.plan_id });
            }
            prefetchPlanDetail(invite.plan_id);
            router.push({
                pathname: '/plan/[id]',
                params: {
                    id: invite.plan_id,
                    inviteId: invite.id,
                    inviterId: invite.invitador_id,
                    inviterName,
                    inviterAvatar: invite.invitador?.avatar_url ?? '',
                    inviteTipo: invite.tipo,
                },
            });
        };

        return (
            <View key={invite.id} style={styles.inviteCard}>
                <TouchableOpacity
                    style={styles.inviteTop}
                    onPress={openPlanInvite}
                    onPressIn={() => {
                        if (invite.plan) {
                            seedPlanDetailFromFeed({
                                id: invite.plan_id,
                                titulo: invite.plan.titulo,
                                imagen_url: invite.plan.imagen_url,
                                maximo_participantes: invite.plan.maximo_participantes,
                                requiere_aprobacion: invite.plan.requiere_aprobacion,
                                categoria: invite.plan.categoria ?? '',
                            });
                        }
                        prefetchPlanDetail(invite.plan_id);
                    }}
                    activeOpacity={0.85}
                >
                    <ProfileAvatar
                        uri={invite.invitador?.avatar_url}
                        name={inviterName}
                        size={48}
                        recyclingKey={invite.invitador_id || invite.id}
                    />
                    <View style={styles.inviteBody}>
                        <View style={styles.inviteTypeRow}>
                            <View style={[styles.typePill, isGroup ? styles.typeGroup : styles.typePlan]}>
                                <Ionicons
                                    name={isGroup ? 'people' : 'calendar'}
                                    size={13}
                                    color={isGroup ? '#7C3AED' : PRIMARY_DARK}
                                />
                                <Text style={[styles.typePillText, isGroup && { color: '#7C3AED' }]}>
                                    {isGroup ? t('friends.inviteTypeGroup') : t('friends.inviteTypePlan')}
                                </Text>
                            </View>
                        </View>
                        <Text style={styles.inviteTitle} numberOfLines={2}>{title}</Text>
                        <Text style={styles.inviteFrom}>{t('friends.inviteFrom', { name: inviterName })}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
                </TouchableOpacity>
                <View style={styles.inviteActions}>
                    <TouchableOpacity
                        style={[styles.actionBtn, styles.actionSuccess, busy && styles.btnDisabled]}
                        onPress={() => handleAcceptPlanInvite(invite)}
                        disabled={busy}
                    >
                        {busy ? (
                            <ActivityIndicator color="#FFF" size="small" />
                        ) : (
                            <>
                                <Ionicons name="checkmark-circle" size={18} color="#FFF" />
                                <Text style={styles.actionSuccessText}>{t('friends.accept')}</Text>
                            </>
                        )}
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.actionBtn, styles.actionOutlineDanger, busy && styles.btnDisabled]}
                        onPress={() => handleRejectPlanInvite(invite.id)}
                        disabled={busy}
                    >
                        <Ionicons name="close-circle-outline" size={18} color={DANGER} />
                        <Text style={styles.actionOutlineDangerText}>{t('friends.reject')}</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    const handleSuggestAdd = (person: FriendSuggestion) => {
        const uid = userIdRef.current;
        if (!uid || suggestSentIds.has(person.id)) return;
        setSuggestBusyId(person.id);
        void sendFriendRequest(uid, person.id).then(({ error }) => {
            setSuggestBusyId(null);
            if (error) {
                hapticError();
                Alert.alert(
                    t('profile.error'),
                    error === 'organizer_no_friends' ? t('friends.organizerNoFriends') : error,
                );
                return;
            }
            hapticSuccess();
            setSuggestSentIds((prev) => new Set(prev).add(person.id));
            setSuggestions((prev) => prev.filter((s) => s.id !== person.id));
            void refillSuggestions();
        });
    };

    const handleSuggestDismiss = (person: FriendSuggestion) => {
        const uid = userIdRef.current;
        if (!uid) return;
        hapticLight();
        setSuggestions((prev) => prev.filter((s) => s.id !== person.id));
        void dismissFriendSuggestion(uid, person.id).then(() => refillSuggestions());
    };

    const suggestionsBlock =
        suggestions.length === 0 ? null : (
            <View style={styles.suggestBlock}>
                <Text style={styles.suggestTitle}>{t('friends.suggested')}</Text>
                <Text style={styles.suggestSub}>{t('friends.suggestedSub')}</Text>
                {suggestions.map((person, index) => {
                    const sent = suggestSentIds.has(person.id);
                    const busy = suggestBusyId === person.id;
                    const reasonKey =
                        person.reason === 'coincided_fof'
                            ? 'friends.suggestedReasonFofMet'
                            : person.reason === 'friend_of_friend'
                                ? 'friends.suggestedReasonFof'
                                : person.reason === 'affinity'
                                    ? 'friends.suggestedReasonAffinity'
                                    : 'friends.suggestedReason';
                    return (
                        <View
                            key={person.id}
                            style={[styles.suggestRow, index === 0 && { borderTopWidth: 0 }]}
                        >
                            <TouchableOpacity
                                style={styles.suggestProfile}
                                activeOpacity={0.85}
                                onPress={() => openPersonProfile(person)}
                                onPressIn={() => prefetchUserProfile(person.id)}
                            >
                                <ProfileAvatar
                                    uri={person.avatar_url}
                                    name={person.nombre}
                                    size={48}
                                    recyclingKey={person.id}
                                />
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.name} numberOfLines={1}>
                                        {person.nombre}
                                    </Text>
                                    <Text style={styles.suggestHint} numberOfLines={1}>
                                        {t(reasonKey)}
                                    </Text>
                                </View>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.suggestDismissBtn}
                                onPress={() => handleSuggestDismiss(person)}
                                hitSlop={8}
                                accessibilityLabel={t('friends.dismissSuggested')}
                                activeOpacity={0.75}
                            >
                                <Ionicons name="close" size={18} color="#94A3B8" />
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.suggestAddBtn, sent && styles.suggestAddBtnSent]}
                                onPress={() => handleSuggestAdd(person)}
                                disabled={sent || busy}
                                activeOpacity={0.85}
                            >
                                {busy ? (
                                    <ActivityIndicator size="small" color="#FFF" />
                                ) : (
                                    <Text style={styles.suggestAddText}>
                                        {sent ? t('friends.sent') : t('friends.addSuggested')}
                                    </Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    );
                })}
            </View>
        );

    const EmptyFriends = () => (
        <View style={styles.emptyWrap}>
            <LinearGradient colors={['#EFF6FF', '#FFF']} style={styles.emptyIcon}>
                <Ionicons name="people" size={44} color={PRIMARY_DARK} />
            </LinearGradient>
            <Text style={styles.emptyTitle}>{t('friends.noFriends')}</Text>
            <Text style={styles.emptySub}>{t('friends.noFriendsSub')}</Text>
            {suggestionsBlock}
        </View>
    );

    const SectionHeader = ({
        title,
        count,
        accent,
        contentGap,
        sectionStyle,
    }: {
        title: string;
        count?: number;
        accent?: string;
        contentGap?: number;
        sectionStyle?: object;
    }) => (
        <View style={[styles.sectionHeader, sectionStyle, contentGap != null && { marginBottom: contentGap }]}>
            <View style={styles.sectionTitleRow}>
                {accent ? <View style={[styles.sectionDot, { backgroundColor: accent }]} /> : null}
                <Text style={styles.sectionTitle}>{title}</Text>
            </View>
            {count != null && count > 0 ? (
                <View style={styles.sectionCount}>
                    <Text style={styles.sectionCountText}>{count}</Text>
                </View>
            ) : null}
        </View>
    );

    return (
        <SafeAreaView style={styles.safe} edges={['top']}>
            <LinearGradient colors={[colors.gradientTop, colors.gradientBottom]} style={StyleSheet.absoluteFill} />

            <View style={styles.topBar}>
                <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} activeOpacity={0.8}>
                    <Ionicons name="chevron-back" size={24} color={colors.text} />
                </TouchableOpacity>
                <Text style={styles.topTitle}>{t('friends.title')}</Text>
                <View style={styles.iconBtnPlaceholder} />
            </View>

            <View style={styles.headerSpacer} />

            {/* Stats strip */}
            <View style={styles.statsStrip}>
                <View style={styles.statBox}>
                    <Text style={styles.statNum}>{friends.length}</Text>
                    <Text style={styles.statLabel}>{t('friends.tabFriends')}</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statBox}>
                    <View style={styles.statNumRow}>
                        <Text style={styles.statNum}>{pendingCount}</Text>
                        {pendingCount > 0 && <View style={styles.statLiveDot} />}
                    </View>
                    <Text style={styles.statLabel}>{t('friends.tabRequests')}</Text>
                </View>
            </View>

            <View style={styles.tabsSpacer} />

            {/* Tabs */}
            <View style={styles.tabWrap}>
                <TouchableOpacity
                    style={[styles.tab, activeTab === 'friends' && styles.tabActive]}
                    onPress={() => {
                        hapticSelection();
                        setActiveTab('friends');
                        router.setParams({ tab: 'friends' });
                    }}
                    activeOpacity={0.85}
                >
                    <Ionicons
                        name="people"
                        size={16}
                        color={activeTab === 'friends' ? '#FFF' : colors.textMuted}
                    />
                    <Text style={[styles.tabText, activeTab === 'friends' && styles.tabTextActive]}>
                        {t('friends.tabFriends')}
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.tab, activeTab === 'requests' && styles.tabActive]}
                    onPress={() => {
                        hapticSelection();
                        setActiveTab('requests');
                        router.setParams({ tab: 'requests' });
                    }}
                    activeOpacity={0.85}
                >
                    <Ionicons
                        name="notifications"
                        size={16}
                        color={activeTab === 'requests' ? '#FFF' : colors.textMuted}
                    />
                    <Text style={[styles.tabText, activeTab === 'requests' && styles.tabTextActive]}>
                        {t('friends.tabRequests')}
                    </Text>
                    {pendingCount > 0 && (
                        <View style={styles.tabBadge}>
                            <Text style={styles.tabBadgeText}>
                                {pendingCount > 9 ? '9+' : pendingCount}
                            </Text>
                        </View>
                    )}
                </TouchableOpacity>
            </View>

            <View style={styles.contentSpacer} />

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color={PRIMARY_DARK} />
                </View>
            ) : activeTab === 'friends' ? (
                <FlashList
                    ref={listRef}
                    style={{ flex: 1 }}
                    data={friends}
                    keyExtractor={(item) => item.friendshipId}
                    renderItem={renderFriend}
                    contentContainerStyle={styles.listFriends}
                    onScroll={onScroll}
                    scrollEventThrottle={scrollEventThrottle}
                    drawDistance={FLASH_LIST_DRAW_DISTANCE}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PRIMARY_DARK} />
                    }
                    ListFooterComponent={friends.length > 0 ? suggestionsBlock : null}
                    ListEmptyComponent={<EmptyFriends />}
                    showsVerticalScrollIndicator={false}
                />
            ) : (
                <ScrollView
                    ref={requestsScrollRef}
                    onScroll={onRequestsScroll}
                    scrollEventThrottle={requestsScrollThrottle}
                    contentContainerStyle={styles.listRequests}
                    keyboardShouldPersistTaps="handled"
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PRIMARY_DARK} />
                    }
                    showsVerticalScrollIndicator={false}
                >
                    {planJoinRequests.length > 0 && (
                        <View style={styles.invitesBlock}>
                            <LinearGradient
                                colors={['#ECFDF5', '#EFF6FF']}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 1 }}
                                style={styles.invitesGradient}
                            >
                                <View style={styles.invitesHeader}>
                                    <View style={styles.invitesHeaderLeft}>
                                        <View style={styles.invitesIconWrap}>
                                            <Ionicons name="hand-left" size={20} color="#047857" />
                                        </View>
                                        <View>
                                            <Text style={styles.invitesTitle}>{t('friends.planJoinRequests')}</Text>
                                            <Text style={styles.invitesSub}>{t('friends.planJoinRequestsSub')}</Text>
                                        </View>
                                    </View>
                                    <View style={styles.invitesCount}>
                                        <Text style={styles.invitesCountText}>{planJoinRequests.length}</Text>
                                    </View>
                                </View>
                                {planJoinRequests.map(renderPlanJoinRequest)}
                            </LinearGradient>
                        </View>
                    )}

                    {planInvites.length > 0 && (
                        <View style={styles.invitesBlock}>
                            <LinearGradient
                                colors={['#EFF6FF', '#F5F3FF']}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 1 }}
                                style={styles.invitesGradient}
                            >
                                <View style={styles.invitesHeader}>
                                    <View style={styles.invitesHeaderLeft}>
                                        <View style={styles.invitesIconWrap}>
                                            <Ionicons name="mail-unread" size={20} color={PRIMARY_DARK} />
                                        </View>
                                        <View>
                                            <Text style={styles.invitesTitle}>{t('friends.planInvites')}</Text>
                                            <Text style={styles.invitesSub}>{t('friends.planInvitesSub')}</Text>
                                        </View>
                                    </View>
                                    <View style={styles.invitesCount}>
                                        <Text style={styles.invitesCountText}>{planInvites.length}</Text>
                                    </View>
                                </View>
                                {planInvites.map(renderPlanInvite)}
                            </LinearGradient>
                        </View>
                    )}

                    <SectionHeader title={t('friends.received')} count={incoming.length} accent={SUCCESS} />
                    {incoming.length === 0 ? (
                        <View style={styles.sectionEmpty}>
                            <Ionicons name="checkmark-done-circle-outline" size={28} color="#CBD5E1" />
                            <Text style={styles.sectionEmptyText}>{t('friends.noNew')}</Text>
                        </View>
                    ) : (
                        incoming.map(renderIncoming)
                    )}

                    <View style={styles.outgoingBlock}>
                        <SectionHeader
                            title={t('friends.outgoing')}
                            count={outgoing.length}
                            accent="#94A3B8"
                        />
                        {outgoing.length === 0 ? (
                            <View style={styles.sectionEmpty}>
                                <Ionicons name="paper-plane-outline" size={26} color="#CBD5E1" />
                                <Text style={styles.sectionEmptyText}>{t('friends.noSent')}</Text>
                            </View>
                        ) : (
                            <View style={styles.outgoingCard}>{outgoing.map(renderOutgoing)}</View>
                        )}
                    </View>
                </ScrollView>
            )}
        </SafeAreaView>
    );
}

function createFriendsStyles(c: ThemeColors) {
    const INK = c.text;
    return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.backgroundAlt },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    iconBtn: {
        width: 42,
        height: 42,
        borderRadius: 14,
        backgroundColor: c.surface,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.95)',
    },
    iconBtnPlaceholder: { width: 42 },
    topTitle: { fontSize: 18, fontWeight: '900', color: INK, letterSpacing: -0.3 },
    headerSpacer: { height: 20 },
    tabsSpacer: { height: 22 },
    contentSpacer: { height: 8 },
    statsStrip: {
        flexDirection: 'row',
        marginHorizontal: 20,
        marginTop: 0,
        marginBottom: 0,
        backgroundColor: c.surface,
        borderRadius: 18,
        paddingVertical: 14,
        borderWidth: 1,
        borderColor: '#EEF3FB',
        shadowColor: PRIMARY_DARK,
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 4,
    },
    statBox: { flex: 1, alignItems: 'center' },
    statDivider: { width: 1, backgroundColor: '#E2E8F0', marginVertical: 4 },
    statNumRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    statNum: { fontSize: 22, fontWeight: '900', color: INK },
    statLabel: {
        fontSize: 11,
        fontWeight: '700',
        color: c.textMuted,
        marginTop: 4,
        textTransform: 'uppercase',
    },
    statLiveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: DANGER },
    tabWrap: {
        flexDirection: 'row',
        marginHorizontal: 20,
        marginTop: 0,
        marginBottom: 0,
        backgroundColor: 'rgba(255,255,255,0.75)',
        borderRadius: 16,
        padding: 4,
        borderWidth: 1,
        borderColor: '#EEF3FB',
    },
    tab: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 11,
        borderRadius: 12,
    },
    tabActive: { backgroundColor: PRIMARY_DARK },
    tabText: { fontSize: 13, fontWeight: '800', color: c.textMuted },
    tabTextActive: { color: '#FFF' },
    tabBadge: {
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: PRIMARY_DARK,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 4,
        marginLeft: 2,
    },
    tabBadgeText: { color: '#FFF', fontSize: 10, fontWeight: '900' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    listFriends: { paddingHorizontal: 20, paddingTop: 0, paddingBottom: 36 },
    listRequests: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 36 },
    premiumCardOuter: {
        marginBottom: 12,
        borderRadius: 20,
        shadowColor: '#0F2A4A',
        shadowOpacity: 0.16,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 6,
    },
    premiumCard: {
        borderRadius: 20,
        overflow: 'hidden',
        backgroundColor: c.surface,
        borderWidth: 1.5,
        borderColor: '#BFDBFE',
    },
    premiumHeaderBand: {
        paddingVertical: 10,
        paddingHorizontal: 14,
    },
    premiumHeaderTouch: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    avatarRingWrap: {
        width: 50,
        height: 50,
        borderRadius: 25,
        overflow: 'hidden',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.2)',
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.9)',
    },
    avatarPremium: {
        width: 54,
        height: 54,
        borderRadius: 27,
        backgroundColor: '#E3ECFB',
    },
    premiumHeaderText: { flex: 1 },
    premiumNameLight: {
        fontSize: 16,
        fontWeight: '900',
        color: '#FFF',
        letterSpacing: -0.3,
    },
    premiumSubLight: {
        fontSize: 11,
        color: 'rgba(255,255,255,0.82)',
        marginTop: 2,
        fontWeight: '600',
    },
    premiumChevronLight: {
        width: 32,
        height: 32,
        borderRadius: 10,
        backgroundColor: 'rgba(255,255,255,0.18)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    premiumBody: {
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 14,
        backgroundColor: '#FAFCFF',
    },
    premiumActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    premiumChatWrap: { flex: 1 },
    premiumChatBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 13,
        borderRadius: 16,
    },
    premiumChatText: { color: '#FFF', fontWeight: '800', fontSize: 14, letterSpacing: 0.2 },
    premiumRemoveBtn: {
        width: 48,
        height: 48,
        borderRadius: 16,
        backgroundColor: c.surface,
        borderWidth: 1.5,
        borderColor: '#FECACA',
        justifyContent: 'center',
        alignItems: 'center',
    },
    card: {
        backgroundColor: c.surface,
        borderRadius: 20,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#EEF3FB',
        overflow: 'hidden',
        shadowColor: PRIMARY_DARK,
        shadowOpacity: 0.06,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
    },
    rowMain: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 14,
        gap: 12,
    },
    avatarLg: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#E3ECFB' },
    avatarMd: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#E3ECFB' },
    avatarSm: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#E3ECFB' },
    rowText: { flex: 1 },
    name: { fontSize: 16, fontWeight: '800', color: INK },
    rowSub: { fontSize: 12, color: '#94A3B8', marginTop: 3, fontWeight: '500' },
    rowActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 14,
        paddingBottom: 14,
    },
    actionBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 11,
        borderRadius: 14,
    },
    actionPrimary: { backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE' },
    actionPrimaryText: { color: PRIMARY_DARK, fontWeight: '800', fontSize: 13 },
    actionSuccess: { backgroundColor: SUCCESS },
    actionSuccessText: { color: '#FFF', fontWeight: '800', fontSize: 13 },
    actionOutlineDanger: {
        flex: 1,
        backgroundColor: c.surface,
        borderWidth: 1.5,
        borderColor: '#FECACA',
    },
    actionOutlineDangerText: { color: DANGER, fontWeight: '800', fontSize: 13 },
    iconCircle: {
        width: 44,
        height: 44,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
    },
    iconDanger: { backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' },
    iconMuted: { backgroundColor: '#F1F5F9' },
    hintPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        alignSelf: 'flex-start',
        marginTop: 6,
        backgroundColor: '#EFF6FF',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
    },
    hintPillText: { fontSize: 11, fontWeight: '700', color: PRIMARY_DARK },
    btnDisabled: { opacity: 0.55 },
    invitesBlock: {
        borderRadius: 22,
        overflow: 'hidden',
        marginBottom: 22,
        borderWidth: 1,
        borderColor: '#BFDBFE',
    },
    invitesGradient: { padding: 16 },
    invitesHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: 14,
        gap: 12,
    },
    invitesHeaderLeft: { flexDirection: 'row', gap: 12, flex: 1 },
    invitesIconWrap: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: c.surface,
        justifyContent: 'center',
        alignItems: 'center',
    },
    invitesTitle: { fontSize: 16, fontWeight: '900', color: INK },
    invitesSub: { fontSize: 12, color: c.textMuted, marginTop: 3, lineHeight: 17 },
    invitesCount: {
        minWidth: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: DANGER,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 8,
    },
    invitesCountText: { color: '#FFF', fontSize: 13, fontWeight: '900' },
    inviteCard: {
        backgroundColor: c.surface,
        borderRadius: 18,
        padding: 14,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: '#EEF3FB',
    },
    inviteTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
    inviteBody: { flex: 1 },
    inviteTypeRow: { marginBottom: 6 },
    typePill: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 10,
    },
    typePlan: { backgroundColor: '#EFF6FF' },
    typeGroup: { backgroundColor: '#F3E8FF' },
    typePillText: { fontSize: 10, fontWeight: '800', color: PRIMARY_DARK, textTransform: 'uppercase' },
    inviteTitle: { fontSize: 17, fontWeight: '900', color: INK, marginBottom: 4 },
    inviteFrom: { fontSize: 13, color: c.textMuted, fontWeight: '600' },
    inviteActions: { flexDirection: 'row', gap: 10 },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
        marginTop: 4,
    },
    sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    sectionDot: { width: 8, height: 8, borderRadius: 4 },
    sectionTitle: {
        fontSize: 12,
        fontWeight: '800',
        color: c.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
    },
    sectionCount: {
        backgroundColor: '#FEE2E2',
        paddingHorizontal: 10,
        paddingVertical: 3,
        borderRadius: 10,
    },
    sectionCountText: { color: DANGER, fontSize: 11, fontWeight: '900' },
    sectionEmpty: {
        backgroundColor: c.surface,
        borderRadius: 18,
        padding: 24,
        alignItems: 'center',
        gap: 8,
        marginBottom: 20,
        borderWidth: 1,
        borderColor: '#EEF3FB',
    },
    sectionEmptyText: { color: '#94A3B8', fontSize: 14, fontWeight: '500' },
    outgoingBlock: {
        marginTop: 22,
    },
    outgoingCard: {
        backgroundColor: c.surface,
        borderRadius: 18,
        padding: 8,
        marginBottom: 20,
        borderWidth: 1,
        borderColor: '#EEF3FB',
    },
    outgoingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 10,
        gap: 10,
    },
    outgoingProfileTap: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minWidth: 0,
    },
    outgoingHint: { fontSize: 12, color: '#94A3B8', marginTop: 2 },
    cancelChip: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 10,
        backgroundColor: '#F1F5F9',
    },
    cancelChipText: { color: c.textMuted, fontWeight: '700', fontSize: 12 },
    emptyWrap: { alignItems: 'center', paddingTop: 40, paddingHorizontal: 16, width: '100%' },
    emptyIcon: {
        width: 96,
        height: 96,
        borderRadius: 48,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 18,
        borderWidth: 1,
        borderColor: '#BFDBFE',
    },
    emptyTitle: { fontSize: 19, fontWeight: '900', color: INK, marginBottom: 8 },
    emptySub: { fontSize: 14, color: c.textMuted, textAlign: 'center', lineHeight: 21, paddingHorizontal: 16 },
    suggestBlock: {
        width: '100%',
        marginTop: 4,
        marginBottom: 8,
        backgroundColor: c.surface,
        borderRadius: 20,
        padding: 14,
        borderWidth: 1,
        borderColor: '#E0EFFF',
    },
    suggestTitle: { fontSize: 16, fontWeight: '900', color: INK },
    suggestSub: { fontSize: 12, color: c.textMuted, fontWeight: '600', marginTop: 3, marginBottom: 12 },
    suggestRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: '#EEF3FB',
    },
    suggestProfile: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 },
    suggestHint: { fontSize: 12, color: '#94A3B8', fontWeight: '600', marginTop: 2 },
    suggestDismissBtn: {
        width: 34,
        height: 34,
        borderRadius: 11,
        backgroundColor: '#F1F5F9',
        justifyContent: 'center',
        alignItems: 'center',
    },
    suggestAddBtn: {
        backgroundColor: PRIMARY_DARK,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 12,
        minWidth: 78,
        alignItems: 'center',
    },
    suggestAddBtnSent: { backgroundColor: '#BBF7D0' },
    suggestAddText: { color: '#FFF', fontWeight: '800', fontSize: 13 },
    });
}

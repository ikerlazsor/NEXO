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
    removeFriend,
    sendFriendRequest,
    type FriendProfile,
    type FriendRequest,
} from '../lib/friends';
import {
    dismissFriendSuggestion,
    getFriendSuggestions,
    type FriendSuggestion,
} from '../lib/friendSuggestions';
import { ensureDirectConversation } from '../lib/directChat';
import { hapticError, hapticLight, hapticSelection, hapticSuccess } from '../lib/haptics';
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
import { getAuthUser } from '../lib/auth';
import { invalidatePlanMembershipCaches, screenCacheKey, ScreenCacheTTL } from '../lib/screenCaches';
import { cacheGetStale, cacheInvalidate, cacheIsFresh, cacheSet } from '../lib/ttlCache';
import { supabase } from '../lib/supabase';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const BG_TOP = '#DCEBFF';
const BG_BOTTOM = '#F2F7FF';
const SUCCESS = '#22C55E';
const DANGER = '#EF4444';

type TabKey = 'friends' | 'requests';

export default function FriendsScreen() {
    const router = useRouter();
    const { t } = useT();
    const { tab } = useLocalSearchParams<{ tab?: string }>();
    const [activeTab, setActiveTab] = useState<TabKey>('friends');
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const { listRef, onScroll, scrollEventThrottle } = useListScrollRestore<FriendProfile & { friendshipId: string }>(ScreenKeys.FRIENDS);
    const { scrollRef: requestsScrollRef, onScroll: onRequestsScroll, scrollEventThrottle: requestsScrollThrottle } =
        useScrollViewRestore(`${ScreenKeys.FRIENDS}-requests`);
    const [friends, setFriends] = useState<(FriendProfile & { friendshipId: string })[]>([]);
    const [incoming, setIncoming] = useState<FriendRequest[]>([]);
    const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
    const [planInvites, setPlanInvites] = useState<PlanInvite[]>([]);
    const [suggestions, setSuggestions] = useState<FriendSuggestion[]>([]);
    const [suggestBusyId, setSuggestBusyId] = useState<string | null>(null);
    const [suggestSentIds, setSuggestSentIds] = useState<Set<string>>(new Set());
    /** Solo para aceptar invitación a plan (hay que validar cupo/límite antes de cambiar UI). */
    const [inviteAcceptId, setInviteAcceptId] = useState<string | null>(null);
    const hasLoadedRef = useRef(false);
    const userIdRef = useRef<string | null>(null);
    const loadGenRef = useRef(0);
    const refreshingRef = useRef(false);

    const loadData = useCallback(async (opts?: { force?: boolean }) => {
        const gen = ++loadGenRef.current;
        try {
            const user = await getAuthUser();
            if (!user) {
                router.replace('/login');
                return;
            }

            const cacheKey = screenCacheKey.friends(user.id);
            const cached = cacheGetStale<{
                friends: (FriendProfile & { friendshipId: string })[];
                incoming: FriendRequest[];
                outgoing: FriendRequest[];
                planInvites: PlanInvite[];
            }>(cacheKey);
            if (cached && !hasLoadedRef.current) {
                setFriends(cached.friends);
                setIncoming(cached.incoming);
                setOutgoing(cached.outgoing);
                setPlanInvites(cached.planInvites);
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
                || (cached?.planInvites?.length ?? 0) > 0;

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
                void getFriendSuggestions(user.id, 10)
                    .then((rows) => {
                        if (gen === loadGenRef.current) setSuggestions(rows);
                    })
                    .catch(() => {});
                return;
            }

            // Si la caché estaba vacía, fuerza red siempre al enfocar.
            const [friendsData, incomingData, outgoingData, invitesData, suggestData] = await Promise.all([
                getFriends(user.id),
                getIncomingRequests(user.id),
                getOutgoingRequests(user.id),
                getIncomingPlanInvites(user.id).catch(() => [] as PlanInvite[]),
                getFriendSuggestions(user.id, 10).catch(() => [] as FriendSuggestion[]),
            ]);
            if (gen !== loadGenRef.current) return;

            setFriends(friendsData);
            setIncoming(incomingData);
            setOutgoing(outgoingData);
            setPlanInvites(invitesData);
            setSuggestions(suggestData);
            cacheSet(cacheKey, {
                friends: friendsData,
                incoming: incomingData,
                outgoing: outgoingData,
                planInvites: invitesData,
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
    }, [router, t]);

    useFocusEffect(
        useCallback(() => {
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

    const handleAcceptPlanInvite = async (invite: PlanInvite) => {
        // Validar cupo/límite antes de quitar la invitación de la UI.
        setInviteAcceptId(invite.id);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            const { error, chatId, max } = await acceptPlanInvite(invite, user.id);
            if (error === 'full') {
                hapticError();
                Alert.alert(t('profile.error'), t('friends.inviteFull'));
                return;
            }
            if (error === 'limit') {
                hapticError();
                Alert.alert(t('profile.error'), t('feed.planLimitReached', { max: max ?? 3 }));
                return;
            }
            if (error) {
                hapticError();
                Alert.alert(t('profile.error'), error);
                return;
            }
            hapticSuccess();
            setPlanInvites((prev) => prev.filter((i) => i.id !== invite.id));
            invalidatePlanMembershipCaches(user.id);
            if (chatId) router.push(`/chat/${chatId}`);
        } finally {
            setInviteAcceptId(null);
        }
    };

    const handleRejectPlanInvite = (inviteId: string) => {
        hapticLight();
        const removed = planInvites.find((i) => i.id === inviteId);
        setPlanInvites((prev) => prev.filter((i) => i.id !== inviteId));
        void rejectPlanInvite(inviteId).then(({ error }) => {
            if (error) {
                if (removed) setPlanInvites((prev) => [removed, ...prev]);
                hapticError();
                Alert.alert(t('profile.error'), error);
            }
        });
    };

    const handleRemoveFriend = (friend: FriendProfile & { friendshipId: string }) => {
        Alert.alert(
            t('userprofile.unfriendTitle'),
            t('friends.removeConfirmName', { name: friend.nombre }),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('friends.removeBtn'),
                    style: 'destructive',
                    onPress: () => {
                        setFriends((prev) => prev.filter((f) => f.friendshipId !== friend.friendshipId));
                        invalidatePeerProfile(friend.id);
                        void removeFriend(friend.friendshipId).then(({ error }) => {
                            if (error) {
                                setFriends((prev) => [friend, ...prev]);
                                Alert.alert(t('profile.error'), error.message);
                            }
                        });
                    },
                },
            ]
        );
    };

    const handleOpenChat = (friendId: string) => {
        // Los chats 1:1 ya no crean "planes falsos": van directos a mensajes con receptor_id.
        const uid = userIdRef.current;
        if (uid) {
            void ensureDirectConversation(uid, friendId).then(() => {
                cacheInvalidate(screenCacheKey.chatsList(uid));
            });
        }
        router.push(`/direct-chat/${friendId}`);
    };

    const pendingCount = incoming.length + planInvites.length;

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
                            onPress={() =>
                                router.push({ pathname: '/user-profile/[id]', params: { id: item.id } })
                            }
                            activeOpacity={0.9}
                        >
                            <View style={styles.avatarRingWrap}>
                                <ProfileAvatar
                                    uri={item.avatar_url}
                                    name={item.nombre}
                                    size={54}
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

                    <View style={styles.premiumBody}>
                        <View style={styles.premiumActions}>
                            <TouchableOpacity
                                style={styles.premiumChatWrap}
                                onPress={() => handleOpenChat(item.id)}
                                activeOpacity={0.88}
                            >
                                <LinearGradient
                                    colors={[accentPair[0], accentPair[1]]}
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 1, y: 0 }}
                                    style={styles.premiumChatBtn}
                                >
                                    <Ionicons name="chatbubble-ellipses" size={18} color="#FFF" />
                                    <Text style={styles.premiumChatText}>{t('friends.message')}</Text>
                                </LinearGradient>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={styles.premiumRemoveBtn}
                                onPress={() => handleRemoveFriend(item)}
                                activeOpacity={0.85}
                            >
                                <Ionicons name="heart-dislike-outline" size={20} color={DANGER} />
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </View>
        );
    };

    const renderIncoming = (item: FriendRequest) => {
        return (
            <View key={item.id} style={styles.card}>
                <TouchableOpacity
                    style={styles.rowMain}
                    onPress={() => router.push({ pathname: '/user-profile/[id]', params: { id: item.perfil.id } })}
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
                        <Ionicons name="close" size={22} color="#64748B" />
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
                    onPress={() => router.push(`/user-profile/${item.perfil.id}`)}
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

    const renderPlanInvite = (invite: PlanInvite) => {
        const busy = inviteAcceptId === invite.id;
        const title = invite.plan?.titulo || '—';
        const inviterName = invite.invitador?.nombre || t('chats.user');
        const isGroup = invite.tipo === 'grupo';

        const openPlanInvite = () => {
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
                <TouchableOpacity style={styles.inviteTop} onPress={openPlanInvite} activeOpacity={0.85}>
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
                Alert.alert(t('profile.error'), error);
                return;
            }
            hapticSuccess();
            setSuggestSentIds((prev) => new Set(prev).add(person.id));
            setSuggestions((prev) => prev.filter((s) => s.id !== person.id));
            cacheInvalidate(`friendSuggestions:${uid}`);
        });
    };

    const handleSuggestDismiss = (person: FriendSuggestion) => {
        const uid = userIdRef.current;
        if (!uid) return;
        hapticLight();
        setSuggestions((prev) => prev.filter((s) => s.id !== person.id));
        void dismissFriendSuggestion(uid, person.id);
    };

    const suggestionsHeader =
        suggestions.length === 0 ? null : (
            <View style={styles.suggestBlock}>
                <Text style={styles.suggestTitle}>{t('friends.suggested')}</Text>
                <Text style={styles.suggestSub}>{t('friends.suggestedSub')}</Text>
                {suggestions.map((person, index) => {
                    const sent = suggestSentIds.has(person.id);
                    const busy = suggestBusyId === person.id;
                    return (
                        <View
                            key={person.id}
                            style={[styles.suggestRow, index === 0 && { borderTopWidth: 0 }]}
                        >
                            <TouchableOpacity
                                style={styles.suggestProfile}
                                activeOpacity={0.85}
                                onPress={() =>
                                    router.push({ pathname: '/user-profile/[id]', params: { id: person.id } })
                                }
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
                                        {person.nombre_usuario
                                            ? `@${person.nombre_usuario}`
                                            : t('friends.suggestedReason')}
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
            {suggestionsHeader}
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
            <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={StyleSheet.absoluteFill} />

            <View style={styles.topBar}>
                <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} activeOpacity={0.8}>
                    <Ionicons name="chevron-back" size={24} color={INK} />
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
                    }}
                    activeOpacity={0.85}
                >
                    <Ionicons
                        name="people"
                        size={16}
                        color={activeTab === 'friends' ? '#FFF' : '#64748B'}
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
                    }}
                    activeOpacity={0.85}
                >
                    <Ionicons
                        name="notifications"
                        size={16}
                        color={activeTab === 'requests' ? '#FFF' : '#64748B'}
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
                    ListHeaderComponent={friends.length > 0 ? suggestionsHeader : null}
                    ListEmptyComponent={<EmptyFriends />}
                    showsVerticalScrollIndicator={false}
                />
            ) : (
                <ScrollView
                    ref={requestsScrollRef}
                    onScroll={onRequestsScroll}
                    scrollEventThrottle={requestsScrollThrottle}
                    contentContainerStyle={styles.listRequests}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PRIMARY_DARK} />
                    }
                    showsVerticalScrollIndicator={false}
                >
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

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: BG_BOTTOM },
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
        backgroundColor: 'rgba(255,255,255,0.88)',
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
        backgroundColor: '#FFF',
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
        color: '#64748B',
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
    tabText: { fontSize: 13, fontWeight: '800', color: '#64748B' },
    tabTextActive: { color: '#FFF' },
    tabBadge: {
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: DANGER,
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
        marginBottom: 18,
        borderRadius: 22,
        shadowColor: '#0F2A4A',
        shadowOpacity: 0.2,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 10 },
        elevation: 8,
    },
    premiumCard: {
        borderRadius: 22,
        overflow: 'hidden',
        backgroundColor: '#FFF',
        borderWidth: 1.5,
        borderColor: '#BFDBFE',
    },
    premiumHeaderBand: {
        paddingVertical: 16,
        paddingHorizontal: 16,
    },
    premiumHeaderTouch: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    avatarRingWrap: {
        width: 58,
        height: 58,
        borderRadius: 29,
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
        fontSize: 18,
        fontWeight: '900',
        color: '#FFF',
        letterSpacing: -0.3,
    },
    premiumSubLight: {
        fontSize: 12,
        color: 'rgba(255,255,255,0.82)',
        marginTop: 4,
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
        backgroundColor: '#FFF',
        borderWidth: 1.5,
        borderColor: '#FECACA',
        justifyContent: 'center',
        alignItems: 'center',
    },
    card: {
        backgroundColor: '#FFF',
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
        backgroundColor: '#FFF',
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
        backgroundColor: '#FFF',
        justifyContent: 'center',
        alignItems: 'center',
    },
    invitesTitle: { fontSize: 16, fontWeight: '900', color: INK },
    invitesSub: { fontSize: 12, color: '#64748B', marginTop: 3, lineHeight: 17 },
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
        backgroundColor: '#FFF',
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
    inviteFrom: { fontSize: 13, color: '#64748B', fontWeight: '600' },
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
        color: '#64748B',
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
        backgroundColor: '#FFF',
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
        backgroundColor: '#FFF',
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
    cancelChipText: { color: '#64748B', fontWeight: '700', fontSize: 12 },
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
    emptySub: { fontSize: 14, color: '#64748B', textAlign: 'center', lineHeight: 21, paddingHorizontal: 16 },
    suggestBlock: {
        width: '100%',
        marginTop: 4,
        marginBottom: 8,
        backgroundColor: '#FFF',
        borderRadius: 20,
        padding: 14,
        borderWidth: 1,
        borderColor: '#E0EFFF',
    },
    suggestTitle: { fontSize: 16, fontWeight: '900', color: INK },
    suggestSub: { fontSize: 12, color: '#64748B', fontWeight: '600', marginTop: 3, marginBottom: 12 },
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

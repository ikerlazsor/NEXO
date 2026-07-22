import {
    Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect,
    useLocalSearchParams,
    useRouter } from 'expo-router';
import { useCallback,
    useRef,
    useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Image,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Alert } from '../lib/nexoAlert';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
    acceptFriendRequest,
    cancelFriendRequest,
    getAvatarUri,
    getFriends,
    getIncomingRequests,
    getOutgoingRequests,
    rejectFriendRequest,
    removeFriend,
    type FriendProfile,
    type FriendRequest,
} from '../lib/friends';
import { useT } from '../lib/i18n';
import { OPTIMIZED_LIST_PROPS } from '../lib/listConfig';
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
import { screenCacheKey, ScreenCacheTTL } from '../lib/screenCaches';
import { cacheGetStale, cacheSet } from '../lib/ttlCache';
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
    const [actionId, setActionId] = useState<string | null>(null);
    const hasLoadedRef = useRef(false);

    const loadData = useCallback(async () => {
        try {
            const user = await getAuthUser();
            if (!user) {
                router.replace('/login');
                return;
            }

            const cached = cacheGetStale<{
                friends: (FriendProfile & { friendshipId: string })[];
                incoming: FriendRequest[];
                outgoing: FriendRequest[];
                planInvites: PlanInvite[];
            }>(screenCacheKey.friends(user.id));
            if (cached && !hasLoadedRef.current) {
                setFriends(cached.friends);
                setIncoming(cached.incoming);
                setOutgoing(cached.outgoing);
                setPlanInvites(cached.planInvites);
                hasLoadedRef.current = true;
                setLoading(false);
            } else if (!refreshing && !hasLoadedRef.current) {
                setLoading(true);
            }

            const [friendsData, incomingData, outgoingData, invitesData] = await Promise.all([
                getFriends(user.id),
                getIncomingRequests(user.id),
                getOutgoingRequests(user.id),
                getIncomingPlanInvites(user.id).catch(() => [] as PlanInvite[]),
            ]);

            setFriends(friendsData);
            setIncoming(incomingData);
            setOutgoing(outgoingData);
            setPlanInvites(invitesData);
            cacheSet(screenCacheKey.friends(user.id), {
                friends: friendsData,
                incoming: incomingData,
                outgoing: outgoingData,
                planInvites: invitesData,
            }, ScreenCacheTTL.friends);
        } catch {
            Alert.alert(t('profile.error'), t('friends.loadError'));
        } finally {
            hasLoadedRef.current = true;
            setLoading(false);
            setRefreshing(false);
        }
    }, [router, t, refreshing]);

    useFocusEffect(
        useCallback(() => {
            if (tab === 'requests') setActiveTab('requests');
            else if (tab === 'friends') setActiveTab('friends');
            loadData();
        }, [loadData, tab])
    );

    const onRefresh = () => {
        setRefreshing(true);
        loadData();
    };

    const handleAccept = async (requestId: string) => {
        setActionId(requestId);
        const { error } = await acceptFriendRequest(requestId);
        setActionId(null);
        if (error) {
            Alert.alert(t('profile.error'), error.message);
            return;
        }
        await loadData();
    };

    const handleReject = async (requestId: string) => {
        setActionId(requestId);
        const { error } = await rejectFriendRequest(requestId);
        setActionId(null);
        if (error) {
            Alert.alert(t('profile.error'), error.message);
            return;
        }
        await loadData();
    };

    const handleCancel = async (requestId: string) => {
        setActionId(requestId);
        const { error } = await cancelFriendRequest(requestId);
        setActionId(null);
        if (error) {
            Alert.alert(t('profile.error'), error.message);
            return;
        }
        await loadData();
    };

    const handleAcceptPlanInvite = async (invite: PlanInvite) => {
        setActionId('pinv_' + invite.id);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            const { error, chatId } = await acceptPlanInvite(invite, user.id);
            if (error === 'full') {
                Alert.alert(t('profile.error'), t('friends.inviteFull'));
                return;
            }
            if (error) {
                Alert.alert(t('profile.error'), error);
                return;
            }
            await loadData();
            if (chatId) router.push(`/chat/${chatId}`);
        } finally {
            setActionId(null);
        }
    };

    const handleRejectPlanInvite = async (inviteId: string) => {
        setActionId('pinv_' + inviteId);
        await rejectPlanInvite(inviteId);
        setActionId(null);
        await loadData();
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
                    onPress: async () => {
                        setActionId(friend.friendshipId);
                        const { error } = await removeFriend(friend.friendshipId);
                        setActionId(null);
                        if (error) {
                            Alert.alert(t('profile.error'), error.message);
                            return;
                        }
                        await loadData();
                    },
                },
            ]
        );
    };

    const handleOpenChat = (friendId: string) => {
        // Los chats 1:1 ya no crean "planes falsos": van directos a mensajes con receptor_id.
        router.push(`/direct-chat/${friendId}`);
    };

    const pendingCount = incoming.length + planInvites.length;

    const renderFriend = ({ item, index }: { item: FriendProfile & { friendshipId: string }; index: number }) => {
        const busy = actionId === item.friendshipId;
        const isChatting = actionId === 'chat_' + item.id;
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
                                <Image source={{ uri: getAvatarUri(item) }} style={styles.avatarPremium} />
                                <View style={styles.avatarRingBorder} />
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
                        <View style={styles.friendStatusRow}>
                            <Ionicons name="heart" size={14} color={PRIMARY_DARK} />
                            <Text style={styles.friendStatusText}>{t('friends.tabFriends')}</Text>
                        </View>

                        <View style={styles.premiumActions}>
                            <TouchableOpacity
                                style={styles.premiumChatWrap}
                                onPress={() => handleOpenChat(item.id)}
                                disabled={isChatting || busy}
                                activeOpacity={0.88}
                            >
                                <LinearGradient
                                    colors={[accentPair[0], accentPair[1]]}
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 1, y: 0 }}
                                    style={[styles.premiumChatBtn, (isChatting || busy) && styles.btnDisabled]}
                                >
                                    {isChatting ? (
                                        <ActivityIndicator color="#FFF" size="small" />
                                    ) : (
                                        <>
                                            <Ionicons name="chatbubble-ellipses" size={18} color="#FFF" />
                                            <Text style={styles.premiumChatText}>{t('friends.message')}</Text>
                                        </>
                                    )}
                                </LinearGradient>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.premiumRemoveBtn, busy && styles.btnDisabled]}
                                onPress={() => handleRemoveFriend(item)}
                                disabled={busy || isChatting}
                                activeOpacity={0.85}
                            >
                                {busy ? (
                                    <ActivityIndicator color={DANGER} size="small" />
                                ) : (
                                    <Ionicons name="person-remove-outline" size={20} color={DANGER} />
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </View>
        );
    };

    const renderIncoming = (item: FriendRequest) => {
        const busy = actionId === item.id;
        return (
            <View key={item.id} style={styles.card}>
                <TouchableOpacity
                    style={styles.rowMain}
                    onPress={() => router.push({ pathname: '/user-profile/[id]', params: { id: item.perfil.id } })}
                    activeOpacity={0.85}
                >
                    <Image source={{ uri: getAvatarUri(item.perfil) }} style={styles.avatarLg} />
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
                        style={[styles.actionBtn, styles.actionSuccess, busy && styles.btnDisabled]}
                        onPress={() => handleAccept(item.id)}
                        disabled={busy}
                        activeOpacity={0.85}
                    >
                        {busy ? (
                            <ActivityIndicator color="#FFF" size="small" />
                        ) : (
                            <>
                                <Ionicons name="checkmark" size={18} color="#FFF" />
                                <Text style={styles.actionSuccessText}>{t('friends.accept')}</Text>
                            </>
                        )}
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.iconCircle, styles.iconMuted, busy && styles.btnDisabled]}
                        onPress={() => handleReject(item.id)}
                        disabled={busy}
                    >
                        <Ionicons name="close" size={22} color="#64748B" />
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    const renderOutgoing = (item: FriendRequest) => {
        const busy = actionId === item.id;
        return (
            <View key={item.id} style={styles.outgoingRow}>
                <Image source={{ uri: getAvatarUri(item.perfil) }} style={styles.avatarSm} />
                <View style={styles.rowText}>
                    <Text style={styles.name} numberOfLines={1}>{item.perfil.nombre}</Text>
                    <Text style={styles.outgoingHint}>{t('friends.sent')}</Text>
                </View>
                <TouchableOpacity
                    style={[styles.cancelChip, busy && styles.btnDisabled]}
                    onPress={() => handleCancel(item.id)}
                    disabled={busy}
                >
                    {busy ? (
                        <ActivityIndicator color="#64748B" size="small" />
                    ) : (
                        <Text style={styles.cancelChipText}>{t('friends.cancel')}</Text>
                    )}
                </TouchableOpacity>
            </View>
        );
    };

    const renderPlanInvite = (invite: PlanInvite) => {
        const busy = actionId === 'pinv_' + invite.id;
        const title = invite.plan?.titulo || '—';
        const inviterName = invite.invitador?.nombre || t('chats.user');
        const isGroup = invite.tipo === 'grupo';

        return (
            <View key={invite.id} style={styles.inviteCard}>
                <View style={styles.inviteTop}>
                    <Image
                        source={{
                            uri: getAvatarUri(
                                invite.invitador ?? { avatar_url: null, nombre: inviterName }
                            ),
                        }}
                        style={styles.avatarMd}
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
                </View>
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

    const EmptyFriends = () => (
        <View style={styles.emptyWrap}>
            <LinearGradient colors={['#EFF6FF', '#FFF']} style={styles.emptyIcon}>
                <Ionicons name="people" size={44} color={PRIMARY_DARK} />
            </LinearGradient>
            <Text style={styles.emptyTitle}>{t('friends.noFriends')}</Text>
            <Text style={styles.emptySub}>{t('friends.noFriendsSub')}</Text>
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
                    onPress={() => setActiveTab('friends')}
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
                    onPress={() => setActiveTab('requests')}
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
                <FlatList
                    ref={listRef}
                    data={friends}
                    keyExtractor={(item) => item.friendshipId}
                    renderItem={renderFriend}
                    contentContainerStyle={styles.listFriends}
                    onScroll={onScroll}
                    scrollEventThrottle={scrollEventThrottle}
                    {...OPTIMIZED_LIST_PROPS}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PRIMARY_DARK} />
                    }
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
                        <View style={styles.outgoingTitleGap} />
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
    contentSpacer: { height: 18 },
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
    listFriends: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 36 },
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
        position: 'relative',
    },
    avatarPremium: {
        width: 58,
        height: 58,
        borderRadius: 29,
        backgroundColor: '#E3ECFB',
        borderWidth: 3,
        borderColor: 'rgba(255,255,255,0.95)',
    },
    avatarRingBorder: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 29,
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.35)',
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
        paddingTop: 12,
        paddingBottom: 14,
        backgroundColor: '#FAFCFF',
    },
    friendStatusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 12,
    },
    friendStatusText: {
        fontSize: 12,
        fontWeight: '800',
        color: PRIMARY_DARK,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    premiumActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        padding: 14,
        paddingLeft: 18,
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
    inviteTop: { flexDirection: 'row', gap: 12, marginBottom: 12 },
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
        marginTop: 36,
        paddingTop: 8,
    },
    outgoingTitleGap: {
        height: 22,
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
    outgoingHint: { fontSize: 12, color: '#94A3B8', marginTop: 2 },
    cancelChip: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 10,
        backgroundColor: '#F1F5F9',
    },
    cancelChipText: { color: '#64748B', fontWeight: '700', fontSize: 12 },
    emptyWrap: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 28 },
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
    emptySub: { fontSize: 14, color: '#64748B', textAlign: 'center', lineHeight: 21 },
});

import {
    Ionicons } from '@expo/vector-icons';
import { useFocusEffect,
    useRouter } from 'expo-router';
import { useCallback,
    useEffect,
    useRef,
    useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import {
    ActivityIndicator,
    AppState,
    type AppStateStatus,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import { Alert } from '../../lib/nexoAlert';
import { type ThemeColors } from '../../theme';
import { useAppTheme, useThemedStyles } from '../../lib/appTheme';
import { ChatListRow, type ChatListItem } from '../../components/ChatListRow';
import { ProfileAvatar } from '../../components/ProfileAvatar';
import { ChatSkeletonList } from '../../components/SkeletonShimmer';
import { NexoEmptyState } from '../../components/ui/NexoState';
import { useListScrollRestore } from '../../hooks/useListScrollRestore';
import { getDirectConversations, hideDirectChat, ensureDirectConversation } from '../../lib/directChat';
import { getChatSummaries } from '../../lib/chatSummaries';
import { deletePlanCompletely } from '../../lib/deletePlan';
import { isGroupChatPlan } from '../../lib/feedPlans';
import { getFriends, getAvatarUri, type FriendProfile } from '../../lib/friends';
import { useT } from '../../lib/i18n';
import { formatChatListPreview } from '../../lib/chatSystem';
import { FLASH_LIST_DRAW_DISTANCE } from '../../lib/listConfig';
import { ScreenKeys } from '../../lib/screenState';
import { getAuthUser } from '../../lib/auth';
import { useAuthSession } from '../../lib/authSession';
import { GuestLockedPanel } from '../../components/GuestLockedPanel';
import { useChromeHeaderLayout } from '../../components/MainChrome';
import { markDirectChatRead, markPlanChatRead, subscribeChatUnread } from '../../lib/chatUnread';
import { isPlanChatAlive, runPlanLifecycleMaintenance } from '../../lib/planLifecycle';
import { filterHiddenPlanChats, hidePlanChat } from '../../lib/planChatHide';
import { diskSet } from '../../lib/diskCache';
import { prefetchRemoteImages } from '../../lib/prefetchCovers';
import { prefetchRecentChatThreads, seedChatThreadPeek } from '../../lib/prefetchChats';
import { invalidatePlanMembershipCaches, screenCacheKey, ScreenCacheTTL } from '../../lib/screenCaches';
import { broadcastPlanMembership } from '../../lib/membershipBroadcast';
import { cacheGetStale, cacheIsFresh, cacheInvalidate, cacheSet } from '../../lib/ttlCache';
import { supabase } from '../../lib/supabase';

type ChatRow = ChatListItem;

const MAX_GROUP_NAME_LENGTH = 40;

export default function MyChatsScreen() {
    const router = useRouter();
    const { t } = useT();
    const { colors, scheme } = useAppTheme();
    const styles = useThemedStyles(createChatsStyles);
    const { isGuest, userId } = useAuthSession();
    const chrome = useChromeHeaderLayout();
    const insets = useSafeAreaInsets();
    const cachedChats = userId ? cacheGetStale<ChatRow[]>(screenCacheKey.chatsList(userId)) : null;
    const cachedHasRows = Array.isArray(cachedChats) && cachedChats.length > 0;
    const [chats, setChats] = useState<ChatRow[]>(() => (cachedHasRows ? cachedChats! : []));
    const [loading, setLoading] = useState(() => !cachedHasRows);
    const [refreshing, setRefreshing] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [showCreateGroup, setShowCreateGroup] = useState(false);
    const [groupName, setGroupName] = useState('');
    const [friends, setFriends] = useState<(FriendProfile & { friendshipId: string })[]>([]);
    const [selectedFriends, setSelectedFriends] = useState<Set<string>>(new Set());
    const [loadingFriends, setLoadingFriends] = useState(false);
    const [creatingGroup, setCreatingGroup] = useState(false);
    const [currentUserId, setCurrentUserId] = useState<string | null>(userId);
    const hasDataRef = useRef(cachedHasRows);
    const fetchInFlightRef = useRef(false);
    const openSwipeRef = useRef<Swipeable | null>(null);
    const swipeRefs = useRef(new Map<string, Swipeable>());
    const silentRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fetchMyChatsRef = useRef<(opts?: { silent?: boolean; force?: boolean }) => Promise<void>>(async () => {});
    const { listRef, onScroll, scrollEventThrottle } = useListScrollRestore<ChatRow>(
        ScreenKeys.CHATS,
        { restoreOnFocus: false },
    );

    const scheduleSilentRefresh = useCallback(() => {
        if (silentRefreshTimer.current) clearTimeout(silentRefreshTimer.current);
        silentRefreshTimer.current = setTimeout(() => {
            void fetchMyChatsRef.current({ silent: true });
        }, 900);
    }, []);

    useEffect(() => {
        if (!userId) return;
        setCurrentUserId(userId);
        const cached = cacheGetStale<ChatRow[]>(screenCacheKey.chatsList(userId));
        if (Array.isArray(cached) && cached.length > 0 && !hasDataRef.current) {
            setChats(cached);
            hasDataRef.current = true;
            setLoading(false);
        }
        // Siempre pedir red al conocer userId (caché [] no cuenta).
        void fetchMyChatsRef.current({ silent: hasDataRef.current, force: !hasDataRef.current });
    }, [userId]);

    useEffect(() => {
        const unsub = subscribeChatUnread(() => {
            scheduleSilentRefresh();
        });
        return unsub;
    }, [scheduleSilentRefresh]);

    useEffect(() => {
        const channel = supabase
            .channel(`chats-unread-${Math.random().toString(36).slice(2, 9)}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensajes' }, () => {
                scheduleSilentRefresh();
            })
            .subscribe();
        return () => {
            if (silentRefreshTimer.current) clearTimeout(silentRefreshTimer.current);
            supabase.removeChannel(channel);
        };
    }, [scheduleSilentRefresh]);

    const formatPreview = (msg: { tipo: string; contenido: string; emisor_id: string }, names: Record<string, string>) =>
        formatChatListPreview(msg, {
            names,
            currentUserId,
            youLabel: t('chats.you'),
            userFallback: t('chats.user'),
            labels: {
                joinedPlanSelf: t('chat.systemJoinedPlanSelf'),
                joinedGroupSelf: t('chat.systemJoinedGroupSelf'),
                joinedPlan: (name) => t('chat.systemJoinedPlan', { name }),
                joinedGroup: (name) => t('chat.systemJoinedGroup', { name }),
                image: t('chats.previewImage'),
                video: t('chats.previewVideo'),
                voice: t('chats.previewVoice'),
            },
        });


    const fetchMyChats = async (opts?: { silent?: boolean; force?: boolean }) => {
        if (fetchInFlightRef.current && opts?.silent) return;
        try {
            fetchInFlightRef.current = true;
            if (!opts?.silent && !refreshing && !hasDataRef.current) setLoading(true);
            const uid = userId ?? (await getAuthUser())?.id ?? null;
            if (!uid) return;
            setCurrentUserId(uid);
            const user = { id: uid };

            const cacheKey = screenCacheKey.chatsList(user.id);
            const cached = cacheGetStale<ChatRow[]>(cacheKey);
            if (Array.isArray(cached) && cached.length > 0 && !hasDataRef.current) {
                setChats(cached);
                hasDataRef.current = true;
                setLoading(false);
            }

            if (
                !opts?.force
                && !opts?.silent
                && cacheIsFresh(cacheKey)
                && hasDataRef.current
                && Array.isArray(cached)
                && cached.length > 0
            ) {
                setLoading(false);
                setRefreshing(false);
                return;
            }

            void runPlanLifecycleMaintenance();

            const summaries = await getChatSummaries(user.id, {
                // Los INSERT en tiempo real y el pull-to-refresh deben saltarse el TTL.
                force: !!opts?.force || !!opts?.silent,
            });
            const directConversations = await getDirectConversations(user.id, summaries);

            let planRows: ChatRow[] = summaries
                .filter((row) => row.conversation_kind === 'plan')
                .filter((row) =>
                    isPlanChatAlive({
                        fecha_evento: row.event_at,
                        categoria: row.category,
                        chat_eliminado_en: row.chat_deleted_at,
                    }),
                )
                .map((row) => {
                    const hasLastMessage = !!row.last_at && !!row.last_sender_id;
                    const ultimoTexto = hasLastMessage
                        ? formatPreview(
                              {
                                  tipo: row.last_type ?? 'texto',
                                  contenido: row.last_content ?? '',
                                  emisor_id: row.last_sender_id!,
                              },
                              {
                                  [row.last_sender_id!]:
                                      row.last_sender_id === user.id
                                          ? t('chats.you')
                                          : row.last_sender_name || t('chats.user'),
                              },
                          )
                        : t('chats.noMessages');

                    return {
                        id: row.conversation_id,
                        title: row.title,
                        image_url: row.image_url,
                        kind: isGroupChatPlan({ categoria: row.category })
                            ? 'group' as const
                            : 'plan' as const,
                        creadorId: row.creator_id ?? undefined,
                        fechaEvento: row.event_at,
                        ultimoTexto,
                        lastAt: row.last_at ?? row.created_at ?? '',
                        unread: row.unread_count,
                    };
                });
            planRows = await filterHiddenPlanChats(user.id, planRows);

            const directRows: ChatRow[] = directConversations.map((conversation) => ({
                id: `direct-${conversation.peerId}`,
                peerId: conversation.peerId,
                title: conversation.nombre,
                image_url: conversation.avatarUri,
                kind: 'direct' as const,
                ultimoTexto: conversation.lastMessage
                    ? formatPreview(
                          {
                              tipo: conversation.lastMessage.tipo,
                              contenido: conversation.lastMessage.contenido,
                              emisor_id: conversation.lastMessage.emisor_id,
                          },
                          {
                              [conversation.peerId]: conversation.nombre,
                              [user.id]: t('chats.you'),
                          },
                      )
                    : t('chats.noMessages'),
                lastAt: conversation.lastMessage?.creado_en ?? conversation.openedAt ?? '',
                unread: conversation.unread,
            }));

            const rows = [...planRows, ...directRows].sort(
                (a, b) => new Date(b.lastAt || 0).getTime() - new Date(a.lastAt || 0).getTime()
            );

            setChats(rows);
            hasDataRef.current = true;
            setLoadError(false);
            cacheSet(cacheKey, rows, ScreenCacheTTL.chatsList);
            void diskSet(cacheKey, rows);
            prefetchRemoteImages(rows.map((row) => row.image_url), 24);
            prefetchRecentChatThreads(user.id, rows);
        } catch (error) {
            if (__DEV__) console.error('Error cargando mis chats:', error);
            if (!hasDataRef.current) setLoadError(true);
        } finally {
            fetchInFlightRef.current = false;
            setLoading(false);
            setRefreshing(false);
        }
    };
    fetchMyChatsRef.current = fetchMyChats;

    useFocusEffect(
        useCallback(() => {
            void fetchMyChatsRef.current({ silent: hasDataRef.current, force: false });
        }, []),
    );

    useEffect(() => {
        const onAppState = (next: AppStateStatus) => {
            if (next !== 'active') return;
            void fetchMyChatsRef.current({ silent: true, force: false });
        };
        const sub = AppState.addEventListener('change', onAppState);
        return () => sub.remove();
    }, []);

    const confirmDeleteChat = useCallback((item: ChatRow) => {
        if (!currentUserId) return;
        openSwipeRef.current?.close();

        if (item.kind === 'direct') {
            if (!item.peerId) return;
            Alert.alert(t('chat.deleteDirectTitle'), t('chat.deleteDirectConfirm'), [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('chat.deleteChat'),
                    style: 'destructive',
                    onPress: () => {
                        setTimeout(() => {
                            void (async () => {
                                const { error } = await hideDirectChat(currentUserId, item.peerId!);
                                if (error) {
                                    Alert.alert(t('profile.error'), error);
                                    return;
                                }
                                setChats((prev) => prev.filter((c) => c.id !== item.id));
                            })();
                        }, 0);
                    },
                },
            ]);
            return;
        }

        const isHost = !!item.creadorId && item.creadorId === currentUserId;
        const planStarted =
            !!item.fechaEvento &&
            Number.isFinite(new Date(item.fechaEvento).getTime()) &&
            Date.now() >= new Date(item.fechaEvento).getTime();
        const leavePlan = !isHost && !planStarted;

        const title = isHost
            ? t('chat.deletePlanHost')
            : leavePlan
              ? t('chat.deleteChatAndLeave')
              : t('chat.deleteChat');
        const message = isHost
            ? t('chat.deletePlanHostConfirm')
            : leavePlan
              ? t('chat.deleteChatConfirm')
              : t('chat.deleteChatOnlyConfirm');
        const actionLabel = isHost
            ? t('chat.deletePlanHost')
            : leavePlan
              ? t('chat.deleteChatAndLeave')
              : t('chat.deleteChat');

        Alert.alert(title, message, [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: actionLabel,
                style: 'destructive',
                // No async aquí: en Android el Alert espera el Promise y se queda abierto.
                onPress: () => {
                    setTimeout(() => {
                        void (async () => {
                            if (isHost) {
                                const { error } = await deletePlanCompletely(item.id);
                                if (error) {
                                    Alert.alert(t('profile.error'), t('chat.deletePlanError') + ': ' + error);
                                    return;
                                }
                            } else if (leavePlan) {
                                const { error } = await supabase
                                    .from('participantes')
                                    .delete()
                                    .eq('plan_id', item.id)
                                    .eq('usuario_id', currentUserId);
                                if (error) {
                                    Alert.alert(t('profile.error'), error.message);
                                    return;
                                }
                                void import('../../lib/push').then(({ cancelPlanLifecycleReminders }) => {
                                    void cancelPlanLifecycleReminders(item.id);
                                });
                                broadcastPlanMembership(item.id, 'none', {
                                    userId: currentUserId,
                                    dropJoined: true,
                                });
                            } else {
                                await hidePlanChat(currentUserId, item.id);
                                invalidatePlanMembershipCaches(currentUserId);
                            }
                            if (isHost) {
                                invalidatePlanMembershipCaches(currentUserId);
                            }
                            setChats((prev) => prev.filter((c) => c.id !== item.id));
                        })();
                    }, 0);
                },
            },
        ]);
    }, [currentUserId, t]);

    const registerSwipeRef = useCallback((key: string, ref: Swipeable | null) => {
        if (ref) swipeRefs.current.set(key, ref);
        else swipeRefs.current.delete(key);
    }, []);

    const handleSwipeWillOpen = useCallback((key: string) => {
        const next = swipeRefs.current.get(key);
        const prev = openSwipeRef.current;
        if (prev && prev !== next) prev.close();
        if (next) openSwipeRef.current = next;
    }, []);

    const handleSwipeClose = useCallback((key: string) => {
        const current = swipeRefs.current.get(key);
        if (openSwipeRef.current === current) openSwipeRef.current = null;
    }, []);

    const handleMarkChatRead = useCallback((item: ChatRow) => {
        if (!currentUserId || item.unread <= 0) return;
        if (item.kind === 'direct' && item.peerId) {
            void markDirectChatRead(currentUserId, item.peerId);
        } else {
            void markPlanChatRead(currentUserId, item.id);
        }
        setChats((prev) =>
            prev.map((c) =>
                c.id === item.id && c.kind === item.kind ? { ...c, unread: 0 } : c,
            ),
        );
    }, [currentUserId]);

    const handleOpenChat = useCallback((item: ChatRow) => {
        openSwipeRef.current?.close();
        if (item.kind === 'direct' && item.peerId) {
            router.push(`/direct-chat/${item.peerId}`);
        } else {
            router.push(`/chat/${item.id}`);
        }
    }, [router]);

    const renderChatItem = useCallback(
        ({ item }: { item: ChatRow }) => (
            <ChatListRow
                item={item}
                currentUserId={currentUserId}
                deleteLabel={t('chat.deleteChat')}
                onDelete={confirmDeleteChat}
                onOpen={handleOpenChat}
                onMarkRead={handleMarkChatRead}
                onSwipeWillOpen={handleSwipeWillOpen}
                onSwipeClose={handleSwipeClose}
                registerSwipeRef={registerSwipeRef}
            />
        ),
        [
            confirmDeleteChat,
            currentUserId,
            handleMarkChatRead,
            handleOpenChat,
            handleSwipeClose,
            handleSwipeWillOpen,
            registerSwipeRef,
            t,
        ],
    );

    const openCreateGroup = async () => {
        setShowCreateGroup(true);
        setGroupName('');
        setSelectedFriends(new Set());
        setLoadingFriends(true);
        try {
            const user = await getAuthUser();
            if (!user) return;
            const list = await getFriends(user.id);
            setFriends(list);
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingFriends(false);
        }
    };

    const toggleFriend = (id: string) => {
        setSelectedFriends((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const insertGroupPlan = async (userId: string, name: string) => {
        const farFuture = new Date();
        farFuture.setFullYear(farFuture.getFullYear() + 10);

        const payload: Record<string, unknown> = {
            titulo: name,
            categoria: 'Grupo',
            creador_id: userId,
            maximo_participantes: 50,
            fecha_evento: farFuture.toISOString(),
            requiere_aprobacion: false,
            is_group_chat: true,
        };

        const { data, error } = await supabase
            .from('planes')
            .insert(payload)
            .select()
            .single();

        if (error) {
            // Columna is_group_chat puede no existir aún en algunos entornos.
            if (/is_group_chat/i.test(error.message)) {
                delete payload.is_group_chat;
                const retry = await supabase.from('planes').insert(payload).select().single();
                if (retry.error) throw retry.error;
                return retry.data;
            }
            throw error;
        }
        return data;
    };

    const handleCreateGroup = async () => {
        if (selectedFriends.size === 0) {
            Alert.alert(t('login.notice'), t('chats.selectOneFriend'));
            return;
        }

        // 1 persona = chat directo (título = nombre de la persona), sin pedir nombre de grupo.
        if (selectedFriends.size === 1) {
            const peerId = [...selectedFriends][0];
            const friend = friends.find((f) => f.id === peerId);
            const title = friend?.nombre?.trim() || t('chats.user');
            const imageUrl = friend
                ? getAvatarUri({ nombre: title, avatar_url: friend.avatar_url ?? null })
                : null;
            setShowCreateGroup(false);
            setGroupName('');
            setSelectedFriends(new Set());
            setCreatingGroup(true);
            try {
                const user = await getAuthUser();
                if (!user) return;
                await ensureDirectConversation(user.id, peerId);
                cacheInvalidate(screenCacheKey.chatsList(user.id));
                const now = new Date().toISOString();
                const row: ChatRow = {
                    id: `direct-${peerId}`,
                    peerId,
                    title,
                    image_url: imageUrl,
                    kind: 'direct',
                    ultimoTexto: t('chats.noMessages'),
                    lastAt: now,
                    unread: 0,
                };
                setChats((prev) => [row, ...prev.filter((c) => c.id !== row.id)]);
                hasDataRef.current = true;
                seedChatThreadPeek(user.id, {
                    id: row.id,
                    title: row.title,
                    image_url: row.image_url,
                    kind: 'direct',
                    peerId,
                });
                router.push(`/direct-chat/${peerId}`);
            } catch (e: any) {
                if (__DEV__) console.error(e);
                Alert.alert(t('profile.error'), e?.message || t('friends.chatError'));
            } finally {
                setCreatingGroup(false);
            }
            return;
        }

        const name = groupName.trim();
        if (!name) {
            Alert.alert(t('login.notice'), t('chats.groupName'));
            return;
        }
        if (name.length > MAX_GROUP_NAME_LENGTH) {
            Alert.alert(t('login.notice'), t('chats.groupNameTooLong', { max: MAX_GROUP_NAME_LENGTH }));
            return;
        }

        setCreatingGroup(true);
        try {
            const user = await getAuthUser();
            if (!user) return;

            const newPlan = await insertGroupPlan(user.id, name.slice(0, MAX_GROUP_NAME_LENGTH));
            // Primero el creador; luego el resto (anfitrión puede insertar miembros).
            const { error: meError } = await supabase.from('participantes').insert({
                plan_id: newPlan.id,
                usuario_id: user.id,
                estado: 'aceptado',
            });
            if (meError) throw meError;

            setShowCreateGroup(false);
            setGroupName('');
            const friendIds = [...selectedFriends];
            setSelectedFriends(new Set());
            invalidatePlanMembershipCaches(user.id);
            router.push(`/chat/${newPlan.id}`);
            void fetchMyChats({ force: true });

            if (friendIds.length > 0) {
                void supabase.from('participantes').insert(
                    friendIds.map((usuario_id) => ({
                        plan_id: newPlan.id,
                        usuario_id,
                        estado: 'aceptado',
                    })),
                ).then(({ error: partsError }) => {
                    if (partsError && __DEV__) console.error(partsError);
                });
            }
        } catch (e: any) {
            if (__DEV__) console.error(e);
            const msg = String(e?.message ?? '');
            if (/active_plan_limit/i.test(msg)) {
                Alert.alert(t('profile.error'), t('createplan.planLimitReached', { max: 5 }));
            } else {
                Alert.alert(t('profile.error'), msg || t('friends.chatError'));
            }
        } finally {
            setCreatingGroup(false);
        }
    };

    const onRefresh = () => {
        setRefreshing(true);
        void fetchMyChats({ force: true });
    };

    const renderEmpty = () => (
        <NexoEmptyState
            icon={loadError ? 'cloud-offline-outline' : 'chatbubbles-outline'}
            title={loadError ? t('chats.loadError') : t('chats.empty')}
            description={loadError ? undefined : t('chats.emptySub')}
            actionLabel={loadError ? t('chats.retry') : t('chats.explore')}
            onAction={() => {
                if (loadError) {
                    setLoadError(false);
                    void fetchMyChats({ force: true });
                } else {
                    router.navigate('/');
                }
            }}
            secondaryLabel={loadError ? undefined : t('chats.createGroup')}
            onSecondaryAction={loadError ? undefined : openCreateGroup}
            style={{ paddingTop: 48 }}
        />
    );

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
                    <Text style={styles.pageTitle}>{t('chats.title')}</Text>
                </View>
                <GuestLockedPanel intent={{ type: 'chats' }} />
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
                    <Text style={styles.pageTitle}>{t('chats.title')}</Text>
                    <TouchableOpacity onPress={openCreateGroup} style={styles.addBtn} hitSlop={6}>
                        <Ionicons name="add" size={28} color={colors.text} />
                    </TouchableOpacity>
                </View>

                {loading && !refreshing && chats.length === 0 ? (
                    <ChatSkeletonList count={8} />
                ) : (
                <FlashList
                    ref={listRef}
                    style={{ flex: 1 }}
                    data={chats}
                    keyExtractor={(item) => item.id.toString()}
                    getItemType={(item) => item.kind}
                    ListEmptyComponent={!loading ? renderEmpty : null}
                    contentContainerStyle={styles.listContent}
                    onScroll={onScroll}
                    scrollEventThrottle={scrollEventThrottle}
                    drawDistance={FLASH_LIST_DRAW_DISTANCE}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
                    }
                    renderItem={renderChatItem}
                    extraData={currentUserId}
                />
                )}

                <Modal visible={showCreateGroup} animationType="slide" transparent>
                    <KeyboardAvoidingView
                        style={{ flex: 1 }}
                        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
                    >
                        <Pressable style={styles.modalOverlay} onPress={Keyboard.dismiss}>
                            <Pressable
                                style={[
                                    styles.modalSheet,
                                    { paddingBottom: Math.max(insets.bottom, 16) + 12 },
                                ]}
                                onPress={() => {}}
                            >
                                <View style={styles.modalHeader}>
                                    <Text style={styles.modalTitle}>
                                        {selectedFriends.size <= 1
                                            ? t('chats.createGroup')
                                            : t('chats.createGroupTitle')}
                                    </Text>
                                    <TouchableOpacity onPress={() => setShowCreateGroup(false)}>
                                        <Ionicons name="close" size={26} color={colors.text} />
                                    </TouchableOpacity>
                                </View>

                                {selectedFriends.size >= 2 ? (
                                    <>
                                        <Text style={styles.modalLabel}>{t('chats.groupName')}</Text>
                                        <TextInput
                                            style={styles.modalInput}
                                            placeholder={t('chats.groupNamePlaceholder')}
                                            placeholderTextColor={colors.textSubtle}
                                            keyboardAppearance={scheme === 'dark' ? 'dark' : 'light'}
                                            value={groupName}
                                            onChangeText={(text) =>
                                                setGroupName(text.slice(0, MAX_GROUP_NAME_LENGTH))
                                            }
                                            maxLength={MAX_GROUP_NAME_LENGTH}
                                            returnKeyType="done"
                                            onSubmitEditing={Keyboard.dismiss}
                                        />
                                        <Text style={styles.groupNameCount}>
                                            {groupName.length}/{MAX_GROUP_NAME_LENGTH}
                                        </Text>
                                    </>
                                ) : null}

                                <Text
                                    style={[
                                        styles.modalLabel,
                                        { marginTop: selectedFriends.size >= 2 ? 16 : 0 },
                                    ]}
                                >
                                    {t('chats.inviteFriends')}
                                </Text>
                                {loadingFriends ? (
                                    <ActivityIndicator color={colors.brand} style={{ marginVertical: 20 }} />
                                ) : friends.length === 0 ? (
                                    <Text style={styles.noFriendsHint}>{t('friends.noFriends')}</Text>
                                ) : (
                                    <ScrollView
                                        style={styles.friendsScroll}
                                        nestedScrollEnabled
                                        keyboardShouldPersistTaps="handled"
                                        keyboardDismissMode="on-drag"
                                    >
                                        {friends.map((f) => {
                                            const selected = selectedFriends.has(f.id);
                                            return (
                                                <TouchableOpacity
                                                    key={f.id}
                                                    style={[styles.friendPickRow, selected && styles.friendPickSelected]}
                                                    onPress={() => toggleFriend(f.id)}
                                                >
                                                    <ProfileAvatar
                                                        uri={f.avatar_url}
                                                        name={f.nombre}
                                                        size={40}
                                                        recyclingKey={f.id}
                                                    />
                                                    <Text style={styles.friendPickName}>{f.nombre}</Text>
                                                    <Ionicons
                                                        name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                                                        size={24}
                                                        color={selected ? colors.primary : colors.borderStrong}
                                                    />
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </ScrollView>
                                )}

                                <TouchableOpacity
                                    style={[styles.createGroupConfirm, creatingGroup && { opacity: 0.7 }]}
                                    onPress={handleCreateGroup}
                                    disabled={creatingGroup}
                                >
                                    {creatingGroup ? (
                                        <ActivityIndicator color={colors.onPrimary} />
                                    ) : (
                                        <Text style={styles.createGroupConfirmText}>
                                            {selectedFriends.size <= 1
                                                ? t('chats.openDirectChat')
                                                : t('chats.createGroupConfirm')}
                                        </Text>
                                    )}
                                </TouchableOpacity>
                            </Pressable>
                        </Pressable>
                    </KeyboardAvoidingView>
                </Modal>
            </View>
    );
}

function createChatsStyles(c: ThemeColors) {
    const INK = c.text;
    const PRIMARY = c.brand;
    const PRIMARY_DARK = c.primary;
    return StyleSheet.create({
    container: { flex: 1, backgroundColor: 'transparent' },
    pageHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingLeft: 20,
        marginBottom: 8,
    },
    pageTitle: { fontSize: 24, fontWeight: '900', color: INK },
    addBtn: {
        width: 44,
        height: 44,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: c.surface,
        borderRadius: 14,
        elevation: 3,
        shadowColor: PRIMARY_DARK,
        shadowOpacity: 0.12,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
    },
    loading: { flex: 1, justifyContent: 'center' },
    listContent: { paddingHorizontal: 0, paddingTop: 8, paddingBottom: 130 },
    swipeRow: { marginBottom: 0 },
    chatCard: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: 'transparent',
        paddingLeft: 16,
        paddingRight: 12,
        paddingTop: 20,
        paddingBottom: 0,
    },
    deleteAction: {
        width: 88,
        backgroundColor: c.danger,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 4,
    },
    deleteActionText: { color: c.onPrimary, fontWeight: '800', fontSize: 12 },
    chatImage: { width: 64, height: 64, borderRadius: 32, backgroundColor: c.border },
    groupIconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: c.border, justifyContent: 'center', alignItems: 'center' },
    chatInfo: { flex: 1, marginLeft: 14, minWidth: 0, paddingTop: 0 },
    chatMain: { flexDirection: 'row', alignItems: 'flex-start', paddingBottom: 0, paddingRight: 4 },
    chatCopy: { flex: 1, minWidth: 0, marginRight: 8, paddingTop: 1 },
    chatTitle: { fontSize: 18, fontWeight: '800', color: INK, marginBottom: 4, lineHeight: 22 },
    lastMsg: { fontSize: 14, color: c.textSubtle, lineHeight: 18 },
    chatSep: {
        height: 1.25,
        backgroundColor: c.borderStrong,
        marginRight: 10,
        marginTop: 30,
    },
    unreadBadge: {
        minWidth: 26,
        height: 26,
        borderRadius: 13,
        backgroundColor: PRIMARY_DARK,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 7,
        marginTop: 19,
    },
    unreadText: { color: c.onPrimary, fontSize: 12, fontWeight: '800' },
    emptyContainer: {
        alignItems: 'center',
        marginTop: 60,
        paddingHorizontal: 40,
    },
    emptyIconBg: { width: 120, height: 120, borderRadius: 60, backgroundColor: c.surface, justifyContent: 'center', alignItems: 'center', marginBottom: 20, elevation: 4, shadowColor: PRIMARY_DARK, shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border },
    emptyTitle: { fontSize: 20, fontWeight: '800', color: INK, marginBottom: 10 },
    emptySubtitle: { fontSize: 15, color: c.textMuted, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
    exploreBtn: { backgroundColor: PRIMARY_DARK, paddingHorizontal: 30, paddingVertical: 15, borderRadius: 18, marginBottom: 12 },
    exploreBtnText: { color: c.onPrimary, fontWeight: '700', fontSize: 16 },
    createGroupBtnEmpty: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: PRIMARY, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 18 },
    createGroupBtnText: { color: c.onPrimary, fontWeight: '800', fontSize: 15 },
    modalOverlay: { flex: 1, backgroundColor: c.overlay, justifyContent: 'flex-end' },
    modalSheet: { backgroundColor: c.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, maxHeight: '85%' },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    modalTitle: { fontSize: 20, fontWeight: '900', color: INK },
    modalLabel: { fontSize: 13, fontWeight: '800', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 8 },
    modalInput: { backgroundColor: c.surfaceSubtle, borderRadius: 14, padding: 14, fontSize: 16, color: INK, borderWidth: 1, borderColor: c.border },
    groupNameCount: { alignSelf: 'flex-end', marginTop: 6, fontSize: 12, fontWeight: '600', color: c.textSubtle },
    friendsScroll: { maxHeight: 220, marginBottom: 16 },
    friendPickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 14, marginBottom: 6 },
    friendPickSelected: { backgroundColor: c.primarySoft },
    friendPickAvatar: { width: 44, height: 44, borderRadius: 22, marginRight: 12, backgroundColor: c.border },
    friendPickName: { flex: 1, fontSize: 16, fontWeight: '700', color: INK },
    noFriendsHint: { color: c.textSubtle, textAlign: 'center', marginVertical: 16, fontWeight: '600' },
    createGroupConfirm: { backgroundColor: PRIMARY_DARK, paddingVertical: 16, borderRadius: 16, alignItems: 'center' },
    createGroupConfirmText: { color: c.onPrimary, fontWeight: '800', fontSize: 16 },
    });
}

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
import { theme } from '../../theme';
import { PlanImage } from '../../components/PlanImage';
import { ProfileAvatar } from '../../components/ProfileAvatar';
import { ChatSkeletonList } from '../../components/SkeletonShimmer';
import { useListScrollRestore } from '../../hooks/useListScrollRestore';
import { getDirectConversations, hideDirectChat, ensureDirectConversation } from '../../lib/directChat';
import { getChatSummaries } from '../../lib/chatSummaries';
import { deletePlanCompletely } from '../../lib/deletePlan';
import { isGroupChatPlan } from '../../lib/feedPlans';
import { getFriends, type FriendProfile } from '../../lib/friends';
import { useT } from '../../lib/i18n';
import { FLASH_LIST_DRAW_DISTANCE } from '../../lib/listConfig';
import { ScreenKeys } from '../../lib/screenState';
import { resolvePlanImageSource } from '../../lib/sports';
import { getAuthUser } from '../../lib/auth';
import { markDirectChatRead, markPlanChatRead, subscribeChatUnread } from '../../lib/chatUnread';
import { hapticSelection } from '../../lib/haptics';
import { isPlanChatAlive, runPlanLifecycleMaintenance } from '../../lib/planLifecycle';
import { filterHiddenPlanChats, hidePlanChat } from '../../lib/planChatHide';
import { diskSet } from '../../lib/diskCache';
import { invalidatePlanMembershipCaches, screenCacheKey, ScreenCacheTTL } from '../../lib/screenCaches';
import { cacheGetStale, cacheIsFresh, cacheInvalidate, cacheSet } from '../../lib/ttlCache';
import { supabase } from '../../lib/supabase';

const PRIMARY = theme.colors.brand;
const PRIMARY_DARK = theme.colors.primary;
const INK = theme.colors.text;

type ChatRow = {
    id: string;
    title: string;
    image_url: string | null;
    kind: 'plan' | 'group' | 'direct';
    peerId?: string;
    creadorId?: string;
    fechaEvento?: string | null;
    ultimoTexto: string;
    lastAt: string;
    unread: number;
};

export default function MyChatsScreen() {
    const router = useRouter();
    const { t } = useT();
    const insets = useSafeAreaInsets();
    const [chats, setChats] = useState<ChatRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [showCreateGroup, setShowCreateGroup] = useState(false);
    const [groupName, setGroupName] = useState('');
    const [friends, setFriends] = useState<(FriendProfile & { friendshipId: string })[]>([]);
    const [selectedFriends, setSelectedFriends] = useState<Set<string>>(new Set());
    const [loadingFriends, setLoadingFriends] = useState(false);
    const [creatingGroup, setCreatingGroup] = useState(false);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const hasDataRef = useRef(false);
    const didSessionLoadRef = useRef(false);
    const fetchInFlightRef = useRef(false);
    const openSwipeRef = useRef<Swipeable | null>(null);
    const silentRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fetchMyChatsRef = useRef<(opts?: { silent?: boolean; force?: boolean }) => Promise<void>>(async () => {});
    const { listRef, onScroll, scrollEventThrottle } = useListScrollRestore<ChatRow>(ScreenKeys.CHATS);

    const scheduleSilentRefresh = useCallback(() => {
        if (silentRefreshTimer.current) clearTimeout(silentRefreshTimer.current);
        silentRefreshTimer.current = setTimeout(() => {
            void fetchMyChatsRef.current({ silent: true });
        }, 450);
    }, []);

    useEffect(() => {
        void getAuthUser().then((user) => {
            setCurrentUserId(user?.id ?? null);
            if (!user) return;
            const cached = cacheGetStale<ChatRow[]>(screenCacheKey.chatsList(user.id));
            if (Array.isArray(cached)) {
                setChats(cached);
                hasDataRef.current = true;
                setLoading(false);
            }
        });
    }, []);

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

    const formatPreview = (msg: { tipo: string; contenido: string; emisor_id: string }, names: Record<string, string>) => {
        const nombre = names[msg.emisor_id] || t('chats.user');
        if (msg.tipo === 'imagen') return `${nombre}: ${t('chats.previewImage')}`;
        if (msg.tipo === 'video') return `${nombre}: ${t('chats.previewVideo')}`;
        if (msg.tipo === 'audio') {
            const sec = parseInt(msg.contenido, 10);
            const dur = Number.isFinite(sec) && sec > 0
                ? `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, '0')}`
                : null;
            return dur ? `${nombre}: ${t('chats.previewVoice')} ${dur}` : `${nombre}: ${t('chats.previewVoice')}`;
        }
        return `${nombre}: ${msg.contenido}`;
    };

    const fetchMyChats = async (opts?: { silent?: boolean; force?: boolean }) => {
        if (fetchInFlightRef.current && opts?.silent) return;
        try {
            fetchInFlightRef.current = true;
            if (!opts?.silent && !refreshing && !hasDataRef.current) setLoading(true);
            const user = await getAuthUser();
            if (!user) return;
            setCurrentUserId(user.id);

            const cacheKey = screenCacheKey.chatsList(user.id);
            const cached = cacheGetStale<ChatRow[]>(cacheKey);
            if (Array.isArray(cached) && !hasDataRef.current) {
                setChats(cached);
                hasDataRef.current = true;
                setLoading(false);
            }

            if (!opts?.force && !opts?.silent && cacheIsFresh(cacheKey) && hasDataRef.current) {
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
            if (!didSessionLoadRef.current) {
                didSessionLoadRef.current = true;
                void fetchMyChatsRef.current();
                return;
            }
            // Al volver: refrescar si la caché se invalidó (p. ej. chat 1:1 recién abierto).
            void getAuthUser().then((user) => {
                if (!user) return;
                if (cacheIsFresh(screenCacheKey.chatsList(user.id))) return;
                void fetchMyChatsRef.current({ silent: true, force: true });
            });
        }, []),
    );

    const confirmDeleteChat = (item: ChatRow) => {
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
                            } else {
                                await hidePlanChat(currentUserId, item.id);
                            }
                            invalidatePlanMembershipCaches(currentUserId);
                            setChats((prev) => prev.filter((c) => c.id !== item.id));
                        })();
                    }, 0);
                },
            },
        ]);
    };

    const openCreateGroup = async () => {
        setShowCreateGroup(true);
        setGroupName('');
        setSelectedFriends(new Set());
        setLoadingFriends(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
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
                    title: friend?.nombre || t('chats.user'),
                    image_url: friend?.avatar_url ?? null,
                    kind: 'direct',
                    ultimoTexto: t('chats.noMessages'),
                    lastAt: now,
                    unread: 0,
                };
                setChats((prev) => [row, ...prev.filter((c) => c.id !== row.id)]);
                hasDataRef.current = true;
                router.push(`/direct-chat/${peerId}`);
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

        setCreatingGroup(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const newPlan = await insertGroupPlan(user.id, name);
            // Primero el creador; luego el resto (anfitrión puede insertar miembros).
            const { error: meError } = await supabase.from('participantes').insert({
                plan_id: newPlan.id,
                usuario_id: user.id,
                estado: 'aceptado',
            });
            if (meError) throw meError;

            const friendIds = [...selectedFriends];
            if (friendIds.length > 0) {
                const { error: partsError } = await supabase.from('participantes').insert(
                    friendIds.map((usuario_id) => ({
                        plan_id: newPlan.id,
                        usuario_id,
                        estado: 'aceptado',
                    })),
                );
                if (partsError) throw partsError;
            }

            setShowCreateGroup(false);
            setGroupName('');
            setSelectedFriends(new Set());
            invalidatePlanMembershipCaches(user.id);
            router.push(`/chat/${newPlan.id}`);
            void fetchMyChats({ force: true });
        } catch (e: any) {
            if (__DEV__) console.error(e);
            Alert.alert(t('profile.error'), e?.message || t('friends.chatError'));
        } finally {
            setCreatingGroup(false);
        }
    };

    const onRefresh = () => {
        setRefreshing(true);
        void fetchMyChats({ force: true });
    };

    const renderEmpty = () => (
        <View style={styles.emptyContainer}>
            <View style={styles.emptyIconBg}>
                <Ionicons name={loadError ? 'cloud-offline-outline' : 'chatbubbles-outline'} size={60} color={PRIMARY} />
            </View>
            <Text style={styles.emptyTitle}>{loadError ? t('chats.loadError') : t('chats.empty')}</Text>
            {!loadError ? <Text style={styles.emptySubtitle}>{t('chats.emptySub')}</Text> : null}
            {loadError ? (
                <TouchableOpacity
                    style={styles.exploreBtn}
                    onPress={() => {
                        setLoadError(false);
                        void fetchMyChats({ force: true });
                    }}
                >
                    <Text style={styles.exploreBtnText}>{t('chats.retry')}</Text>
                </TouchableOpacity>
            ) : (
                <>
                    <TouchableOpacity
                        style={styles.exploreBtn}
                        onPress={() => router.navigate('/')}
                    >
                        <Text style={styles.exploreBtnText}>{t('chats.explore')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.createGroupBtnEmpty} onPress={openCreateGroup}>
                        <Ionicons name="people" size={18} color={theme.colors.surface} />
                        <Text style={styles.createGroupBtnText}>{t('chats.createGroup')}</Text>
                    </TouchableOpacity>
                </>
            )}
        </View>
    );

    return (
            <View style={styles.container}>
                <View style={styles.pageHeader}>
                    <Text style={styles.pageTitle}>{t('chats.title')}</Text>
                    <TouchableOpacity onPress={openCreateGroup} style={styles.addBtn}>
                        <Ionicons name="add" size={26} color={INK} />
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
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PRIMARY_DARK} />
                    }
                    renderItem={({ item }) => (
                        <View style={styles.swipeRow}>
                            <Swipeable
                                ref={(ref) => {
                                    if (ref) {
                                        (item as any)._swipeRef = ref;
                                    }
                                }}
                                overshootRight={false}
                                friction={2}
                                rightThreshold={40}
                                onSwipeableWillOpen={() => {
                                    const prev = openSwipeRef.current;
                                    const next = (item as any)._swipeRef as Swipeable | undefined;
                                    if (prev && prev !== next) prev.close();
                                    if (next) openSwipeRef.current = next;
                                }}
                                onSwipeableClose={() => {
                                    const current = (item as any)._swipeRef as Swipeable | undefined;
                                    if (openSwipeRef.current === current) openSwipeRef.current = null;
                                }}
                                renderRightActions={() => (
                                    <TouchableOpacity
                                        style={styles.deleteAction}
                                        activeOpacity={0.9}
                                        onPress={() => confirmDeleteChat(item)}
                                    >
                                        <Ionicons name="trash" size={22} color={theme.colors.surface} />
                                        <Text style={styles.deleteActionText}>{t('chat.deleteChat')}</Text>
                                    </TouchableOpacity>
                                )}
                            >
                                <TouchableOpacity
                                    style={styles.chatCard}
                                    activeOpacity={0.85}
                                    onLongPress={() => confirmDeleteChat(item)}
                                    onPress={() => {
                                        hapticSelection();
                                        openSwipeRef.current?.close();
                                        if (currentUserId && item.unread > 0) {
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
                                        }
                                        if (item.kind === 'direct' && item.peerId) {
                                            router.push(`/direct-chat/${item.peerId}`);
                                        } else {
                                            router.push(`/chat/${item.id}`);
                                        }
                                    }}
                                >
                                    {item.kind === 'direct' ? (
                                        <ProfileAvatar
                                            uri={item.image_url}
                                            name={item.title}
                                            size={52}
                                            recyclingKey={item.peerId ?? item.id}
                                        />
                                    ) : item.kind === 'group' && item.image_url ? (
                                        <PlanImage
                                            source={resolvePlanImageSource(item.image_url)}
                                            style={styles.chatImage}
                                            recyclingKey={`group-${item.id}`}
                                        />
                                    ) : item.kind === 'group' ? (
                                        <View style={styles.groupIconWrap}>
                                            <Ionicons name="people" size={28} color={PRIMARY_DARK} />
                                        </View>
                                    ) : (
                                        <PlanImage
                                            source={resolvePlanImageSource(item.image_url)}
                                            style={styles.chatImage}
                                            recyclingKey={String(item.id)}
                                        />
                                    )}
                                    <View style={styles.chatInfo}>
                                        <Text style={styles.chatTitle} numberOfLines={1}>{item.title}</Text>
                                        <Text style={styles.lastMsg} numberOfLines={1}>{item.ultimoTexto}</Text>
                                    </View>
                                    <View style={styles.chevronWrap}>
                                        {item.unread > 0 ? (
                                            <View style={styles.unreadBadge}>
                                                <Text style={styles.unreadText}>
                                                    {item.unread > 9 ? '9+' : item.unread}
                                                </Text>
                                            </View>
                                        ) : (
                                            <Ionicons name="chevron-forward" size={16} color={PRIMARY_DARK} />
                                        )}
                                    </View>
                                </TouchableOpacity>
                            </Swipeable>
                        </View>
                    )}
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
                                        <Ionicons name="close" size={26} color={INK} />
                                    </TouchableOpacity>
                                </View>

                                {selectedFriends.size >= 2 ? (
                                    <>
                                        <Text style={styles.modalLabel}>{t('chats.groupName')}</Text>
                                        <TextInput
                                            style={styles.modalInput}
                                            placeholder={t('chats.groupNamePlaceholder')}
                                            placeholderTextColor={theme.colors.textSubtle}
                                            value={groupName}
                                            onChangeText={setGroupName}
                                            returnKeyType="done"
                                            onSubmitEditing={Keyboard.dismiss}
                                        />
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
                                    <ActivityIndicator color={PRIMARY} style={{ marginVertical: 20 }} />
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
                                                        color={selected ? PRIMARY_DARK : '#CBD5E1'}
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
                                        <ActivityIndicator color={theme.colors.surface} />
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

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: 'transparent' },
    pageHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingBottom: 14,
    },
    pageTitle: { fontSize: 22, fontWeight: '900', color: INK },
    addBtn: { width: 45, height: 45, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: 15, elevation: 3, shadowColor: PRIMARY_DARK, shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
    loading: { flex: 1, justifyContent: 'center' },
    listContent: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 130 },
    swipeRow: { marginBottom: 12 },
    chatCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.surface,
        borderRadius: 20,
        padding: 12,
        elevation: 4,
        shadowColor: '#1E3A8A',
        shadowOpacity: 0.1,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
    },
    deleteAction: {
        width: 92,
        marginLeft: 10,
        borderRadius: 20,
        backgroundColor: theme.colors.danger,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 4,
    },
    deleteActionText: { color: theme.colors.surface, fontWeight: '800', fontSize: 12 },
    chatImage: { width: 58, height: 58, borderRadius: 20, backgroundColor: theme.colors.border },
    groupIconWrap: { width: 58, height: 58, borderRadius: 20, backgroundColor: theme.colors.border, justifyContent: 'center', alignItems: 'center' },
    chatInfo: { flex: 1, marginLeft: 14 },
    chatTitle: { fontSize: 16, fontWeight: '800', color: INK, marginBottom: 3 },
    lastMsg: { fontSize: 14, color: theme.colors.textSubtle },
    unreadBadge: {
        minWidth: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: theme.colors.danger,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 6,
    },
    unreadText: { color: theme.colors.surface, fontSize: 11, fontWeight: '800' },
    chevronWrap: { width: 30, height: 30, borderRadius: 15, backgroundColor: theme.colors.surfaceSubtle, justifyContent: 'center', alignItems: 'center' },
    emptyContainer: {
        alignItems: 'center',
        marginTop: 60,
        paddingHorizontal: 40,
    },
    emptyIconBg: { width: 120, height: 120, borderRadius: 60, backgroundColor: theme.colors.surface, justifyContent: 'center', alignItems: 'center', marginBottom: 20, elevation: 4, shadowColor: PRIMARY_DARK, shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
    emptyTitle: { fontSize: 20, fontWeight: '800', color: INK, marginBottom: 10 },
    emptySubtitle: { fontSize: 15, color: theme.colors.textMuted, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
    exploreBtn: { backgroundColor: PRIMARY_DARK, paddingHorizontal: 30, paddingVertical: 15, borderRadius: 18, marginBottom: 12 },
    exploreBtnText: { color: theme.colors.surface, fontWeight: '700', fontSize: 16 },
    createGroupBtnEmpty: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: PRIMARY, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 18 },
    createGroupBtnText: { color: theme.colors.surface, fontWeight: '800', fontSize: 15 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(15,42,74,0.45)', justifyContent: 'flex-end' },
    modalSheet: { backgroundColor: theme.colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, maxHeight: '85%' },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    modalTitle: { fontSize: 20, fontWeight: '900', color: INK },
    modalLabel: { fontSize: 13, fontWeight: '800', color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 8 },
    modalInput: { backgroundColor: theme.colors.surfaceSubtle, borderRadius: 14, padding: 14, fontSize: 16, color: INK, borderWidth: 1, borderColor: theme.colors.border },
    friendsScroll: { maxHeight: 220, marginBottom: 16 },
    friendPickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 14, marginBottom: 6 },
    friendPickSelected: { backgroundColor: theme.colors.primarySoft },
    friendPickAvatar: { width: 44, height: 44, borderRadius: 22, marginRight: 12, backgroundColor: theme.colors.border },
    friendPickName: { flex: 1, fontSize: 16, fontWeight: '700', color: INK },
    noFriendsHint: { color: theme.colors.textSubtle, textAlign: 'center', marginVertical: 16, fontWeight: '600' },
    createGroupConfirm: { backgroundColor: PRIMARY_DARK, paddingVertical: 16, borderRadius: 16, alignItems: 'center' },
    createGroupConfirmText: { color: theme.colors.surface, fontWeight: '800', fontSize: 16 },
});

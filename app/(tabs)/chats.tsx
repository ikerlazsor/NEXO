import {
    Ionicons } from '@expo/vector-icons';
import { useFocusEffect,
    useRouter } from 'expo-router';
import { useCallback,
    useEffect,
    useRef,
    useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Image,
    Keyboard,
    Modal,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Alert } from '../../lib/nexoAlert';
import { MainChrome } from '../../components/MainChrome';
import { PlanImage } from '../../components/PlanImage';
import { useListScrollRestore } from '../../hooks/useListScrollRestore';
import { getDirectConversations, hideDirectChat } from '../../lib/directChat';
import { deletePlanCompletely } from '../../lib/deletePlan';
import { isGroupChatPlan } from '../../lib/feedPlans';
import { getAvatarUri, getFriends, type FriendProfile } from '../../lib/friends';
import { sendPlanInvite } from '../../lib/planInvites';
import { useT } from '../../lib/i18n';
import { OPTIMIZED_LIST_PROPS } from '../../lib/listConfig';
import { ScreenKeys } from '../../lib/screenState';
import { resolvePlanImageSource } from '../../lib/sports';
import { getAuthUser } from '../../lib/auth';
import { getChatUnreadMap, markDirectChatRead, markPlanChatRead, subscribeChatUnread } from '../../lib/chatUnread';
import { isPlanChatAlive, runPlanLifecycleMaintenance } from '../../lib/planLifecycle';
import { screenCacheKey, ScreenCacheTTL } from '../../lib/screenCaches';
import { cacheGetStale, cacheSet } from '../../lib/ttlCache';
import { supabase } from '../../lib/supabase';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';

type ChatRow = {
    id: string;
    title: string;
    image_url: string | null;
    kind: 'plan' | 'group' | 'direct';
    peerId?: string;
    creadorId?: string;
    ultimoTexto: string;
    lastAt: string;
    unread: number;
};

export default function MyChatsScreen() {
    const router = useRouter();
    const { t } = useT();
    const [chats, setChats] = useState<ChatRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [showCreateGroup, setShowCreateGroup] = useState(false);
    const [groupName, setGroupName] = useState('');
    const [friends, setFriends] = useState<(FriendProfile & { friendshipId: string })[]>([]);
    const [selectedFriends, setSelectedFriends] = useState<Set<string>>(new Set());
    const [loadingFriends, setLoadingFriends] = useState(false);
    const [creatingGroup, setCreatingGroup] = useState(false);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const hasDataRef = useRef(false);
    const fetchInFlightRef = useRef(false);
    const openSwipeRef = useRef<Swipeable | null>(null);
    const { listRef, onScroll, scrollEventThrottle } = useListScrollRestore<ChatRow>(ScreenKeys.CHATS);

    useFocusEffect(
        useCallback(() => {
            void fetchMyChats();
        }, [])
    );

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
            void fetchMyChats({ silent: true });
        });
        return unsub;
    }, []);

    useEffect(() => {
        const channel = supabase
            .channel(`chats-unread-${Math.random().toString(36).slice(2, 9)}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensajes' }, () => {
                void fetchMyChats({ silent: true });
            })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, []);

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

    const fetchMyChats = async (opts?: { silent?: boolean }) => {
        if (fetchInFlightRef.current && opts?.silent) return;
        try {
            fetchInFlightRef.current = true;
            if (!opts?.silent && !refreshing && !hasDataRef.current) setLoading(true);
            const user = await getAuthUser();
            if (!user) return;
            setCurrentUserId(user.id);

            const cached = cacheGetStale<ChatRow[]>(screenCacheKey.chatsList(user.id));
            if (Array.isArray(cached) && !hasDataRef.current) {
                setChats(cached);
                hasDataRef.current = true;
                setLoading(false);
            }

            void runPlanLifecycleMaintenance();

            const [{ data: myParts }, directConversations, unreadMap] = await Promise.all([
                supabase.from('participantes').select('plan_id').eq('usuario_id', user.id).eq('estado', 'aceptado'),
                getDirectConversations(user.id).catch(() => []),
                getChatUnreadMap(user.id),
            ]);

            const planIds = [...new Set((myParts ?? []).map((p) => p.plan_id))].filter(Boolean);

            let planRows: ChatRow[] = [];
            if (planIds.length > 0) {
                const { data: plans, error: plansError } = await supabase
                    .from('planes')
                    .select('id, titulo, imagen_url, categoria, creador_id, creado_en, fecha_evento, chat_eliminado_en')
                    .in('id', planIds);

                if (plansError) throw plansError;

                const alivePlans = (plans ?? []).filter((p) => isPlanChatAlive(p));
                const ids = alivePlans.map((p) => p.id);
                const msgLimit = Math.min(Math.max(ids.length * 4, 40), 300);

                let lastMsgs: any[] = [];
                if (ids.length > 0) {
                    const { data } = await supabase
                        .from('mensajes')
                        .select('plan_id, contenido, tipo, creado_en, emisor_id')
                        .in('plan_id', ids)
                        .order('creado_en', { ascending: false })
                        .limit(msgLimit);
                    lastMsgs = data ?? [];
                }

                const lastByPlan = new Map<string, any>();
                lastMsgs.forEach((m) => {
                    if (!lastByPlan.has(m.plan_id)) lastByPlan.set(m.plan_id, m);
                });

                const nameIds = new Set<string>(lastMsgs.map((m) => m.emisor_id));
                const names: Record<string, string> = {};
                if (nameIds.size > 0) {
                    const { data: profiles } = await supabase
                        .from('perfiles')
                        .select('id, nombre')
                        .in('id', Array.from(nameIds));
                    (profiles ?? []).forEach((pr) => { names[pr.id] = pr.nombre; });
                }

                planRows = alivePlans.map((p) => {
                    const ult = lastByPlan.get(p.id);
                    return {
                        id: p.id,
                        title: p.titulo,
                        image_url: p.imagen_url,
                        kind: isGroupChatPlan(p) ? 'group' as const : 'plan' as const,
                        creadorId: p.creador_id ? String(p.creador_id) : undefined,
                        ultimoTexto: ult ? formatPreview(ult, names) : t('chats.noMessages'),
                        lastAt: ult?.creado_en ?? p.creado_en ?? '',
                        unread: unreadMap.plans[p.id] ?? 0,
                    };
                });
            }

            const directRows: ChatRow[] = directConversations.map((c) => ({
                id: `direct-${c.peerId}`,
                peerId: c.peerId,
                title: c.nombre,
                image_url: c.avatarUri,
                kind: 'direct' as const,
                ultimoTexto: c.lastMessage
                    ? formatPreview(
                          { tipo: c.lastMessage.tipo, contenido: c.lastMessage.contenido, emisor_id: c.lastMessage.emisor_id },
                          { [c.peerId]: c.nombre, [user.id]: t('chats.you') }
                      )
                    : t('chats.noMessages'),
                lastAt: c.lastMessage?.creado_en ?? '',
                unread: unreadMap.directs[c.peerId] ?? 0,
            }));

            const rows = [...planRows, ...directRows].sort(
                (a, b) => new Date(b.lastAt || 0).getTime() - new Date(a.lastAt || 0).getTime()
            );

            setChats(rows);
            hasDataRef.current = true;
            cacheSet(screenCacheKey.chatsList(user.id), rows, ScreenCacheTTL.chatsList);
        } catch (error) {
            console.error('Error cargando mis chats:', error);
        } finally {
            fetchInFlightRef.current = false;
            setLoading(false);
            setRefreshing(false);
        }
    };

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
        Alert.alert(
            isHost ? t('chat.deletePlanHost') : t('chat.deleteChat'),
            isHost ? t('chat.deletePlanHostConfirm') : t('chat.deleteChatConfirm'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: isHost ? t('chat.deletePlanHost') : t('chat.deleteChat'),
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
                                } else {
                                    const { error } = await supabase
                                        .from('participantes')
                                        .delete()
                                        .eq('plan_id', item.id)
                                        .eq('usuario_id', currentUserId);
                                    if (error) {
                                        Alert.alert(t('profile.error'), error.message);
                                        return;
                                    }
                                }
                                setChats((prev) => prev.filter((c) => c.id !== item.id));
                            })();
                        }, 0);
                    },
                },
            ],
        );
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

        const { data, error } = await supabase
            .from('planes')
            .insert({
                titulo: name,
                categoria: 'Grupo',
                creador_id: userId,
                maximo_participantes: 50,
                fecha_evento: farFuture.toISOString(),
                requiere_aprobacion: false,
            })
            .select()
            .single();

        if (error) throw error;
        return data;
    };

    const handleCreateGroup = async () => {
        const name = groupName.trim();
        if (!name) {
            Alert.alert(t('login.notice'), t('chats.groupName'));
            return;
        }
        if (selectedFriends.size === 0) {
            Alert.alert(t('login.notice'), t('chats.selectOneFriend'));
            return;
        }

        setCreatingGroup(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const newPlan = await insertGroupPlan(user.id, name);

            const { error: meError } = await supabase
                .from('participantes')
                .insert({ plan_id: newPlan.id, usuario_id: user.id, estado: 'aceptado' });
            if (meError) throw meError;

            let invited = 0;
            let failed = 0;
            for (const friendId of selectedFriends) {
                const { error: invErr } = await sendPlanInvite(newPlan.id, user.id, friendId, 'grupo');
                if (!invErr) invited++;
                else failed++;
            }

            setShowCreateGroup(false);
            router.push(`/chat/${newPlan.id}`);
            fetchMyChats();

            if (invited > 0) {
                Alert.alert(t('login.notice'), t('friends.inviteSent'));
            }
            if (failed > 0) {
                Alert.alert(
                    t('profile.error'),
                    invited === 0 ? t('friends.invitesSqlHint') : t('chats.invitePartialFail', { ok: invited, fail: failed })
                );
            }
        } catch (e: any) {
            console.error(e);
            const msg = e?.message ?? '';
            Alert.alert(
                t('profile.error'),
                msg.includes('plan_invitaciones')
                    ? t('friends.invitesSqlHint')
                    : msg || t('friends.chatError')
            );
        } finally {
            setCreatingGroup(false);
        }
    };

    const onRefresh = () => {
        setRefreshing(true);
        fetchMyChats();
    };

    const renderEmpty = () => (
        <View style={styles.emptyContainer}>
            <View style={styles.emptyIconBg}>
                <Ionicons name="chatbubbles-outline" size={60} color={PRIMARY} />
            </View>
            <Text style={styles.emptyTitle}>{t('chats.empty')}</Text>
            <Text style={styles.emptySubtitle}>{t('chats.emptySub')}</Text>
            <TouchableOpacity style={styles.exploreBtn} onPress={() => router.replace('/(tabs)')}>
                <Text style={styles.exploreBtnText}>{t('chats.explore')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.createGroupBtnEmpty} onPress={openCreateGroup}>
                <Ionicons name="people" size={18} color="#FFF" />
                <Text style={styles.createGroupBtnText}>{t('chats.createGroup')}</Text>
            </TouchableOpacity>
        </View>
    );

    return (
        <MainChrome active="chats">
            <View style={styles.container}>
                <View style={styles.pageHeader}>
                    <Text style={styles.pageTitle}>{t('chats.title')}</Text>
                    <TouchableOpacity onPress={openCreateGroup} style={styles.addBtn}>
                        <Ionicons name="add" size={26} color={INK} />
                    </TouchableOpacity>
                </View>

                {loading && !refreshing && chats.length === 0 ? (
                    <View style={styles.loading}>
                        <ActivityIndicator size="large" color={PRIMARY_DARK} />
                    </View>
                ) : null}
                <FlatList
                    ref={listRef}
                    data={chats}
                    keyExtractor={(item) => item.id.toString()}
                    ListEmptyComponent={!loading ? renderEmpty : null}
                    contentContainerStyle={styles.listContent}
                    onScroll={onScroll}
                    scrollEventThrottle={scrollEventThrottle}
                    {...OPTIMIZED_LIST_PROPS}
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
                                        <Ionicons name="trash" size={22} color="#FFF" />
                                        <Text style={styles.deleteActionText}>{t('chat.deleteChat')}</Text>
                                    </TouchableOpacity>
                                )}
                            >
                                <TouchableOpacity
                                    style={styles.chatCard}
                                    activeOpacity={0.85}
                                    onLongPress={() => confirmDeleteChat(item)}
                                    onPress={() => {
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
                                        <Image
                                            source={{
                                                uri:
                                                    item.image_url ||
                                                    getAvatarUri({ nombre: item.title, avatar_url: null }),
                                            }}
                                            style={styles.chatImage}
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

                <Modal visible={showCreateGroup} animationType="slide" transparent>
                    <Pressable style={styles.modalOverlay} onPress={Keyboard.dismiss}>
                        <Pressable style={styles.modalSheet} onPress={() => {}}>
                            <View style={styles.modalHeader}>
                                <Text style={styles.modalTitle}>{t('chats.createGroup')}</Text>
                                <TouchableOpacity onPress={() => setShowCreateGroup(false)}>
                                    <Ionicons name="close" size={26} color={INK} />
                                </TouchableOpacity>
                            </View>

                            <Text style={styles.modalLabel}>{t('chats.groupName')}</Text>
                            <TextInput
                                style={styles.modalInput}
                                placeholder={t('chats.groupNamePlaceholder')}
                                placeholderTextColor="#94A3B8"
                                value={groupName}
                                onChangeText={setGroupName}
                                returnKeyType="done"
                                onSubmitEditing={Keyboard.dismiss}
                            />

                            <Text style={[styles.modalLabel, { marginTop: 16 }]}>{t('chats.inviteFriends')}</Text>
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
                                                <Image source={{ uri: getAvatarUri(f) }} style={styles.friendPickAvatar} />
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
                                    <ActivityIndicator color="#FFF" />
                                ) : (
                                    <Text style={styles.createGroupConfirmText}>{t('chats.createGroup')}</Text>
                                )}
                            </TouchableOpacity>
                        </Pressable>
                    </Pressable>
                </Modal>
            </View>
        </MainChrome>
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
    addBtn: { width: 45, height: 45, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 15, elevation: 3, shadowColor: PRIMARY_DARK, shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
    loading: { flex: 1, justifyContent: 'center' },
    listContent: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 130 },
    swipeRow: { marginBottom: 12 },
    chatCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF',
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
        backgroundColor: '#EF4444',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 4,
    },
    deleteActionText: { color: '#FFF', fontWeight: '800', fontSize: 12 },
    chatImage: { width: 58, height: 58, borderRadius: 20, backgroundColor: '#E3ECFB' },
    groupIconWrap: { width: 58, height: 58, borderRadius: 20, backgroundColor: '#E3ECFB', justifyContent: 'center', alignItems: 'center' },
    chatInfo: { flex: 1, marginLeft: 14 },
    chatTitle: { fontSize: 16, fontWeight: '800', color: INK, marginBottom: 3 },
    lastMsg: { fontSize: 14, color: '#94A3B8' },
    unreadBadge: {
        minWidth: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: '#EF4444',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 6,
    },
    unreadText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
    chevronWrap: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#EEF3FB', justifyContent: 'center', alignItems: 'center' },
    emptyContainer: {
        alignItems: 'center',
        marginTop: 60,
        paddingHorizontal: 40,
    },
    emptyIconBg: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', marginBottom: 20, elevation: 4, shadowColor: PRIMARY_DARK, shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
    emptyTitle: { fontSize: 20, fontWeight: '800', color: INK, marginBottom: 10 },
    emptySubtitle: { fontSize: 15, color: '#64748B', textAlign: 'center', lineHeight: 22, marginBottom: 24 },
    exploreBtn: { backgroundColor: PRIMARY_DARK, paddingHorizontal: 30, paddingVertical: 15, borderRadius: 18, marginBottom: 12 },
    exploreBtnText: { color: '#FFF', fontWeight: '700', fontSize: 16 },
    createGroupBtnEmpty: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: PRIMARY, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 18 },
    createGroupBtnText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(15,42,74,0.45)', justifyContent: 'flex-end' },
    modalSheet: { backgroundColor: '#FFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, maxHeight: '85%' },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    modalTitle: { fontSize: 20, fontWeight: '900', color: INK },
    modalLabel: { fontSize: 13, fontWeight: '800', color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 8 },
    modalInput: { backgroundColor: '#F1F5F9', borderRadius: 14, padding: 14, fontSize: 16, color: INK, borderWidth: 1, borderColor: '#E2E8F0' },
    friendsScroll: { maxHeight: 220, marginBottom: 16 },
    friendPickRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 8, borderRadius: 14, marginBottom: 6 },
    friendPickSelected: { backgroundColor: '#EFF6FF' },
    friendPickAvatar: { width: 44, height: 44, borderRadius: 22, marginRight: 12, backgroundColor: '#E3ECFB' },
    friendPickName: { flex: 1, fontSize: 16, fontWeight: '700', color: INK },
    noFriendsHint: { color: '#94A3B8', textAlign: 'center', marginVertical: 16, fontWeight: '600' },
    createGroupConfirm: { backgroundColor: PRIMARY_DARK, paddingVertical: 16, borderRadius: 16, alignItems: 'center' },
    createGroupConfirmText: { color: '#FFF', fontWeight: '800', fontSize: 16 },
});

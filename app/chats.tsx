import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    Keyboard,
    Modal,
    Platform,
    Pressable,
    RefreshControl,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { PlanImage } from '../components/PlanImage';
import { getDirectConversations } from '../lib/directChat';
import { isGroupChatPlan } from '../lib/feedPlans';
import { getAvatarUri, getFriends, type FriendProfile } from '../lib/friends';
import { sendPlanInvite } from '../lib/planInvites';
import { useT } from '../lib/i18n';
import { supabase } from '../lib/supabase';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const BG_TOP = '#DCEBFF';
const BG_BOTTOM = '#F2F7FF';

type ChatRow = {
    id: string;
    title: string;
    image_url: string | null;
    kind: 'plan' | 'group' | 'direct';
    /** Para chats directos: id del otro usuario (ruta /direct-chat/[peerId]). */
    peerId?: string;
    ultimoTexto: string;
    lastAt: string;
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

    useFocusEffect(
        useCallback(() => {
            fetchMyChats();
        }, [])
    );

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

    const fetchMyChats = async () => {
        try {
            if (!refreshing && chats.length === 0) setLoading(true);
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const [{ data: myParts }, directConversations] = await Promise.all([
                supabase.from('participantes').select('plan_id').eq('usuario_id', user.id).eq('estado', 'aceptado'),
                getDirectConversations(user.id).catch(() => []),
            ]);

            const planIds = [...new Set((myParts ?? []).map((p) => p.plan_id))].filter(Boolean);

            let planRows: ChatRow[] = [];
            if (planIds.length > 0) {
                const { data: plans, error: plansError } = await supabase
                    .from('planes')
                    .select('id, titulo, imagen_url, categoria, creador_id, creado_en')
                    .in('id', planIds);

                if (plansError) throw plansError;

                const ids = (plans ?? []).map((p) => p.id);
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

                planRows = (plans ?? []).map((p) => {
                    const ult = lastByPlan.get(p.id);
                    return {
                        id: p.id,
                        title: p.titulo,
                        image_url: p.imagen_url,
                        kind: isGroupChatPlan(p) ? 'group' as const : 'plan' as const,
                        ultimoTexto: ult ? formatPreview(ult, names) : t('chats.noMessages'),
                        lastAt: ult?.creado_en ?? p.creado_en ?? '',
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
            }));

            const rows = [...planRows, ...directRows].sort(
                (a, b) => new Date(b.lastAt || 0).getTime() - new Date(a.lastAt || 0).getTime()
            );

            setChats(rows);
        } catch (error) {
            console.error('Error cargando mis chats:', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
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
        // Los grupos de chat viven en planes con categoria 'Grupo'; fecha_evento y
        // maximo_participantes son NOT NULL en el esquema, así que damos valores neutros.
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
            <TouchableOpacity style={styles.exploreBtn} onPress={() => router.push('/')}>
                <Text style={styles.exploreBtnText}>{t('chats.explore')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.createGroupBtnEmpty} onPress={openCreateGroup}>
                <Ionicons name="people" size={18} color="#FFF" />
                <Text style={styles.createGroupBtnText}>{t('chats.createGroup')}</Text>
            </TouchableOpacity>
        </View>
    );

    return (
        <SafeAreaView style={styles.container}>
            <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={StyleSheet.absoluteFill} />
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={24} color={INK} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{t('chats.title')}</Text>
                <TouchableOpacity onPress={openCreateGroup} style={styles.addBtn}>
                    <Ionicons name="add" size={26} color={INK} />
                </TouchableOpacity>
            </View>

            {loading && !refreshing ? (
                <View style={styles.loading}>
                    <ActivityIndicator size="large" color={PRIMARY_DARK} />
                </View>
            ) : (
                <FlatList
                    data={chats}
                    keyExtractor={(item) => item.id.toString()}
                    ListEmptyComponent={renderEmpty}
                    contentContainerStyle={chats.length === 0 ? { flex: 1 } : styles.listContent}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PRIMARY_DARK} />
                    }
                    renderItem={({ item }) => (
                        <TouchableOpacity
                            style={styles.chatCard}
                            activeOpacity={0.85}
                            onPress={() =>
                                item.kind === 'direct' && item.peerId
                                    ? router.push(`/direct-chat/${item.peerId}`)
                                    : router.push(`/chat/${item.id}`)
                            }
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
                                    source={item.image_url}
                                    style={styles.chatImage}
                                    recyclingKey={`group-${item.id}`}
                                />
                            ) : item.kind === 'group' ? (
                                <View style={styles.groupIconWrap}>
                                    <Ionicons name="people" size={28} color={PRIMARY_DARK} />
                                </View>
                            ) : (
                                <PlanImage
                                    source={item.image_url}
                                    style={styles.chatImage}
                                    recyclingKey={String(item.id)}
                                />
                            )}
                            <View style={styles.chatInfo}>
                                <Text style={styles.chatTitle} numberOfLines={1}>{item.title}</Text>
                                <Text style={styles.lastMsg} numberOfLines={1}>{item.ultimoTexto}</Text>
                            </View>
                            <View style={styles.chevronWrap}>
                                <Ionicons name="chevron-forward" size={16} color={PRIMARY_DARK} />
                            </View>
                        </TouchableOpacity>
                    )}
                />
            )}

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
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG_BOTTOM },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingTop: Platform.OS === 'ios' ? 8 : 14,
        paddingBottom: 14,
    },
    backBtn: { width: 45, height: 45, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 15, elevation: 3, shadowColor: PRIMARY_DARK, shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
    addBtn: { width: 45, height: 45, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 15, elevation: 3, shadowColor: PRIMARY_DARK, shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
    headerTitle: { fontSize: 22, fontWeight: '900', color: INK },
    loading: { flex: 1, justifyContent: 'center' },
    listContent: { paddingHorizontal: 16, paddingTop: 4 },
    chatCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF',
        borderRadius: 20,
        padding: 12,
        marginBottom: 12,
        elevation: 4,
        shadowColor: '#1E3A8A',
        shadowOpacity: 0.1,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
    },
    chatImage: { width: 58, height: 58, borderRadius: 20, backgroundColor: '#E3ECFB' },
    groupIconWrap: { width: 58, height: 58, borderRadius: 20, backgroundColor: '#E3ECFB', justifyContent: 'center', alignItems: 'center' },
    chatInfo: { flex: 1, marginLeft: 14 },
    chatTitle: { fontSize: 16, fontWeight: '800', color: INK, marginBottom: 3 },
    lastMsg: { fontSize: 14, color: '#94A3B8' },
    chevronWrap: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#EEF3FB', justifyContent: 'center', alignItems: 'center' },
    emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
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

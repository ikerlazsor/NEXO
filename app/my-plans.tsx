import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { PlanImage } from '../components/PlanImage';
import { useListScrollRestore } from '../hooks/useListScrollRestore';
import { isFeedPlan } from '../lib/feedPlans';
import { useT } from '../lib/i18n';
import { OPTIMIZED_LIST_PROPS } from '../lib/listConfig';
import { ScreenKeys } from '../lib/screenState';
import { getPlanJoinRequestCount } from '../lib/notifications';
import { isAcceptedParticipant } from '../lib/participants';
import { resolvePlanImageSource } from '../lib/sports';
import { supabase } from '../lib/supabase';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const SUCCESS = '#22C55E';
const DANGER = '#EF4444';
const BG_TOP = '#DCEBFF';
const BG_BOTTOM = '#F2F7FF';

const avatarFallback = (name?: string) =>
    `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'N')}&background=4DA6FF&color=fff`;

export default function MyPlansScreen() {
    const router = useRouter();
    const { t } = useT();
    const [loading, setLoading] = useState(true);
    const [plans, setPlans] = useState<any[]>([]);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [pendingCount, setPendingCount] = useState(0);
    const hasDataRef = useRef(false);
    const { listRef, onScroll, scrollEventThrottle } = useListScrollRestore(ScreenKeys.MY_PLANS);

    useFocusEffect(useCallback(() => { fetchMyPlans(); }, []));

    const fetchMyPlans = async () => {
        try {
            if (!hasDataRef.current) setLoading(true);
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) { router.replace('/login'); return; }

            const pending = await getPlanJoinRequestCount(user.id);
            setPendingCount(pending);

            const now = new Date();
            const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

            const [createdRes, joinedRes] = await Promise.all([
                supabase
                    .from('planes')
                    .select('id, titulo, imagen_url, categoria, maximo_participantes, fecha_evento, creador_id, participantes(usuario_id, estado, perfiles:usuario_id(id, nombre, avatar_url))')
                    .eq('creador_id', user.id)
                    .order('fecha_evento', { ascending: true }),
                supabase
                    .from('participantes')
                    .select(`
                        plan_id,
                        planes (
                            id, titulo, imagen_url, categoria, maximo_participantes, fecha_evento, creador_id,
                            participantes ( usuario_id, estado, perfiles:usuario_id ( id, nombre, avatar_url ) )
                        )
                    `)
                    .eq('usuario_id', user.id)
                    .eq('estado', 'aceptado'),
            ]);

            const formatPlan = (p: any, role: 'creator' | 'member') => {
                const parts = (p.participantes || []) as any[];
                const accepted = parts.filter((x) => isAcceptedParticipant(x.estado));
                const pendingReqs = role === 'creator'
                    ? parts
                        .filter((x) => x.estado === 'pendiente' && x.usuario_id !== user.id && x.perfiles)
                        .map((x) => ({ ...x.perfiles, id: x.usuario_id }))
                    : [];
                return { ...p, joinedCount: accepted.length, pending: pendingReqs, role };
            };

            const created = (createdRes.data || [])
                .filter((p: any) => isFeedPlan(p))
                .filter((p: any) => !p.fecha_evento || new Date(p.fecha_evento) >= startOfToday)
                .map((p) => formatPlan(p, 'creator'));

            const joined = (joinedRes.data || [])
                .map((row) => {
                    const raw = row.planes;
                    const plan = Array.isArray(raw) ? raw[0] : raw;
                    if (!plan || plan.creador_id === user.id) return null;
                    if (!isFeedPlan(plan)) return null;
                    if (plan.fecha_evento && new Date(plan.fecha_evento) < startOfToday) return null;
                    return formatPlan(plan, 'member');
                })
                .filter(Boolean) as any[];

            const merged = [...created, ...joined].sort((a, b) => {
                const da = a.fecha_evento ? new Date(a.fecha_evento).getTime() : 0;
                const db = b.fecha_evento ? new Date(b.fecha_evento).getTime() : 0;
                return da - db;
            });

            setPlans(merged);
            hasDataRef.current = merged.length > 0;
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleAccept = async (planId: string, userId: string) => {
        setBusyId(planId + userId);
        const { error } = await supabase
            .from('participantes')
            .update({ estado: 'aceptado' })
            .eq('plan_id', planId)
            .eq('usuario_id', userId)
            .eq('estado', 'pendiente');

        setBusyId(null);
        if (error) {
            Alert.alert(
                t('profile.error'),
                error.message.includes('policy') || error.message.includes('RLS')
                    ? t('myplans.rlsHint')
                    : error.message
            );
            return;
        }
        fetchMyPlans();
    };

    const handleReject = async (planId: string, userId: string) => {
        setBusyId(planId + userId);
        const { error } = await supabase
            .from('participantes')
            .delete()
            .eq('plan_id', planId)
            .eq('usuario_id', userId);

        setBusyId(null);
        if (error) {
            Alert.alert(t('profile.error'), error.message);
            return;
        }
        fetchMyPlans();
    };

    const renderPlan = ({ item }: { item: any }) => {
        const isFull = item.joinedCount >= item.maximo_participantes;
        const isCreator = item.role === 'creator';
        return (
            <View style={styles.card}>
                <View style={styles.cardHeader}>
                    <PlanImage source={resolvePlanImageSource(item.imagen_url)} style={styles.thumb} recyclingKey={String(item.id)} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                        <View style={styles.titleRow}>
                            <Text style={styles.cardTitle} numberOfLines={1}>{item.titulo}</Text>
                            {!isCreator && (
                                <View style={styles.memberTag}>
                                    <Text style={styles.memberTagText}>{t('myplans.joined')}</Text>
                                </View>
                            )}
                        </View>
                        <View style={styles.countRow}>
                            <Ionicons name="people" size={14} color={isFull ? '#B8860B' : PRIMARY_DARK} />
                            <Text style={[styles.countText, isFull && { color: '#B8860B' }]}>{item.joinedCount}/{item.maximo_participantes}</Text>
                            {isFull && <Text style={styles.fullTag}>{t('card.fullShort')}</Text>}
                        </View>
                    </View>
                    <TouchableOpacity style={styles.chatBtn} onPress={() => router.push(`/chat/${item.id}`)}>
                        <Ionicons name="chatbubbles-outline" size={20} color={PRIMARY_DARK} />
                    </TouchableOpacity>
                </View>

                {isCreator ? (
                <View style={styles.requestsBlock}>
                    {item.pending.length === 0 ? (
                        <Text style={styles.noRequestsText}>{t('myplans.noRequests')}</Text>
                    ) : (
                        <>
                            <Text style={styles.requestsTitle}>{t('myplans.requests', { n: item.pending.length })}</Text>
                            {item.pending.map((p: any) => {
                                const busy = busyId === item.id + p.id;
                                return (
                                    <View key={p.id} style={styles.requestRow}>
                                        <TouchableOpacity
                                            style={styles.requestUser}
                                            onPress={() => router.push({ pathname: '/user-profile/[id]', params: { id: p.id } })}
                                        >
                                            <Image source={{ uri: p.avatar_url || avatarFallback(p.nombre) }} style={styles.reqAvatar} />
                                            <View style={{ flex: 1 }}>
                                                <Text style={styles.reqName} numberOfLines={1}>{p.nombre || t('profile.user')}</Text>
                                                <Text style={styles.reqHint}>{t('myplans.viewProfile')}</Text>
                                            </View>
                                        </TouchableOpacity>
                                        {busy ? (
                                            <ActivityIndicator color={PRIMARY_DARK} style={{ width: 78 }} />
                                        ) : (
                                            <View style={styles.reqActions}>
                                                <TouchableOpacity
                                                    style={[styles.reqBtn, { backgroundColor: isFull ? '#E2E8F0' : SUCCESS }]}
                                                    onPress={() => !isFull && handleAccept(item.id, p.id)}
                                                    disabled={isFull}
                                                >
                                                    <Ionicons name="checkmark" size={20} color="#FFF" />
                                                </TouchableOpacity>
                                                <TouchableOpacity style={[styles.reqBtn, styles.reqReject]} onPress={() => handleReject(item.id, p.id)}>
                                                    <Ionicons name="close" size={20} color={DANGER} />
                                                </TouchableOpacity>
                                            </View>
                                        )}
                                    </View>
                                );
                            })}
                            {isFull && <Text style={styles.fullHint}>{t('myplans.full')}</Text>}
                        </>
                    )}
                </View>
                ) : null}
            </View>
        );
    };

    return (
        <View style={styles.container}>
            <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={StyleSheet.absoluteFill} />
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Ionicons name="chevron-back" size={24} color={INK} />
                </TouchableOpacity>
                <View style={styles.headerTitleWrap}>
                    <Text style={styles.headerTitle}>{t('myplans.title')}</Text>
                    {pendingCount > 0 && (
                        <View style={styles.headerBadge}>
                            <Text style={styles.headerBadgeText}>
                                {pendingCount > 9 ? '9+' : pendingCount}
                            </Text>
                        </View>
                    )}
                </View>
                <View style={{ width: 45 }} />
            </View>

            <View style={{ flex: 1 }}>
                <FlatList
                    ref={listRef}
                    data={plans}
                    keyExtractor={(item) => item.id}
                    renderItem={renderPlan}
                    showsVerticalScrollIndicator={false}
                    onScroll={onScroll}
                    scrollEventThrottle={scrollEventThrottle}
                    {...OPTIMIZED_LIST_PROPS}
                    contentContainerStyle={styles.list}
                    ListEmptyComponent={
                        !loading ? (
                        <View style={styles.center}>
                            <View style={styles.emptyIconWrap}>
                                <Ionicons name="calendar-outline" size={48} color={PRIMARY} />
                            </View>
                            <Text style={styles.emptyTitle}>{t('myplans.empty')}</Text>
                            <TouchableOpacity style={styles.exploreBtn} onPress={() => router.push('/create-plan')}>
                                <Text style={styles.exploreBtnText}>{t('feed.create')}</Text>
                            </TouchableOpacity>
                        </View>
                        ) : null
                    }
                />
                {loading && plans.length === 0 ? (
                    <ActivityIndicator style={{ position: 'absolute', alignSelf: 'center', top: 80 }} color={PRIMARY_DARK} />
                ) : null}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG_BOTTOM },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 60 : 44, paddingBottom: 14 },
    backButton: { width: 45, height: 45, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 15, elevation: 3, shadowColor: PRIMARY_DARK, shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
    headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    headerTitle: { fontSize: 22, fontWeight: '900', color: INK },
    headerBadge: {
        minWidth: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: '#EF4444',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 6,
    },
    headerBadgeText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
    list: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: 6 },
    card: { backgroundColor: '#FFF', borderRadius: 22, padding: 16, marginBottom: 16, elevation: 5, shadowColor: '#1E3A8A', shadowOpacity: 0.1, shadowRadius: 14, shadowOffset: { width: 0, height: 8 } },
    cardHeader: { flexDirection: 'row', alignItems: 'center' },
    thumb: { width: 54, height: 54, borderRadius: 16, backgroundColor: '#E3ECFB' },
    cardTitle: { fontSize: 16, fontWeight: '800', color: INK, flex: 1 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    memberTag: { backgroundColor: '#EFF6FF', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
    memberTagText: { fontSize: 10, fontWeight: '800', color: PRIMARY_DARK, textTransform: 'uppercase' },
    countRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
    countText: { fontSize: 13, fontWeight: '700', color: PRIMARY_DARK },
    fullTag: { marginLeft: 6, fontSize: 10, fontWeight: '900', color: '#B8860B', backgroundColor: '#FEF3C7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
    chatBtn: { width: 40, height: 40, borderRadius: 14, backgroundColor: '#EEF3FB', justifyContent: 'center', alignItems: 'center' },
    requestsBlock: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#EEF3FB' },
    noRequestsText: { fontSize: 13, color: '#94A3B8', fontWeight: '600' },
    requestsTitle: { fontSize: 12, fontWeight: '800', color: PRIMARY_DARK, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 10 },
    requestRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
    requestUser: { flexDirection: 'row', alignItems: 'center', flex: 1 },
    reqAvatar: { width: 42, height: 42, borderRadius: 21, marginRight: 10, backgroundColor: '#E3ECFB' },
    reqName: { fontSize: 15, fontWeight: '700', color: INK },
    reqHint: { fontSize: 12, color: PRIMARY_DARK, fontWeight: '600', marginTop: 1 },
    reqActions: { flexDirection: 'row', gap: 8 },
    reqBtn: { width: 38, height: 38, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
    reqReject: { backgroundColor: '#FEE2E2' },
    fullHint: { fontSize: 12, color: '#B8860B', marginTop: 4 },
    center: { alignItems: 'center', marginTop: 70, paddingHorizontal: 30 },
    emptyIconWrap: { width: 110, height: 110, borderRadius: 55, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', elevation: 4, shadowColor: PRIMARY_DARK, shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, marginBottom: 20 },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: INK, marginBottom: 20 },
    exploreBtn: { backgroundColor: PRIMARY_DARK, paddingHorizontal: 22, paddingVertical: 14, borderRadius: 16 },
    exploreBtnText: { color: '#FFF', fontWeight: '700' },
});

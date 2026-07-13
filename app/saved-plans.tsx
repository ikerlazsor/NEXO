import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { PlanCard, type Membership } from '../components/PlanCard';
import { useT } from '../lib/i18n';
import { supabase } from '../lib/supabase';
import {
    isAcceptedParticipant,
    mapEstadoToMembership,
    membershipFromJoinEstado,
    promoteWaitlist,
    resolveJoinEstado,
} from '../lib/waitlist';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const BG_TOP = '#DCEBFF';
const BG_BOTTOM = '#F2F7FF';

export default function SavedPlansScreen() {
    const router = useRouter();
    const { t } = useT();
    const [loading, setLoading] = useState(true);
    const [savedPlans, setSavedPlans] = useState<any[]>([]);
    const [membershipMap, setMembershipMap] = useState<Record<string, Membership>>({});
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);

    useFocusEffect(useCallback(() => { fetchSavedData(); }, []));

    const fetchSavedData = async () => {
        try {
            setLoading(true);
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            setCurrentUserId(user.id);

            const { data: savedData } = await supabase
                .from('planes_guardados')
                .select('plan_id, planes (*, participantes(usuario_id, estado, perfiles:usuario_id(id, nombre, avatar_url)))')
                .eq('usuario_id', user.id);

            const { data: joinedData } = await supabase
                .from('participantes')
                .select('plan_id, estado')
                .eq('usuario_id', user.id);

            const rawPlans = (savedData || []).map((s: any) => s.planes).filter(Boolean);

            const creatorIds = Array.from(new Set(rawPlans.map((p: any) => p.user_id).filter(Boolean)));
            let creatorMap: Record<string, any> = {};
            if (creatorIds.length > 0) {
                const { data: creators } = await supabase.from('perfiles').select('id, nombre, avatar_url').in('id', creatorIds);
                creatorMap = Object.fromEntries((creators || []).map(c => [c.id, c]));
            }

            const formatted = rawPlans.map((plan: any) => {
                const rawParticipants = (plan.participantes || []) as any[];
                const accepted = rawParticipants.filter((p: any) => isAcceptedParticipant(p.estado));
                const list: any[] = [];
                const creator = creatorMap[plan.user_id];
                if (creator) list.push({ ...creator, isCreator: true });
                accepted.forEach((p: any) => {
                    if (p.perfiles && p.perfiles.id !== plan.user_id) list.push({ ...p.perfiles, isCreator: false });
                });
                return { ...plan, joinedCount: accepted.length, participantsList: list };
            });

            setSavedPlans(formatted);

            const map: Record<string, Membership> = {};
            (joinedData || []).forEach((p: any) => {
                const m = mapEstadoToMembership(p.estado);
                if (m) map[p.plan_id] = m;
            });
            setMembershipMap(map);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleJoin = async (planId: string) => {
        if (!currentUserId) return;
        const plan = savedPlans.find(p => p.id === planId);
        if (!plan) return;

        const estado = resolveJoinEstado(plan);
        const nextMembership = membershipFromJoinEstado(estado);
        setMembershipMap(prev => ({ ...prev, [planId]: nextMembership }));
        if (estado === 'aceptado') {
            setSavedPlans(prev => prev.map(p => p.id === planId ? { ...p, joinedCount: p.joinedCount + 1 } : p));
        }
        await supabase.from('participantes').insert({ plan_id: planId, usuario_id: currentUserId, estado });
    };

    const handleLeave = async (planId: string) => {
        if (!currentUserId) return;
        const membership = membershipMap[planId];
        const wasJoined = membership === 'joined';
        const wasWaitlist = membership === 'waitlist';
        Alert.alert(
            wasJoined ? t('saved.leave') : wasWaitlist ? t('feed.leaveWaitlistTitle') : t('saved.cancelRequest'),
            wasJoined ? t('saved.leaveConfirm') : wasWaitlist ? t('feed.leaveWaitlistMsg') : t('saved.cancelRequestConfirm'),
            [
            { text: t('common.no') },
            { text: t('common.yes'), onPress: async () => {
                setMembershipMap(prev => { const n = { ...prev }; delete n[planId]; return n; });
                if (wasJoined) setSavedPlans(prev => prev.map(p => p.id === planId ? { ...p, joinedCount: Math.max(0, p.joinedCount - 1) } : p));
                await supabase.from('participantes').delete().eq('plan_id', planId).eq('usuario_id', currentUserId);
                if (wasJoined) {
                    await promoteWaitlist(planId);
                    fetchSavedData();
                }
            }}
        ]);
    };

    const handleRemove = async (planId: string) => {
        if (!currentUserId) return;
        await supabase.from('planes_guardados').delete().eq('plan_id', planId).eq('usuario_id', currentUserId);
        setSavedPlans(prev => prev.filter(p => p.id !== planId));
    };

    const handleDelete = async (planId: string) => {
        Alert.alert(t('saved.deletePlan'), t('saved.deleteConfirm'), [
            { text: t('common.cancel'), style: "cancel" },
            { text: t('common.delete'), style: "destructive", onPress: async () => {
                setSavedPlans(prev => prev.filter(p => p.id !== planId));
                await supabase.from('participantes').delete().eq('plan_id', planId);
                await supabase.from('planes').delete().eq('id', planId);
            }}
        ]);
    };

    const handleEdit = (planId: string) => {
        router.push({ pathname: '/create-plan', params: { editId: planId } });
    };

    return (
        <View style={styles.container}>
            <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={StyleSheet.absoluteFill} />
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Ionicons name="chevron-back" size={24} color={INK} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{t('saved.title')}</Text>
                <View style={styles.headerRight}><Text style={styles.badgeText}>{savedPlans.length}</Text></View>
            </View>

            {loading ? <ActivityIndicator style={{ marginTop: 50 }} color={PRIMARY_DARK} /> : (
                <FlatList
                    data={savedPlans}
                    keyExtractor={(item) => item.id}
                    showsVerticalScrollIndicator={false}
                    renderItem={({ item, index }) => (
                        <PlanCard
                            item={item}
                            index={index}
                            currentUserId={currentUserId}
                            membership={membershipMap[item.id] || 'none'}
                            isSaved={true}
                            onJoin={handleJoin}
                            onLeave={handleLeave}
                            onDelete={handleDelete}
                            onEdit={handleEdit}
                            onToggleSave={handleRemove}
                            router={router}
                        />
                    )}
                    contentContainerStyle={styles.list}
                    ListEmptyComponent={
                        <View style={styles.center}>
                            <View style={styles.emptyIconWrap}>
                                <Ionicons name="heart-outline" size={48} color={PRIMARY} />
                            </View>
                            <Text style={styles.emptyTitle}>{t('saved.empty')}</Text>
                            <TouchableOpacity style={styles.exploreBtn} onPress={() => router.replace('/(tabs)')}>
                                <Text style={styles.exploreBtnText}>{t('saved.explore')}</Text>
                            </TouchableOpacity>
                        </View>
                    }
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG_BOTTOM },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 60 : 44, paddingBottom: 16 },
    backButton: { width: 45, height: 45, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 15, elevation: 3, shadowColor: PRIMARY_DARK, shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
    headerTitle: { fontSize: 22, fontWeight: '900', color: INK },
    headerRight: { backgroundColor: PRIMARY_DARK, minWidth: 28, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, alignItems: 'center' },
    badgeText: { color: '#FFF', fontWeight: '800' },
    list: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: 6 },
    center: { alignItems: 'center', marginTop: 70, paddingHorizontal: 30 },
    emptyIconWrap: { width: 110, height: 110, borderRadius: 55, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', elevation: 4, shadowColor: PRIMARY_DARK, shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, marginBottom: 20 },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: INK, marginBottom: 20 },
    exploreBtn: { backgroundColor: PRIMARY_DARK, paddingHorizontal: 22, paddingVertical: 14, borderRadius: 16 },
    exploreBtnText: { color: '#FFF', fontWeight: '700' }
});

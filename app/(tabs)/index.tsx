/*
pantalla principal / home feed de planes
*/
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
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
    View
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { PlanCard, type Membership } from '../../components/PlanCard';
import { getAuthUser } from '../../lib/auth';
import { isFeedPlan } from '../../lib/feedPlans';
import { useT } from '../../lib/i18n';
import { deletePlanCompletely } from '../../lib/deletePlan';
import { debounce } from '../../lib/debounce';
import { getProfileNotificationCount } from '../../lib/notifications';
import { SPAIN_PROVINCES } from '../../lib/provinces';
import { MAIN_CATEGORIES } from '../../lib/sports';
import { supabase } from '../../lib/supabase';
import {
    isAcceptedParticipant,
    mapEstadoToMembership,
    membershipFromJoinEstado,
    promoteWaitlist,
    resolveJoinEstado,
} from '../../lib/waitlist';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const BG_TOP = '#DCEBFF';
const BG_BOTTOM = '#F2F7FF';

const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
    'Todos': 'apps',
    'Deporte': 'fitness',
    'Fiesta': 'sparkles',
    'Solo chicas': 'female',
    'Estudio': 'book',
    'Tapas': 'restaurant',
    'Fútbol': 'football',
};

const DATE_KEYS = ['all', 'today', 'week', 'month'];

const FEED_PLAN_COLUMNS =
    'id, title, image_url, category, deporte_tipo, futbol_formato, event_date, location_name, latitude, longitude, max_people, user_id, requiere_aprobacion, description, is_direct_chat, is_group_chat';

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
    const { t, lang, setLang } = useT();
    const [search, setSearch] = useState('');
    const [selectedFilter, setSelectedFilter] = useState('Todos');
    const [zoneFilter, setZoneFilter] = useState('');
    const [dateFilter, setDateFilter] = useState('all');
    const [showZoneModal, setShowZoneModal] = useState(false);
    const [showDateModal, setShowDateModal] = useState(false);

    const [plans, setPlans] = useState<any[]>([]);
    const [membershipMap, setMembershipMap] = useState<Record<string, Membership>>({});
    const [savedPlans, setSavedPlans] = useState<string[]>([]);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [notifCount, setNotifCount] = useState(0);
    const [notifBreakdown, setNotifBreakdown] = useState({
        friendRequests: 0,
        planRequests: 0,
        planInvites: 0,
    });

    const filters = ['Todos', ...MAIN_CATEGORIES];

    const fetchData = async () => {
        let finished = false;
        const safetyTimer = setTimeout(() => {
            if (!finished) {
                setLoading(false);
                setRefreshing(false);
            }
        }, 12000);

        try {
            if (!refreshing && plans.length === 0) setLoading(true);

            const user = await getAuthUser();
            setCurrentUserId(user?.id || null);

            const { data: plansData, error: plansError } = await supabase
                .from('planes')
                .select(FEED_PLAN_COLUMNS)
                .order('event_date', { ascending: true });

            if (plansError) {
                console.error('Error cargando planes:', plansError);
            }

            const safePlans = (plansData || []).filter(isFeedPlan);
            const planIds = safePlans.map((p) => p.id);

            let partsByPlan: Record<string, any[]> = {};
            if (planIds.length > 0) {
                const { data: partsData, error: partsError } = await supabase
                    .from('participantes')
                    .select('plan_id, usuario_id, estado, perfiles:usuario_id(id, nombre, avatar_url)')
                    .in('plan_id', planIds)
                    .eq('estado', 'aceptado');

                if (partsError) {
                    console.warn('Participantes del feed:', partsError.message);
                } else {
                    (partsData || []).forEach((row: any) => {
                        if (!partsByPlan[row.plan_id]) partsByPlan[row.plan_id] = [];
                        partsByPlan[row.plan_id].push(row);
                    });
                }
            }

            const creatorIds = Array.from(new Set(safePlans.map((p) => p.user_id).filter(Boolean)));
            let creatorMap: Record<string, any> = {};
            if (creatorIds.length > 0) {
                const { data: creators } = await supabase
                    .from('perfiles')
                    .select('id, nombre, avatar_url')
                    .in('id', creatorIds);
                creatorMap = Object.fromEntries((creators || []).map((c) => [c.id, c]));
            }

            const formattedPlans = safePlans.map((plan) => {
                const rawParticipants = partsByPlan[plan.id] || [];
                const accepted = rawParticipants.filter((p: any) => isAcceptedParticipant(p.estado));
                const list: any[] = [];
                const creator = creatorMap[plan.user_id];
                if (creator) list.push({ ...creator, isCreator: true });
                accepted.forEach((p: any) => {
                    const prof = Array.isArray(p.perfiles) ? p.perfiles[0] : p.perfiles;
                    if (prof && prof.id !== plan.user_id) list.push({ ...prof, isCreator: false });
                });
                return { ...plan, joinedCount: accepted.length, participantsList: list };
            });

            setPlans(formattedPlans);

            if (user) {
                void Promise.all([
                    supabase.from('perfiles').select('avatar_url').eq('id', user.id).maybeSingle(),
                    getProfileNotificationCount(user.id),
                    supabase.from('participantes').select('plan_id, estado').eq('usuario_id', user.id),
                    supabase.from('planes_guardados').select('plan_id').eq('usuario_id', user.id),
                ]).then(([profileRes, notifs, participantsRes, savedRes]) => {
                    setAvatarUrl(profileRes.data?.avatar_url || user.user_metadata?.avatar_url || null);
                    setNotifCount(notifs.total);
                    setNotifBreakdown({
                        friendRequests: notifs.friendRequests,
                        planRequests: notifs.planRequests,
                        planInvites: notifs.planInvites,
                    });
                    const map: Record<string, Membership> = {};
                    (participantsRes.data || []).forEach((p: any) => {
                        const m = mapEstadoToMembership(p.estado);
                        if (m) map[p.plan_id] = m;
                    });
                    setMembershipMap(map);
                    setSavedPlans(savedRes.data?.map((s) => s.plan_id) || []);
                }).catch(() => {
                    setNotifCount(0);
                    setNotifBreakdown({ friendRequests: 0, planRequests: 0, planInvites: 0 });
                });
            } else {
                setNotifCount(0);
                setNotifBreakdown({ friendRequests: 0, planRequests: 0, planInvites: 0 });
            }
        } catch (error) {
            console.log(error);
        } finally {
            finished = true;
            clearTimeout(safetyTimer);
            setLoading(false);
            setRefreshing(false);
        }
    };

    const fetchDataRef = useRef<() => Promise<void>>(async () => {});
    fetchDataRef.current = fetchData;

    useEffect(() => {
        const debouncedRefresh = debounce(() => {
            void fetchDataRef.current();
        }, 450);
        const uniqueChannelId = `feed-${Math.random().toString(36).substr(2, 9)}`;
        const channel = supabase.channel(uniqueChannelId);
        channel
            .on('postgres_changes', { event: '*', schema: 'public', table: 'planes' }, debouncedRefresh)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'participantes' }, debouncedRefresh)
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, []);

    useFocusEffect(useCallback(() => { fetchData(); }, []));

    const handleJoin = async (planId: string) => {
        if (!currentUserId) return;
        const plan = plans.find(p => p.id === planId);
        if (!plan) return;

        const estado = resolveJoinEstado(plan);
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
              ? t('feed.leaveWaitlistTitle')
              : t('feed.cancelRequestTitle');
        const message = wasJoined
            ? t('feed.leaveMsg')
            : wasWaitlist
              ? t('feed.leaveWaitlistMsg')
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

    const handleDeletePlan = async (planId: string) => {
        Alert.alert(t('feed.deletePlan'), t('feed.deleteConfirm'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('feed.deletePlan'),
                style: 'destructive',
                onPress: async () => {
                    const prevPlans = plans;
                    const prevMap = membershipMap;
                    const prevSaved = savedPlans;
                    setPlans(prev => prev.filter(p => p.id !== planId));
                    setMembershipMap(prev => { const n = { ...prev }; delete n[planId]; return n; });
                    setSavedPlans(prev => prev.filter(id => id !== planId));
                    const { error } = await deletePlanCompletely(planId);
                    if (error) {
                        setPlans(prevPlans);
                        setMembershipMap(prevMap);
                        setSavedPlans(prevSaved);
                        Alert.alert(t('feed.error'), t('feed.deleteError'));
                    }
                },
            },
        ]);
    };

    const handleEditPlan = (planId: string) => {
        router.push({ pathname: '/create-plan', params: { editId: planId } });
    };

    const matchesDate = (plan: any) => {
        if (dateFilter === 'all') return true;
        if (!plan.event_date) return false;
        const d = new Date(plan.event_date);
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

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const filteredPlans = useMemo(() => {
        const isMinePlan = (p: any) =>
            String(p.user_id) === String(currentUserId)
            || membershipMap[p.id] === 'joined'
            || membershipMap[p.id] === 'requested'
            || membershipMap[p.id] === 'waitlist';

        return plans
            .filter(p =>
                isFeedPlan(p)
                && (!p.event_date || new Date(p.event_date) >= startOfToday)
                && (selectedFilter === 'Todos'
                    || p.category === selectedFilter
                    || (selectedFilter === 'Deporte' && (p.category === 'Deporte' || p.category === 'Fútbol')))
                && p.title.toLowerCase().includes(search.toLowerCase())
                && (zoneFilter.trim() === '' || (p.location_name || '').toLowerCase().includes(zoneFilter.trim().toLowerCase()))
                && matchesDate(p)
            )
            .sort((a, b) => {
                const am = isMinePlan(a) ? 0 : 1;
                const bm = isMinePlan(b) ? 0 : 1;
                if (am !== bm) return am - bm;
                const ad = a.event_date ? new Date(a.event_date).getTime() : Infinity;
                const bd = b.event_date ? new Date(b.event_date).getTime() : Infinity;
                return ad - bd;
            });
    }, [plans, currentUserId, membershipMap, selectedFilter, search, zoneFilter, dateFilter, startOfToday.getTime()]);

    const activeDateLabel = t('date.' + dateFilter);

    return (
        <View style={styles.container}>
            <StatusBar barStyle="dark-content" />
            <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={StyleSheet.absoluteFill} />

            <View style={styles.header}>
                <View style={styles.headerTextGroup}>
                    <Text style={styles.greeting}>{t('feed.greeting')}</Text>
                    <Text style={styles.logoInline}>Nexo</Text>
                </View>
                <View style={styles.headerRight}>
                    <View style={styles.flagsRow}>
                        <TouchableOpacity
                            style={[styles.flagBtn, lang === 'es' && styles.flagBtnActive]}
                            onPress={() => setLang('es')}
                            activeOpacity={0.8}
                        >
                            <Text style={styles.flagEmoji}>🇪🇸</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.flagBtn, lang === 'en' && styles.flagBtnActive]}
                            onPress={() => setLang('en')}
                            activeOpacity={0.8}
                        >
                            <Text style={styles.flagEmoji}>🇬🇧</Text>
                        </TouchableOpacity>
                    </View>
                    <TouchableOpacity
                        style={styles.profileBtn}
                        onPress={() => {
                            if (notifCount === 0) {
                                router.push('/profile');
                                return;
                            }
                            const { friendRequests, planRequests, planInvites } = notifBreakdown;
                            if (planRequests > 0 && friendRequests === 0 && planInvites === 0) {
                                router.push('/my-plans');
                            } else if (friendRequests > 0 || planInvites > 0) {
                                router.push('/friends');
                            } else {
                                router.push('/profile');
                            }
                        }}
                    >
                        <View style={styles.profileAvatarWrap}>
                            {avatarUrl ? (
                                <Image source={{ uri: avatarUrl }} style={styles.profileImage} />
                            ) : (
                                <View style={styles.profileIconBg}><Ionicons name="person" size={22} color={PRIMARY_DARK} /></View>
                            )}
                            {notifCount > 0 && (
                                <View style={styles.profileNotifBadge}>
                                    <Text style={styles.profileNotifText}>
                                        {notifCount > 9 ? '9+' : notifCount}
                                    </Text>
                                </View>
                            )}
                        </View>
                    </TouchableOpacity>
                </View>
            </View>

            <View style={styles.searchWrapper}>
                <View style={styles.searchContainer}>
                    <Ionicons name="search" size={20} color={PRIMARY_DARK} />
                    <TextInput placeholder={t('feed.searchPlaceholder')} placeholderTextColor="#94A3B8" style={styles.searchInput} value={search} onChangeText={setSearch} />
                </View>
            </View>

            <View style={styles.quickFiltersRow}>
                <TouchableOpacity
                    style={[styles.quickFilterPill, zoneFilter ? styles.quickFilterActive : null]}
                    onPress={() => setShowZoneModal(true)}
                >
                    <Ionicons name="location" size={15} color={zoneFilter ? '#FFF' : PRIMARY_DARK} />
                    <Text style={[styles.quickFilterText, zoneFilter ? { color: '#FFF' } : null]} numberOfLines={1}>
                        {zoneFilter ? zoneFilter : t('feed.zone')}
                    </Text>
                    {zoneFilter ? (
                        <TouchableOpacity onPress={() => setZoneFilter('')} hitSlop={8}>
                            <Ionicons name="close-circle" size={15} color="#FFF" />
                        </TouchableOpacity>
                    ) : null}
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.quickFilterPill, dateFilter !== 'all' ? styles.quickFilterActive : null]}
                    onPress={() => setShowDateModal(true)}
                >
                    <Ionicons name="calendar" size={15} color={dateFilter !== 'all' ? '#FFF' : PRIMARY_DARK} />
                    <Text style={[styles.quickFilterText, dateFilter !== 'all' ? { color: '#FFF' } : null]}>
                        {dateFilter !== 'all' ? activeDateLabel : t('feed.date')}
                    </Text>
                </TouchableOpacity>
            </View>

            <View style={styles.filtersContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersScroll}>
                    {filters.map(f => {
                        const active = selectedFilter === f;
                        return (
                            <Pressable key={f} onPress={() => setSelectedFilter(f)} style={[styles.filterBtn, active && styles.activeFilter]}>
                                <Ionicons name={CATEGORY_ICONS[f] || 'pricetag'} size={15} color={active ? '#FFF' : PRIMARY_DARK} />
                                <Text style={[styles.filterText, active && styles.activeText]}>{t('cat.' + f)}</Text>
                            </Pressable>
                        );
                    })}
                </ScrollView>
            </View>

            {loading && !refreshing ? (
                <ActivityIndicator size="large" color={PRIMARY_DARK} style={{ marginTop: 50 }} />
            ) : (
                <FlatList
                    data={filteredPlans}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                    initialNumToRender={6}
                    maxToRenderPerBatch={5}
                    windowSize={7}
                    removeClippedSubviews={Platform.OS === 'android'}
                    ListEmptyComponent={<EmptySearch onClear={() => { setSearch(''); setSelectedFilter('Todos'); setZoneFilter(''); setDateFilter('all'); }} />}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={fetchData} tintColor={PRIMARY_DARK} />}
                    renderItem={({ item, index }) => (
                        <PlanCard
                            item={item}
                            index={index}
                            currentUserId={currentUserId}
                            membership={membershipMap[item.id] || 'none'}
                            isSaved={savedPlans.includes(item.id)}
                            onJoin={handleJoin}
                            onLeave={handleLeave}
                            onDelete={handleDeletePlan}
                            onEdit={handleEditPlan}
                            onToggleSave={handleSave}
                            router={router}
                        />
                    )}
                />
            )}

            <TouchableOpacity style={styles.fabLeft} onPress={() => router.push('/chats')}>
                <Ionicons name="chatbubbles" size={26} color="#fff" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.fab} onPress={() => router.push('/create-plan')} activeOpacity={0.9}>
                <LinearGradient colors={[PRIMARY, PRIMARY_DARK]} style={styles.fabGradient}>
                    <Ionicons name="add" size={32} color="#fff" />
                </LinearGradient>
            </TouchableOpacity>

            <Modal visible={showZoneModal} animationType="slide" onRequestClose={() => setShowZoneModal(false)}>
                <View style={styles.mapModalContainer}>
                    <MapView
                        style={StyleSheet.absoluteFill}
                        initialRegion={{ latitude: 40.0, longitude: -3.7, latitudeDelta: 11, longitudeDelta: 11 }}
                    >
                        {SPAIN_PROVINCES.map((prov) => (
                            <Marker
                                key={prov.name}
                                coordinate={{ latitude: prov.latitude, longitude: prov.longitude }}
                                title={prov.name}
                                pinColor={zoneFilter === prov.name ? '#22C55E' : '#2563EB'}
                                onPress={() => { setZoneFilter(prov.name); setShowZoneModal(false); }}
                            />
                        ))}
                    </MapView>

                    <View style={styles.mapModalHeader}>
                        <TouchableOpacity style={styles.mapCloseBtn} onPress={() => setShowZoneModal(false)}>
                            <Ionicons name="chevron-back" size={24} color={INK} />
                        </TouchableOpacity>
                        <View style={styles.mapHeaderTitleWrap}>
                            <Text style={styles.mapHeaderTitle}>{t('feed.filterZoneTitle')}</Text>
                            <Text style={styles.mapHeaderSub}>{t('feed.filterZoneSub')}</Text>
                        </View>
                    </View>

                    <View style={styles.mapModalFooter}>
                        {zoneFilter ? (
                            <View style={styles.mapSelectedRow}>
                                <Ionicons name="location" size={18} color={PRIMARY_DARK} />
                                <Text style={styles.mapSelectedText}>{zoneFilter}</Text>
                                <TouchableOpacity style={styles.mapClearBtn} onPress={() => { setZoneFilter(''); setShowZoneModal(false); }}>
                                    <Text style={styles.mapClearText}>{t('common.remove')}</Text>
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <Text style={styles.mapFooterHint}>{t('feed.filterZoneHint')}</Text>
                        )}
                    </View>
                </View>
            </Modal>

            <Modal visible={showDateModal} transparent animationType="fade" onRequestClose={() => setShowDateModal(false)}>
                <Pressable style={styles.modalOverlay} onPress={() => setShowDateModal(false)}>
                    <Pressable style={styles.modalSheet}>
                        <Text style={styles.modalTitle}>{t('feed.filterDateTitle')}</Text>
                        {DATE_KEYS.map(key => {
                            const active = dateFilter === key;
                            return (
                                <TouchableOpacity
                                    key={key}
                                    style={[styles.dateOption, active && styles.dateOptionActive]}
                                    onPress={() => { setDateFilter(key); setShowDateModal(false); }}
                                >
                                    <Text style={[styles.dateOptionText, active && { color: PRIMARY_DARK, fontWeight: '800' }]}>{t('date.' + key)}</Text>
                                    {active && <Ionicons name="checkmark-circle" size={20} color={PRIMARY_DARK} />}
                                </TouchableOpacity>
                            );
                        })}
                    </Pressable>
                </Pressable>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: BG_BOTTOM },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: Platform.OS === 'ios' ? 60 : 48, paddingHorizontal: 24, marginBottom: 16 },
    headerTextGroup: { flex: 1 },
    greeting: { fontSize: 15, color: '#64748B', fontWeight: '600' },
    logoInline: { fontSize: 28, fontWeight: '900', color: INK, letterSpacing: -0.5 },
    profileBtn: { padding: 2 },
    profileAvatarWrap: { position: 'relative' },
    profileNotifBadge: {
        position: 'absolute',
        top: -2,
        right: -2,
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: '#EF4444',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 4,
        borderWidth: 2,
        borderColor: '#FFF',
    },
    profileNotifText: { color: '#FFF', fontSize: 10, fontWeight: '800' },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    flagsRow: { flexDirection: 'row', backgroundColor: '#FFF', borderRadius: 14, padding: 3, gap: 2, elevation: 3, shadowColor: PRIMARY_DARK, shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
    flagBtn: { width: 32, height: 32, borderRadius: 11, justifyContent: 'center', alignItems: 'center' },
    flagBtnActive: { backgroundColor: '#E3ECFB' },
    flagEmoji: { fontSize: 18 },
    profileIconBg: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', elevation: 4, shadowColor: PRIMARY_DARK, shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
    profileImage: { width: 46, height: 46, borderRadius: 23, borderWidth: 2, borderColor: '#FFF' },
    searchWrapper: { paddingHorizontal: 24, marginBottom: 12 },
    searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', paddingHorizontal: 16, paddingVertical: 14, borderRadius: 18, elevation: 3, shadowColor: PRIMARY_DARK, shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
    searchInput: { marginLeft: 10, flex: 1, fontSize: 16, color: INK },

    quickFiltersRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 24, marginBottom: 12 },
    quickFilterPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFF', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: '#E3ECFB', maxWidth: 180 },
    quickFilterActive: { backgroundColor: PRIMARY_DARK, borderColor: PRIMARY_DARK },
    quickFilterText: { color: PRIMARY_DARK, fontWeight: '700', fontSize: 13, flexShrink: 1 },

    filtersContainer: { marginBottom: 4 },
    filtersScroll: { paddingHorizontal: 24, paddingBottom: 10 },
    filterBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 14, backgroundColor: '#FFF', marginRight: 10, borderWidth: 1, borderColor: '#E3ECFB' },
    activeFilter: { backgroundColor: PRIMARY_DARK, borderColor: PRIMARY_DARK },
    filterText: { color: '#475569', fontWeight: '700' },
    activeText: { color: '#FFF' },
    listContent: { paddingHorizontal: 20, paddingBottom: 130, paddingTop: 6 },

    emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 60, paddingHorizontal: 20 },
    emptyIconWrap: { width: 110, height: 110, borderRadius: 55, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', elevation: 4, shadowColor: PRIMARY_DARK, shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: INK, textAlign: 'center', marginTop: 22 },
    emptySubtitle: { fontSize: 14, color: '#64748B', textAlign: 'center', marginTop: 8 },
    createBtnEmpty: { marginTop: 22, backgroundColor: PRIMARY_DARK, paddingHorizontal: 22, paddingVertical: 13, borderRadius: 16 },
    createBtnEmptyText: { color: '#FFF', fontWeight: '700' },

    fab: { position: 'absolute', bottom: 32, right: 24, width: 64, height: 64, borderRadius: 22, elevation: 12, shadowColor: PRIMARY_DARK, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
    fabGradient: { flex: 1, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
    fabLeft: { position: 'absolute', bottom: 32, left: 24, backgroundColor: INK, width: 64, height: 64, borderRadius: 22, justifyContent: 'center', alignItems: 'center', elevation: 12, shadowColor: INK, shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(15,42,74,0.4)', justifyContent: 'center', paddingHorizontal: 32 },
    modalSheet: { backgroundColor: '#FFF', borderRadius: 24, padding: 22 },
    modalTitle: { fontSize: 18, fontWeight: '800', color: INK, marginBottom: 18 },
    dateOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 15, paddingHorizontal: 16, borderRadius: 14, marginBottom: 8, backgroundColor: '#F2F7FF' },
    dateOptionActive: { backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: PRIMARY },
    dateOptionText: { fontSize: 15, color: '#475569', fontWeight: '600' },

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

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
    Modal,
    Platform,
    Pressable,
    RefreshControl,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { PlanCard, type Membership } from '../../components/PlanCard';
import { ProfileAvatar } from '../../components/ProfileAvatar';
import { LangPicker } from '../../components/LangPicker';
import { getAuthUser } from '../../lib/auth';
import { getFriends } from '../../lib/friends';
import { isFeedPlan } from '../../lib/feedPlans';
import { useT } from '../../lib/i18n';
import { deletePlanCompletely } from '../../lib/deletePlan';
import { reportPlan } from '../../lib/reportPlan';
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
} from '../../lib/participants';

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
};

const DATE_KEYS = ['all', 'today', 'week', 'month'];

const FEED_PLAN_COLUMNS =
    'id, titulo, imagen_url, categoria, tipo_deporte, fecha_evento, nombre_ubicacion, latitud, longitud, maximo_participantes, creador_id, requiere_aprobacion, descripcion, estado';

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
    const [showCategoryModal, setShowCategoryModal] = useState(false);

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
    const [friendIds, setFriendIds] = useState<Set<string>>(new Set());

    const CATEGORY_FILTER_OPTIONS = ['Todos', 'Fiesta', 'Tapas', 'Deporte', 'Estudio', 'Solo chicas'];

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

            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const todayIso = todayStart.toISOString();

            const userPromise = getAuthUser();
            const plansPromise = supabase
                .from('planes')
                .select(FEED_PLAN_COLUMNS)
                .or(`fecha_evento.is.null,fecha_evento.gte.${todayIso}`)
                .order('fecha_evento', { ascending: true })
                .limit(100);

            const [user, plansRes] = await Promise.all([userPromise, plansPromise]);
            setCurrentUserId(user?.id || null);

            if (plansRes.error) {
                console.error('Error cargando planes:', plansRes.error);
            }

            const safePlans = (plansRes.data || []).filter(isFeedPlan);
            const planIds = safePlans.map((p) => p.id);

            const partsPromise = planIds.length > 0
                ? supabase
                    .from('participantes')
                    .select('plan_id, usuario_id, estado, perfiles:usuario_id(id, nombre, avatar_url)')
                    .in('plan_id', planIds)
                    .eq('estado', 'aceptado')
                : Promise.resolve({ data: [], error: null });

            const creatorIds = Array.from(new Set(safePlans.map((p) => p.creador_id).filter(Boolean)));
            const creatorsPromise = creatorIds.length > 0
                ? supabase.from('perfiles').select('id, nombre, avatar_url').in('id', creatorIds)
                : Promise.resolve({ data: [], error: null });

            const userExtrasPromise = user
                ? Promise.all([
                    supabase.from('perfiles').select('avatar_url').eq('id', user.id).maybeSingle(),
                    getProfileNotificationCount(user.id),
                    supabase.from('participantes').select('plan_id, estado').eq('usuario_id', user.id),
                    supabase.from('planes_guardados').select('plan_id').eq('usuario_id', user.id),
                    getFriends(user.id),
                ])
                : Promise.resolve(null);

            const [partsRes, creatorsRes, userExtras] = await Promise.all([
                partsPromise,
                creatorsPromise,
                userExtrasPromise,
            ]);

            let partsByPlan: Record<string, any[]> = {};
            if (partsRes.error) {
                console.warn('Participantes del feed:', partsRes.error.message);
            } else {
                (partsRes.data || []).forEach((row: any) => {
                    if (!partsByPlan[row.plan_id]) partsByPlan[row.plan_id] = [];
                    partsByPlan[row.plan_id].push(row);
                });
            }

            const creatorMap = Object.fromEntries((creatorsRes.data || []).map((c) => [c.id, c]));

            const formattedPlans = safePlans.map((plan) => {
                const rawParticipants = partsByPlan[plan.id] || [];
                const accepted = rawParticipants.filter((p: any) => isAcceptedParticipant(p.estado));
                const list: any[] = [];
                const creator = creatorMap[plan.creador_id];
                if (creator) list.push({ ...creator, isCreator: true });
                accepted.forEach((p: any) => {
                    const prof = Array.isArray(p.perfiles) ? p.perfiles[0] : p.perfiles;
                    if (prof && prof.id !== plan.creador_id) list.push({ ...prof, isCreator: false });
                });
                return { ...plan, joinedCount: accepted.length, participantsList: list };
            });

            setPlans(formattedPlans);

            if (user && userExtras) {
                const [profileRes, notifs, participantsRes, savedRes, friendsData] = userExtras;
                setAvatarUrl(profileRes.data?.avatar_url || user.user_metadata?.avatar_url || null);
                setNotifCount(notifs.total);
                setNotifBreakdown({
                    friendRequests: notifs.friendRequests,
                    planRequests: notifs.planRequests,
                    planInvites: notifs.planInvites,
                });
                setFriendIds(new Set(friendsData.map((f) => f.id)));
                const map: Record<string, Membership> = {};
                (participantsRes.data || []).forEach((p: any) => {
                    const m = mapEstadoToMembership(p.estado);
                    if (m) map[p.plan_id] = m;
                });
                setMembershipMap(map);
                setSavedPlans(savedRes.data?.map((s) => s.plan_id) || []);
            } else {
                setNotifCount(0);
                setNotifBreakdown({ friendRequests: 0, planRequests: 0, planInvites: 0 });
                setFriendIds(new Set());
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

        const estado = resolveJoinEstado({
            requiere_aprobacion: plan.requiere_aprobacion,
            maximo_participantes: plan.maximo_participantes,
            joinedCount: plan.joinedCount,
        });
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
              ? t('card.leaveWaitlistTitle')
              : t('feed.cancelRequestTitle');
        const message = wasJoined
            ? t('feed.leaveMsg')
            : wasWaitlist
              ? t('card.leaveWaitlistMsg')
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

    const handleReportPlan = (planId: string) => {
        if (!currentUserId) return;
        Alert.alert(t('card.reportTitle'), t('card.reportConfirm'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('card.report'),
                style: 'destructive',
                onPress: async () => {
                    const { error } = await reportPlan(planId, currentUserId);
                    if (error === 'already_reported') {
                        Alert.alert(t('feed.error'), t('card.reportAlready'));
                    } else if (error) {
                        Alert.alert(t('feed.error'), t('card.reportError'));
                    } else {
                        Alert.alert(t('card.reportSuccess'));
                    }
                },
            },
        ]);
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
        if (!plan.fecha_evento) return false;
        const d = new Date(plan.fecha_evento);
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
            String(p.creador_id) === String(currentUserId)
            || membershipMap[p.id] === 'joined'
            || membershipMap[p.id] === 'requested';

        return plans
            .filter(p =>
                isFeedPlan(p)
                && (!p.fecha_evento || new Date(p.fecha_evento) >= startOfToday)
                && (selectedFilter === 'Todos' || p.categoria === selectedFilter)
                && (p.titulo || '').toLowerCase().includes(search.toLowerCase())
                && (zoneFilter.trim() === '' || (p.nombre_ubicacion || '').toLowerCase().includes(zoneFilter.trim().toLowerCase()))
                && matchesDate(p)
            )
            .sort((a, b) => {
                const am = isMinePlan(a) ? 0 : 1;
                const bm = isMinePlan(b) ? 0 : 1;
                if (am !== bm) return am - bm;
                const ad = a.fecha_evento ? new Date(a.fecha_evento).getTime() : Infinity;
                const bd = b.fecha_evento ? new Date(b.fecha_evento).getTime() : Infinity;
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
                    <LangPicker lang={lang} onChange={setLang} compact />
                    <TouchableOpacity
                        style={styles.profileBtn}
                        onPress={() => router.push('/profile')}
                    >
                        <View style={styles.profileAvatarWrap}>
                            <ProfileAvatar uri={avatarUrl} name="U" size={44} recyclingKey={currentUserId ?? undefined} />
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
                    style={[styles.quickFilterPill, styles.quickFilterBox, zoneFilter ? styles.quickFilterActive : null]}
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
                    style={[styles.quickFilterPill, styles.quickFilterBox, dateFilter !== 'all' ? styles.quickFilterActive : null]}
                    onPress={() => setShowDateModal(true)}
                >
                    <Ionicons name="calendar" size={15} color={dateFilter !== 'all' ? '#FFF' : PRIMARY_DARK} />
                    <Text style={[styles.quickFilterText, dateFilter !== 'all' ? { color: '#FFF' } : null]} numberOfLines={1}>
                        {dateFilter !== 'all' ? activeDateLabel : t('feed.date')}
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.quickFilterPill, styles.quickFilterBox, selectedFilter !== 'Todos' ? styles.quickFilterActive : null]}
                    onPress={() => setShowCategoryModal(true)}
                >
                    <Ionicons name="grid" size={15} color={selectedFilter !== 'Todos' ? '#FFF' : PRIMARY_DARK} />
                    <Text style={[styles.quickFilterText, selectedFilter !== 'Todos' ? { color: '#FFF' } : null]} numberOfLines={1}>
                        {selectedFilter !== 'Todos' ? t('cat.' + selectedFilter) : t('feed.category')}
                    </Text>
                </TouchableOpacity>
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
                            friendIds={friendIds}
                            onJoin={handleJoin}
                            onLeave={handleLeave}
                            onDelete={handleDeletePlan}
                            onEdit={handleEditPlan}
                            onToggleSave={handleSave}
                            onReport={currentUserId ? handleReportPlan : undefined}
                            router={router}
                        />
                    )}
                />
            )}

            <View style={styles.floatingBar}>
                <TouchableOpacity style={styles.floatingBtn} onPress={() => router.push('/chats')} activeOpacity={0.9}>
                    <Ionicons name="chatbubbles" size={24} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.floatingBtnCenter} onPress={() => router.push('/search-profiles')} activeOpacity={0.9}>
                    <Ionicons name="search" size={24} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.floatingBtn} onPress={() => router.push('/create-plan')} activeOpacity={0.9}>
                    <LinearGradient colors={[PRIMARY, PRIMARY_DARK]} style={styles.floatingBtnGradient}>
                        <Ionicons name="add" size={28} color="#fff" />
                    </LinearGradient>
                </TouchableOpacity>
            </View>

            <Modal visible={showCategoryModal} transparent animationType="fade" onRequestClose={() => setShowCategoryModal(false)}>
                <Pressable style={styles.modalOverlay} onPress={() => setShowCategoryModal(false)}>
                    <Pressable style={styles.modalSheet}>
                        <Text style={styles.modalTitle}>{t('feed.filterCategoryTitle')}</Text>
                        {CATEGORY_FILTER_OPTIONS.map((cat) => {
                            const active = selectedFilter === cat;
                            return (
                                <TouchableOpacity
                                    key={cat}
                                    style={[styles.dateOption, active && styles.dateOptionActive]}
                                    onPress={() => { setSelectedFilter(cat); setShowCategoryModal(false); }}
                                >
                                    <View style={styles.categoryOptionRow}>
                                        <Ionicons name={CATEGORY_ICONS[cat] || 'apps'} size={18} color={active ? PRIMARY_DARK : '#64748B'} />
                                        <Text style={[styles.dateOptionText, active && { color: PRIMARY_DARK, fontWeight: '800' }]}>{t('cat.' + cat)}</Text>
                                    </View>
                                    {active && <Ionicons name="checkmark-circle" size={20} color={PRIMARY_DARK} />}
                                </TouchableOpacity>
                            );
                        })}
                    </Pressable>
                </Pressable>
            </Modal>

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
    searchWrapper: { paddingHorizontal: 24, marginBottom: 12 },
    searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', paddingHorizontal: 16, paddingVertical: 14, borderRadius: 18, elevation: 3, shadowColor: PRIMARY_DARK, shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
    searchInput: { marginLeft: 10, flex: 1, fontSize: 16, color: INK },

    quickFiltersRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 24, marginBottom: 12 },
    quickFilterPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFF', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: '#E3ECFB' },
    quickFilterBox: { flex: 1, justifyContent: 'center' },
    quickFilterActive: { backgroundColor: PRIMARY_DARK, borderColor: PRIMARY_DARK },
    quickFilterText: { color: PRIMARY_DARK, fontWeight: '700', fontSize: 12, flexShrink: 1 },

    listContent: { paddingHorizontal: 20, paddingBottom: 130, paddingTop: 6 },

    emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 60, paddingHorizontal: 20 },
    emptyIconWrap: { width: 110, height: 110, borderRadius: 55, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', elevation: 4, shadowColor: PRIMARY_DARK, shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: INK, textAlign: 'center', marginTop: 22 },
    emptySubtitle: { fontSize: 14, color: '#64748B', textAlign: 'center', marginTop: 8 },
    createBtnEmpty: { marginTop: 22, backgroundColor: PRIMARY_DARK, paddingHorizontal: 22, paddingVertical: 13, borderRadius: 16 },
    createBtnEmptyText: { color: '#FFF', fontWeight: '700' },

    floatingBar: {
        position: 'absolute',
        bottom: 28,
        left: 24,
        right: 24,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: INK,
        borderRadius: 22,
        paddingVertical: 10,
        paddingHorizontal: 16,
        elevation: 14,
        shadowColor: INK,
        shadowOpacity: 0.35,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
    },
    floatingBtn: {
        width: 52,
        height: 52,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
    },
    floatingBtnCenter: {
        width: 52,
        height: 52,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.12)',
    },
    floatingBtnGradient: {
        width: 52,
        height: 52,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
    },
    categoryOptionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },

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

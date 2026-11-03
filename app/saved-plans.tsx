import {
    Ionicons
} from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, {
    useCallback,
    useRef,
    useState
} from 'react';
import {
    ActivityIndicator,
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { PlanCard, type Membership } from '../components/PlanCard';
import { useListScrollRestore } from '../hooks/useListScrollRestore';
import { getAuthUser } from '../lib/auth';
import { useAuthSession } from '../lib/authSession';
import { deletePlanCompletely } from '../lib/deletePlan';
import { attachFeedPlanPeople } from '../lib/feedQuery';
import { useT } from '../lib/i18n';
import { FLASH_LIST_DRAW_DISTANCE } from '../lib/listConfig';
import { broadcastPlanMembership } from '../lib/membershipBroadcast';
import { Alert } from '../lib/nexoAlert';
import { persistJoinWithWaitlistFallback, persistLeave, subscribeSaveState } from '../lib/offlineActions';
import { peekViewerIsOrganizer, rememberViewerIsOrganizer } from '../lib/organizer';
import {
    canJoinWaitlist,
    mapEstadoToMembership,
    membershipFromJoinEstado,
    promoteWaitlist,
    resolveJoinEstado,
} from '../lib/participants';
import { isPlanActiveForSaved, purgePastSavedPlansForUser, runPlanLifecycleMaintenance } from '../lib/planLifecycle';
import { canJoinMorePlans, countLocalActivePlans, MAX_ACTIVE_PLANS } from '../lib/planLimits';
import { getMyProfile } from '../lib/profileData';
import type { Genero } from '../lib/profileFields';
import { screenCacheKey, ScreenCacheTTL } from '../lib/screenCaches';
import { ScreenKeys } from '../lib/screenState';
import { canJoinPlanByGender } from '../lib/soloChicas';
import { wasKickedFromPlan } from '../lib/planKicks';
import { supabase } from '../lib/supabase';
import { cacheGetStale, cacheSet } from '../lib/ttlCache';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const BG_TOP = '#DCEBFF';
const BG_BOTTOM = '#F2F7FF';

type SavedPlansSnapshot = {
    savedPlans: any[];
    membershipMap: Record<string, Membership>;
    currentUserGenero: Genero | null;
};

export default function SavedPlansScreen() {
    const router = useRouter();
    const { t } = useT();
    const { userId: sessionUserId } = useAuthSession();
    const cachedSaved = sessionUserId
        ? cacheGetStale<SavedPlansSnapshot>(screenCacheKey.savedPlans(sessionUserId))
        : null;
    const upcomingCached = (cachedSaved?.savedPlans ?? []).filter((p) => isPlanActiveForSaved(p));
    const [loading, setLoading] = useState(() => !cachedSaved);
    const [savedPlans, setSavedPlans] = useState<any[]>(() => upcomingCached);
    const [membershipMap, setMembershipMap] = useState<Record<string, Membership>>(
        () => cachedSaved?.membershipMap ?? {},
    );
    const [currentUserId, setCurrentUserId] = useState<string | null>(sessionUserId);
    const [currentUserGenero, setCurrentUserGenero] = useState<Genero | null>(
        () => cachedSaved?.currentUserGenero ?? null,
    );
    const [isOrganizerAccount, setIsOrganizerAccount] = useState(() => peekViewerIsOrganizer());
    const { listRef, onScroll, scrollEventThrottle } = useListScrollRestore(ScreenKeys.SAVED_PLANS);
    const hasDataRef = useRef(!!cachedSaved);
    const fetchGenRef = useRef(0);
    const joiningRef = useRef(false);

    // Sincronizar estado de corazón desde feed / pantalla de detalle
    React.useEffect(() => {
        const saveUnsub = subscribeSaveState((evt) => {
            setSavedPlans((prev) => {
                if (evt.saved) {
                    // Añadir solo si ya tenemos el plan en lista; si no, el focus refetch lo trae.
                    return prev;
                }
                return prev.filter((p) => String(p.id) !== evt.planId);
            });
            if (!evt.saved && sessionUserId) {
                const cacheKey = screenCacheKey.savedPlans(sessionUserId);
                const cached = cacheGetStale<SavedPlansSnapshot>(cacheKey);
                if (cached?.savedPlans) {
                    cacheSet(
                        cacheKey,
                        {
                            ...cached,
                            savedPlans: cached.savedPlans.filter((p) => String(p.id) !== evt.planId),
                        },
                        ScreenCacheTTL.savedPlans,
                    );
                }
            }
        });
        return saveUnsub;
    }, [sessionUserId]);

    const fetchSavedData = useCallback(async () => {
        const gen = ++fetchGenRef.current;
        try {
            const userId = sessionUserId ?? (await getAuthUser())?.id ?? null;
            if (!userId) return;
            if (gen !== fetchGenRef.current) return;
            setCurrentUserId(userId);

            const cacheKey = screenCacheKey.savedPlans(userId);
            const cached = cacheGetStale<SavedPlansSnapshot>(cacheKey);
            if (cached && !hasDataRef.current) {
                const upcoming = (cached.savedPlans ?? []).filter((p) => isPlanActiveForSaved(p));
                setSavedPlans(upcoming);
                setMembershipMap(cached.membershipMap);
                setCurrentUserGenero(cached.currentUserGenero);
                hasDataRef.current = upcoming.length > 0;
                if (upcoming.length > 0) setLoading(false);
            } else if (!hasDataRef.current) {
                setLoading(true);
            }

            const { data: myProfile } = await getMyProfile();
            if (gen !== fetchGenRef.current) return;
            const nextGenero = (myProfile?.genero as Genero) ?? null;
            setCurrentUserGenero(nextGenero);
            setIsOrganizerAccount(myProfile?.es_organizador === true);
            rememberViewerIsOrganizer(myProfile?.es_organizador === true);

            void runPlanLifecycleMaintenance();
            await purgePastSavedPlansForUser(userId);
            if (gen !== fetchGenRef.current) return;

            const { data: savedData } = await supabase
                .from('planes_guardados')
                .select('plan_id, planes (*)')
                .eq('usuario_id', userId);

            const { data: joinedData } = await supabase
                .from('participantes')
                .select('plan_id, estado')
                .eq('usuario_id', userId);

            if (gen !== fetchGenRef.current) return;

            const rawPlans = (savedData || [])
                .map((s: any) => s.planes)
                .filter(Boolean)
                .filter((plan: any) => isPlanActiveForSaved(plan));

            const formatted = await attachFeedPlanPeople(rawPlans, { keepNonFeed: true });

            setSavedPlans(formatted);
            hasDataRef.current = true;

            const map: Record<string, Membership> = {};
            (joinedData || []).forEach((p: any) => {
                const m = mapEstadoToMembership(p.estado);
                if (m) map[p.plan_id] = m;
            });
            setMembershipMap(map);

            cacheSet(cacheKey, {
                savedPlans: formatted,
                membershipMap: map,
                currentUserGenero: nextGenero,
            } satisfies SavedPlansSnapshot, ScreenCacheTTL.savedPlans);
        } catch (error) {
            if (__DEV__) console.error(error);
        } finally {
            if (gen === fetchGenRef.current) setLoading(false);
        }
    }, [sessionUserId]);

    useFocusEffect(
        useCallback(() => {
            void fetchSavedData();
        }, [fetchSavedData]),
    );

    const joinErrorCopy = (error: { message?: string } | null | undefined) => {
        const msg = String(error?.message || '');
        if (msg.includes('organizer_cannot_join')) return t('organizer.cannotJoin');
        if (msg.includes('solo_chicas')) return t('card.soloChicasOnly');
        if (msg.includes('friends_only')) return t('feed.joinError');
        if (msg.includes('plan_private') || msg.includes('invite_required')) return t('feed.joinError');
        if (msg.includes('plan_full')) return t('feed.joinError');
        return t('feed.joinError');
    };

    const handleJoin = async (planId: string) => {
        if (!currentUserId || joiningRef.current) return;
        if (isOrganizerAccount) {
            Alert.alert(t('feed.error'), t('organizer.cannotJoin'));
            return;
        }
        const plan = savedPlans.find(p => p.id === planId);
        if (!plan) return;

        if (!canJoinPlanByGender(plan, currentUserGenero)) {
            Alert.alert(t('feed.error'), t('card.soloChicasOnly'));
            return;
        }

        if (await wasKickedFromPlan(planId, currentUserId)) {
            Alert.alert(t('feed.error'), t('plan.kickedCannotJoin'));
            return;
        }

        const existingMembership = membershipMap[planId];
        const alreadyIn =
            existingMembership === 'joined' ||
            existingMembership === 'requested' ||
            existingMembership === 'waitlist';
        if (!alreadyIn) {
            const localCount = countLocalActivePlans(currentUserId, savedPlans, membershipMap);
            if (localCount >= MAX_ACTIVE_PLANS) {
                const limitCheck = await canJoinMorePlans(currentUserId, planId);
                if (!limitCheck.allowed) {
                    Alert.alert(
                        t('feed.error'),
                        limitCheck.reason === 'organizer'
                            ? t('organizer.cannotJoin')
                            : t('feed.planLimitReached', { max: limitCheck.max }),
                    );
                    return;
                }
            }
        }

        joiningRef.current = true;
        const estado = resolveJoinEstado({
            requiere_aprobacion: plan.requiere_aprobacion,
            maximo_participantes: plan.maximo_participantes,
            joinedCount: plan.joinedCount,
        });
        const nextMembership = membershipFromJoinEstado(estado);
        const prevMap = membershipMap;
        const prevPlans = savedPlans;
        setMembershipMap(prev => ({ ...prev, [planId]: nextMembership }));
        if (estado === 'aceptado') {
            setSavedPlans(prev => prev.map(p => p.id === planId ? { ...p, joinedCount: p.joinedCount + 1 } : p));
        }
        try {
            const { queued, error, estado: applied } = await persistJoinWithWaitlistFallback(
                {
                    planId,
                    userId: currentUserId,
                    estado,
                    planTitle: plan.titulo,
                    fechaEvento: plan.fecha_evento,
                    categoria: plan.categoria,
                    locationName: plan.nombre_ubicacion,
                },
                canJoinWaitlist(plan.fecha_evento),
            );
            if (error) {
                setMembershipMap(prevMap);
                setSavedPlans(prevPlans);
                Alert.alert(t('feed.error'), joinErrorCopy(error));
                return;
            }
            if (applied === 'lista_espera' && estado === 'aceptado') {
                setMembershipMap((prev) => ({ ...prev, [planId]: 'waitlist' }));
                setSavedPlans(prevPlans);
                Alert.alert(t('feed.joinedWaitlist'));
            }
            const finalMembership: Membership =
                applied === 'lista_espera'
                    ? 'waitlist'
                    : applied === 'pendiente'
                      ? 'requested'
                      : nextMembership;
            broadcastPlanMembership(planId, finalMembership, {
                userId: currentUserId,
                bumpJoined: finalMembership === 'joined',
                clearInvite: true,
            });
            if (!queued) {
                const { notifyPlanJoin, schedulePlanLifecycleReminders } = await import('../lib/push');
                notifyPlanJoin(planId, applied);
                if (applied === 'aceptado') {
                    void schedulePlanLifecycleReminders({
                        planId,
                        planTitle: plan.titulo,
                        fechaEvento: plan.fecha_evento,
                        categoria: plan.categoria,
                    });
                }
            }
        } finally {
            joiningRef.current = false;
        }
    };

    const handleLeave = async (planId: string) => {
        if (!currentUserId) return;
        const membership = membershipMap[planId];
        const wasJoined = membership === 'joined';
        const wasWaitlist = membership === 'waitlist';
        Alert.alert(
            wasJoined ? t('saved.leave') : wasWaitlist ? t('card.leaveWaitlistTitle') : t('saved.cancelRequest'),
            wasJoined ? t('saved.leaveConfirm') : wasWaitlist ? t('card.leaveWaitlistMsg') : t('saved.cancelRequestConfirm'),
            [
            { text: t('common.no') },
            { text: t('common.yes'), onPress: async () => {
                const prevMap = membershipMap;
                const prevPlans = savedPlans;
                setMembershipMap(prev => { const n = { ...prev }; delete n[planId]; return n; });
                if (wasJoined) setSavedPlans(prev => prev.map(p => p.id === planId ? { ...p, joinedCount: Math.max(0, p.joinedCount - 1) } : p));
                const { queued, error } = await persistLeave(planId, currentUserId, wasJoined);
                if (error) {
                    setMembershipMap(prevMap);
                    setSavedPlans(prevPlans);
                    Alert.alert(t('feed.error'), t('feed.leaveError'));
                    return;
                }
                broadcastPlanMembership(planId, 'none', {
                    userId: currentUserId,
                    dropJoined: wasJoined,
                });
                if (wasJoined && !queued) {
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
            {
                text: t('common.delete'),
                style: 'destructive',
                // No async aquí: en Android el Alert espera el Promise y se queda abierto.
                onPress: () => {
                    setSavedPlans((prev) => prev.filter((p) => p.id !== planId));
                    setTimeout(() => {
                        void deletePlanCompletely(planId);
                    }, 0);
                },
            },
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

            <View style={{ flex: 1 }}>
                <FlashList
                    ref={listRef}
                    style={{ flex: 1 }}
                    data={savedPlans}
                    keyExtractor={(item) => item.id}
                    showsVerticalScrollIndicator={false}
                    onScroll={onScroll}
                    scrollEventThrottle={scrollEventThrottle}
                    drawDistance={FLASH_LIST_DRAW_DISTANCE}
                    renderItem={({ item, index }) => (
                        <PlanCard
                            item={item}
                            index={index}
                            currentUserId={currentUserId}
                            userGenero={currentUserGenero}
                            membership={membershipMap[item.id] || 'none'}
                            isSaved={true}
                            viewerIsOrganizer={isOrganizerAccount}
                            onJoin={handleJoin}
                            onLeave={handleLeave}
                            onDelete={handleDelete}
                            onEdit={handleEdit}
                            onToggleSave={handleRemove}
                            onOpenDetail={(planId) => router.push({ pathname: '/plan/[id]', params: { id: planId } })}
                            router={router}
                        />
                    )}
                    contentContainerStyle={styles.list}
                    ListEmptyComponent={
                        !loading ? (
                        <View style={styles.center}>
                            <View style={styles.emptyIconWrap}>
                                <Ionicons name="bookmark-outline" size={48} color={PRIMARY} />
                            </View>
                            <Text style={styles.emptyTitle}>{t('saved.empty')}</Text>
                            <TouchableOpacity style={styles.exploreBtn} onPress={() => router.navigate('/')}>
                                <Text style={styles.exploreBtnText}>{t('saved.explore')}</Text>
                            </TouchableOpacity>
                        </View>
                        ) : null
                    }
                />
                {loading && savedPlans.length === 0 ? (
                    <ActivityIndicator style={{ position: 'absolute', alignSelf: 'center', top: 80 }} color={PRIMARY_DARK} />
                ) : null}
            </View>
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

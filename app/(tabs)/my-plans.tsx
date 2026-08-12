import {
    Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import {
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react';
import { FlashList } from '@shopify/flash-list';
import {
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Alert } from '../../lib/nexoAlert';
import { PlanImage } from '../../components/PlanImage';
import { ProfileAvatar } from '../../components/ProfileAvatar';
import { MyPlansSkeletonList } from '../../components/SkeletonShimmer';
import { useListScrollRestore } from '../../hooks/useListScrollRestore';
import { prefetchPlanDetail, seedPlanDetailFromFeed } from '../../lib/planDetailCache';
import { isFeedPlan } from '../../lib/feedPlans';
import { useT } from '../../lib/i18n';
import { FLASH_LIST_DRAW_DISTANCE } from '../../lib/listConfig';
import { getAuthUser } from '../../lib/auth';
import { getPlanJoinRequestCount, invalidateProfileNotificationCount } from '../../lib/notifications';
import { hapticLight, hapticSelection, hapticSuccess } from '../../lib/haptics';
import { isAcceptedParticipant } from '../../lib/participants';
import { type Genero } from '../../lib/profileFields';
import { getDismissedPlanIdSet, getOpenRatingPlanMap, type PendingRatingPlan } from '../../lib/ratings';
import { getHiddenPlanIdSet } from '../../lib/myPlansHide';
import { ScreenKeys } from '../../lib/screenState';
import { resolvePlanImageSource } from '../../lib/sports';
import { diskSet } from '../../lib/diskCache';
import { screenCacheKey, ScreenCacheTTL } from '../../lib/screenCaches';
import { cacheGetStale, cacheIsFresh, cacheSet } from '../../lib/ttlCache';
import { getMyProfile } from '../../lib/profileData';
import { supabase } from '../../lib/supabase';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const SUCCESS = '#22C55E';
const DANGER = '#EF4444';
const MUTED = '#64748B';
const GOLD = '#B45309';
const GOLD_BG = '#FEF3C7';
const GOLD_BORDER = '#FCD34D';

type PlanItem = {
    id: string;
    titulo: string;
    imagen_url: string | null;
    maximo_participantes: number;
    fecha_evento: string | null;
    creador_id: string;
    joinedCount: number;
    pending: { id: string; nombre?: string; avatar_url?: string | null }[];
    role: 'creator' | 'member';
    isPast: boolean;
};

export default function MyPlansScreen() {
    const router = useRouter();
    const { t, lang } = useT();
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [plans, setPlans] = useState<PlanItem[]>([]);
    const [pendingCount, setPendingCount] = useState(0);
    const [ratingByPlan, setRatingByPlan] = useState<Record<string, PendingRatingPlan>>({});
    const [userGenero, setUserGenero] = useState<Genero | null>(null);
    const hasDataRef = useRef(false);
    const fetchGenRef = useRef(0);
    const didSessionLoadRef = useRef(false);
    const { listRef, onScroll, scrollEventThrottle } = useListScrollRestore<PlanItem>(ScreenKeys.MY_PLANS);

    useEffect(() => {
        void getAuthUser().then((user) => {
            if (!user) return;
            const cached = cacheGetStale<{
                plans: PlanItem[];
                pendingCount: number;
                ratingByPlan: Record<string, PendingRatingPlan>;
            }>(screenCacheKey.myPlans(user.id));
            if (cached && !hasDataRef.current) {
                setPlans(cached.plans ?? []);
                setPendingCount(cached.pendingCount ?? 0);
                setRatingByPlan(cached.ratingByPlan ?? {});
                hasDataRef.current = true;
                setLoading(false);
            }
        });
    }, []);

    const locale = lang === 'en' ? 'en-GB' : 'es-ES';

    const fetchMyPlans = useCallback(async (opts?: { force?: boolean }) => {
        const gen = ++fetchGenRef.current;
        try {
            const user = await getAuthUser();
            if (!user) { router.replace('/login'); return; }

            const cacheKey = screenCacheKey.myPlans(user.id);
            const cached = cacheGetStale<{
                plans: PlanItem[];
                pendingCount: number;
                ratingByPlan: Record<string, PendingRatingPlan>;
            }>(cacheKey);
            if (cached && !hasDataRef.current) {
                setPlans(cached.plans ?? []);
                setPendingCount(cached.pendingCount ?? 0);
                setRatingByPlan(cached.ratingByPlan ?? {});
                hasDataRef.current = true;
                setLoading(false);
            } else if (!hasDataRef.current) {
                setLoading(true);
            }

            if (!opts?.force && cacheIsFresh(cacheKey) && hasDataRef.current) {
                setLoading(false);
                return;
            }

            const now = Date.now();
            const planCols = 'id, titulo, imagen_url, categoria, maximo_participantes, fecha_evento, creador_id';

            const [myProfileRes, pending, openRatings, createdRes, joinedRes] = await Promise.all([
                getMyProfile(),
                getPlanJoinRequestCount(user.id),
                getOpenRatingPlanMap(user.id),
                // Sin perfiles anidados: solo ids/estado; perfiles solo para pendientes.
                supabase
                    .from('planes')
                    .select(`${planCols}, participantes(usuario_id, estado)`)
                    .eq('creador_id', user.id)
                    .order('fecha_evento', { ascending: true }),
                supabase
                    .from('participantes')
                    .select(`
                        plan_id,
                        planes (
                            ${planCols},
                            participantes ( usuario_id, estado )
                        )
                    `)
                    .eq('usuario_id', user.id)
                    .eq('estado', 'aceptado'),
            ]);
            if (gen !== fetchGenRef.current) return;

            setUserGenero((myProfileRes.data?.genero as Genero) ?? null);
            setPendingCount(pending);
            setRatingByPlan(openRatings);

            const pendingUserIds = new Set<string>();
            const collectPendingIds = (parts: { usuario_id: string; estado: string }[]) => {
                for (const x of parts) {
                    if (x.estado === 'pendiente' && x.usuario_id !== user.id) {
                        pendingUserIds.add(x.usuario_id);
                    }
                }
            };

            for (const p of createdRes.data || []) {
                collectPendingIds((p.participantes || []) as { usuario_id: string; estado: string }[]);
            }

            const pendingProfiles = new Map<string, { id: string; nombre?: string; avatar_url?: string | null }>();
            if (pendingUserIds.size > 0) {
                const { data: profiles } = await supabase
                    .from('perfiles')
                    .select('id, nombre, avatar_url')
                    .in('id', [...pendingUserIds]);
                for (const pr of profiles ?? []) {
                    pendingProfiles.set(pr.id, {
                        id: pr.id,
                        nombre: pr.nombre ?? undefined,
                        avatar_url: pr.avatar_url,
                    });
                }
            }
            if (gen !== fetchGenRef.current) return;

            const formatPlan = (p: any, role: 'creator' | 'member'): PlanItem | null => {
                if (!p || !isFeedPlan(p)) return null;
                const parts = (p.participantes || []) as { usuario_id: string; estado: string }[];
                const accepted = parts.filter((x) => isAcceptedParticipant(x.estado));
                const pendingReqs = role === 'creator'
                    ? parts
                        .filter((x) => x.estado === 'pendiente' && x.usuario_id !== user.id)
                        .map((x) => pendingProfiles.get(x.usuario_id) ?? { id: x.usuario_id })
                    : [];
                const eventMs = p.fecha_evento ? new Date(p.fecha_evento).getTime() : 0;
                return {
                    id: p.id,
                    titulo: p.titulo,
                    imagen_url: p.imagen_url,
                    maximo_participantes: p.maximo_participantes,
                    fecha_evento: p.fecha_evento,
                    creador_id: p.creador_id,
                    joinedCount: accepted.length,
                    pending: pendingReqs,
                    role,
                    isPast: !!p.fecha_evento && eventMs < now,
                };
            };

            const byId = new Map<string, PlanItem>();

            for (const p of createdRes.data || []) {
                const formatted = formatPlan(p, 'creator');
                if (formatted) byId.set(formatted.id, formatted);
            }

            for (const row of joinedRes.data || []) {
                const raw = row.planes;
                const plan = Array.isArray(raw) ? raw[0] : raw;
                if (!plan || plan.creador_id === user.id) continue;
                const formatted = formatPlan(plan, 'member');
                if (formatted) byId.set(formatted.id, formatted);
            }

            const all = Array.from(byId.values());
            const pastIds = all.filter((p) => p.isPast).map((p) => p.id);
            const [dismissed, hidden] = await Promise.all([
                getDismissedPlanIdSet(user.id, pastIds),
                getHiddenPlanIdSet(user.id, pastIds),
            ]);
            if (gen !== fetchGenRef.current) return;

            const visible = all.filter((p) => !p.isPast || (!dismissed.has(p.id) && !hidden.has(p.id)));
            const upcoming = visible
                .filter((p) => !p.isPast)
                .sort((a, b) => {
                    const da = a.fecha_evento ? new Date(a.fecha_evento).getTime() : 0;
                    const db = b.fecha_evento ? new Date(b.fecha_evento).getTime() : 0;
                    return da - db;
                });
            const past = visible
                .filter((p) => p.isPast)
                .sort((a, b) => {
                    const da = a.fecha_evento ? new Date(a.fecha_evento).getTime() : 0;
                    const db = b.fecha_evento ? new Date(b.fecha_evento).getTime() : 0;
                    return db - da;
                });

            const merged = [...upcoming, ...past];
            setPlans(merged);
            hasDataRef.current = true;
            const snap = {
                plans: merged,
                pendingCount: pending,
                ratingByPlan: openRatings,
            };
            cacheSet(cacheKey, snap, ScreenCacheTTL.myPlans);
            void diskSet(cacheKey, snap);
            setLoadError(false);
        } catch (e) {
            if (__DEV__) console.error(e);
            if (!hasDataRef.current) setLoadError(true);
        } finally {
            if (gen === fetchGenRef.current) setLoading(false);
        }
    }, [router]);

    useFocusEffect(
        useCallback(() => {
            // Siempre forzar red: unirse / aceptación del host deja la caché desfasada.
            if (!didSessionLoadRef.current) {
                didSessionLoadRef.current = true;
            }
            void fetchMyPlans({ force: true });
        }, [fetchMyPlans]),
    );

    const handleAccept = (planId: string, userId: string) => {
        const plan = plans.find((p) => p.id === planId);
        if (!plan) return;
        if (plan.joinedCount >= plan.maximo_participantes) {
            Alert.alert(t('profile.error'), t('myplans.full'));
            return;
        }
        hapticSuccess();

        let snapshot: PlanItem | undefined;
        setPlans((prev) =>
            prev.map((p) => {
                if (p.id !== planId) return p;
                snapshot = p;
                return {
                    ...p,
                    pending: p.pending.filter((u) => u.id !== userId),
                    joinedCount: p.joinedCount + 1,
                };
            }),
        );
        setPendingCount((c) => Math.max(0, c - 1));

        void (async () => {
            const { count, error: countError } = await supabase
                .from('participantes')
                .select('id', { count: 'exact', head: true })
                .eq('plan_id', planId)
                .eq('estado', 'aceptado');

            if (countError) {
                if (snapshot) {
                    setPlans((prev) => prev.map((p) => (p.id === planId ? snapshot! : p)));
                    setPendingCount((c) => c + 1);
                }
                Alert.alert(t('profile.error'), countError.message);
                return;
            }

            if ((count ?? 0) >= plan.maximo_participantes) {
                if (snapshot) {
                    setPlans((prev) => prev.map((p) => (p.id === planId ? snapshot! : p)));
                    setPendingCount((c) => c + 1);
                }
                Alert.alert(t('profile.error'), t('myplans.full'));
                return;
            }

            const { error } = await supabase
                .from('participantes')
                .update({ estado: 'aceptado' })
                .eq('plan_id', planId)
                .eq('usuario_id', userId)
                .eq('estado', 'pendiente');

            if (error) {
                if (snapshot) {
                    setPlans((prev) => prev.map((p) => (p.id === planId ? snapshot! : p)));
                    setPendingCount((c) => c + 1);
                }
                const msg = error.message || '';
                Alert.alert(
                    t('profile.error'),
                    msg.includes('plan_full') || msg.includes('active_plan_limit')
                        ? t('myplans.full')
                        : msg.includes('policy') || msg.includes('RLS')
                          ? t('myplans.rlsHint')
                          : msg,
                );
                return;
            }
            void import('../../lib/push').then(({ notifyPlanJoinDecision }) => {
                notifyPlanJoinDecision(planId, userId, true);
            });
            void getAuthUser().then((u) => {
                if (u) invalidateProfileNotificationCount(u.id);
            });
        })();
    };

    const handleReject = (planId: string, userId: string) => {
        hapticLight();
        let snapshot: PlanItem | undefined;
        setPlans((prev) =>
            prev.map((p) => {
                if (p.id !== planId) return p;
                snapshot = p;
                return {
                    ...p,
                    pending: p.pending.filter((u) => u.id !== userId),
                };
            }),
        );
        setPendingCount((c) => Math.max(0, c - 1));

        void supabase
            .from('participantes')
            .delete()
            .eq('plan_id', planId)
            .eq('usuario_id', userId)
            .then(({ error }) => {
                if (error) {
                    if (snapshot) {
                        setPlans((prev) => prev.map((p) => (p.id === planId ? snapshot! : p)));
                        setPendingCount((c) => c + 1);
                    }
                    Alert.alert(t('profile.error'), error.message);
                    return;
                }
                void import('../../lib/push').then(({ notifyPlanJoinDecision }) => {
                    notifyPlanJoinDecision(planId, userId, false);
                });
                void getAuthUser().then((u) => {
                    if (u) invalidateProfileNotificationCount(u.id);
                });
            });
    };

    const formatDate = (iso: string | null) => {
        if (!iso) return '';
        return new Date(iso).toLocaleDateString(locale, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const renderPlan = ({ item, index }: { item: PlanItem; index: number }) => {
        const isFull = item.joinedCount >= item.maximo_participantes;
        const isCreator = item.role === 'creator';
        const showPastHeader = item.isPast && (index === 0 || !plans[index - 1]?.isPast);
        const showUpcomingHeader = !item.isPast && index === 0;
        const rating = ratingByPlan[item.id];
        const ratedDone = rating ? rating.totalPeers - rating.pendingCount : 0;

        return (
            <View>
                {showUpcomingHeader ? (
                    <Text style={styles.sectionLabel}>{t('myplans.upcoming')}</Text>
                ) : null}
                {showPastHeader ? (
                    <Text style={[styles.sectionLabel, index > 0 && { marginTop: 8 }]}>
                        {t('myplans.past')}
                    </Text>
                ) : null}
                <TouchableOpacity
                    style={[styles.card, item.isPast && styles.cardPast]}
                    activeOpacity={0.88}
                    onPress={() => {
                        hapticSelection();
                        seedPlanDetailFromFeed(item as unknown as Record<string, unknown>);
                        prefetchPlanDetail(item.id);
                        router.push(`/plan/${item.id}`);
                    }}
                >
                    <View style={styles.cardHeader}>
                        <PlanImage
                            source={resolvePlanImageSource(item.imagen_url)}
                            style={styles.thumb}
                            recyclingKey={String(item.id)}
                        />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.cardTitle} numberOfLines={1}>{item.titulo}</Text>
                            {item.fecha_evento ? (
                                <Text style={styles.dateText}>{formatDate(item.fecha_evento)}</Text>
                            ) : null}
                            <View style={styles.countRow}>
                                <Ionicons name="people" size={14} color={isFull ? '#B8860B' : PRIMARY_DARK} />
                                <Text style={[styles.countText, isFull && { color: '#B8860B' }]}>
                                    {item.joinedCount}/{item.maximo_participantes}
                                </Text>
                                {!item.isPast && !isCreator ? (
                                    <View style={styles.memberTag}>
                                        <Text style={styles.memberTagText}>
                                            {t(userGenero === 'femenino' ? 'myplans.joinedF' : 'myplans.joined')}
                                        </Text>
                                    </View>
                                ) : null}
                            </View>
                            {rating ? (
                                <TouchableOpacity
                                    style={styles.rateChip}
                                    onPress={(e) => {
                                        e.stopPropagation?.();
                                        router.push({ pathname: '/rate-plan', params: { planId: item.id } });
                                    }}
                                    activeOpacity={0.85}
                                >
                                    <Ionicons name="star" size={13} color={GOLD} />
                                    <Text style={styles.rateChipText}>
                                        {rating.pendingCount < rating.totalPeers
                                            ? t('myplans.rateProgress', {
                                                  done: ratedDone,
                                                  total: rating.totalPeers,
                                              })
                                            : t('myplans.rate')}
                                    </Text>
                                </TouchableOpacity>
                            ) : null}
                        </View>
                        {!item.isPast ? (
                            <TouchableOpacity
                                style={styles.chatBtn}
                                onPress={(e) => {
                                    e.stopPropagation?.();
                                    router.push(`/chat/${item.id}`);
                                }}
                            >
                                <Ionicons name="chatbubbles-outline" size={20} color={PRIMARY_DARK} />
                            </TouchableOpacity>
                        ) : (
                            <Ionicons name="chevron-forward" size={18} color="#CBD5E1" />
                        )}
                    </View>

                    {isCreator && !item.isPast ? (
                        <View style={styles.requestsBlock}>
                            {item.pending.length === 0 ? (
                                <Text style={styles.noRequestsText}>{t('myplans.noRequests')}</Text>
                            ) : (
                                <>
                                    <Text style={styles.requestsTitle}>
                                        {t('myplans.requests', { n: item.pending.length })}
                                    </Text>
                                    {item.pending.map((p) => {
                                        return (
                                            <View key={p.id} style={styles.requestRow}>
                                                <TouchableOpacity
                                                    style={styles.requestUser}
                                                    onPress={() =>
                                                        router.push({
                                                            pathname: '/user-profile/[id]',
                                                            params: { id: p.id },
                                                        })
                                                    }
                                                >
                                                    <View style={{ marginRight: 10 }}>
                                                        <ProfileAvatar
                                                            uri={p.avatar_url}
                                                            name={p.nombre || t('profile.user')}
                                                            size={36}
                                                            recyclingKey={p.id}
                                                        />
                                                    </View>
                                                    <View style={{ flex: 1 }}>
                                                        <Text style={styles.reqName} numberOfLines={1}>
                                                            {p.nombre || t('profile.user')}
                                                        </Text>
                                                        <Text style={styles.reqHint}>{t('myplans.viewProfile')}</Text>
                                                    </View>
                                                </TouchableOpacity>
                                                <View style={styles.reqActions}>
                                                    <TouchableOpacity
                                                        style={[
                                                            styles.reqBtn,
                                                            { backgroundColor: isFull ? '#E2E8F0' : SUCCESS },
                                                        ]}
                                                        onPress={() => !isFull && handleAccept(item.id, p.id)}
                                                        disabled={isFull}
                                                    >
                                                        <Ionicons name="checkmark" size={20} color="#FFF" />
                                                    </TouchableOpacity>
                                                    <TouchableOpacity
                                                        style={[styles.reqBtn, styles.reqReject]}
                                                        onPress={() => handleReject(item.id, p.id)}
                                                    >
                                                        <Ionicons name="close" size={20} color={DANGER} />
                                                    </TouchableOpacity>
                                                </View>
                                            </View>
                                        );
                                    })}
                                    {isFull && <Text style={styles.fullHint}>{t('myplans.full')}</Text>}
                                </>
                            )}
                        </View>
                    ) : null}
                </TouchableOpacity>
            </View>
        );
    };

    return (
            <View style={styles.container}>
                <View style={styles.pageHeader}>
                    <View style={styles.pageTitleWrap}>
                        <Text style={styles.pageTitle}>{t('myplans.title')}</Text>
                        {pendingCount > 0 && (
                            <View style={styles.headerBadge}>
                                <Text style={styles.headerBadgeText}>
                                    {pendingCount > 9 ? '9+' : pendingCount}
                                </Text>
                            </View>
                        )}
                    </View>
                </View>

                <View style={{ flex: 1 }}>
                    {loading && plans.length === 0 ? (
                        <MyPlansSkeletonList count={5} />
                    ) : (
                        <FlashList
                            ref={listRef}
                            style={{ flex: 1 }}
                            data={plans}
                            keyExtractor={(item) => item.id}
                            renderItem={renderPlan}
                            getItemType={(item) => (item.isPast ? 'past' : item.role)}
                            showsVerticalScrollIndicator={false}
                            onScroll={onScroll}
                            scrollEventThrottle={scrollEventThrottle}
                            drawDistance={FLASH_LIST_DRAW_DISTANCE}
                            contentContainerStyle={styles.list}
                            ListEmptyComponent={
                                <View style={styles.center}>
                                    <View style={styles.emptyIconWrap}>
                                        <Ionicons
                                            name={loadError ? 'cloud-offline-outline' : 'calendar-outline'}
                                            size={48}
                                            color={PRIMARY}
                                        />
                                    </View>
                                    <Text style={styles.emptyTitle}>
                                        {loadError ? t('myplans.loadError') : t('myplans.empty')}
                                    </Text>
                                    <TouchableOpacity
                                        style={styles.exploreBtn}
                                        onPress={() => {
                                            if (loadError) {
                                                setLoadError(false);
                                                void fetchMyPlans({ force: true });
                                            } else {
                                                router.push('/create-plan');
                                            }
                                        }}
                                    >
                                        <Text style={styles.exploreBtnText}>
                                            {loadError ? t('myplans.retry') : t('feed.create')}
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            }
                        />
                    )}
                </View>
            </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: 'transparent' },
    pageHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingBottom: 14,
    },
    pageTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    pageTitle: { fontSize: 22, fontWeight: '900', color: INK },
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
    list: { paddingHorizontal: 20, paddingBottom: 130, paddingTop: 6 },
    sectionLabel: {
        fontSize: 12,
        fontWeight: '800',
        color: MUTED,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        marginBottom: 10,
        marginLeft: 2,
    },
    card: {
        backgroundColor: '#FFF',
        borderRadius: 22,
        padding: 16,
        marginBottom: 16,
        elevation: 5,
        shadowColor: '#1E3A8A',
        shadowOpacity: 0.1,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 8 },
    },
    cardPast: { opacity: 0.96 },
    cardHeader: { flexDirection: 'row', alignItems: 'center' },
    thumb: { width: 54, height: 54, borderRadius: 16, backgroundColor: '#E3ECFB' },
    cardTitle: { fontSize: 16, fontWeight: '800', color: INK },
    memberTag: {
        backgroundColor: '#EFF6FF',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 8,
        marginLeft: 4,
    },
    memberTagText: { fontSize: 10, fontWeight: '800', color: PRIMARY_DARK, textTransform: 'uppercase' },
    dateText: { fontSize: 12, fontWeight: '600', color: MUTED, marginTop: 3 },
    rateChip: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        marginTop: 8,
        backgroundColor: GOLD_BG,
        borderWidth: 1,
        borderColor: GOLD_BORDER,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 10,
    },
    rateChipText: { fontSize: 12, fontWeight: '800', color: GOLD },
    countRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
    countText: { fontSize: 13, fontWeight: '700', color: PRIMARY_DARK },
    chatBtn: {
        width: 40,
        height: 40,
        borderRadius: 14,
        backgroundColor: '#EEF3FB',
        justifyContent: 'center',
        alignItems: 'center',
    },
    requestsBlock: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#EEF3FB' },
    noRequestsText: { fontSize: 13, color: '#94A3B8', fontWeight: '600' },
    requestsTitle: {
        fontSize: 12,
        fontWeight: '800',
        color: PRIMARY_DARK,
        textTransform: 'uppercase',
        letterSpacing: 0.3,
        marginBottom: 10,
    },
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
    emptyIconWrap: {
        width: 110,
        height: 110,
        borderRadius: 55,
        backgroundColor: '#FFF',
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 4,
        shadowColor: PRIMARY_DARK,
        shadowOpacity: 0.15,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        marginBottom: 20,
    },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: INK, marginBottom: 20 },
    exploreBtn: { backgroundColor: PRIMARY_DARK, paddingHorizontal: 22, paddingVertical: 14, borderRadius: 16 },
    exploreBtnText: { color: '#FFF', fontWeight: '700' },
});

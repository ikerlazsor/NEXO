import {
    Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect,
    useLocalSearchParams,
    useRouter } from 'expo-router';
import { useCallback,
    useEffect,
    useMemo,
    useRef,
    useState } from 'react';
import {
    ActivityIndicator,
    Dimensions,
    Modal,
    Platform,
    ScrollView,
    Share,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Alert } from '../../lib/nexoAlert';
import { Marker } from 'react-native-maps';
import { NexoMapView } from '../../components/NexoMapView';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useScrollViewRestore } from '../../hooks/useScrollViewRestore';
import { PlanImage } from '../../components/PlanImage';
import { ProfileAvatar } from '../../components/ProfileAvatar';
import { SportIcon } from '../../components/SportIcon';
import { InvitePeopleSheet, type InviteProfile } from '../../components/InvitePeopleSheet';
import { getAuthUser } from '../../lib/auth';
import { getCoincidedUserIds } from '../../lib/coincidences';
import { getFriends } from '../../lib/friends';
import { getPlanPendingInvitees, sendPlanInvite, cancelPlanInvite, acceptPlanInvite, rejectPlanInvite, type PlanInvite } from '../../lib/planInvites';
import {
    canJoinWaitlist,
    isAcceptedParticipant,
    mapEstadoToMembership,
    membershipFromJoinEstado,
    promoteWaitlist,
    resolveJoinEstado,
    type Membership,
} from '../../lib/participants';
import { canJoinPlanByGender } from '../../lib/soloChicas';
import { canJoinMorePlans } from '../../lib/planLimits';
import { kickParticipant } from '../../lib/kickParticipant';
import { getPersonalityLabel, type Genero } from '../../lib/profileFields';
import { distanceKm, formatDistanceKm, openDirectionsTo } from '../../lib/geo';
import { hapticError, hapticLight, hapticMedium, hapticSuccess } from '../../lib/haptics';
import { useT } from '../../lib/i18n';
import { hidePlanFromMyList } from '../../lib/myPlansHide';
import { buildPlanShareMessage } from '../../lib/shareLinks';
import { isPlanActiveForSaved, isPlanChatAlive } from '../../lib/planLifecycle';
import { renderRatingStars } from '../../lib/profileRating';
import { getOpenRatingForPlan, type PendingRatingPlan } from '../../lib/ratings';
import { EMPTY_STATS, formatRatingScore, getUserStats, type UserStats } from '../../lib/stats';
import { resolvePlanImageSource, resolvePlanSport, getPlanCategoryDisplay } from '../../lib/sports';
import { ScreenKeys } from '../../lib/screenState';
import { invalidatePlanMembershipCaches } from '../../lib/screenCaches';
import { invalidatePlanDetailCache } from '../../lib/planDetailCache';
import { cacheGetStale, cacheIsFresh, cacheSet } from '../../lib/ttlCache';
import { getWaitlistPosition } from '../../lib/waitlistPosition';
import { supabase } from '../../lib/supabase';

const { width: SCREEN_W } = Dimensions.get('window');
const HERO_H = Math.min(380, SCREEN_W * 0.92);
const PLAN_DETAIL_TTL_MS = 90_000;
const planDetailKey = (id: string) => `planDetail:${id}`;

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';
const SURFACE = '#FFFFFF';
const BORDER = '#E2E8F0';
const SUCCESS = '#22C55E';
const DANGER = '#EF4444';
const FRIEND = '#10B981';
const FRIEND_BG = '#ECFDF5';
const FRIEND_BORDER = '#6EE7B7';
const ACQUAINTANCE = '#7C3AED';
const ACQUAINTANCE_BG = '#F5F3FF';
const ACQUAINTANCE_BORDER = '#C4B5FD';
const GOLD = '#F59E0B';
const WAITLIST = '#7C3AED';

type Participant = {
    id: string;
    nombre: string;
    avatar_url?: string | null;
    isCreator?: boolean;
    ambientes_preferidos?: string[] | null;
    etiquetas?: string[] | null;
    genero?: string | null;
};

type PlanRow = {
    id: string;
    titulo: string;
    imagen_url: string | null;
    categoria: string;
    tipo_deporte: string | null;
    fecha_evento: string | null;
    nombre_ubicacion: string | null;
    latitud: number | null;
    longitud: number | null;
    maximo_participantes: number;
    creador_id: string;
    requiere_aprobacion: boolean;
    descripcion: string | null;
    solo_chicas?: boolean;
    modo_privado?: boolean;
    chat_eliminado_en?: string | null;
};

type PlanDetailSnapshot = {
    plan: PlanRow;
    participants: Participant[];
    joinedCount: number;
    creator: Participant | null;
    creatorStats: UserStats;
    membership: Membership;
    friendIds: string[];
    coincidedIds: string[];
    isSaved: boolean;
    currentUserGenero: Genero | null;
    openRating: PendingRatingPlan | null;
    currentUserId: string | null;
    /** Semilla incompleta del feed: no salta el fetch real. */
    partial?: boolean;
};

function PersonBubble({
    person,
    isFriend,
    isAcquaintance,
    subtitle,
    onPress,
    size = 64,
}: {
    person: Participant;
    isFriend: boolean;
    isAcquaintance?: boolean;
    subtitle?: string;
    onPress: () => void;
    size?: number;
}) {
    const { t, lang } = useT();
    const showAcquaintance = !!isAcquaintance && !isFriend;
    return (
        <TouchableOpacity style={styles.personBubble} activeOpacity={0.85} onPress={onPress}>
            <View
                style={[
                    styles.personAvatarRing,
                    { width: size + 8, height: size + 8, borderRadius: (size + 8) / 2 },
                    isFriend && styles.personAvatarRingFriend,
                    showAcquaintance && styles.personAvatarRingAcquaintance,
                ]}
            >
                <ProfileAvatar
                    uri={person.avatar_url}
                    name={person.nombre}
                    size={size}
                    recyclingKey={person.id}
                />
                {person.isCreator && (
                    <View style={styles.creatorStar}>
                        <Ionicons name="star" size={10} color="#FFF" />
                    </View>
                )}
            </View>
            <Text
                style={[
                    styles.personName,
                    isFriend && styles.personNameFriend,
                    showAcquaintance && styles.personNameAcquaintance,
                ]}
                numberOfLines={1}
            >
                {person.nombre || t('planDetail.anonymous')}
            </Text>
            {subtitle ? (
                <Text
                    style={[
                        styles.personSubtitle,
                        isFriend && styles.personSubtitleFriend,
                        showAcquaintance && styles.personSubtitleAcquaintance,
                    ]}
                    numberOfLines={1}
                >
                    {subtitle}
                </Text>
            ) : null}
            {isFriend ? (
                <View style={styles.friendPill}>
                    <Ionicons name="heart" size={10} color={FRIEND} />
                    <Text style={styles.friendPillText}>
                        {t(person.genero === 'femenino' ? 'planDetail.friendF' : 'planDetail.friend')}
                    </Text>
                </View>
            ) : showAcquaintance ? (
                <View style={styles.acquaintancePill}>
                    <Ionicons name="people" size={10} color={ACQUAINTANCE} />
                    <Text style={styles.acquaintancePillText}>
                        {t(
                            person.genero === 'femenino'
                                ? 'planDetail.acquaintanceF'
                                : 'planDetail.acquaintance',
                        )}
                    </Text>
                </View>
            ) : null}
        </TouchableOpacity>
    );
}

export default function PlanDetailScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { t, lang } = useT();
    const dateLocale = lang === 'en' ? 'en-GB' : 'es-ES';
    const { id, inviteId, inviterId, inviterName, inviterAvatar, inviteTipo } = useLocalSearchParams<{
        id: string | string[];
        inviteId?: string | string[];
        inviterId?: string | string[];
        inviterName?: string | string[];
        inviterAvatar?: string | string[];
        inviteTipo?: string | string[];
    }>();
    const planId = Array.isArray(id) ? id[0] : id;
    const pendingInviteId = Array.isArray(inviteId) ? inviteId[0] : inviteId;
    const pendingInviterId = Array.isArray(inviterId) ? inviterId[0] : inviterId;
    const pendingInviterName = Array.isArray(inviterName) ? inviterName[0] : inviterName;
    const pendingInviterAvatar = Array.isArray(inviterAvatar) ? inviterAvatar[0] : inviterAvatar;
    const pendingInviteTipo = (Array.isArray(inviteTipo) ? inviteTipo[0] : inviteTipo) as
        | 'plan'
        | 'grupo'
        | undefined;
    const [inviteHandled, setInviteHandled] = useState(false);
    const fromInvite = !!pendingInviteId && !inviteHandled;
    const scrollKey = planId ? `${ScreenKeys.PLAN_DETAIL}:${planId}` : ScreenKeys.PLAN_DETAIL;
    const { scrollRef, onScroll, scrollEventThrottle } = useScrollViewRestore(scrollKey);

    const cachedDetail = planId ? cacheGetStale<PlanDetailSnapshot>(planDetailKey(planId)) : null;

    const [loading, setLoading] = useState(() => !cachedDetail);
    const [plan, setPlan] = useState<PlanRow | null>(() => cachedDetail?.plan ?? null);
    const [participants, setParticipants] = useState<Participant[]>(() => cachedDetail?.participants ?? []);
    const [joinedCount, setJoinedCount] = useState(() => cachedDetail?.joinedCount ?? 0);
    const [creator, setCreator] = useState<Participant | null>(() => cachedDetail?.creator ?? null);
    const [creatorStats, setCreatorStats] = useState<UserStats>(() => cachedDetail?.creatorStats ?? EMPTY_STATS);
    const [currentUserId, setCurrentUserId] = useState<string | null>(() => cachedDetail?.currentUserId ?? null);
    const [currentUserGenero, setCurrentUserGenero] = useState<Genero | null>(
        () => cachedDetail?.currentUserGenero ?? null,
    );
    const [membership, setMembership] = useState<Membership>(() => cachedDetail?.membership ?? 'none');
    const [friendIds, setFriendIds] = useState<Set<string>>(
        () => new Set(cachedDetail?.friendIds ?? []),
    );
    const [coincidedIds, setCoincidedIds] = useState<Set<string>>(
        () => new Set(cachedDetail?.coincidedIds ?? []),
    );
    const [isSaved, setIsSaved] = useState(() => cachedDetail?.isSaved ?? false);
    const [actionBusy, setActionBusy] = useState(false);
    const [mapExpanded, setMapExpanded] = useState(false);
    const [openRating, setOpenRating] = useState<PendingRatingPlan | null>(
        () => cachedDetail?.openRating ?? null,
    );
    const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);
    const [showInviteSheet, setShowInviteSheet] = useState(false);
    const [invitees, setInvitees] = useState<InviteProfile[]>([]);
    const [waitlistPosition, setWaitlistPosition] = useState<number | null>(null);
    const hasLoadedRef = useRef(!!cachedDetail);
    const loadGenRef = useRef(0);

    const applyDetailSnapshot = useCallback((snap: PlanDetailSnapshot) => {
        setPlan(snap.plan);
        setParticipants(snap.participants);
        setJoinedCount(snap.joinedCount);
        setCreator(snap.creator);
        setCreatorStats(snap.creatorStats);
        setMembership(snap.membership);
        setFriendIds(new Set(snap.friendIds));
        setCoincidedIds(new Set(snap.coincidedIds ?? []));
        setIsSaved(snap.isSaved);
        setCurrentUserGenero(snap.currentUserGenero);
        setOpenRating(snap.openRating);
        setCurrentUserId(snap.currentUserId);
        hasLoadedRef.current = true;
    }, []);

    const loadPlan = useCallback(async (opts?: { force?: boolean }) => {
        if (!planId) return;
        const gen = ++loadGenRef.current;
        const detailKey = planDetailKey(planId);
        try {
            const stale = cacheGetStale<PlanDetailSnapshot>(detailKey);
            if (stale) {
                applyDetailSnapshot(stale);
                setLoading(false);
                // Semillas del feed vienen sin user/amigos/guardados → hay que completar.
                const cacheComplete = !stale.partial && !!stale.currentUserId;
                if (!opts?.force && cacheIsFresh(detailKey) && cacheComplete) return;
            } else if (!hasLoadedRef.current) {
                setLoading(true);
            }

            const user = await getAuthUser();
            if (gen !== loadGenRef.current) return;
            setCurrentUserId(user?.id ?? null);

            const { data: planRow, error } = await supabase
                .from('planes')
                .select(
                    'id, titulo, imagen_url, categoria, tipo_deporte, solo_chicas, modo_privado, fecha_evento, nombre_ubicacion, latitud, longitud, maximo_participantes, creador_id, requiere_aprobacion, descripcion, chat_eliminado_en',
                )
                .eq('id', planId)
                .maybeSingle();

            if (gen !== loadGenRef.current) return;
            if (error || !planRow) {
                if (!stale) setPlan(null);
                return;
            }

            setPlan(planRow as PlanRow);

            const [partsRes, creatorRes, myPartRes, savedRes, friendsData, coincidedSet, stats, myProfileRes] = await Promise.all([
                supabase
                    .from('participantes')
                    .select('usuario_id, estado, perfiles:usuario_id(id, nombre, avatar_url, genero)')
                    .eq('plan_id', planId)
                    .eq('estado', 'aceptado'),
                supabase
                    .from('perfiles')
                    .select('id, nombre, avatar_url, ambientes_preferidos, etiquetas, genero')
                    .eq('id', planRow.creador_id)
                    .maybeSingle(),
                user
                    ? supabase
                          .from('participantes')
                          .select('estado')
                          .eq('plan_id', planId)
                          .eq('usuario_id', user.id)
                          .maybeSingle()
                    : Promise.resolve({ data: null, error: null }),
                user
                    ? supabase
                          .from('planes_guardados')
                          .select('plan_id')
                          .eq('plan_id', planId)
                          .eq('usuario_id', user.id)
                          .maybeSingle()
                    : Promise.resolve({ data: null, error: null }),
                user ? getFriends(user.id) : Promise.resolve([]),
                user ? getCoincidedUserIds(user.id) : Promise.resolve(new Set<string>()),
                getUserStats(planRow.creador_id),
                user
                    ? supabase.from('perfiles').select('genero').eq('id', user.id).maybeSingle()
                    : Promise.resolve({ data: null, error: null }),
            ]);
            if (gen !== loadGenRef.current) return;

            const accepted = (partsRes.data || []).filter((p: { estado: string }) =>
                isAcceptedParticipant(p.estado),
            );

            const creatorProfile: Participant | null = creatorRes.data
                ? { ...creatorRes.data, isCreator: true }
                : null;

            const list: Participant[] = [];
            if (creatorProfile) list.push(creatorProfile);
            accepted.forEach((p: any) => {
                const prof = Array.isArray(p.perfiles) ? p.perfiles[0] : p.perfiles;
                if (prof && prof.id !== planRow.creador_id) {
                    list.push({ ...prof, isCreator: false });
                }
            });

            const nextMembership = myPartRes.data?.estado
                ? (mapEstadoToMembership(myPartRes.data.estado) ?? 'none')
                : 'none';
            const nextFriends = friendsData.map((f) => f.id);
            const nextCoincided = [...coincidedSet];
            const nextGenero = (myProfileRes.data?.genero as Genero) ?? null;
            const nextOpenRating = user ? await getOpenRatingForPlan(user.id, planId) : null;
            if (gen !== loadGenRef.current) return;
            const nextSaved = !!savedRes.data;

            const snap: PlanDetailSnapshot = {
                plan: planRow as PlanRow,
                participants: list,
                joinedCount: accepted.length,
                creator: creatorProfile,
                creatorStats: stats,
                membership: nextMembership,
                friendIds: nextFriends,
                coincidedIds: nextCoincided,
                isSaved: nextSaved,
                currentUserGenero: nextGenero,
                openRating: nextOpenRating,
                currentUserId: user?.id ?? null,
                partial: false,
            };
            applyDetailSnapshot(snap);
            cacheSet(detailKey, snap, PLAN_DETAIL_TTL_MS);
        } finally {
            if (gen === loadGenRef.current) setLoading(false);
        }
    }, [planId, applyDetailSnapshot]);

    useFocusEffect(
        useCallback(() => {
            void loadPlan();
        }, [loadPlan]),
    );

    useEffect(() => {
        if (!planId || !currentUserId || membership !== 'waitlist') {
            setWaitlistPosition(null);
            return;
        }
        let alive = true;
        void getWaitlistPosition(planId, currentUserId).then((pos) => {
            if (alive) setWaitlistPosition(pos);
        });
        return () => {
            alive = false;
        };
    }, [planId, currentUserId, membership, joinedCount]);

    useEffect(() => {
        if (!planId) return;
        const channel = supabase
            .channel(`plan-spots:${planId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'participantes',
                    filter: `plan_id=eq.${planId}`,
                },
                () => {
                    void (async () => {
                        const { data } = await supabase
                            .from('participantes')
                            .select('usuario_id, estado')
                            .eq('plan_id', planId);
                        if (!data) return;
                        const accepted = data.filter((p) => isAcceptedParticipant(p.estado));
                        setJoinedCount(accepted.length);

                        if (currentUserId) {
                            const mine = data.find((p) => p.usuario_id === currentUserId);
                            const nextMembership = mine?.estado
                                ? (mapEstadoToMembership(mine.estado) ?? 'none')
                                : 'none';
                            setMembership(nextMembership);
                            if (nextMembership === 'waitlist') {
                                const pos = await getWaitlistPosition(planId, currentUserId);
                                setWaitlistPosition(pos);
                            } else {
                                setWaitlistPosition(null);
                            }
                        }
                    })();
                },
            )
            .subscribe();
        return () => {
            void supabase.removeChannel(channel);
        };
    }, [planId, currentUserId]);

    const isCreator = currentUserId && plan && String(plan.creador_id) === String(currentUserId);
    const isFull = plan ? joinedCount >= plan.maximo_participantes : false;
    const requiresApproval = !!plan?.requiere_aprobacion;
    const waitlistOpen = canJoinWaitlist(plan?.fecha_evento);
    const genderBlocked = plan ? !canJoinPlanByGender(plan, currentUserGenero) : false;
    const isPrivatePlan = !!plan?.modo_privado;
    const isPastPlan = !!(plan?.fecha_evento && new Date(plan.fecha_evento).getTime() < Date.now());
    /** Privado: solo creador. Público: creador o integrante. Nunca en planes ya pasados. */
    const canInvitePeople =
        !!currentUserId &&
        !!plan &&
        !isPastPlan &&
        (isCreator || (membership === 'joined' && !isPrivatePlan));

    const openInviteSheet = async () => {
        if (!planId || !canInvitePeople) return;
        setShowInviteSheet(true);
        try {
            const list = await getPlanPendingInvitees(planId);
            setInvitees(
                list.map((i) => ({
                    id: i.id,
                    nombre: i.nombre,
                    nombre_usuario: i.nombre_usuario,
                    avatar_url: i.avatar_url,
                    invitedByName: i.invitadorNombre,
                })),
            );
        } catch {
            setInvitees([]);
        }
    };

    const handleInviteAdd = useCallback(
        async (profile: InviteProfile) => {
            if (!planId || !currentUserId) return { error: 'no_user' };
            setInvitees((prev) => (prev.some((p) => p.id === profile.id) ? prev : [...prev, profile]));
            const { error } = await sendPlanInvite(planId, currentUserId, profile.id, 'plan');
            if (error) {
                setInvitees((prev) => prev.filter((p) => p.id !== profile.id));
            }
            return { error };
        },
        [planId, currentUserId],
    );

    const handleInviteRemove = useCallback(
        async (profileId: string) => {
            if (!planId) return { error: 'no_plan' };
            let removed: InviteProfile | undefined;
            setInvitees((prev) => {
                removed = prev.find((p) => p.id === profileId);
                return prev.filter((p) => p.id !== profileId);
            });
            const { error } = await cancelPlanInvite(planId, profileId);
            if (error && removed) {
                setInvitees((prev) => (prev.some((p) => p.id === removed!.id) ? prev : [...prev, removed!]));
            }
            return { error };
        },
        [planId],
    );

    const inviteExcludeIds = useMemo(
        () => new Set(participants.map((p) => p.id)),
        [participants],
    );

    const eventDate = plan?.fecha_evento ? new Date(plan.fecha_evento) : null;
    const dateString = eventDate
        ? eventDate.toLocaleDateString(dateLocale, { weekday: 'long', day: 'numeric', month: 'long' })
        : t('card.noDate');
    const timeString = eventDate
        ? eventDate.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })
        : '';
    const sportPlan = plan ? resolvePlanSport(plan) : null;
    const lat = plan?.latitud ?? 40.4167;
    const lng = plan?.longitud ?? -3.7037;

    const handleKick = (targetUserId: string, targetName: string) => {
        if (!currentUserId || !planId || !isCreator) return;
        Alert.alert(t('planDetail.kickTitle'), t('planDetail.kickMsg', { name: targetName }), [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('planDetail.kickConfirm'),
                style: 'destructive',
                onPress: () => {
                    void (async () => {
                        const { error } = await kickParticipant(planId, targetUserId, currentUserId);
                        if (error) {
                            Alert.alert(t('feed.error'), error);
                            return;
                        }
                        await loadPlan({ force: true });
                    })();
                },
            },
        ]);
    };

    const openProfile = (userId: string) => {
        router.push({
            pathname: '/user-profile/[id]',
            params: { id: userId, isFriend: friendIds.has(userId) ? '1' : '0' },
        });
    };

    const handleShare = async () => {
        if (!plan) return;
        const when = eventDate ? `${dateString}${timeString ? ` · ${timeString}` : ''}` : '';
        const message = buildPlanShareMessage({
            title: plan.titulo,
            location: plan.nombre_ubicacion,
            when: when || null,
            planId: plan.id,
            hint: t('planDetail.shareHint'),
            lang,
        });
        try {
            await Share.share({ message });
        } catch {
            // cancelled
        }
    };

    const handleToggleSave = async () => {
        if (!currentUserId || !planId) {
            // Caché parcial a veces deja user a null: forzar carga completa.
            void loadPlan({ force: true });
            return;
        }
        const prev = isSaved;
        hapticLight();
        setIsSaved(!prev);
        const patchCache = (saved: boolean) => {
            const key = planDetailKey(planId);
            const stale = cacheGetStale<PlanDetailSnapshot>(key);
            if (stale) {
                cacheSet(key, { ...stale, isSaved: saved }, PLAN_DETAIL_TTL_MS);
            }
        };
        if (prev) {
            const { error } = await supabase
                .from('planes_guardados')
                .delete()
                .eq('plan_id', planId)
                .eq('usuario_id', currentUserId);
            if (error) {
                setIsSaved(prev);
                hapticError();
                Alert.alert(t('feed.error'), t('feed.saveError'));
            } else {
                patchCache(false);
            }
        } else {
            if (plan && !isPlanActiveForSaved(plan)) {
                setIsSaved(prev);
                return;
            }
            const { error } = await supabase
                .from('planes_guardados')
                .insert({ plan_id: planId, usuario_id: currentUserId });
            if (error) {
                setIsSaved(prev);
                hapticError();
                Alert.alert(t('feed.error'), t('feed.saveError'));
            } else {
                patchCache(true);
            }
        }
    };

    const handleJoin = async () => {
        if (!currentUserId || !plan || actionBusy) return;
        if (!canJoinPlanByGender(plan, currentUserGenero)) {
            hapticError();
            Alert.alert(t('feed.error'), t('card.soloChicasOnly'));
            return;
        }
        hapticMedium();
        // Spinner solo mientras se valida el límite; luego el botón cambia al instante.
        setActionBusy(true);
        const limitCheck = await canJoinMorePlans(currentUserId, plan.id);
        if (!limitCheck.allowed) {
            setActionBusy(false);
            hapticError();
            Alert.alert(t('feed.error'), t('feed.planLimitReached', { max: limitCheck.max }));
            return;
        }
        const estado = resolveJoinEstado({
            requiere_aprobacion: plan.requiere_aprobacion,
            maximo_participantes: plan.maximo_participantes,
            joinedCount,
        });
        const nextMembership = membershipFromJoinEstado(estado);
        const prevMembership = membership;
        const prevCount = joinedCount;
        setMembership(nextMembership);
        if (estado === 'aceptado') setJoinedCount((c) => c + 1);
        setActionBusy(false);

        const { error } = await supabase.from('participantes').insert({
            plan_id: plan.id,
            usuario_id: currentUserId,
            estado,
        });
        if (error) {
            setMembership(prevMembership);
            setJoinedCount(prevCount);
            hapticError();
            Alert.alert(t('feed.error'), t('feed.joinError'));
        } else {
            hapticSuccess();
            invalidatePlanMembershipCaches(currentUserId);
            invalidatePlanDetailCache(plan.id);
            const { notifyPlanJoin, schedulePlanLifecycleReminders } = await import('../../lib/push');
            notifyPlanJoin(plan.id, estado);
            if (estado === 'aceptado') {
                void schedulePlanLifecycleReminders({
                    planId: plan.id,
                    planTitle: plan.titulo,
                    fechaEvento: plan.fecha_evento,
                    categoria: plan.categoria,
                });
            }
            await loadPlan({ force: true });
        }
    };

    const handleLeave = () => {
        if (!currentUserId || !plan) return;
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
                onPress: () => {
                    const prevMembership = membership;
                    const prevCount = joinedCount;
                    setMembership('none');
                    if (wasJoined) setJoinedCount((c) => Math.max(0, c - 1));

                    void (async () => {
                        const { error } = await supabase
                            .from('participantes')
                            .delete()
                            .eq('plan_id', plan.id)
                            .eq('usuario_id', currentUserId);

                        if (error) {
                            setMembership(prevMembership);
                            setJoinedCount(prevCount);
                            Alert.alert(t('feed.error'), t('feed.leaveError'));
                        } else {
                            invalidatePlanMembershipCaches(currentUserId);
                            invalidatePlanDetailCache(plan.id);
                            if (wasJoined) {
                                await promoteWaitlist(plan.id);
                                await loadPlan({ force: true });
                            }
                        }
                    })();
                },
            },
        ]);
    };

    const chatAlive = plan ? isPlanChatAlive(plan) : false;

    const confirmHideFromMyList = () => {
        if (!plan || !currentUserId) return;
        Alert.alert(t('planDetail.hideFromListTitle'), t('planDetail.hideFromListMsg'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('planDetail.hideFromListConfirm'),
                style: 'destructive',
                onPress: async () => {
                    await hidePlanFromMyList(currentUserId, plan.id);
                    router.back();
                },
            },
        ]);
    };

    const handleAcceptIncomingInvite = async () => {
        if (!currentUserId || !plan || !pendingInviteId || actionBusy) return;
        setActionBusy(true);
        try {
            const invite: PlanInvite = {
                id: pendingInviteId,
                plan_id: plan.id,
                invitador_id: pendingInviterId || '',
                invitado_id: currentUserId,
                tipo: pendingInviteTipo === 'grupo' ? 'grupo' : 'plan',
                estado: 'pendiente',
                creado_en: '',
                plan: {
                    id: plan.id,
                    titulo: plan.titulo,
                    imagen_url: plan.imagen_url,
                    maximo_participantes: plan.maximo_participantes,
                    requiere_aprobacion: plan.requiere_aprobacion,
                    categoria: plan.categoria,
                },
                invitador: pendingInviterId
                    ? {
                          id: pendingInviterId,
                          nombre: pendingInviterName?.trim() || t('planDetail.anonymous'),
                          avatar_url: pendingInviterAvatar || null,
                      }
                    : undefined,
            };
            const { error, estado, max } = await acceptPlanInvite(invite, currentUserId);
            if (error === 'full') {
                Alert.alert(t('feed.error'), t('friends.inviteFull'));
                return;
            }
            if (error === 'limit') {
                Alert.alert(t('feed.error'), t('feed.planLimitReached', { max: max ?? 3 }));
                return;
            }
            if (error) {
                Alert.alert(t('feed.error'), error);
                return;
            }
            setInviteHandled(true);
            setMembership(estado === 'pendiente' ? 'requested' : 'joined');
            invalidatePlanMembershipCaches(currentUserId);
            await loadPlan({ force: true });
        } finally {
            setActionBusy(false);
        }
    };

    const handleRejectIncomingInvite = () => {
        if (!pendingInviteId || actionBusy) return;
        setInviteHandled(true);
        void rejectPlanInvite(pendingInviteId).then(({ error }) => {
            if (error) {
                setInviteHandled(false);
                Alert.alert(t('feed.error'), error);
                return;
            }
            router.back();
        });
    };

    const renderPrimaryAction = () => {
        if (
            fromInvite &&
            pendingInviteId &&
            !isCreator &&
            membership === 'none' &&
            !isPastPlan
        ) {
            const name = pendingInviterName?.trim() || t('planDetail.anonymous');
            return (
                <View style={styles.inviteDecisionWrap}>
                    <TouchableOpacity
                        style={styles.inviteDecisionHeader}
                        activeOpacity={0.85}
                        onPress={() => {
                            if (!pendingInviterId) return;
                            router.push({ pathname: '/user-profile/[id]', params: { id: pendingInviterId } });
                        }}
                    >
                        <ProfileAvatar
                            uri={pendingInviterAvatar || null}
                            name={name}
                            size={40}
                            recyclingKey={pendingInviterId ?? name}
                        />
                        <Text style={styles.inviteDecisionLabel} numberOfLines={2}>
                            {t('planDetail.inviteFrom', { name })}
                        </Text>
                    </TouchableOpacity>
                    <View style={styles.inviteDecisionActions}>
                        <TouchableOpacity
                            style={[styles.inviteDecisionJoin, actionBusy && { opacity: 0.7 }]}
                            onPress={handleAcceptIncomingInvite}
                            activeOpacity={0.9}
                            disabled={actionBusy}
                        >
                            {actionBusy ? (
                                <ActivityIndicator color="#FFF" />
                            ) : (
                                <Text style={styles.inviteDecisionJoinText}>{t('planDetail.inviteJoin')}</Text>
                            )}
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.inviteDecisionReject, actionBusy && { opacity: 0.7 }]}
                            onPress={handleRejectIncomingInvite}
                            activeOpacity={0.85}
                            disabled={actionBusy}
                        >
                            <Text style={styles.inviteDecisionRejectText}>{t('planDetail.inviteReject')}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            );
        }

        if (isPastPlan && (isCreator || membership === 'joined' || membership === 'requested' || membership === 'waitlist')) {
            return (
                <View style={styles.joinedActions}>
                    {chatAlive ? (
                        <TouchableOpacity
                            style={styles.chatBtn}
                            activeOpacity={0.9}
                            onPress={() => router.push(`/chat/${plan!.id}`)}
                        >
                            <LinearGradient colors={[PRIMARY, PRIMARY_DARK]} style={styles.chatBtnGradient}>
                                <Ionicons name="chatbubbles" size={22} color="#FFF" />
                                <Text style={styles.chatBtnText}>{t('planDetail.openChat')}</Text>
                            </LinearGradient>
                        </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity style={styles.hideFromListBtn} onPress={confirmHideFromMyList} activeOpacity={0.85}>
                        <Ionicons name="trash-outline" size={20} color={DANGER} />
                        <Text style={styles.hideFromListText}>{t('planDetail.hideFromList')}</Text>
                    </TouchableOpacity>
                </View>
            );
        }

        if (isCreator) {
            return (
                <View style={styles.creatorActions}>
                    {chatAlive ? (
                        <TouchableOpacity
                            style={styles.chatBtn}
                            activeOpacity={0.9}
                            onPress={() => router.push(`/chat/${plan!.id}`)}
                        >
                            <LinearGradient colors={[PRIMARY, PRIMARY_DARK]} style={styles.chatBtnGradient}>
                                <Ionicons name="chatbubbles" size={22} color="#FFF" />
                                <Text style={styles.chatBtnText}>{t('planDetail.openChat')}</Text>
                            </LinearGradient>
                        </TouchableOpacity>
                    ) : null}
                    {isPastPlan ? (
                        <TouchableOpacity
                            style={styles.iconRoundBtn}
                            onPress={() =>
                                router.push({ pathname: '/create-plan', params: { duplicateId: plan!.id } })
                            }
                        >
                            <Ionicons name="copy-outline" size={22} color={PRIMARY_DARK} />
                        </TouchableOpacity>
                    ) : (
                        <TouchableOpacity
                            style={styles.iconRoundBtn}
                            onPress={() => router.push({ pathname: '/create-plan', params: { editId: plan!.id } })}
                        >
                            <Ionicons name="create-outline" size={22} color={PRIMARY_DARK} />
                        </TouchableOpacity>
                    )}
                </View>
            );
        }

        if (membership === 'joined') {
            return (
                <View style={styles.joinedActions}>
                    <TouchableOpacity style={styles.joinedOutlineBtn} onPress={handleLeave} activeOpacity={0.85}>
                        <Ionicons name="checkmark-circle" size={20} color={SUCCESS} />
                        <Text style={styles.joinedOutlineText}>
                            {t(currentUserGenero === 'femenino' ? 'card.joinedF' : 'card.joined')}
                        </Text>
                    </TouchableOpacity>
                    {chatAlive ? (
                        <TouchableOpacity
                            style={styles.chatIconBtn}
                            activeOpacity={0.9}
                            onPress={() => router.push(`/chat/${plan!.id}`)}
                            accessibilityLabel={t('planDetail.openChat')}
                        >
                            <LinearGradient colors={[PRIMARY, PRIMARY_DARK]} style={styles.chatIconBtnGradient}>
                                <Ionicons name="chatbubbles" size={22} color="#FFF" />
                            </LinearGradient>
                        </TouchableOpacity>
                    ) : null}
                </View>
            );
        }

        if (membership === 'requested') {
            return (
                <TouchableOpacity style={styles.requestedBtn} onPress={handleLeave} activeOpacity={0.85}>
                    <Ionicons name="time" size={20} color="#B45309" />
                    <Text style={styles.requestedBtnText}>{t('card.requested')}</Text>
                </TouchableOpacity>
            );
        }

        if (membership === 'waitlist') {
            return (
                <TouchableOpacity style={styles.waitlistBtn} onPress={handleLeave} activeOpacity={0.85}>
                    <Ionicons name="hourglass" size={20} color={WAITLIST} />
                    <Text style={styles.waitlistBtnText}>
                        {waitlistPosition != null
                            ? t('card.waitlistPosition', { n: waitlistPosition })
                            : t('card.waitlist')}
                    </Text>
                </TouchableOpacity>
            );
        }

        if (genderBlocked) {
            return (
                <View style={styles.genderBlockedBtn}>
                    <Ionicons name="lock-closed" size={20} color="#DB2777" />
                    <Text style={styles.genderBlockedBtnText}>{t('card.soloChicasOnly')}</Text>
                </View>
            );
        }

        if (isFull) {
            if (!waitlistOpen) {
                return (
                    <View style={styles.fullClosedBtn}>
                        <Ionicons name="ban" size={20} color={DANGER} />
                        <Text style={styles.fullClosedBtnText}>{t('card.fullClosed')}</Text>
                    </View>
                );
            }
            return (
                <TouchableOpacity style={styles.waitlistJoinBtn} onPress={handleJoin} activeOpacity={0.9} disabled={actionBusy}>
                    <Ionicons name="list" size={20} color="#FFF" />
                    <Text style={styles.waitlistJoinText}>{t('card.joinWaitlist')}</Text>
                </TouchableOpacity>
            );
        }

        return (
            <TouchableOpacity style={styles.joinBtn} onPress={handleJoin} activeOpacity={0.9} disabled={actionBusy}>
                <LinearGradient colors={[PRIMARY, PRIMARY_DARK]} style={styles.joinBtnGradient}>
                    <Text style={styles.joinBtnText}>{requiresApproval ? t('card.request') : t('card.join')}</Text>
                    <Ionicons name={requiresApproval ? 'shield-checkmark' : 'arrow-forward'} size={20} color="#FFF" />
                </LinearGradient>
            </TouchableOpacity>
        );
    };

    if (loading && !plan) {
        return (
            <View style={styles.loadingWrap}>
                <ActivityIndicator size="large" color={PRIMARY_DARK} />
            </View>
        );
    }

    if (!plan) {
        return (
            <SafeAreaView style={styles.notFoundWrap}>
                <Ionicons name="compass-outline" size={56} color={MUTED} />
                <Text style={styles.notFoundTitle}>{t('planDetail.notFound')}</Text>
                <TouchableOpacity style={styles.backLink} onPress={() => router.back()}>
                    <Text style={styles.backLinkText}>{t('common.back')}</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    const creatorIsFriend = creator ? friendIds.has(creator.id) : false;
    const creatorRoleLabel =
        creator?.genero === 'femenino' ? t('planDetail.creatorFemale') : t('planDetail.creator');
    const ratingLabel =
        creatorStats.numeroValoraciones > 0
            ? t(
                  creatorStats.numeroValoraciones === 1
                      ? 'planDetail.ratingLabelOne'
                      : 'planDetail.ratingLabel',
                  {
                      score: formatRatingScore(creatorStats.valoracionMedia),
                      count: creatorStats.numeroValoraciones,
                  },
              )
            : t('planDetail.noReviews');

    return (
        <View style={styles.root}>
            <ScrollView
                ref={scrollRef}
                onScroll={onScroll}
                scrollEventThrottle={scrollEventThrottle}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: insets.bottom + (fromInvite ? 150 : 85) }}
            >
                <View style={styles.heroWrap}>
                    <PlanImage
                        source={resolvePlanImageSource(plan.imagen_url)}
                        style={styles.heroImage}
                        priority="high"
                        recyclingKey={plan.id}
                    />
                    <View style={[styles.heroTopBar, { paddingTop: insets.top + 10 }]}>
                        <TouchableOpacity style={styles.glassBtn} onPress={() => router.back()} activeOpacity={0.85}>
                            <Ionicons name="chevron-back" size={24} color="#FFF" />
                        </TouchableOpacity>
                        <View style={styles.heroTopRight}>
                            {!isPastPlan ? (
                                <TouchableOpacity style={styles.glassBtn} onPress={handleShare} activeOpacity={0.85}>
                                    <Ionicons name="arrow-redo" size={18} color="#FFF" />
                                </TouchableOpacity>
                            ) : null}
                            {!isPastPlan && !isCreator ? (
                                <TouchableOpacity style={styles.glassBtn} onPress={handleToggleSave} activeOpacity={0.85}>
                                    <Ionicons name={isSaved ? 'heart' : 'heart-outline'} size={20} color={isSaved ? DANGER : '#FFF'} />
                                </TouchableOpacity>
                            ) : null}
                            {!isCreator && currentUserId ? (
                                <TouchableOpacity
                                    style={styles.glassBtn}
                                    onPress={() =>
                                        router.push({ pathname: '/report-plan', params: { planId: plan.id } })
                                    }
                                    activeOpacity={0.85}
                                >
                                    <Ionicons name="flag-outline" size={18} color="#FECACA" />
                                </TouchableOpacity>
                            ) : null}
                        </View>
                    </View>
                </View>

                <View style={styles.sheet}>
                    <View style={styles.titleBlock}>
                        <View style={styles.categoryChipLight}>
                            <Text style={styles.categoryChipLightText}>{getPlanCategoryDisplay(plan, t)}</Text>
                        </View>
                        <Text style={styles.planTitle}>{plan.titulo}</Text>
                        {sportPlan && (
                            <View style={styles.sportChipLight}>
                                <SportIcon sport={sportPlan.tipo} size={16} color={PRIMARY_DARK} />
                                <Text style={styles.sportChipLightText}>{t('sport.' + sportPlan.tipo)}</Text>
                            </View>
                        )}
                    </View>

                    {openRating ? (
                        <TouchableOpacity
                            style={styles.rateBanner}
                            activeOpacity={0.88}
                            onPress={() =>
                                router.push({ pathname: '/rate-plan', params: { planId: plan.id } })
                            }
                        >
                            <View style={styles.rateBannerIcon}>
                                <Ionicons name="star" size={18} color="#B45309" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.rateBannerTitle}>
                                    {openRating.pendingCount < openRating.totalPeers
                                        ? t('planDetail.rateProgress', {
                                              done: openRating.totalPeers - openRating.pendingCount,
                                              total: openRating.totalPeers,
                                          })
                                        : t('planDetail.rate')}
                                </Text>
                                <Text style={styles.rateBannerSub}>
                                    {openRating.pendingCount === 1
                                        ? t('ratings.readyToRateOne')
                                        : openRating.pendingCount > 1
                                          ? t('ratings.readyToRate', { n: openRating.pendingCount })
                                          : t('ratings.readyContinue')}
                                </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color="#B45309" />
                        </TouchableOpacity>
                    ) : null}

                    <View style={styles.dateRow}>
                        <View style={styles.dateCard}>
                            <Ionicons name="calendar" size={20} color={PRIMARY_DARK} />
                            <View style={styles.dateCardText}>
                                <Text style={styles.dateLabel}>{t('planDetail.date')}</Text>
                                <Text style={styles.dateValue}>{dateString}</Text>
                            </View>
                        </View>
                        {timeString ? (
                            <View style={styles.dateCard}>
                                <Ionicons name="time" size={20} color={PRIMARY_DARK} />
                                <View style={styles.dateCardText}>
                                    <Text style={styles.dateLabel}>{t('planDetail.time')}</Text>
                                    <Text style={styles.dateValue}>{timeString}</Text>
                                </View>
                            </View>
                        ) : null}
                    </View>

                    {creator && (
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>{creatorRoleLabel}</Text>
                            <View style={[styles.creatorCard, creatorIsFriend && styles.creatorCardFriend]}>
                                <TouchableOpacity
                                    style={styles.creatorMain}
                                    activeOpacity={0.85}
                                    onPress={() => openProfile(creator.id)}
                                >
                                    <View style={[styles.creatorAvatarWrap, creatorIsFriend && styles.creatorAvatarWrapFriend]}>
                                        <ProfileAvatar uri={creator.avatar_url} name={creator.nombre} size={72} recyclingKey={creator.id} />
                                    </View>
                                    <View style={styles.creatorInfo}>
                                        <Text style={styles.creatorLabel}>{creatorRoleLabel}</Text>
                                        <Text style={[styles.creatorName, creatorIsFriend && styles.creatorNameFriend]}>
                                            {creator.nombre}
                                        </Text>
                                        <View style={styles.ratingRow}>
                                            {renderRatingStars(creatorStats.valoracionMedia, 14)}
                                            <Text style={styles.ratingText}>{ratingLabel}</Text>
                                        </View>
                                        {(creator.ambientes_preferidos?.length || creator.etiquetas?.length) ? (
                                            <View style={styles.personalityRow}>
                                                {(creator.ambientes_preferidos?.length
                                                    ? creator.ambientes_preferidos
                                                    : creator.etiquetas ?? []
                                                )
                                                    .slice(0, 3)
                                                    .map((tag) => (
                                                        <View key={tag} style={styles.personalityChip}>
                                                            <Text style={styles.personalityChipText}>
                                                                {getPersonalityLabel(tag, creator.genero, t)}
                                                            </Text>
                                                        </View>
                                                    ))}
                                            </View>
                                        ) : null}
                                    </View>
                                </TouchableOpacity>
                            </View>
                        </View>
                    )}

                    <View style={styles.section}>
                        <View style={styles.sectionHeaderRow}>
                            <Text style={styles.sectionTitle}>{t('planDetail.participants')}</Text>
                            <Text style={styles.participantCount}>
                                {participants.length}/{plan.maximo_participantes}
                            </Text>
                        </View>
                        {canInvitePeople ? (
                            <TouchableOpacity style={styles.inviteParticipantsBtn} onPress={openInviteSheet} activeOpacity={0.85}>
                                <Ionicons name="person-add-outline" size={18} color={PRIMARY_DARK} />
                                <Text style={styles.inviteParticipantsBtnText} numberOfLines={1}>
                                    {t('invite.openBtn')}
                                    {invitees.length > 0
                                        ? ` ${t('invite.pendingCountParen', { n: invitees.length })}`
                                        : ''}
                                </Text>
                                <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
                            </TouchableOpacity>
                        ) : null}
                        {participants.length === 0 ? (
                            <View style={styles.emptyParticipants}>
                                <Ionicons name="people-outline" size={28} color={MUTED} />
                                <Text style={styles.emptyParticipantsText}>{t('card.beFirst')}</Text>
                            </View>
                        ) : (
                            <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={styles.participantsScroll}
                            >
                                {participants.map((p) => (
                                    <View key={p.id} style={styles.participantBubbleWrap}>
                                        <PersonBubble
                                            person={p}
                                            isFriend={friendIds.has(p.id)}
                                            isAcquaintance={
                                                !isPastPlan &&
                                                coincidedIds.has(p.id) &&
                                                !friendIds.has(p.id)
                                            }
                                            subtitle={
                                                p.isCreator
                                                    ? p.genero === 'femenino'
                                                        ? t('planDetail.creatorFemale')
                                                        : t('planDetail.creator')
                                                    : undefined
                                            }
                                            onPress={() => openProfile(p.id)}
                                        />
                                        {isCreator && !p.isCreator && (
                                            <TouchableOpacity
                                                style={styles.kickBtn}
                                                onPress={() => handleKick(p.id, p.nombre || t('profile.user'))}
                                                hitSlop={8}
                                            >
                                                <Ionicons name="close-circle" size={22} color={DANGER} />
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                ))}
                            </ScrollView>
                        )}
                    </View>

                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>{t('planDetail.about')}</Text>
                        <Text style={styles.description}>{plan.descripcion?.trim() || t('card.noDescription')}</Text>
                    </View>

                    <View style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <Ionicons name="location" size={18} color={PRIMARY_DARK} />
                            <Text style={styles.sectionTitle}>{t('planDetail.location')}</Text>
                        </View>
                        <Text style={styles.locationName}>{plan.nombre_ubicacion || t('card.location')}</Text>
                        <TouchableOpacity
                            style={styles.mapCard}
                            activeOpacity={0.92}
                            onPress={() => setMapExpanded(true)}
                        >
                            <NexoMapView
                                key={`detail-${plan.id}-${lat}-${lng}`}
                                style={styles.map}
                                scrollEnabled={false}
                                zoomEnabled={false}
                                pitchEnabled={false}
                                rotateEnabled={false}
                                liteMode={Platform.OS === 'android'}
                                loadingEnabled
                                moveOnMarkerPress={false}
                                initialRegion={{
                                    latitude: lat,
                                    longitude: lng,
                                    latitudeDelta: 0.008,
                                    longitudeDelta: 0.008,
                                }}
                            >
                                <Marker coordinate={{ latitude: lat, longitude: lng }} />
                            </NexoMapView>
                            <View style={styles.mapTapOverlay} pointerEvents="none">
                                <View style={styles.mapExpandPill}>
                                    <Ionicons name="expand" size={16} color="#FFF" />
                                    <Text style={styles.mapExpandText}>{t('planDetail.expandMap')}</Text>
                                </View>
                            </View>
                        </TouchableOpacity>
                        <View style={styles.mapBottomSpacer} />
                    </View>
                </View>
            </ScrollView>

            <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 20) }]}>
                {renderPrimaryAction()}
            </View>

            <Modal visible={mapExpanded} animationType="slide" onRequestClose={() => setMapExpanded(false)}>
                <View style={styles.fullMapRoot}>
                    <StatusBar barStyle="dark-content" />
                    <NexoMapView
                        key={`full-${plan.id}-${lat}-${lng}`}
                        style={styles.fullMap}
                        scrollEnabled
                        zoomEnabled
                        pitchEnabled
                        rotateEnabled
                        loadingEnabled
                        showsUserLocation
                        showsMyLocationButton={Platform.OS === 'android'}
                        onUserLocationChange={(e) => {
                            const c = e.nativeEvent.coordinate;
                            if (!c) return;
                            setUserCoords((prev) => {
                                if (
                                    prev &&
                                    Math.abs(prev.latitude - c.latitude) < 0.00005 &&
                                    Math.abs(prev.longitude - c.longitude) < 0.00005
                                ) {
                                    return prev;
                                }
                                return { latitude: c.latitude, longitude: c.longitude };
                            });
                        }}
                        initialRegion={{
                            latitude: lat,
                            longitude: lng,
                            latitudeDelta: 0.012,
                            longitudeDelta: 0.012,
                        }}
                    >
                        <Marker
                            coordinate={{ latitude: lat, longitude: lng }}
                            title={plan.titulo}
                            description={plan.nombre_ubicacion ?? undefined}
                            onPress={() => void openDirectionsTo(lat, lng, plan.nombre_ubicacion)}
                        />
                    </NexoMapView>
                    <View style={[styles.fullMapTopBar, { paddingTop: insets.top + 8 }]}>
                        <TouchableOpacity style={styles.fullMapCloseBtn} onPress={() => setMapExpanded(false)} activeOpacity={0.85}>
                            <Ionicons name="close" size={26} color={INK} />
                        </TouchableOpacity>
                    </View>
                    <View style={[styles.fullMapFooter, { paddingBottom: Math.max(insets.bottom, 16) }]}>
                        <View style={styles.fullMapFooterCard}>
                            <Ionicons name="location" size={20} color={PRIMARY_DARK} />
                            <View style={styles.fullMapFooterText}>
                                <Text style={styles.fullMapFooterTitle} numberOfLines={1}>{plan.nombre_ubicacion || t('card.location')}</Text>
                                <Text style={styles.fullMapFooterSub} numberOfLines={1}>
                                    {userCoords
                                        ? formatDistanceKm(
                                              distanceKm(userCoords.latitude, userCoords.longitude, lat, lng),
                                              lang,
                                          )
                                        : t('planDetail.distanceUnknown')}
                                </Text>
                            </View>
                            <TouchableOpacity
                                style={styles.directionsBtn}
                                activeOpacity={0.88}
                                onPress={() => void openDirectionsTo(lat, lng, plan.nombre_ubicacion)}
                            >
                                <Ionicons name="navigate" size={18} color="#FFF" />
                                <Text style={styles.directionsBtnText}>{t('planDetail.getDirections')}</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {canInvitePeople ? (
                <InvitePeopleSheet
                    visible={showInviteSheet}
                    onClose={() => setShowInviteSheet(false)}
                    currentUserId={currentUserId}
                    selected={invitees}
                    excludeIds={inviteExcludeIds}
                    onAdd={handleInviteAdd}
                    onRemove={handleInviteRemove}
                />
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#F1F5F9' },
    loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F5F9' },
    notFoundWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F5F9', padding: 24 },
    notFoundTitle: { fontSize: 18, fontWeight: '700', color: INK, marginTop: 16, textAlign: 'center' },
    backLink: { marginTop: 20, paddingHorizontal: 20, paddingVertical: 10 },
    backLinkText: { color: PRIMARY_DARK, fontWeight: '700', fontSize: 16 },

    heroWrap: { height: HERO_H, backgroundColor: '#E2E8F0' },
    heroImage: { width: '100%', height: '100%' },
    heroTopBar: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        zIndex: 2,
    },
    heroTopRight: { flexDirection: 'row', gap: 8 },
    glassBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(15,42,74,0.45)',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.25)',
    },

    sheet: {
        backgroundColor: SURFACE,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        paddingTop: 28,
        paddingHorizontal: 20,
        paddingBottom: 8,
        minHeight: 200,
        marginTop: -16,
        ...Platform.select({
            ios: { shadowColor: '#0F2A4A', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.08, shadowRadius: 12 },
            android: { elevation: 8 },
        }),
    },
    titleBlock: { marginBottom: 20 },
    categoryChipLight: {
        alignSelf: 'flex-start',
        backgroundColor: '#EFF6FF',
        paddingHorizontal: 12,
        paddingVertical: 5,
        borderRadius: 20,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#BFDBFE',
    },
    categoryChipLightText: { color: PRIMARY_DARK, fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
    planTitle: { fontSize: 26, fontWeight: '800', color: INK, lineHeight: 32, letterSpacing: -0.4 },
    sportChipLight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 12,
        alignSelf: 'flex-start',
        backgroundColor: '#F8FAFC',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: BORDER,
    },
    sportChipLightText: { color: INK, fontSize: 13, fontWeight: '600' },

    dateRow: { flexDirection: 'row', gap: 10, marginBottom: 4 },
    dateCard: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: '#F8FAFC',
        borderRadius: 16,
        padding: 14,
        borderWidth: 1,
        borderColor: BORDER,
    },
    dateCardText: { flex: 1 },
    dateLabel: { fontSize: 11, fontWeight: '600', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4 },
    dateValue: { fontSize: 14, fontWeight: '700', color: INK, marginTop: 2 },

    section: { marginTop: 28 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    inviteParticipantsBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: '#EFF6FF',
        borderWidth: 1,
        borderColor: '#BFDBFE',
        borderRadius: 14,
        paddingVertical: 12,
        paddingHorizontal: 14,
        marginBottom: 14,
    },
    inviteParticipantsBtnText: { flex: 1, color: PRIMARY_DARK, fontWeight: '800', fontSize: 14 },
    sectionTitle: { fontSize: 17, fontWeight: '800', color: INK, letterSpacing: -0.2 },
    locationName: { fontSize: 15, color: MUTED, marginBottom: 12, fontWeight: '500' },
    mapCard: {
        height: 180,
        borderRadius: 20,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: BORDER,
    },
    map: { width: '100%', height: '100%' },
    mapTapOverlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingBottom: 12,
        backgroundColor: 'rgba(15,42,74,0.08)',
    },
    mapExpandPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(15,42,74,0.72)',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
    },
    mapExpandText: { color: '#FFF', fontSize: 13, fontWeight: '700' },
    mapBottomSpacer: { height: 14, backgroundColor: SURFACE },

    fullMapRoot: { flex: 1, backgroundColor: '#000' },
    fullMap: { ...StyleSheet.absoluteFillObject },
    fullMapTopBar: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        paddingHorizontal: 16,
        zIndex: 2,
    },
    fullMapCloseBtn: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: SURFACE,
        alignItems: 'center',
        justifyContent: 'center',
        ...Platform.select({
            ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 6 },
            android: { elevation: 4 },
        }),
    },
    fullMapFooter: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 16,
    },
    fullMapFooterCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: SURFACE,
        borderRadius: 16,
        padding: 16,
        ...Platform.select({
            ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 8 },
            android: { elevation: 6 },
        }),
    },
    fullMapFooterText: { flex: 1 },
    fullMapFooterTitle: { fontSize: 16, fontWeight: '800', color: INK },
    fullMapFooterSub: { fontSize: 13, color: MUTED, marginTop: 2 },
    directionsBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: PRIMARY_DARK,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 12,
    },
    directionsBtnText: { color: '#FFF', fontSize: 13, fontWeight: '800' },

    creatorCard: {
        marginTop: 12,
        backgroundColor: '#FFFBEB',
        borderRadius: 20,
        borderWidth: 1.5,
        borderColor: '#FDE68A',
        overflow: 'hidden',
    },
    creatorCardFriend: {
        backgroundColor: FRIEND_BG,
        borderColor: FRIEND_BORDER,
    },
    creatorMain: { flexDirection: 'row', padding: 16, gap: 14, alignItems: 'center' },
    creatorAvatarWrap: {
        borderRadius: 40,
        borderWidth: 3,
        borderColor: GOLD,
        padding: 2,
    },
    creatorAvatarWrapFriend: { borderColor: FRIEND },
    creatorInfo: { flex: 1 },
    creatorLabel: { fontSize: 11, fontWeight: '700', color: GOLD, textTransform: 'uppercase', letterSpacing: 0.5 },
    creatorName: { fontSize: 20, fontWeight: '800', color: INK, marginTop: 2 },
    creatorNameFriend: { color: '#047857' },
    ratingRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 6 },
    ratingText: { fontSize: 12, color: MUTED, fontWeight: '500' },
    personalityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
    personalityChip: {
        backgroundColor: '#EFF6FF',
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderWidth: 1,
        borderColor: '#BFDBFE',
    },
    personalityChipText: { fontSize: 11, fontWeight: '700', color: PRIMARY_DARK },

    participantCount: { fontSize: 14, fontWeight: '700', color: MUTED },
    participantsScroll: { paddingVertical: 4, gap: 16, paddingRight: 8 },
    participantBubbleWrap: { alignItems: 'center', position: 'relative' },
    kickBtn: { position: 'absolute', top: -4, right: -4, backgroundColor: '#FFF', borderRadius: 12 },
    personBubble: { width: 80, alignItems: 'center' },
    personAvatarRing: {
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: BORDER,
        backgroundColor: SURFACE,
    },
    personAvatarRingFriend: { borderColor: FRIEND, backgroundColor: FRIEND_BG },
    personAvatarRingAcquaintance: { borderColor: ACQUAINTANCE, backgroundColor: ACQUAINTANCE_BG },
    creatorStar: {
        position: 'absolute',
        bottom: 0,
        right: 0,
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: GOLD,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: SURFACE,
    },
    personName: { fontSize: 12, fontWeight: '700', color: INK, marginTop: 8, textAlign: 'center', maxWidth: 76 },
    personNameFriend: { color: '#047857' },
    personNameAcquaintance: { color: '#6D28D9' },
    personSubtitle: { fontSize: 10, color: MUTED, marginTop: 2 },
    personSubtitleFriend: { color: FRIEND },
    personSubtitleAcquaintance: { color: ACQUAINTANCE },
    friendPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        marginTop: 4,
        backgroundColor: FRIEND_BG,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: FRIEND_BORDER,
    },
    friendPillText: { fontSize: 9, fontWeight: '700', color: FRIEND },
    acquaintancePill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        marginTop: 4,
        backgroundColor: ACQUAINTANCE_BG,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: ACQUAINTANCE_BORDER,
    },
    acquaintancePillText: { fontSize: 9, fontWeight: '700', color: ACQUAINTANCE },

    emptyParticipants: {
        alignItems: 'center',
        paddingVertical: 24,
        backgroundColor: '#F8FAFC',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: BORDER,
        borderStyle: 'dashed',
    },
    emptyParticipantsText: { marginTop: 8, color: MUTED, fontWeight: '600' },

    description: { fontSize: 15, lineHeight: 24, color: '#334155', marginTop: 8 },
    rateBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginHorizontal: 0,
        marginBottom: 16,
        paddingVertical: 14,
        paddingHorizontal: 14,
        backgroundColor: '#FEF3C7',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#FCD34D',
    },
    rateBannerIcon: {
        width: 36,
        height: 36,
        borderRadius: 12,
        backgroundColor: '#FDE68A',
        alignItems: 'center',
        justifyContent: 'center',
    },
    rateBannerTitle: { fontSize: 14, fontWeight: '800', color: '#92400E' },
    rateBannerSub: { fontSize: 12, fontWeight: '600', color: '#B45309', marginTop: 2 },

    bottomBar: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 20,
        paddingTop: 16,
        backgroundColor: 'rgba(255,255,255,0.98)',
        borderTopWidth: 1,
        borderTopColor: BORDER,
        ...Platform.select({
            ios: { shadowColor: '#000', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.06, shadowRadius: 8 },
            android: { elevation: 12 },
        }),
    },
    joinBtn: { borderRadius: 16, overflow: 'hidden' },
    joinBtnGradient: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        paddingVertical: 18,
        paddingHorizontal: 24,
    },
    joinBtnText: { color: '#FFF', fontSize: 17, fontWeight: '800' },
    inviteDecisionWrap: { gap: 12 },
    inviteDecisionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 4,
    },
    inviteDecisionLabel: {
        flex: 1,
        fontSize: 15,
        fontWeight: '700',
        color: INK,
    },
    inviteDecisionActions: {
        flexDirection: 'row',
        gap: 10,
    },
    inviteDecisionJoin: {
        flex: 1,
        minHeight: 50,
        borderRadius: 14,
        backgroundColor: PRIMARY_DARK,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 12,
    },
    inviteDecisionJoinText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
    inviteDecisionReject: {
        flex: 1,
        minHeight: 50,
        borderRadius: 14,
        backgroundColor: '#FEF2F2',
        borderWidth: 1.5,
        borderColor: '#FECACA',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 12,
    },
    inviteDecisionRejectText: { color: DANGER, fontSize: 16, fontWeight: '800' },
    waitlistJoinBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        backgroundColor: WAITLIST,
        paddingVertical: 18,
        paddingHorizontal: 24,
        borderRadius: 16,
    },
    waitlistJoinText: { color: '#FFF', fontSize: 17, fontWeight: '800' },
    fullClosedBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        backgroundColor: '#FEF2F2',
        paddingVertical: 18,
        paddingHorizontal: 24,
        borderRadius: 16,
        borderWidth: 1.5,
        borderColor: '#FECACA',
    },
    fullClosedBtnText: { color: DANGER, fontSize: 16, fontWeight: '800' },
    genderBlockedBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        backgroundColor: '#FDF2F8',
        paddingVertical: 18,
        paddingHorizontal: 24,
        borderRadius: 16,
        borderWidth: 1.5,
        borderColor: '#FBCFE8',
    },
    genderBlockedBtnText: { color: '#DB2777', fontSize: 15, fontWeight: '800', textAlign: 'center', flex: 1 },
    requestedBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: '#FFFBEB',
        paddingVertical: 16,
        borderRadius: 16,
        borderWidth: 1.5,
        borderColor: '#FDE68A',
    },
    requestedBtnText: { color: '#B45309', fontSize: 16, fontWeight: '800' },
    waitlistBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: '#F5F3FF',
        paddingVertical: 16,
        borderRadius: 16,
        borderWidth: 1.5,
        borderColor: '#DDD6FE',
    },
    waitlistBtnText: { color: WAITLIST, fontSize: 16, fontWeight: '800' },
    joinedActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    chatBtn: { borderRadius: 16, overflow: 'hidden' },
    chatBtnGradient: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        paddingVertical: 18,
        paddingHorizontal: 28,
    },
    chatBtnText: { color: '#FFF', fontSize: 17, fontWeight: '800', letterSpacing: 0.2 },
    chatIconBtn: { borderRadius: 16, overflow: 'hidden' },
    chatIconBtnGradient: {
        width: 56,
        height: 56,
        alignItems: 'center',
        justifyContent: 'center',
    },
    joinedOutlineBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        minHeight: 56,
        paddingVertical: 14,
        borderRadius: 16,
        borderWidth: 1.5,
        borderColor: '#BBF7D0',
        backgroundColor: '#F0FDF4',
    },
    joinedOutlineText: { color: SUCCESS, fontSize: 15, fontWeight: '700' },
    hideFromListBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        minHeight: 52,
        paddingVertical: 16,
        paddingHorizontal: 22,
        borderRadius: 16,
        backgroundColor: '#FEF2F2',
        borderWidth: 1.5,
        borderColor: '#FECACA',
    },
    hideFromListText: { color: DANGER, fontSize: 16, fontWeight: '800', letterSpacing: 0.2 },
    creatorActions: { flexDirection: 'row', gap: 10, alignItems: 'center' },
    iconRoundBtn: {
        width: 52,
        height: 52,
        borderRadius: 16,
        backgroundColor: '#EFF6FF',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: '#BFDBFE',
    },
});

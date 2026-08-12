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
    Modal,
    Platform,
    ScrollView,
    Share,
    StatusBar,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Alert } from '../../lib/nexoAlert';
import { styles } from '../../features/plan-detail/planDetailStyles';
import { PersonBubble } from '../../features/plan-detail/PersonBubble';
import type { Participant, PlanDetailSnapshot, PlanRow } from '../../features/plan-detail/types';
import { Marker } from 'react-native-maps';
import { NexoMapView } from '../../components/NexoMapView';
import { NexoEmptyState, NexoLoadingState } from '../../components/ui/NexoState';
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
import { theme } from '../../theme';
import { getMyProfile, getPublicProfileCards } from '../../lib/profileData';

const PLAN_DETAIL_TTL_MS = 90_000;
const planDetailKey = (id: string) => `planDetail:${id}`;

const PRIMARY = theme.colors.brand;
const PRIMARY_DARK = theme.colors.primary;
const INK = theme.colors.text;
const MUTED = theme.colors.textMuted;
const SUCCESS = theme.colors.success;
const DANGER = theme.colors.danger;
const WAITLIST = theme.colors.accent;

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

            const [partsRes, myPartRes, savedRes, friendsData, coincidedSet, stats, myProfileRes] = await Promise.all([
                supabase
                    .from('participantes')
                    .select('usuario_id, estado')
                    .eq('plan_id', planId)
                    .eq('estado', 'aceptado'),
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
                    ? getMyProfile()
                    : Promise.resolve({ data: null, error: null }),
            ]);
            if (gen !== loadGenRef.current) return;

            const accepted = (partsRes.data || []).filter((p: { estado: string }) =>
                isAcceptedParticipant(p.estado),
            );

            const profileIds = [
                planRow.creador_id,
                ...accepted.map((p: { usuario_id: string }) => p.usuario_id),
            ];
            const publicProfiles = await getPublicProfileCards(profileIds);
            const profileMap = new Map(publicProfiles.map((profile) => [profile.id, profile]));
            const creatorData = profileMap.get(planRow.creador_id);
            const creatorProfile: Participant | null = creatorData
                ? { ...creatorData, nombre: creatorData.nombre ?? t('profile.user'), isCreator: true }
                : null;

            const list: Participant[] = [];
            if (creatorProfile) list.push(creatorProfile);
            accepted.forEach((p: any) => {
                const prof = profileMap.get(p.usuario_id);
                if (prof && prof.id !== planRow.creador_id) {
                    list.push({ ...prof, nombre: prof.nombre ?? t('profile.user'), isCreator: false });
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
    }, [planId, applyDetailSnapshot, t]);

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
                                <ActivityIndicator color={theme.colors.surface} />
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
                                <Ionicons name="chatbubbles" size={22} color={theme.colors.surface} />
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
                                <Ionicons name="chatbubbles" size={22} color={theme.colors.surface} />
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
                                <Ionicons name="chatbubbles" size={22} color={theme.colors.surface} />
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
                    <Ionicons name="list" size={20} color={theme.colors.surface} />
                    <Text style={styles.waitlistJoinText}>{t('card.joinWaitlist')}</Text>
                </TouchableOpacity>
            );
        }

        return (
            <TouchableOpacity style={styles.joinBtn} onPress={handleJoin} activeOpacity={0.9} disabled={actionBusy}>
                <LinearGradient colors={[PRIMARY, PRIMARY_DARK]} style={styles.joinBtnGradient}>
                    <Text style={styles.joinBtnText}>{requiresApproval ? t('card.request') : t('card.join')}</Text>
                    <Ionicons name={requiresApproval ? 'shield-checkmark' : 'arrow-forward'} size={20} color={theme.colors.surface} />
                </LinearGradient>
            </TouchableOpacity>
        );
    };

    if (loading && !plan) {
        return <NexoLoadingState style={styles.loadingWrap} />;
    }

    if (!plan) {
        return (
            <SafeAreaView style={styles.notFoundWrap}>
                <NexoEmptyState
                    icon="compass-outline"
                    title={t('planDetail.notFound')}
                    actionLabel={t('common.back')}
                    onAction={() => router.back()}
                />
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
                            <Ionicons name="chevron-back" size={24} color={theme.colors.surface} />
                        </TouchableOpacity>
                        <View style={styles.heroTopRight}>
                            {!isPastPlan ? (
                                <TouchableOpacity style={styles.glassBtn} onPress={handleShare} activeOpacity={0.85}>
                                    <Ionicons name="arrow-redo" size={18} color={theme.colors.surface} />
                                </TouchableOpacity>
                            ) : null}
                            {!isPastPlan && !isCreator ? (
                                <TouchableOpacity style={styles.glassBtn} onPress={handleToggleSave} activeOpacity={0.85}>
                                    <Ionicons name={isSaved ? 'heart' : 'heart-outline'} size={20} color={isSaved ? DANGER : theme.colors.surface} />
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
                                    <Ionicons name="flag-outline" size={18} color={theme.colors.dangerBorder} />
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
                                <Ionicons name="chevron-forward" size={18} color={theme.colors.textSubtle} />
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
                                    <Ionicons name="expand" size={16} color={theme.colors.surface} />
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
                                <Ionicons name="navigate" size={18} color={theme.colors.surface} />
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

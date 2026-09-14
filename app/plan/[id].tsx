import {
    Ionicons
} from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
    useFocusEffect,
    useLocalSearchParams,
    useRouter
} from 'expo-router';
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react';
import {
    ActivityIndicator,
    Dimensions,
    InteractionManager,
    Modal,
    Platform,
    ScrollView,
    Share,
    StatusBar,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Marker } from 'react-native-maps';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { FitMatchBanner } from '../../components/FitMatchBanner';
import { FootballLineupSection } from '../../components/FootballLineup';
import { FootballShareCard } from '../../components/FootballShareCard';
import { InvitePeopleSheet, type InviteProfile } from '../../components/InvitePeopleSheet';
import { NexoMapView } from '../../components/NexoMapView';
import { PadelLineupSection } from '../../components/PadelLineup';
import { PlanCoverCarousel } from '../../components/PlanCoverCarousel';
import { ProfileAvatar } from '../../components/ProfileAvatar';
import { PlanDetailSkeleton } from '../../components/SkeletonShimmer';
import { TranslatedText } from '../../components/TranslatedText';
import { NexoEmptyState } from '../../components/ui/NexoState';
import { PersonBubble } from '../../features/plan-detail/PersonBubble';
import { createPlanDetailStyles } from '../../features/plan-detail/planDetailStyles';
import type { Participant, PlanDetailSnapshot, PlanRow } from '../../features/plan-detail/types';
import { useScrollViewRestore } from '../../hooks/useScrollViewRestore';
import { useAppTheme, useThemedStyles } from '../../lib/appTheme';
import { getAuthUser } from '../../lib/auth';
import { clearPendingAuthIntent, peekPendingAuthIntent } from '../../lib/authIntent';
import { useAuthSession } from '../../lib/authSession';
import { getCoincidedUserIds } from '../../lib/coincidences';
import { feedFitPercent } from '../../lib/feedAffinity';
import { FEED_CACHE_KEY, type FeedSnapshot } from '../../lib/feedCache';
import { fetchFitPersonalityTags } from '../../lib/feedLoad';
import { isGroupChatPlan } from '../../lib/feedPlans';
import { noteFeedInviteCleared, takeFeedMembershipPatches } from '../../lib/feedReload';
import {
    fetchFootballConfig,
    fetchFootballSlots,
    formatDisplayLabel,
    uiFormatFromConfig,
    type FootballConfig,
    type FootballOccupant,
} from '../../lib/footballLineup';
import { getFriends } from '../../lib/friends';
import { distanceKm, formatDistanceKm, openDirectionsTo } from '../../lib/geo';
import { fetchGuestPlanDetail } from '../../lib/guestFeed';
import { hapticError, hapticLight, hapticMedium, hapticSuccess } from '../../lib/haptics';
import { useT } from '../../lib/i18n';
import { kickParticipant } from '../../lib/kickParticipant';
import { broadcastPlanMembership } from '../../lib/membershipBroadcast';
import { hidePlanFromAttendedProfile, removePlanFromMyPlansAndHistory } from '../../lib/myPlansHide';
import { Alert } from '../../lib/nexoAlert';
import { persistJoinWithWaitlistFallback, persistLeave, persistSave } from '../../lib/offlineActions';
import { getOrganizerFollowStats, peekViewerIsOrganizer, rememberViewerIsOrganizer } from '../../lib/organizer';
import {
    canJoinWaitlist,
    formatPlanPeople,
    isAcceptedParticipant,
    mapEstadoToMembership,
    membershipFromJoinEstado,
    promoteWaitlist,
    resolveJoinEstado,
    type Membership,
} from '../../lib/participants';
import { planCoverList } from '../../lib/planCovers';
import {
    overlayOwnCreatorProfile,
    PLAN_DETAIL_TTL_MS,
    planDetailKey,
} from '../../lib/planDetailCache';
import {
    acceptPlanInvite,
    cancelPlanInvite,
    clearPendingPlanInvitesForMember,
    getPlanPendingInvitees,
    rejectPlanInvite,
    sendPlanInvite,
    type PlanInvite,
} from '../../lib/planInvites';
import {
    acceptPlanJoinRequest,
    fetchPlanJoinRequests,
    invalidatePlanJoinRequestCaches,
    rejectPlanJoinRequest,
    type PlanJoinRequest,
} from '../../lib/planJoinRequests';
import { formatCountdown, isPlanActiveForSaved, isPlanChatAlive, resolveRatingUiPhase } from '../../lib/planLifecycle';
import { MAX_ACTIVE_PLANS } from '../../lib/planLimits';
import { seedChatThreadPeek } from '../../lib/prefetchChats';
import { dismissPushForPlanDetail } from '../../lib/presentedPush';
import { getMyProfile, getPublicProfileCards } from '../../lib/profileData';
import { getPersonalityLabel, type Genero } from '../../lib/profileFields';
import { renderRatingStars } from '../../lib/profileRating';
import { getPendingRatingForPlan, subscribeRatingSession, type PendingRatingPlan } from '../../lib/ratings';
import { ScreenKeys } from '../../lib/screenState';
import { shareFootballCard } from '../../lib/shareFootballPlan';
import { buildPlanShareMessage } from '../../lib/shareLinks';
import { canJoinPlanByGender } from '../../lib/soloChicas';
import { resolvePlanSport } from '../../lib/sports';
import { EMPTY_STATS, formatRatingScore, getUserStats, personRepeatStat, type UserStats } from '../../lib/stats';
import { supabase } from '../../lib/supabase';
import { lockTabPager, unlockTabPager } from '../../lib/tabPagerScroll';
import { cacheGetStale, cacheIsFresh, cacheSet } from '../../lib/ttlCache';
import { prefetchUserProfile, seedUserProfilePeek } from '../../lib/userProfileCache';
import { getWaitlistPosition } from '../../lib/waitlistPosition';
import { theme } from '../../theme';

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
    const styles = useThemedStyles(createPlanDetailStyles);
    const { colors } = useAppTheme();
    const { requireAccount, userId: sessionUserId } = useAuthSession();
    const dateLocale = lang === 'en' ? 'en-GB' : 'es-ES';
    const { id, inviteId, inviterId, inviterName, inviterAvatar, inviteTipo, from } = useLocalSearchParams<{
        id: string | string[];
        inviteId?: string | string[];
        inviterId?: string | string[];
        inviterName?: string | string[];
        inviterAvatar?: string | string[];
        inviteTipo?: string | string[];
        /** attended = perfil «A los que he ido»; my-plans = Mis planes */
        from?: string | string[];
    }>();
    const planId = Array.isArray(id) ? id[0] : id;
    const openedFrom = Array.isArray(from) ? from[0] : from;
    const hideMode: 'attended' | 'my-plans' = openedFrom === 'attended' ? 'attended' : 'my-plans';
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
    const [organizerFollowers, setOrganizerFollowers] = useState<number | null>(
        () => cachedDetail?.organizerFollowers ?? null,
    );
    const [currentUserId, setCurrentUserId] = useState<string | null>(
        () => sessionUserId ?? cachedDetail?.currentUserId ?? null,
    );
    const [currentUserGenero, setCurrentUserGenero] = useState<Genero | null>(
        () => cachedDetail?.currentUserGenero ?? null,
    );
    const [currentUserIsOrganizer, setCurrentUserIsOrganizer] = useState(() => peekViewerIsOrganizer());
    const [membership, setMembership] = useState<Membership>(() => cachedDetail?.membership ?? 'none');
    const [friendIds, setFriendIds] = useState<Set<string>>(
        () => new Set(cachedDetail?.friendIds ?? []),
    );
    const [coincidedIds, setCoincidedIds] = useState<Set<string>>(
        () => new Set(cachedDetail?.coincidedIds ?? []),
    );
    const [fitPersonalityTags, setFitPersonalityTags] = useState<string[]>(() => {
        const snap = cacheGetStale<FeedSnapshot>(FEED_CACHE_KEY);
        return snap?.feedTaste?.personalityTags ?? [];
    });
    const [isSaved, setIsSaved] = useState(() => cachedDetail?.isSaved ?? false);
    const [actionBusy, setActionBusy] = useState(false);
    const [mapExpanded, setMapExpanded] = useState(false);
    const [mapPreviewReady, setMapPreviewReady] = useState(false);
    const [openRating, setOpenRating] = useState<PendingRatingPlan | null>(
        () => cachedDetail?.openRating ?? null,
    );
    const [ratingNowTick, setRatingNowTick] = useState(() => Date.now());
    const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);
    const [showInviteSheet, setShowInviteSheet] = useState(false);
    const [invitees, setInvitees] = useState<InviteProfile[]>([]);
    const [pendingJoinRequests, setPendingJoinRequests] = useState<PlanJoinRequest[]>([]);
    const joinRequestBusyRef = useRef<Set<string>>(new Set());
    const [waitlistPosition, setWaitlistPosition] = useState<number | null>(null);
    const [lineupReady, setLineupReady] = useState(false);
    const hasLoadedRef = useRef(!!cachedDetail);
    const loadGenRef = useRef(0);

    const applyDetailSnapshot = useCallback((snap: PlanDetailSnapshot) => {
        setPlan(snap.plan);
        setParticipants(snap.participants);
        setJoinedCount(snap.joinedCount);
        setCreator(snap.creator);
        setCreatorStats(snap.creatorStats);
        setOrganizerFollowers(snap.organizerFollowers ?? null);
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
            const userId = sessionUserId ?? (await getAuthUser())?.id ?? null;
            if (gen !== loadGenRef.current) return;
            setCurrentUserId(userId);
            const user = userId ? { id: userId } : null;

            const stale = cacheGetStale<PlanDetailSnapshot>(detailKey);
            if (stale) {
                applyDetailSnapshot(stale);
                setLoading(false);
                // Semillas del feed vienen sin user/amigos/guardados → hay que completar.
                const cacheComplete =
                    !stale.partial &&
                    (user ? stale.currentUserId === user.id : !stale.currentUserId) &&
                    (!stale.plan.es_organizador || stale.organizerFollowers != null);
                if (!opts?.force && cacheIsFresh(detailKey) && cacheComplete) return;
            } else if (!hasLoadedRef.current) {
                setLoading(true);
            }

            if (!user) {
                const guest = await fetchGuestPlanDetail(planId);
                if (gen !== loadGenRef.current) return;
                if (!guest) {
                    if (!stale) setPlan(null);
                    return;
                }
                const list = guest.participants.map((p) => ({
                    ...p,
                    nombre: p.nombre ?? t('profile.user'),
                }));
                const creatorProfile = guest.creator
                    ? { ...guest.creator, nombre: guest.creator.nombre ?? t('profile.user') }
                    : list.find((p) => p.isCreator) ?? null;
                const creatorId = (guest.plan as PlanRow).creador_id;
                const followStats =
                    (guest.plan as PlanRow).es_organizador && creatorId
                        ? await getOrganizerFollowStats(creatorId)
                        : { followers: null, following: false };
                if (gen !== loadGenRef.current) return;
                const snap: PlanDetailSnapshot = {
                    plan: guest.plan as PlanRow,
                    participants: list,
                    joinedCount: guest.joinedCount,
                    creator: creatorProfile,
                    creatorStats: EMPTY_STATS,
                    membership: 'none',
                    friendIds: [],
                    coincidedIds: [],
                    isSaved: false,
                    currentUserGenero: null,
                    openRating: null,
                    currentUserId: null,
                    organizerFollowers: followStats.followers,
                    partial: false,
                };
                applyDetailSnapshot(snap);
                setCurrentUserIsOrganizer(false);
                cacheSet(detailKey, snap, PLAN_DETAIL_TTL_MS);
                return;
            }

            const { data: planRow, error } = await supabase
                .from('planes')
                .select(
                    'id, titulo, imagen_url, imagenes_url, recurrencia, categoria, tipo_deporte, solo_chicas, modo_privado, fecha_evento, nombre_ubicacion, latitud, longitud, maximo_participantes, creador_id, requiere_aprobacion, descripcion, chat_eliminado_en',
                )
                .eq('id', planId)
                .maybeSingle();

            if (gen !== loadGenRef.current) return;
            if (error || !planRow) {
                if (!stale) setPlan(null);
                return;
            }

            setPlan(planRow as PlanRow);

            const [partsRes, myPartRes, savedRes, friendsData, coincidedSet, stats, followStats, myProfileRes, nextOpenRating] = await Promise.all([
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
                getOrganizerFollowStats(planRow.creador_id),
                user
                    ? getMyProfile()
                    : Promise.resolve({ data: null, error: null }),
                user ? getPendingRatingForPlan(user.id, planId, { force: true }) : Promise.resolve(null),
            ]);
            if (gen !== loadGenRef.current) return;

            const accepted = (partsRes.data || []).filter((p: { estado: string }) =>
                isAcceptedParticipant(p.estado),
            );

            const nextMembership = myPartRes.data?.estado
                ? (mapEstadoToMembership(myPartRes.data.estado) ?? 'none')
                : 'none';
            // Sticky de un join/leave reciente gana a un fetch que aún no ve la réplica.
            const sticky = takeFeedMembershipPatches()[planId];
            const resolvedMembership =
                sticky === 'none' || sticky === 'joined' || sticky === 'requested' || sticky === 'waitlist'
                    ? (sticky as Membership)
                    : nextMembership;
            const nextFriends = friendsData.map((f) => f.id);
            const nextCoincided = [...coincidedSet];
            const nextGenero = (myProfileRes.data?.genero as Genero) ?? null;
            const nextSaved = !!savedRes.data;
            setCurrentUserIsOrganizer(myProfileRes.data?.es_organizador === true);
            rememberViewerIsOrganizer(myProfileRes.data?.es_organizador === true);

            // Pintar amigos / conocidos / stats / CTA sin esperar a las fichas de perfiles.
            setFriendIds(new Set(nextFriends));
            setCoincidedIds(new Set(nextCoincided));
            setCreatorStats(stats);
            setMembership(resolvedMembership);
            setIsSaved(nextSaved);
            setCurrentUserGenero(nextGenero);
            setOpenRating(nextOpenRating);
            setOrganizerFollowers(followStats.followers ?? null);
            if (stale) {
                applyDetailSnapshot({
                    ...stale,
                    plan: { ...stale.plan, ...(planRow as PlanRow) },
                    friendIds: nextFriends,
                    coincidedIds: nextCoincided,
                    creatorStats: stats,
                    membership: resolvedMembership,
                    isSaved: nextSaved,
                    currentUserGenero: nextGenero,
                    openRating: nextOpenRating,
                    currentUserId: user.id,
                    organizerFollowers: followStats.followers ?? null,
                    partial: true,
                });
            }

            const profileIds = [
                planRow.creador_id,
                ...accepted.map((p: { usuario_id: string }) => p.usuario_id),
            ];
            const publicProfiles = await getPublicProfileCards(profileIds);
            const profileMap = new Map(publicProfiles.map((profile) => [profile.id, profile]));
            const creatorData = overlayOwnCreatorProfile(
                profileMap.get(planRow.creador_id),
                myProfileRes.data,
                user.id,
                planRow.creador_id,
            );
            const people = formatPlanPeople({
                creadorId: planRow.creador_id,
                creatorProfile: creatorData
                    ? { ...creatorData, nombre: creatorData.nombre ?? t('profile.user') }
                    : null,
                acceptedUserIds: accepted.map((p: { usuario_id: string }) => p.usuario_id),
                profileOf: (id) => {
                    const prof = profileMap.get(id);
                    return prof ? { ...prof, nombre: prof.nombre ?? t('profile.user') } : undefined;
                },
            });
            const creatorProfile = people.host;
            const list = people.participantsList;

            if (gen !== loadGenRef.current) return;

            const snap: PlanDetailSnapshot = {
                plan: {
                    ...(planRow as PlanRow),
                    es_organizador: creatorData?.es_organizador === true,
                },
                participants: list,
                joinedCount: people.joinedCount,
                creator: creatorProfile,
                creatorStats: stats,
                membership: resolvedMembership,
                friendIds: nextFriends,
                coincidedIds: nextCoincided,
                isSaved: nextSaved,
                currentUserGenero: nextGenero,
                openRating: nextOpenRating,
                currentUserId: user?.id ?? null,
                organizerFollowers: followStats.followers,
                partial: false,
            };
            applyDetailSnapshot(snap);
            cacheSet(detailKey, snap, PLAN_DETAIL_TTL_MS);
        } finally {
            if (gen === loadGenRef.current) setLoading(false);
        }
    }, [planId, applyDetailSnapshot, sessionUserId, t]);

    useFocusEffect(
        useCallback(() => {
            lockTabPager();
            if (planId) dismissPushForPlanDetail(planId);
            void loadPlan();
            return () => unlockTabPager();
        }, [loadPlan, planId]),
    );

    useEffect(() => {
        if (openRating?.phase !== 'waiting') return;
        const id = setInterval(() => setRatingNowTick(Date.now()), 1000);
        return () => clearInterval(id);
    }, [openRating?.phase, openRating?.planId]);

    // Si valoraste desde perfil / Mis planes, quitar el CTA aquí al instante (y al revés vía caché).
    useEffect(() => {
        if (!planId || !currentUserId) return;
        return subscribeRatingSession((evt) => {
            if (evt.type === 'removed' && evt.planId === planId) {
                setOpenRating(null);
            }
        });
    }, [planId, currentUserId]);

    // Sincronizar estado de corazón desde feed / saved-plans
    useEffect(() => {
        if (!planId) return;
        return subscribeSaveState((evt) => {
            if (evt.planId === planId) {
                setIsSaved(evt.saved);
            }
        });
    }, [planId]);

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
    }, [planId, currentUserId, membership, joinedCount, plan?.creador_id, plan?.es_organizador]);

    useEffect(() => {
        if (!currentUserId) {
            setFitPersonalityTags([]);
            return;
        }
        const cached = cacheGetStale<FeedSnapshot>(FEED_CACHE_KEY)?.feedTaste?.personalityTags;
        if (cached && cached.length > 0) {
            setFitPersonalityTags(cached);
            return;
        }
        let cancelled = false;
        void fetchFitPersonalityTags()
            .then((tags) => {
                if (!cancelled) setFitPersonalityTags(tags);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [currentUserId]);

    useEffect(() => {
        let cancelled = false;
        const task = InteractionManager.runAfterInteractions(() => {
            if (!cancelled) setLineupReady(true);
        });
        const fallback = setTimeout(() => {
            if (!cancelled) setLineupReady(true);
        }, 120);
        return () => {
            cancelled = true;
            task.cancel();
            clearTimeout(fallback);
        };
    }, [planId]);

    useEffect(() => {
        if (!plan) {
            setMapPreviewReady(false);
            return;
        }
        let cancelled = false;
        const task = InteractionManager.runAfterInteractions(() => {
            if (!cancelled) setMapPreviewReady(true);
        });
        const fallback = setTimeout(() => {
            if (!cancelled) setMapPreviewReady(true);
        }, 160);
        return () => {
            cancelled = true;
            task.cancel();
            clearTimeout(fallback);
        };
    }, [plan?.id]);

    useEffect(() => {
        if (!planId) return;
        const channel = supabase
            .channel(`plan-spots:${planId}:${Math.random().toString(36).slice(2, 8)}`)
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
                        const creatorId = plan?.creador_id;
                        const attendeeCount = plan?.es_organizador && creatorId
                            ? accepted.filter((p) => p.usuario_id !== creatorId).length
                            : accepted.length;
                        setJoinedCount(attendeeCount);

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

                        // Actualizar avatares de integrantes en vivo (no solo el contador).
                        if (creatorId) {
                            const profileIds = [
                                creatorId,
                                ...accepted.map((p) => p.usuario_id as string),
                            ];
                            const publicProfiles = await getPublicProfileCards(profileIds);
                            const profileMap = new Map(publicProfiles.map((profile) => [profile.id, profile]));
                            const creatorData = profileMap.get(creatorId);
                            const people = formatPlanPeople({
                                creadorId: creatorId,
                                creatorProfile: creatorData
                                    ? { ...creatorData, nombre: creatorData.nombre ?? t('profile.user') }
                                    : null,
                                acceptedUserIds: accepted.map((p) => p.usuario_id as string),
                                profileOf: (id) => {
                                    const prof = profileMap.get(id);
                                    return prof ? { ...prof, nombre: prof.nombre ?? t('profile.user') } : undefined;
                                },
                            });
                            setParticipants(people.participantsList as Participant[]);
                            if (people.host) setCreator(people.host as Participant);
                            setJoinedCount(people.joinedCount);
                        }
                    })();
                },
            )
            .subscribe();
        return () => {
            void supabase.removeChannel(channel);
        };
    }, [planId, currentUserId, plan?.creador_id, plan?.es_organizador, t]);

    const isCreator = currentUserId && plan && String(plan.creador_id) === String(currentUserId);
    const planFitPct = useMemo(() => {
        if (!plan || !currentUserId || isCreator || currentUserIsOrganizer) return null;
        const feedTaste = cacheGetStale<FeedSnapshot>(FEED_CACHE_KEY)?.feedTaste;
        return feedFitPercent(
            {
                categoria: plan.categoria,
                tipo_deporte: plan.tipo_deporte,
                fecha_evento: plan.fecha_evento,
                solo_chicas: plan.solo_chicas,
            },
            {
                personalityTags: fitPersonalityTags,
                viewerAge: feedTaste?.viewerAge ?? null,
                viewerGenero: currentUserGenero,
            },
            plan.id,
        );
    }, [plan, currentUserId, isCreator, currentUserIsOrganizer, fitPersonalityTags, currentUserGenero]);
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

    const loadPendingJoinRequests = useCallback(async () => {
        if (!planId || !currentUserId || !plan || String(plan.creador_id) !== String(currentUserId) || isPastPlan) {
            setPendingJoinRequests([]);
            return;
        }
        try {
            const rows = await fetchPlanJoinRequests(planId);
            setPendingJoinRequests(rows.filter((r) => !joinRequestBusyRef.current.has(r.userId)));
        } catch {
            setPendingJoinRequests([]);
        }
    }, [planId, currentUserId, plan, isPastPlan]);

    useEffect(() => {
        void loadPendingJoinRequests();
    }, [loadPendingJoinRequests]);

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
                        setTimeout(() => {
                            void loadPlan({ force: true });
                        }, 400);
                    })();
                },
            },
        ]);
    };

    const handleAcceptJoinRequest = (req: PlanJoinRequest) => {
        if (!plan || !currentUserId || !planId) return;
        if (joinedCount >= plan.maximo_participantes) {
            Alert.alert(t('profile.error'), t('myplans.full'));
            return;
        }
        hapticSuccess();
        joinRequestBusyRef.current.add(req.userId);
        setPendingJoinRequests((prev) => prev.filter((r) => r.userId !== req.userId));
        void (async () => {
            try {
                const result = await acceptPlanJoinRequest(req.planId, req.userId, plan.maximo_participantes);
                if (!result.ok) {
                    joinRequestBusyRef.current.delete(req.userId);
                    setPendingJoinRequests((prev) =>
                        prev.some((r) => r.userId === req.userId) ? prev : [req, ...prev],
                    );
                    hapticError();
                    Alert.alert(
                        t('profile.error'),
                        result.code === 'full'
                            ? t('myplans.full')
                            : result.code === 'rls'
                              ? t('myplans.rlsHint')
                              : result.error,
                    );
                    return;
                }
                invalidatePlanJoinRequestCaches(currentUserId, planId);
                setTimeout(() => {
                    void loadPlan({ force: true });
                }, 400);
            } finally {
                joinRequestBusyRef.current.delete(req.userId);
                void loadPendingJoinRequests();
            }
        })();
    };

    const handleRejectJoinRequest = (req: PlanJoinRequest) => {
        if (!currentUserId || !planId) return;
        hapticLight();
        joinRequestBusyRef.current.add(req.userId);
        setPendingJoinRequests((prev) => prev.filter((r) => r.userId !== req.userId));
        void rejectPlanJoinRequest(req.planId, req.userId).then(({ ok, error }) => {
            if (!ok) {
                joinRequestBusyRef.current.delete(req.userId);
                setPendingJoinRequests((prev) =>
                    prev.some((r) => r.userId === req.userId) ? prev : [req, ...prev],
                );
                hapticError();
                if (error) Alert.alert(t('profile.error'), error);
                return;
            }
            invalidatePlanJoinRequestCaches(currentUserId, planId);
            joinRequestBusyRef.current.delete(req.userId);
        });
    };

    const openProfile = (userId: string) => {
        if (requireAccount({ type: 'view-profile', userId })) return;
        const person =
            (creator && creator.id === userId ? creator : null) ||
            participants.find((p) => p.id === userId) ||
            null;
        seedUserProfilePeek({
            id: userId,
            nombre: person?.nombre,
            avatar_url: person?.avatar_url,
            es_organizador: !!plan?.es_organizador && plan?.creador_id === userId,
        });
        prefetchUserProfile(userId);
        router.push({
            pathname: '/user-profile/[id]',
            params: { id: userId, isFriend: friendIds.has(userId) ? '1' : '0' },
        });
    };

    const footballShareRef = useRef<View>(null);
    const footballSharePendingRef = useRef(false);
    const [footballSharePack, setFootballSharePack] = useState<{
        config: FootballConfig | null;
        slots: FootballOccupant[];
        when: string;
    } | null>(null);
    const [footballShareBusy, setFootballShareBusy] = useState(false);

    useEffect(() => {
        if (!footballSharePack || !plan || !footballSharePendingRef.current) return;
        footballSharePendingRef.current = false;
        let cancelled = false;
        void (async () => {
            const formatLabel = footballSharePack.config
                ? formatDisplayLabel(uiFormatFromConfig(footballSharePack.config))
                : null;
            const spotsLeft = Math.max(0, plan.maximo_participantes - joinedCount);
            try {
                await shareFootballCard({
                    cardRef: footballShareRef,
                    input: {
                        planId: plan.id,
                        title: plan.titulo,
                        location: plan.nombre_ubicacion,
                        when: footballSharePack.when || null,
                        spotsLeft,
                        maxPeople: plan.maximo_participantes,
                        joinedCount,
                        config: footballSharePack.config,
                        slots: footballSharePack.slots,
                        people: participants.map((p) => ({
                            id: p.id,
                            nombre: p.nombre,
                            avatar_url: p.avatar_url,
                        })),
                        formatLabel,
                        lang,
                    },
                });
            } finally {
                if (!cancelled) {
                    setFootballShareBusy(false);
                    setFootballSharePack(null);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [footballSharePack, plan, joinedCount, participants, lang]);

    const handleShare = async () => {
        if (!plan || footballShareBusy) return;
        const when = eventDate ? `${dateString}${timeString ? ` · ${timeString}` : ''}` : '';
        const isFootball = sportPlan?.tipo === 'futbol';

        if (!isFootball) {
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
            return;
        }

        setFootballShareBusy(true);
        try {
            const [config, slots] = await Promise.all([
                fetchFootballConfig(plan.id),
                fetchFootballSlots(plan.id),
            ]);
            footballSharePendingRef.current = true;
            setFootballSharePack({ config, slots, when });
        } catch {
            setFootballShareBusy(false);
            footballSharePendingRef.current = false;
        }
    };

    const handleToggleSave = async () => {
        if (requireAccount({ type: 'save-plan', planId: planId ?? '' })) return;
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
            const { error } = await persistSave(planId, currentUserId, false);
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
            const { error } = await persistSave(planId, currentUserId, true);
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
        if (requireAccount({ type: 'join', planId: plan?.id ?? planId ?? '' })) return;
        if (!currentUserId || !plan || actionBusy) return;
        if (isPastPlan) return;
        if (currentUserIsOrganizer) {
            hapticError();
            Alert.alert(t('feed.error'), t('organizer.cannotJoin'));
            return;
        }
        if (!canJoinPlanByGender(plan, currentUserGenero)) {
            hapticError();
            Alert.alert(t('feed.error'), t('card.soloChicasOnly'));
            return;
        }
        hapticMedium();
        // UI al instante; el límite lo valida el servidor (y localmente el organizador).
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

        const { queued, error, estado: applied } = await persistJoinWithWaitlistFallback(
            {
                planId: plan.id,
                userId: currentUserId,
                estado,
                planTitle: plan.titulo,
                fechaEvento: plan.fecha_evento,
                categoria: plan.categoria,
                locationName: plan.nombre_ubicacion,
            },
            waitlistOpen,
        );
        if (error) {
            setMembership(prevMembership);
            setJoinedCount(prevCount);
            hapticError();
            Alert.alert(
                t('feed.error'),
                error.message?.includes('organizer_cannot_join')
                    ? t('organizer.cannotJoin')
                    : String(error.message || '').toLowerCase().includes('plan_full')
                      ? t('feed.planFull')
                      : /active_plan_limit/i.test(String(error.message || ''))
                        ? t('feed.planLimitReached', { max: MAX_ACTIVE_PLANS })
                        : t('feed.joinError'),
            );
        } else {
            if (applied === 'lista_espera' && estado === 'aceptado') {
                setMembership('waitlist');
                setJoinedCount(prevCount);
                Alert.alert(t('feed.joinedWaitlist'));
            }
            hapticSuccess();
            const finalMembership: Membership =
                applied === 'lista_espera'
                    ? 'waitlist'
                    : applied === 'pendiente'
                      ? 'requested'
                      : (nextMembership as Membership);
            broadcastPlanMembership(plan.id, finalMembership, {
                userId: currentUserId,
                bumpJoined: finalMembership === 'joined' && prevMembership !== 'joined',
                clearInvite: true,
            });
            setInviteHandled(true);
            // Por si entró con inviteId pero usó Me apunto normal (o el join del feed).
            void clearPendingPlanInvitesForMember(plan.id, currentUserId);
            if (applied === 'aceptado') {
                void import('../../lib/chatUnread').then(({ markPlanChatRead }) =>
                    markPlanChatRead(currentUserId, plan.id),
                );
            }
            if (!queued) {
                void import('../../lib/push').then(({ notifyPlanJoin, schedulePlanLifecycleReminders }) => {
                    notifyPlanJoin(plan.id, applied);
                    if (applied === 'aceptado') {
                        void schedulePlanLifecycleReminders({
                            planId: plan.id,
                            planTitle: plan.titulo,
                            fechaEvento: plan.fecha_evento,
                            categoria: plan.categoria,
                        });
                    }
                });
                // Soft refresh diferido: force inmediato congelaba tras unirse.
                setTimeout(() => {
                    void loadPlan({ force: true });
                }, 600);
            }
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
                        const { queued, error } = await persistLeave(plan.id, currentUserId, wasJoined);

                        if (error) {
                            setMembership(prevMembership);
                            setJoinedCount(prevCount);
                            Alert.alert(t('feed.error'), t('feed.leaveError'));
                        } else {
                            broadcastPlanMembership(plan.id, 'none', {
                                userId: currentUserId,
                                dropJoined: wasJoined,
                            });
                            if (wasJoined && !queued) {
                                void promoteWaitlist(plan.id).then(() => {
                                    setTimeout(() => {
                                        void loadPlan({ force: true });
                                    }, 600);
                                });
                            }
                        }
                    })();
                },
            },
        ]);
    };

    const pendingIntentDoneRef = useRef(false);
    useEffect(() => {
        if (!currentUserId || !plan || pendingIntentDoneRef.current) return;
        pendingIntentDoneRef.current = true;
        void (async () => {
            const intent = await peekPendingAuthIntent();
            if (!intent) return;
            if ((intent.type === 'join' || intent.type === 'save-plan') && intent.planId === plan.id) {
                await clearPendingAuthIntent();
                if (intent.type === 'join') await handleJoin();
                else await handleToggleSave();
            }
        })();
    }, [currentUserId, plan, handleJoin, handleToggleSave]);

    const chatAlive = plan ? isPlanChatAlive(plan) : false;

    const openPlanChat = useCallback(() => {
        if (!plan) return;
        seedChatThreadPeek(currentUserId, {
            id: plan.id,
            title: plan.titulo,
            image_url: plan.imagen_url,
            kind: isGroupChatPlan(plan) ? 'group' : 'plan',
            creadorId: plan.creador_id,
            fechaEvento: plan.fecha_evento,
        });
        router.push(`/chat/${plan.id}`);
    }, [plan, currentUserId, router]);

    const confirmHideFromMyList = () => {
        if (!plan || !currentUserId) return;
        const isAttended = hideMode === 'attended';
        Alert.alert(
            t(isAttended ? 'planDetail.hideFromAttendedTitle' : 'planDetail.hideFromListTitle'),
            undefined,
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t(isAttended ? 'planDetail.hideFromAttendedConfirm' : 'planDetail.hideFromListConfirm'),
                    style: 'destructive',
                    onPress: async () => {
                        const { error } = isAttended
                            ? await hidePlanFromAttendedProfile(currentUserId, plan.id)
                            : await removePlanFromMyPlansAndHistory(currentUserId, plan.id);
                        if (error) {
                            Alert.alert(t('feed.error'), t('planDetail.hideFromListError'));
                            return;
                        }
                        router.back();
                    },
                },
            ],
        );
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
            const { error, estado, max, alreadyMember } = await acceptPlanInvite(invite, currentUserId);
            if (error === 'full') {
                Alert.alert(t('feed.error'), t('friends.inviteFull'));
                return;
            }
            if (error === 'limit') {
                Alert.alert(t('feed.error'), t('feed.planLimitReached', { max: max ?? MAX_ACTIVE_PLANS }));
                return;
            }
            if (error === 'organizer_cannot_join') {
                Alert.alert(t('feed.error'), t('organizer.cannotJoin'));
                return;
            }
            if (error) {
                Alert.alert(t('feed.error'), error);
                return;
            }
            const nextMembership =
                estado === 'pendiente' ? 'requested' : estado === 'lista_espera' ? 'waitlist' : 'joined';
            const bumpJoined = !alreadyMember && estado === 'aceptado';
            setInviteHandled(true);
            setMembership(nextMembership);
            if (bumpJoined) setJoinedCount((c) => c + 1);
            broadcastPlanMembership(plan.id, nextMembership, {
                userId: currentUserId,
                bumpJoined,
                clearInvite: true,
            });
            setTimeout(() => {
                void loadPlan({ force: true });
            }, 600);
        } finally {
            setActionBusy(false);
        }
    };

    const handleRejectIncomingInvite = () => {
        if (!pendingInviteId || actionBusy) return;
        setInviteHandled(true);
        if (planId) noteFeedInviteCleared(planId);
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
            !currentUserIsOrganizer &&
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
                <View style={styles.pastPlanActions}>
                    {chatAlive ? (
                        <TouchableOpacity
                            style={styles.pastPlanPrimaryBtn}
                            activeOpacity={0.9}
                            onPress={openPlanChat}
                        >
                            <LinearGradient colors={[PRIMARY, PRIMARY_DARK]} style={styles.pastPlanPrimaryGradient}>
                                <Ionicons name="chatbubbles" size={20} color={theme.colors.surface} />
                                <Text style={styles.chatBtnText}>{t('planDetail.openChat')}</Text>
                            </LinearGradient>
                        </TouchableOpacity>
                    ) : null}
                    <View style={styles.pastPlanSecondaryRow}>
                        {isCreator ? (
                            <TouchableOpacity
                                style={styles.pastPlanSecondaryBtn}
                                onPress={() =>
                                    router.push({ pathname: '/create-plan', params: { duplicateId: plan!.id } })
                                }
                                activeOpacity={0.85}
                            >
                                <Ionicons name="copy-outline" size={19} color={PRIMARY_DARK} />
                                <Text style={styles.pastPlanSecondaryText} numberOfLines={1}>
                                    {t('createplan.duplicate')}
                                </Text>
                            </TouchableOpacity>
                        ) : null}
                        <TouchableOpacity
                            style={[
                                styles.pastPlanSecondaryBtn,
                                styles.pastPlanDangerBtn,
                                !isCreator && styles.pastPlanSecondaryBtnFull,
                            ]}
                            onPress={confirmHideFromMyList}
                            activeOpacity={0.85}
                        >
                            <Ionicons name="trash-outline" size={19} color={DANGER} />
                            <Text style={[styles.pastPlanSecondaryText, styles.pastPlanDangerText]} numberOfLines={1}>
                                {t('planDetail.hideFromList')}
                            </Text>
                        </TouchableOpacity>
                    </View>
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
                            onPress={openPlanChat}
                        >
                            <LinearGradient colors={[PRIMARY, PRIMARY_DARK]} style={styles.chatBtnGradient}>
                                <Ionicons name="chatbubbles" size={22} color={theme.colors.surface} />
                                <Text style={styles.chatBtnText}>{t('planDetail.openChat')}</Text>
                            </LinearGradient>
                        </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                        style={styles.iconRoundBtn}
                        onPress={() => router.push({ pathname: '/create-plan', params: { editId: plan!.id } })}
                    >
                        <Ionicons name="create-outline" size={22} color={PRIMARY_DARK} />
                    </TouchableOpacity>
                </View>
            );
        }

        if (membership === 'joined') {
            return (
                <View style={styles.joinedActions}>
                    <TouchableOpacity style={styles.joinedOutlineBtn} onPress={handleLeave} activeOpacity={0.85}>
                        <Ionicons name="checkmark-circle" size={20} color="#059669" />
                        <Text style={styles.joinedOutlineText}>
                            {t(currentUserGenero === 'femenino' ? 'card.joinedF' : 'card.joined')}
                        </Text>
                    </TouchableOpacity>
                    {chatAlive ? (
                        <TouchableOpacity
                            style={styles.chatIconBtn}
                            activeOpacity={0.9}
                            onPress={openPlanChat}
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
                <View style={{ width: '100%', gap: 8 }}>
                    <TouchableOpacity style={styles.requestedBtn} onPress={handleLeave} activeOpacity={0.85}>
                        <Ionicons name="time" size={20} color="#B45309" />
                        <Text style={styles.requestedBtnText}>{t('card.requested')}</Text>
                    </TouchableOpacity>
                    <Text style={{ textAlign: 'center', fontSize: 13, fontWeight: '600', color: '#64748B' }}>
                        {t('card.requestHint')}
                    </Text>
                </View>
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

        if (isPastPlan) {
            return (
                <View style={styles.pastPlanBtn}>
                    <Ionicons name="time-outline" size={20} color="#64748B" />
                    <Text style={styles.pastPlanBtnText}>{t('planDetail.alreadyHappened')}</Text>
                </View>
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

        if (currentUserIsOrganizer) {
            return (
                <View style={styles.organizerBlockedBtn}>
                    <Ionicons name="briefcase-outline" size={20} color={PRIMARY_DARK} />
                    <Text style={styles.organizerBlockedBtnText}>{t('organizer.cannotJoinHint')}</Text>
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
            <View style={{ width: '100%', gap: 8 }}>
            <TouchableOpacity style={styles.joinBtn} onPress={handleJoin} activeOpacity={0.9} disabled={actionBusy}>
                <LinearGradient colors={[PRIMARY, PRIMARY_DARK]} style={styles.joinBtnGradient}>
                    <Text style={styles.joinBtnText}>{requiresApproval ? t('card.request') : t('card.join')}</Text>
                </LinearGradient>
            </TouchableOpacity>
            {requiresApproval ? (
                <Text style={{ textAlign: 'center', fontSize: 13, fontWeight: '600', color: '#64748B' }}>
                    {t('card.requestHint')}
                </Text>
            ) : null}
            </View>
        );
    };

    if (loading && !plan) {
        return <PlanDetailSkeleton />;
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

    const creatorIsFriend = !currentUserIsOrganizer && creator ? friendIds.has(creator.id) : false;
    const creatorRoleLabel = plan.es_organizador
        ? t('organizer.badge')
        : creator?.genero === 'femenino'
          ? t('planDetail.creatorFemale')
          : t('planDetail.creator');
    // Chat/editar (creador) o invite: más aire. Apuntado / Me apunto: más compacto.
    const roomyBottomBar =
        fromInvite ||
        isCreator ||
        (isPastPlan &&
            (isCreator ||
                membership === 'joined' ||
                membership === 'requested' ||
                membership === 'waitlist'));
    const scrollBottomPad = insets.bottom + (fromInvite ? 200 : roomyBottomBar ? 148 : 108);
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
    const personRep = personRepeatStat(creatorStats, {
        isSelf: !!isCreator,
        genero: creator?.genero,
        t,
    });

    return (
        <View style={styles.root}>
            <ScrollView
                ref={scrollRef}
                onScroll={onScroll}
                scrollEventThrottle={scrollEventThrottle}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: scrollBottomPad }}
            >
                <View style={styles.heroWrap}>
                    <PlanCoverCarousel
                        covers={planCoverList(plan)}
                        fallback={plan.imagen_url}
                        width={Dimensions.get('window').width}
                        height={Math.min(440, Dimensions.get('window').width * 1.08)}
                        priority="high"
                        recyclingKey={plan.id}
                        dotsBottom={72}
                    />
                    <LinearGradient
                        pointerEvents="none"
                        colors={['transparent', 'rgba(15,23,42,0.35)', 'rgba(15,23,42,0.78)']}
                        locations={[0, 0.45, 1]}
                        style={styles.heroBottomScrim}
                    />
                    <View style={[styles.heroTopBar, { paddingTop: insets.top + 10 }]}>
                        <TouchableOpacity style={styles.glassBtn} onPress={() => router.back()} activeOpacity={0.85}>
                            <Ionicons name="chevron-back" size={24} color={theme.colors.surface} />
                        </TouchableOpacity>
                        <View style={styles.heroTopRight}>
                            {!isPastPlan ? (
                                <TouchableOpacity style={styles.glassBtnSm} onPress={handleShare} activeOpacity={0.85}>
                                    <Ionicons name="arrow-redo" size={15} color={theme.colors.surface} />
                                </TouchableOpacity>
                            ) : null}
                            {!isPastPlan && !isCreator ? (
                                <TouchableOpacity style={styles.glassBtnSm} onPress={handleToggleSave} activeOpacity={0.85}>
                                    <Ionicons name={isSaved ? 'heart' : 'heart-outline'} size={16} color={isSaved ? DANGER : theme.colors.surface} />
                                </TouchableOpacity>
                            ) : null}
                            {!isCreator && currentUserId ? (
                                <TouchableOpacity
                                    style={styles.glassBtnSm}
                                    onPress={() =>
                                        router.push({ pathname: '/report-plan', params: { planId: plan.id } })
                                    }
                                    activeOpacity={0.85}
                                >
                                    <Ionicons name="flag-outline" size={15} color={theme.colors.dangerBorder} />
                                </TouchableOpacity>
                            ) : null}
                        </View>
                    </View>
                    <View style={styles.heroTitleWrap} pointerEvents="box-none">
                        <TranslatedText text={plan.titulo} style={styles.planTitleOnHero} />
                    </View>
                </View>

                <View style={styles.sheet}>
                    {plan.recurrencia?.freq ? (
                        <View style={[styles.titleBlock, { marginBottom: 12 }]}>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                                <View style={[styles.categoryChipLight, { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 0 }]}>
                                    <Ionicons name="repeat" size={13} color={PRIMARY_DARK} />
                                    <Text style={styles.categoryChipLightText}>{t('organizer.recurring')}</Text>
                                </View>
                            </View>
                        </View>
                    ) : null}

                    {openRating ? (
                        resolveRatingUiPhase(openRating, ratingNowTick) === 'waiting' ? (
                            <View style={[styles.rateBanner, styles.rateBannerWait]}>
                                <View style={[styles.rateBannerIcon, styles.rateBannerIconWait]}>
                                    <Ionicons name="hourglass-outline" size={18} color={WAITLIST} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.rateBannerTitle}>
                                        {t('ratings.unlockIn', {
                                            time: formatCountdown(
                                                Math.max(0, openRating.unlockAt - ratingNowTick),
                                            ),
                                        })}
                                    </Text>
                                </View>
                            </View>
                        ) : (
                        <TouchableOpacity
                            style={styles.rateBanner}
                            activeOpacity={0.88}
                            onPress={() =>
                                router.push({ pathname: '/rate-plan', params: { planId: plan.id } })
                            }
                        >
                            <View style={styles.rateBannerIcon}>
                                <Ionicons name="star" size={18} color={PRIMARY_DARK} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.rateBannerTitle}>{t('planDetail.rateOrg')}</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color={PRIMARY_DARK} />
                        </TouchableOpacity>
                        )
                    ) : null}

                    <View style={styles.dateRow}>
                        <View style={styles.dateCard}>
                            <Ionicons name="calendar" size={20} color={PRIMARY_DARK} />
                            <Text style={styles.dateValue}>{dateString}</Text>
                        </View>
                        {timeString ? (
                            <View style={styles.dateCard}>
                                <Ionicons name="time" size={20} color={PRIMARY_DARK} />
                                <Text style={styles.dateValue}>{timeString}</Text>
                            </View>
                        ) : null}
                    </View>

                    {planFitPct != null ? (
                        <FitMatchBanner
                            pct={planFitPct}
                            label={t('card.fitMatch', { pct: planFitPct })}
                            detail
                        />
                    ) : null}

                    {creator && (
                        <View style={[styles.section, planFitPct != null && styles.sectionAfterFit]}>
                            <Text style={styles.sectionTitle}>{creatorRoleLabel}</Text>
                            <View style={[styles.creatorCard, creatorIsFriend && styles.creatorCardFriend]}>
                                <TouchableOpacity
                                    style={styles.creatorMain}
                                    activeOpacity={0.85}
                                    onPress={() => openProfile(creator.id)}
                                >
                                    <View style={[styles.creatorAvatarWrap, creatorIsFriend && styles.creatorAvatarWrapFriend]}>
                                        <ProfileAvatar
                                            uri={creator.avatar_url}
                                            name={creator.nombre}
                                            size={creatorIsFriend ? 78 : 84}
                                            recyclingKey={creator.id}
                                        />
                                    </View>
                                    <View style={styles.creatorInfo}>
                                        <Text style={[styles.creatorName, creatorIsFriend && styles.creatorNameFriend]}>
                                            {creator.nombre}
                                        </Text>
                                        <View style={styles.ratingRow}>
                                            {plan.es_organizador ? (
                                                <>
                                                    {renderRatingStars(creatorStats.valoracionMedia, 18)}
                                                    <Text style={styles.ratingText}>{ratingLabel}</Text>
                                                </>
                                            ) : (
                                                <Text style={styles.ratingText}>
                                                    {personRep.repeatPct != null
                                                        ? `${personRep.repeatPct}% ${personRep.label}`
                                                        : `${personRep.middleText} ${personRep.label}`}
                                                </Text>
                                            )}
                                        </View>
                                        {plan.es_organizador && organizerFollowers != null ? (
                                            <Text style={styles.membersText}>
                                                {t(
                                                    organizerFollowers === 1
                                                        ? 'planDetail.orgMembersOne'
                                                        : 'planDetail.orgMembers',
                                                    { n: organizerFollowers },
                                                )}
                                            </Text>
                                        ) : null}
                                        {!plan.es_organizador && (creator.ambientes_preferidos?.length || creator.etiquetas?.length) ? (
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

                    {isCreator && !isPastPlan && pendingJoinRequests.length > 0 ? (
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>{t('planDetail.joinRequests')}</Text>
                            <Text style={[styles.membersText, { marginBottom: 10 }]}>
                                {t('planDetail.joinRequestsSub')}
                            </Text>
                            <View style={styles.joinRequestsBlock}>
                                {pendingJoinRequests.map((req) => (
                                    <View key={req.userId} style={styles.joinRequestRow}>
                                        <TouchableOpacity
                                            style={styles.joinRequestUser}
                                            onPress={() => openProfile(req.userId)}
                                            activeOpacity={0.85}
                                        >
                                            <ProfileAvatar
                                                uri={req.avatar_url}
                                                name={req.nombre || 'U'}
                                                size={40}
                                                recyclingKey={req.userId}
                                            />
                                            <Text style={styles.joinRequestName} numberOfLines={1}>
                                                {req.nombre || t('profile.user')}
                                            </Text>
                                        </TouchableOpacity>
                                        <View style={styles.joinRequestActions}>
                                            <TouchableOpacity
                                                style={[styles.joinRequestBtn, { backgroundColor: SUCCESS }]}
                                                onPress={() => handleAcceptJoinRequest(req)}
                                            >
                                                <Ionicons name="checkmark" size={20} color="#FFF" />
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                style={[styles.joinRequestBtn, styles.joinRequestBtnReject]}
                                                onPress={() => handleRejectJoinRequest(req)}
                                            >
                                                <Ionicons name="close" size={20} color={DANGER} />
                                            </TouchableOpacity>
                                        </View>
                                    </View>
                                ))}
                            </View>
                        </View>
                    ) : null}

                    <View style={styles.section}>
                        <View style={styles.sectionHeaderRow}>
                            <Text style={styles.sectionTitle}>{t('planDetail.participants')}</Text>
                            <Text style={styles.participantCount}>
                                {participants.length}/{plan.maximo_participantes}
                            </Text>
                        </View>
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
                                            isFriend={!currentUserIsOrganizer && friendIds.has(p.id)}
                                            isAcquaintance={
                                                !currentUserIsOrganizer &&
                                                !isPastPlan &&
                                                coincidedIds.has(p.id) &&
                                                !friendIds.has(p.id)
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
                    </View>

                    {sportPlan?.tipo === 'futbol' && lineupReady ? (
                        <FootballLineupSection
                            planId={plan.id}
                            maxPeople={plan.maximo_participantes}
                            isCreator={isCreator}
                            canClaim={!isPastPlan && !currentUserIsOrganizer && (membership === 'joined' || isCreator)}
                            currentUserId={currentUserId}
                            participants={participants}
                            onOpenProfile={openProfile}
                            viewerIsOrganizer={currentUserIsOrganizer}
                        />
                    ) : null}

                    {sportPlan?.tipo === 'padel' && lineupReady ? (
                        <PadelLineupSection
                            planId={plan.id}
                            maxPeople={plan.maximo_participantes}
                            isCreator={isCreator}
                            canClaim={!isPastPlan && !currentUserIsOrganizer && (membership === 'joined' || isCreator)}
                            currentUserId={currentUserId}
                            participants={participants}
                            onOpenProfile={openProfile}
                            viewerIsOrganizer={currentUserIsOrganizer}
                        />
                    ) : null}

                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>{t('planDetail.about')}</Text>
                        <TranslatedText
                            text={plan.descripcion?.trim() || null}
                            empty={t('card.noDescription')}
                            style={styles.description}
                        />
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
                            {mapPreviewReady ? (
                                <NexoMapView
                                    key={`preview-${plan.id}-${lat}-${lng}`}
                                    style={styles.map}
                                    scrollEnabled={false}
                                    zoomEnabled={false}
                                    pitchEnabled={false}
                                    rotateEnabled={false}
                                    loadingEnabled
                                    pointerEvents="none"
                                    initialRegion={{
                                        latitude: lat,
                                        longitude: lng,
                                        latitudeDelta: 0.008,
                                        longitudeDelta: 0.008,
                                    }}
                                >
                                    <Marker coordinate={{ latitude: lat, longitude: lng }} />
                                </NexoMapView>
                            ) : (
                                <View style={styles.mapPlaceholder}>
                                    <Ionicons name="map-outline" size={36} color={PRIMARY_DARK} />
                                </View>
                            )}
                            <View style={styles.mapTapOverlay} pointerEvents="none">
                                <View style={styles.mapExpandPill}>
                                    <Ionicons name="expand" size={16} color={theme.colors.surface} />
                                    <Text style={styles.mapExpandText}>{t('planDetail.expandMap')}</Text>
                                </View>
                            </View>
                        </TouchableOpacity>
                        <View
                            style={
                                roomyBottomBar ? styles.mapBottomSpacer : styles.mapBottomSpacerCompact
                            }
                        />
                    </View>
                </View>
            </ScrollView>

            <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 20) }]}>
                {renderPrimaryAction()}
            </View>

            <Modal visible={mapExpanded} animationType="slide" onRequestClose={() => setMapExpanded(false)}>
                <View style={styles.fullMapRoot}>
                    <StatusBar barStyle={colors.statusBar === 'light' ? 'light-content' : 'dark-content'} />
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

            {footballSharePack && plan ? (
                <View
                    pointerEvents="none"
                    style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        opacity: 0.02,
                        zIndex: -1,
                    }}
                    collapsable={false}
                >
                    <FootballShareCard
                        ref={footballShareRef}
                        title={plan.titulo}
                        when={footballSharePack.when || null}
                        location={plan.nombre_ubicacion}
                        spotsLeft={Math.max(0, plan.maximo_participantes - joinedCount)}
                        maxPeople={plan.maximo_participantes}
                        joinedCount={joinedCount}
                        config={footballSharePack.config}
                        slots={footballSharePack.slots}
                        people={participants.map((p) => ({
                            id: p.id,
                            nombre: p.nombre,
                            avatar_url: p.avatar_url,
                        }))}
                        lang={lang}
                    />
                </View>
            ) : null}
        </View>
    );
}

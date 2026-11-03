import {
    Ionicons } from '@expo/vector-icons';
import { useFocusEffect,
    useLocalSearchParams,
    useRouter } from 'expo-router';
import { startTransition,
    useCallback,
    useEffect,
    useRef,
    useState } from 'react';
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Alert } from '../../lib/nexoAlert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AvatarLightbox } from '../../components/AvatarLightbox';
import { ProfileScreenSkeleton } from '../../components/SkeletonShimmer';
import { useDelayedVisible } from '../../lib/useDelayedVisible';
import { MediaLightbox } from '../../components/MediaLightbox';
import { TranslatedText } from '../../components/TranslatedText';
import { ProfileAvatar } from '../../components/ProfileAvatar';
import { ProfileReputationStats } from '../../components/ProfileReputationStats';
import {
    AttendedPlansRow,
    FrostedIconButton,
    GalleryThumb,
    InterestTiles,
    MutualAvatarsRow,
    FollowersAvatarsRow,
    OrganizerIdentity,
    ProfileDualActions,
    ProfileHero,
    ProfileSection,
    ProfileStatsCard,
    ProfileStickyBack,
    formatMembers,
} from '../../components/profile-ui/ProfileRedesign';
import { getAuthUser } from '../../lib/auth';
import { useAuthSession } from '../../lib/authSession';
import {
    acceptFriendRequest,
    cancelFriendRequest,
    getFriendStatus,
    getFriendsCount,
    rejectFriendRequest,
    removeFriend,
    sendFriendRequest,
    type FriendStatus,
} from '../../lib/friends';
import { blockUser, isBlockedEitherWay, isUserBlocked, unblockUser } from '../../lib/blocks';
import { countSharedAttendedPlans } from '../../lib/coincidences';
import { hapticError, hapticLight, hapticSuccess } from '../../lib/haptics';
import { useT } from '../../lib/i18n';
import { useAppTheme } from '../../lib/appTheme';
import { EMPTY_STATS, getUserStats, personRepeatStat, type UserStats } from '../../lib/stats';
import { EMPTY_BADGE_STATS, getBadgeStats, type BadgeStats } from '../../lib/badgeStats';
import {
    affinityPersonFromProfile,
    countSharedOrganizerFollows,
    fetchFirstPersonRepeat,
    type AffinityPerson,
    type FirstRepeatVote,
} from '../../lib/profileAffinity';
import { resolveAndRememberPairAffinity } from '../../lib/pairAffinityCache';
import { loadProfileScreen } from '../../lib/profileScreen';
import { diskGet, diskSet } from '../../lib/diskCache';
import { cacheGetStale, cacheIsFresh, cacheInvalidate, cacheSet } from '../../lib/ttlCache';
import { USER_PROFILE_TTL_MS, userProfileKey } from '../../lib/userProfileCache';
import { rememberFriendStatus, resolveKnownFriendStatus } from '../../lib/friendStatusPeek';
import { ensureViewerAffinityPerson } from '../../lib/viewerAffinityCache';
import { peekChromeAvatar } from '../../lib/chromeAvatar';
import { screenCacheKey } from '../../lib/screenCaches';
import { getMyProfile, getPublicProfile } from '../../lib/profileData';
import { useScrollViewRestore } from '../../hooks/useScrollViewRestore';
import { ScreenKeys } from '../../lib/screenState';
import { bothFemaleGenero, calcAge, parseHabitos, parsePrivacy } from '../../lib/profileFields';
import { parseCountryCode } from '../../lib/countryFlags';
import { formatProfilePlace, parseProfilePlace } from '../../lib/profilePlace';
import { deleteUserAdmin } from '../../lib/moderation';
import { fetchAccountAccess, peekIsOwner } from '../../lib/roles';
import { ownerActionsVisible } from '../../lib/ownerSecretActions';
import {
    followOrganizer,
    getOrganizerFollowStats,
    getOrganizerMembers,
    getOrganizerPastPlans,
    getOrganizerPlansCount,
    getOrganizerUpcomingPlans,
    organizerPlanCard,
    organizerProfileCopy,
    parseOrganizerMeta,
    unfollowOrganizer,
    type OrganizerMeta,
    type OrganizerUpcomingPlan,
} from '../../lib/organizer';
import { prefetchPlanDetail, seedPlanDetailFromFeed } from '../../lib/planDetailCache';
import { readCoverUrl } from '../../lib/profileCover';
import { recordOrganizerProfileView } from '../../lib/organizerInsights';
import {
    getMutualFriends,
    getOrganizerFriendAttendees,
    getPublicAttendedPlans,
    type MutualFriendsResult,
    type PublicAttendedPlan,
} from '../../lib/profileSocial';

const PRIMARY_DARK = '#2563EB';
const MUTED = '#64748B';
const DANGER = '#EF4444';

type PublicProfile = {
    id: string;
    nombre: string | null;
    avatar_url: string | null;
    cover_url?: string | null;
    descripcion: string | null;
    etiquetas: string[] | null;
    edad: number | null;
    genero: string | null;
    nombre_usuario: string | null;
    habitos_consumo: Record<string, unknown> | null;
    ambientes_preferidos: string[] | null;
    perfil_gustos: Record<string, unknown> | null;
    es_organizador?: boolean;
    organizador?: OrganizerMeta;
};

type UserProfileSnapshot = {
    userProfile: PublicProfile;
    friendsCount: number;
    stats: UserStats;
    friendStatus: FriendStatus | null;
    requestId: string | null;
    blocked: boolean;
    blockedEitherWay: boolean;
    currentUserId: string | null;
    currentUserGenero: string | null;
    currentUserIsOrganizer?: boolean;
    currentUserAvatarUrl?: string | null;
    currentUserNombre?: string | null;
    sharedPlans: number;
    followersCount?: number;
    organizerPlansCount?: number;
    followingOrganizer?: boolean;
    upcomingPlans?: OrganizerUpcomingPlan[];
    organizedPlans?: OrganizerUpcomingPlan[];
    mutualFriends?: MutualFriendsResult;
    attendedPlans?: PublicAttendedPlan[];
    orgFriendAttendees?: MutualFriendsResult;
    followerPreviews?: Array<{ id: string; nombre: string; avatar_url: string | null }>;
    badgeStats?: BadgeStats;
    viewerAffinity?: AffinityPerson | null;
    sharedCommunities?: number;
    firstRepeat?: FirstRepeatVote;
};

export default function UserProfileScreen() {
    const router = useRouter();
    const { t, lang } = useT();
    const { colors } = useAppTheme();
    const { userId: sessionUserId } = useAuthSession();
    const { id, isFriend } = useLocalSearchParams<{ id: string | string[]; isFriend?: string }>();
    const profileId = Array.isArray(id) ? id[0] : id;
    const friendHint = isFriend === '1';
    const scrollKey = profileId ? `${ScreenKeys.USER_PROFILE}:${profileId}` : ScreenKeys.USER_PROFILE;
    // Sin restore automático: al entrar recolocaba el scroll y se veía un "bote".
    const { scrollRef, onScroll, scrollEventThrottle } = useScrollViewRestore(scrollKey, { restore: false });

    const cached = profileId ? cacheGetStale<UserProfileSnapshot>(userProfileKey(profileId)) : null;

    const [loading, setLoading] = useState(() => !cached?.userProfile);
    const [userProfile, setUserProfile] = useState<PublicProfile | null>(() => cached?.userProfile ?? null);
    const [currentUserId, setCurrentUserId] = useState<string | null>(
        () => sessionUserId ?? cached?.currentUserId ?? null,
    );
    const [friendStatus, setFriendStatus] = useState<FriendStatus | null>(() =>
        resolveKnownFriendStatus({
            viewerId: sessionUserId ?? cached?.currentUserId,
            otherUserId: profileId,
            cachedStatus: cached?.friendStatus,
            friendHint,
        }),
    );
    const [requestId, setRequestId] = useState<string | null>(() => cached?.requestId ?? null);
    const [friendsCount, setFriendsCount] = useState(() => cached?.friendsCount ?? 0);
    const [stats, setStats] = useState<UserStats>(() => cached?.stats ?? EMPTY_STATS);
    const [blocked, setBlocked] = useState(() => cached?.blocked ?? false);
    const [blockedEitherWay, setBlockedEitherWay] = useState(() => cached?.blockedEitherWay ?? false);
    const [avatarOpen, setAvatarOpen] = useState(false);
    const [sharedPlans, setSharedPlans] = useState(() => cached?.sharedPlans ?? 0);
    const [currentUserGenero, setCurrentUserGenero] = useState<string | null>(
        () => cached?.currentUserGenero ?? null,
    );
    const [currentUserIsOrganizer, setCurrentUserIsOrganizer] = useState(
        () => cached?.currentUserIsOrganizer === true,
    );
    const [currentUserAvatarUrl, setCurrentUserAvatarUrl] = useState<string | null>(
        () => cached?.currentUserAvatarUrl ?? null,
    );
    const [currentUserNombre, setCurrentUserNombre] = useState<string | null>(
        () => cached?.currentUserNombre ?? null,
    );
    const [isOwner, setIsOwner] = useState(() => peekIsOwner());
    const [deletingUser, setDeletingUser] = useState(false);
    const [followersCount, setFollowersCount] = useState(() => cached?.followersCount ?? 0);
    const [organizerPlansCount, setOrganizerPlansCount] = useState(() => cached?.organizerPlansCount ?? 0);
    const [followingOrganizer, setFollowingOrganizer] = useState(() => cached?.followingOrganizer ?? false);
    const [followBusy, setFollowBusy] = useState(false);
    const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
    const [upcomingPlans, setUpcomingPlans] = useState(cached?.upcomingPlans ?? []);
    const [organizedPlans, setOrganizedPlans] = useState(cached?.organizedPlans ?? []);
    const [mutualFriends, setMutualFriends] = useState<MutualFriendsResult>(
        cached?.mutualFriends ?? { total: 0, items: [] },
    );
    const [attendedPlans, setAttendedPlans] = useState<PublicAttendedPlan[]>(cached?.attendedPlans ?? []);
    const [orgFriendAttendees, setOrgFriendAttendees] = useState<MutualFriendsResult>(
        cached?.orgFriendAttendees ?? { total: 0, items: [] },
    );
    const [followerPreviews, setFollowerPreviews] = useState(
        cached?.followerPreviews ?? [],
    );
    const [badgeStats, setBadgeStats] = useState<BadgeStats>(
        cached?.badgeStats ?? EMPTY_BADGE_STATS,
    );
    const [viewerAffinity, setViewerAffinity] = useState<AffinityPerson | null>(
        () => cached?.viewerAffinity ?? null,
    );
    const [sharedCommunities, setSharedCommunities] = useState(() => cached?.sharedCommunities ?? 0);
    const [firstRepeat, setFirstRepeat] = useState<FirstRepeatVote>(() => cached?.firstRepeat ?? null);
    const hasDataRef = useRef(!!cached?.userProfile);
    /** Promesa del envío en curso (para poder cancelar antes de tener requestId). */
    const pendingSendRef = useRef<Promise<string | null> | null>(null);
    const cancelDesiredRef = useRef(false);
    const friendStatusRef = useRef(friendStatus);
    const requestIdRef = useRef(requestId);
    friendStatusRef.current = friendStatus;
    requestIdRef.current = requestId;

    /** Evita que un loadProfile en vuelo pise el estado optimista de solicitud enviada. */
    const coalesceFriendStatus = useCallback(
        (
            incoming: FriendStatus | null,
            incomingRequestId: string | null,
        ): { status: FriendStatus | null; requestId: string | null } => {
            const currentStatus = friendStatusRef.current;
            const currentRequestId = requestIdRef.current;

            if (pendingSendRef.current) {
                return { status: currentStatus, requestId: currentRequestId };
            }

            if (currentStatus === 'pending_sent' && incoming === 'none') {
                return { status: currentStatus, requestId: currentRequestId ?? incomingRequestId };
            }

            return { status: incoming, requestId: incomingRequestId };
        },
        [],
    );

    const applySnapshot = useCallback((snap: UserProfileSnapshot) => {
        setUserProfile(snap.userProfile);
        setFriendsCount(snap.friendsCount);
        setStats(snap.stats);
        const resolved =
            snap.friendStatus ??
            resolveKnownFriendStatus({
                viewerId: snap.currentUserId ?? sessionUserId,
                otherUserId: snap.userProfile?.id ?? profileId,
                cachedStatus: null,
                friendHint,
            });
        setFriendStatus(resolved);
        if (resolved && resolved !== 'self' && snap.userProfile?.id) {
            rememberFriendStatus(snap.userProfile.id, resolved, snap.requestId);
        }
        setRequestId(snap.requestId);
        setBlocked(snap.blocked);
        setBlockedEitherWay(snap.blockedEitherWay);
        setCurrentUserId(snap.currentUserId);
        setCurrentUserGenero(snap.currentUserGenero);
        setCurrentUserIsOrganizer(snap.currentUserIsOrganizer === true);
        setCurrentUserAvatarUrl(snap.currentUserAvatarUrl ?? null);
        setCurrentUserNombre(snap.currentUserNombre ?? null);
        setSharedPlans(snap.sharedPlans);
        setFollowersCount(snap.followersCount ?? 0);
        setOrganizerPlansCount(snap.organizerPlansCount ?? 0);
        setFollowingOrganizer(snap.followingOrganizer ?? false);
        setUpcomingPlans(snap.upcomingPlans ?? []);
        setOrganizedPlans(snap.organizedPlans ?? []);
        setMutualFriends(snap.mutualFriends ?? { total: 0, items: [] });
        setAttendedPlans(snap.attendedPlans ?? []);
        setOrgFriendAttendees(snap.orgFriendAttendees ?? { total: 0, items: [] });
        setFollowerPreviews(snap.followerPreviews ?? []);
        setBadgeStats(snap.badgeStats ?? EMPTY_BADGE_STATS);
        setViewerAffinity(snap.viewerAffinity ?? null);
        setSharedCommunities(snap.sharedCommunities ?? 0);
        setFirstRepeat(snap.firstRepeat ?? null);
        hasDataRef.current = true;
    }, [friendHint, profileId, sessionUserId]);

    useEffect(() => {
        if (!profileId || cached?.userProfile) return;
        let alive = true;
        void diskGet<UserProfileSnapshot>(userProfileKey(profileId), 3 * 24 * 60 * 60 * 1000).then((snap) => {
            if (!alive || !snap?.userProfile || hasDataRef.current) return;
            cacheSet(userProfileKey(profileId), snap, USER_PROFILE_TTL_MS);
            applySnapshot(snap);
            setLoading(false);
        });
        return () => {
            alive = false;
        };
    }, [profileId, cached?.userProfile, applySnapshot]);

    const loadProfile = useCallback(async (opts?: { force?: boolean }) => {
        if (!profileId) return;
        const profileKey = userProfileKey(profileId);

        try {
            const stale = cacheGetStale<UserProfileSnapshot>(profileKey);
            const viewerNeeded =
                sessionUserId
                && profileId
                && sessionUserId !== profileId
                && !stale?.userProfile?.es_organizador;
            if (stale?.userProfile) {
                // Solo hidratar si aún no hay UI: evita un segundo layout al refrescar.
                if (!hasDataRef.current) {
                    applySnapshot(stale);
                }
                setLoading(false);
                // El early-return de caché no debe dejar isOwner a false para siempre.
                void fetchAccountAccess(sessionUserId ?? undefined).then((access) => {
                    setIsOwner(!!access?.isOwner);
                });
                if (!opts?.force && cacheIsFresh(profileKey) && stale.badgeStats) {
                    if (!viewerNeeded || stale.viewerAffinity) return;
                }
            } else if (!hasDataRef.current) {
                setLoading(true);
            }

            const userId = sessionUserId ?? (await getAuthUser())?.id ?? null;
            const user = userId ? { id: userId } : null;
            const peekIsOrg = stale?.userProfile?.es_organizador === true;

            const friendPromise =
                user && user.id !== profileId
                    ? Promise.all([
                          getFriendStatus(user.id, profileId),
                          isUserBlocked(user.id, profileId),
                          isBlockedEitherWay(user.id, profileId),
                          Promise.resolve(0),
                          getMyProfile(),
                          // Termómetro en 1ª oleada (cacheado por sesión).
                          ensureViewerAffinityPerson(user.id),
                          Promise.resolve(0),
                          Promise.resolve(null as FirstRepeatVote),
                      ])
                    : Promise.resolve(null);

            const [screen, friendData, access] = await Promise.all([
                loadProfileScreen(profileId),
                friendPromise,
                user ? fetchAccountAccess(user.id) : Promise.resolve(null),
            ]);

            let profile = screen
                ? {
                      id: screen.profile.id,
                      nombre: screen.profile.nombre,
                      nombre_usuario: screen.profile.nombre_usuario,
                      avatar_url: screen.profile.avatar_url,
                      cover_url: screen.profile.cover_url,
                      descripcion: screen.profile.descripcion,
                      etiquetas: screen.profile.etiquetas,
                      edad: calcAge(screen.profile.fecha_nacimiento),
                      genero: screen.profile.genero,
                      habitos_consumo: screen.profile.habitos_consumo,
                      ambientes_preferidos: screen.profile.ambientes_preferidos,
                      perfil_gustos: screen.profile.perfil_gustos,
                      es_organizador: screen.profile.es_organizador,
                      organizador: screen.profile.organizador,
                  }
                : null;
            let count = screen?.stats.numeroAmistades ?? 0;
            let userStats = screen?.stats ?? EMPTY_STATS;
            let earlyBadgeStats = screen?.badges ?? EMPTY_BADGE_STATS;
            let attendedEarly = screen?.attended ?? [];

            if (!profile) {
                const attendedEarlyPromise = peekIsOrg
                    ? Promise.resolve([] as PublicAttendedPlan[])
                    : getPublicAttendedPlans(profileId, 12);
                const fallback = await Promise.all([
                    getPublicProfile(profileId),
                    getFriendsCount(profileId),
                    getUserStats(profileId),
                    peekIsOrg ? Promise.resolve(EMPTY_BADGE_STATS) : getBadgeStats(profileId),
                    attendedEarlyPromise,
                ]);
                profile = fallback[0];
                count = fallback[1];
                userStats = fallback[2];
                earlyBadgeStats = fallback[3];
                attendedEarly = fallback[4];
            }

            if (!profile) throw new Error('profile_missing');

            setIsOwner(!!access?.isOwner);

            // Pintar planes asistidos en cuanto llegan (no esperar al resto del shell).
            if (profile.es_organizador !== true && attendedEarly.length > 0) {
                setAttendedPlans(attendedEarly);
            }

            const nextProfile: PublicProfile = {
                id: profile.id,
                nombre: profile.nombre,
                nombre_usuario: profile.nombre_usuario,
                avatar_url: profile.avatar_url,
                cover_url: readCoverUrl({
                    cover_url: profile.cover_url,
                    organizador: profile.organizador,
                    perfil_gustos: profile.perfil_gustos,
                }) || parseOrganizerMeta(profile.organizador).portada || null,
                descripcion: profile.descripcion,
                etiquetas: Array.isArray(profile.etiquetas) ? profile.etiquetas : [],
                edad: profile.edad,
                genero: profile.genero,
                habitos_consumo: (profile.habitos_consumo as Record<string, unknown>) ?? {},
                ambientes_preferidos: Array.isArray(profile.ambientes_preferidos) ? profile.ambientes_preferidos : [],
                perfil_gustos: (profile.perfil_gustos as Record<string, unknown>) ?? {},
                es_organizador: profile.es_organizador === true,
                organizador: parseOrganizerMeta(profile.organizador),
            };

            let nextFriendStatus: FriendStatus | null = 'none';
            let nextRequestId: string | null = null;
            let nextBlocked = false;
            let nextBlockedEitherWay = false;
            let nextSharedPlans = 0;
            let nextMyGenero: string | null = null;
            let nextMyAvatar: string | null = null;
            let nextMyNombre: string | null = null;

            let nextViewerAffinity: AffinityPerson | null = null;
            let nextSharedCommunities = 0;
            let nextFirstRepeat: FirstRepeatVote = null;

            if (friendData) {
                const [status, isBlocked, eitherWay, shared, myProfileRes, viewerPerson, communities, repeatVote] =
                    friendData;
                nextFriendStatus = status.status;
                nextRequestId = status.requestId;
                rememberFriendStatus(profileId, status.status, status.requestId);
                nextBlocked = isBlocked;
                nextBlockedEitherWay = eitherWay;
                nextSharedPlans = shared;
                nextMyGenero = (myProfileRes.data?.genero as string | null) ?? null;
                nextMyAvatar = myProfileRes.data?.avatar_url ?? null;
                nextMyNombre = myProfileRes.data?.nombre ?? null;
                if (!nextProfile.es_organizador) {
                    nextViewerAffinity = viewerPerson;
                }
                nextSharedCommunities = communities;
                nextFirstRepeat = repeatVote;
            } else if (user?.id === profileId) {
                nextFriendStatus = 'self';
            }

            ({ status: nextFriendStatus, requestId: nextRequestId } = coalesceFriendStatus(
                nextFriendStatus,
                nextRequestId,
            ));

            const viewerIsOrganizer = friendData
                ? friendData[4].data?.es_organizador === true
                : false;

            // Shell rápido: perfil + social + stats; reputación/listas llegan en la 2ª oleada.
            const earlySnap: UserProfileSnapshot = {
                userProfile: nextProfile,
                friendsCount: Math.max(count, userStats.numeroAmistades || 0),
                stats: userStats,
                friendStatus: nextFriendStatus,
                requestId: nextRequestId,
                blocked: nextBlocked,
                blockedEitherWay: nextBlockedEitherWay,
                currentUserId: user?.id ?? null,
                currentUserGenero: nextMyGenero,
                currentUserIsOrganizer: viewerIsOrganizer,
                currentUserAvatarUrl: nextMyAvatar,
                currentUserNombre: nextMyNombre,
                sharedPlans: nextSharedPlans,
                followersCount: stale?.followersCount ?? 0,
                organizerPlansCount: stale?.organizerPlansCount ?? 0,
                followingOrganizer: stale?.followingOrganizer ?? false,
                upcomingPlans: stale?.upcomingPlans ?? [],
                organizedPlans: stale?.organizedPlans ?? [],
                mutualFriends: stale?.mutualFriends ?? { total: 0, items: [] },
                attendedPlans: nextProfile.es_organizador ? [] : attendedEarly,
                orgFriendAttendees: stale?.orgFriendAttendees ?? { total: 0, items: [] },
                followerPreviews: stale?.followerPreviews ?? [],
                badgeStats: earlyBadgeStats ?? stale?.badgeStats ?? EMPTY_BADGE_STATS,
                viewerAffinity: nextViewerAffinity,
                sharedCommunities: nextSharedCommunities,
                firstRepeat: nextFirstRepeat,
            };
            cacheSet(profileKey, earlySnap, USER_PROFILE_TTL_MS);
            void diskSet(profileKey, earlySnap);
            if (!hasDataRef.current) {
                applySnapshot(earlySnap);
            } else {
                startTransition(() => applySnapshot(earlySnap));
            }
            setLoading(false);

            const [
                orgStats,
                upcoming,
                organized,
                mutual,
                attended,
                orgFriends,
                orgMembers,
                orgPlansCount,
                nextBadgeStats,
                sharedFill,
                myBadgesFill,
                communitiesFill,
                repeatFill,
            ] = await Promise.all([
                nextProfile.es_organizador
                    ? getOrganizerFollowStats(profileId)
                    : Promise.resolve({ followers: 0, following: false }),
                nextProfile.es_organizador ? getOrganizerUpcomingPlans(profileId, 8) : Promise.resolve([]),
                nextProfile.es_organizador ? getOrganizerPastPlans(profileId, 12) : Promise.resolve([]),
                user && user.id !== profileId && !nextProfile.es_organizador
                    ? getMutualFriends(profileId, 6)
                    : Promise.resolve({ total: 0, items: [] }),
                // Ya cargados en 1ª oleada; no repetir.
                Promise.resolve(attendedEarly),
                user && user.id !== profileId && nextProfile.es_organizador
                    ? getOrganizerFriendAttendees(profileId)
                    : Promise.resolve({ total: 0, items: [] }),
                nextProfile.es_organizador ? getOrganizerMembers(profileId) : Promise.resolve([]),
                nextProfile.es_organizador ? getOrganizerPlansCount(profileId) : Promise.resolve(0),
                nextProfile.es_organizador
                    ? Promise.resolve(EMPTY_BADGE_STATS)
                    : peekIsOrg
                      ? getBadgeStats(profileId)
                      : Promise.resolve(earlyBadgeStats),
                user && user.id !== profileId && !nextProfile.es_organizador
                    ? countSharedAttendedPlans(user.id, profileId)
                    : Promise.resolve(0),
                user && user.id !== profileId && !nextProfile.es_organizador
                    ? getBadgeStats(user.id)
                    : Promise.resolve(EMPTY_BADGE_STATS),
                user && user.id !== profileId
                    ? countSharedOrganizerFollows(user.id, profileId)
                    : Promise.resolve(0),
                user && user.id !== profileId && !nextProfile.es_organizador
                    ? fetchFirstPersonRepeat(user.id, profileId)
                    : Promise.resolve(null as FirstRepeatVote),
            ]);

            nextSharedPlans = sharedFill;
            nextSharedCommunities = communitiesFill;
            nextFirstRepeat = repeatFill;
            if (friendData && !nextProfile.es_organizador) {
                nextViewerAffinity =
                    (await ensureViewerAffinityPerson(user!.id)) ?? nextViewerAffinity;
            }

            ({ status: nextFriendStatus, requestId: nextRequestId } = coalesceFriendStatus(
                nextFriendStatus,
                nextRequestId,
            ));

            const snap: UserProfileSnapshot = {
                userProfile: nextProfile,
                // Amigos públicos desde stats (amistades RLS solo deja ver las propias).
                friendsCount: Math.max(count, userStats.numeroAmistades || 0),
                stats: userStats,
                friendStatus: nextFriendStatus,
                requestId: nextRequestId,
                blocked: nextBlocked,
                blockedEitherWay: nextBlockedEitherWay,
                currentUserId: user?.id ?? null,
                currentUserGenero: nextMyGenero,
                currentUserIsOrganizer: viewerIsOrganizer,
                currentUserAvatarUrl: nextMyAvatar,
                currentUserNombre: nextMyNombre,
                sharedPlans: nextSharedPlans,
                followersCount: orgStats.followers ?? 0,
                organizerPlansCount: orgPlansCount,
                followingOrganizer: orgStats.following,
                upcomingPlans: upcoming,
                organizedPlans: organized,
                mutualFriends: mutual,
                attendedPlans: attended,
                orgFriendAttendees: orgFriends,
                followerPreviews: orgMembers.map((row) => ({
                    id: row.id,
                    nombre: row.nombre ?? '',
                    avatar_url: row.avatar_url,
                })),
                badgeStats: nextBadgeStats,
                viewerAffinity: nextViewerAffinity,
                sharedCommunities: nextSharedCommunities,
                firstRepeat: nextFirstRepeat,
            };

            cacheSet(profileKey, snap, USER_PROFILE_TTL_MS);
            void diskSet(profileKey, snap);
            startTransition(() => applySnapshot(snap));
        } catch (error) {
            if (__DEV__) console.error('Error fetching user profile:', error);
            if (!hasDataRef.current) setUserProfile(null);
        } finally {
            setLoading(false);
        }
    }, [profileId, applySnapshot, sessionUserId, coalesceFriendStatus]);

    useFocusEffect(
        useCallback(() => {
            void loadProfile();
            if (profileId && sessionUserId && sessionUserId !== profileId) {
                recordOrganizerProfileView(profileId);
            }
            // La amistad puede cambiar en otro dispositivo mientras la caché sigue "fresca".
            let cancelled = false;
            void (async () => {
                if (!profileId) return;
                const userId = sessionUserId ?? (await getAuthUser())?.id ?? null;
                if (!userId || userId === profileId) return;
                try {
                    const status = await getFriendStatus(userId, profileId);
                    if (cancelled) return;
                    const coalesced = coalesceFriendStatus(status.status, status.requestId);
                    setFriendStatus(coalesced.status);
                    setRequestId(coalesced.requestId);
                    if (coalesced.status) {
                        rememberFriendStatus(profileId, coalesced.status, coalesced.requestId);
                    }
                    const prev = cacheGetStale<UserProfileSnapshot>(userProfileKey(profileId));
                    if (prev) {
                        cacheSet(
                            userProfileKey(profileId),
                            {
                                ...prev,
                                friendStatus: coalesced.status,
                                requestId: coalesced.requestId,
                            },
                            USER_PROFILE_TTL_MS,
                        );
                    }
                } catch {
                    /* ignore */
                }
            })();
            return () => {
                cancelled = true;
            };
        }, [loadProfile, profileId, sessionUserId, coalesceFriendStatus])
    );

    const handleSendRequest = () => {
        if (!currentUserId || !profileId || friendStatus !== 'none') return;

        const prevStatus = friendStatus;
        const prevRequestId = requestId;
        cancelDesiredRef.current = false;
        hapticLight();
        setFriendStatus('pending_sent');
        setRequestId(null);

        const sendPromise = (async () => {
            const { error, requestId: nextId } = await sendFriendRequest(currentUserId, profileId);
            if (error) {
                if (error === 'Ya enviaste una solicitud' && nextId) {
                    setFriendStatus('pending_sent');
                    setRequestId(nextId);
                    const prev = cacheGetStale<UserProfileSnapshot>(userProfileKey(profileId));
                    if (prev) {
                        cacheSet(userProfileKey(profileId), {
                            ...prev,
                            friendStatus: 'pending_sent',
                            requestId: nextId,
                        }, USER_PROFILE_TTL_MS);
                    }
                    return nextId;
                }
                if (!cancelDesiredRef.current) {
                    setFriendStatus(prevStatus);
                    setRequestId(prevRequestId);
                    hapticError();
                    Alert.alert(
                        t('userprofile.sendFail'),
                        error === 'friend_request_daily_limit'
                            ? t('friends.requestDailyLimit')
                            : error === 'organizer_no_friends'
                              ? t('friends.organizerNoFriends')
                              : error,
                    );
                }
                return null;
            }
            const resolvedId = nextId ?? null;
            if (cancelDesiredRef.current) {
                if (resolvedId) await cancelFriendRequest(resolvedId);
                return null;
            }
            setRequestId(resolvedId);
            const prev = cacheGetStale<UserProfileSnapshot>(userProfileKey(profileId));
            if (prev) {
                cacheSet(userProfileKey(profileId), {
                    ...prev,
                    friendStatus: 'pending_sent',
                    requestId: resolvedId,
                }, USER_PROFILE_TTL_MS);
            }
            return resolvedId;
        })();

        pendingSendRef.current = sendPromise;
        void sendPromise.finally(() => {
            if (pendingSendRef.current === sendPromise) pendingSendRef.current = null;
        });
    };

    const handleAccept = async () => {
        if (!requestId) return;

        const prevStatus = friendStatus;
        const prevRequestId = requestId;
        hapticSuccess();
        setFriendStatus('friends');

        const { error } = await acceptFriendRequest(requestId);
        if (error) {
            setFriendStatus(prevStatus);
            setRequestId(prevRequestId);
            hapticError();
            Alert.alert(t('profile.error'), error.message);
            return;
        }

        const prev = cacheGetStale<UserProfileSnapshot>(userProfileKey(profileId!));
        if (prev) {
            cacheSet(userProfileKey(profileId!), {
                ...prev,
                friendStatus: 'friends',
                requestId: prevRequestId,
            }, USER_PROFILE_TTL_MS);
        }
    };

    const handleReject = async () => {
        if (!requestId) return;

        const prevStatus = friendStatus;
        const prevRequestId = requestId;
        hapticLight();
        setFriendStatus('none');
        setRequestId(null);

        const { error } = await rejectFriendRequest(requestId);
        if (error) {
            setFriendStatus(prevStatus);
            setRequestId(prevRequestId);
            hapticError();
            Alert.alert(t('profile.error'), error.message);
            return;
        }

        const prev = cacheGetStale<UserProfileSnapshot>(userProfileKey(profileId!));
        if (prev) {
            cacheSet(userProfileKey(profileId!), {
                ...prev,
                friendStatus: 'none',
                requestId: null,
            }, USER_PROFILE_TTL_MS);
        }
    };

    const handleOwnerDeleteUser = () => {
        if (!ownerActionsVisible(isOwner || peekIsOwner()) || !profileId || friendStatus === 'self' || deletingUser) return;
        const isCommunity = userProfile?.es_organizador === true;
        Alert.alert(
            t(isCommunity ? 'admin.deleteCommunityTitle' : 'admin.deleteUserTitle'),
            t(isCommunity ? 'admin.deleteCommunityMsg' : 'admin.deleteUserMsg'),
            [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t(isCommunity ? 'admin.deleteCommunityConfirm' : 'admin.deleteUserConfirm'),
                style: 'destructive',
                onPress: () => {
                    setDeletingUser(true);
                    void (async () => {
                        const { error } = await deleteUserAdmin(profileId);
                        setDeletingUser(false);
                        if (error) {
                            const known = [
                                'cannot_moderate_staff',
                                'not_authorized',
                                'user_not_found',
                                'invalid_target',
                            ] as const;
                            const msg = known.includes(error as (typeof known)[number])
                                ? t(`admin.err.${error}` as 'admin.err.not_authorized')
                                : /auth_delete_failed|prepare_deletion_failed|cleanup_paths/i.test(error)
                                  ? t('admin.err.delete_failed')
                                  : error;
                            Alert.alert(t('admin.error'), msg);
                            return;
                        }
                        Alert.alert(t('admin.userDeleted'));
                        router.back();
                    })();
                },
            },
            ],
        );
    };

    const handleCancelRequest = () => {
        if (friendStatus !== 'pending_sent') return;

        const prevStatus = friendStatus;
        const prevRequestId = requestId;
        const pendingSend = pendingSendRef.current;
        cancelDesiredRef.current = true;
        hapticLight();
        setFriendStatus('none');
        setRequestId(null);

        void (async () => {
            let id = prevRequestId;
            if (!id && pendingSend) {
                id = await pendingSend;
            }
            if (!id) return;

            const { error } = await cancelFriendRequest(id);
            if (error) {
                cancelDesiredRef.current = false;
                setFriendStatus(prevStatus);
                setRequestId(id);
                Alert.alert(t('profile.error'), error.message);
                return;
            }

            const prev = cacheGetStale<UserProfileSnapshot>(userProfileKey(profileId!));
            if (prev) {
                cacheSet(userProfileKey(profileId!), {
                    ...prev,
                    friendStatus: 'none',
                    requestId: null,
                }, USER_PROFILE_TTL_MS);
            }
        })();
    };

    const handleRemoveFriend = () => {
        if (!userProfile || !profileId) return;
        const fem = bothFemaleGenero(currentUserGenero, userProfile.genero);

        Alert.alert(
            t(fem ? 'userprofile.unfriendTitleF' : 'userprofile.unfriendTitle'),
            t(fem ? 'userprofile.unfriendConfirmNameF' : 'userprofile.unfriendConfirmName', {
                name: userProfile.nombre || t('chats.user'),
            }),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('friends.removeBtn'),
                    style: 'destructive',
                    onPress: () => {
                        const prevStatus = friendStatus;
                        const prevRequestId = requestId;
                        setFriendStatus('none');
                        setRequestId(null);
                        void (async () => {
                            let friendshipId = prevRequestId;
                            if (!friendshipId && currentUserId) {
                                try {
                                    const st = await getFriendStatus(currentUserId, profileId);
                                    friendshipId = st.requestId;
                                } catch {
                                    /* ignore */
                                }
                            }
                            if (!friendshipId) {
                                setFriendStatus(prevStatus);
                                setRequestId(prevRequestId);
                                Alert.alert(t('profile.error'), t('userprofile.loadError'));
                                return;
                            }
                            const { error } = await removeFriend(friendshipId);
                            if (error) {
                                setFriendStatus(prevStatus);
                                setRequestId(prevRequestId);
                                Alert.alert(t('profile.error'), error.message);
                                return;
                            }
                            const prev = cacheGetStale<UserProfileSnapshot>(userProfileKey(profileId));
                            if (prev) {
                                cacheSet(userProfileKey(profileId), {
                                    ...prev,
                                    friendStatus: 'none',
                                    requestId: null,
                                }, USER_PROFILE_TTL_MS);
                            }
                        })();
                    },
                },
            ]
        );
    };

    const handleToggleBlock = () => {
        if (!currentUserId || !profileId || !userProfile) return;

        if (blocked) {
            Alert.alert(
                t(isOrganizerProfile ? 'userprofile.unblockOrganizerTitle' : 'userprofile.unblockTitle'),
                t(isOrganizerProfile ? 'userprofile.unblockOrganizerConfirm' : 'userprofile.unblockConfirm'),
                [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t(isOrganizerProfile ? 'userprofile.unblockOrganizer' : 'userprofile.unblock'),
                    onPress: () => {
                        const prevBlocked = blocked;
                        const prevEither = blockedEitherWay;
                        setBlocked(false);
                        setBlockedEitherWay(false);
                        void unblockUser(currentUserId, profileId).then(({ error }) => {
                            if (error) {
                                setBlocked(prevBlocked);
                                setBlockedEitherWay(prevEither);
                                Alert.alert(t('profile.error'), error);
                            }
                        });
                    },
                },
            ]);
            return;
        }

        Alert.alert(
            t(isOrganizerProfile ? 'userprofile.blockOrganizerTitle' : 'userprofile.blockTitle'),
            t(isOrganizerProfile ? 'userprofile.blockOrganizerConfirm' : 'userprofile.blockConfirmName', {
                name: userProfile.nombre || t('chats.user'),
            }),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t(isOrganizerProfile ? 'userprofile.blockOrganizer' : 'userprofile.block'),
                    style: 'destructive',
                    onPress: () => {
                        const prevBlocked = blocked;
                        const prevEither = blockedEitherWay;
                        const prevStatus = friendStatus;
                        const prevRequestId = requestId;
                        setBlocked(true);
                        setBlockedEitherWay(true);
                        setFriendStatus('none');
                        setRequestId(null);
                        void blockUser(currentUserId, profileId).then(({ error }) => {
                            if (error) {
                                setBlocked(prevBlocked);
                                setBlockedEitherWay(prevEither);
                                setFriendStatus(prevStatus);
                                setRequestId(prevRequestId);
                                Alert.alert(
                                    t('profile.error'),
                                    error === 'block_daily_limit' ? t('blocks.dailyLimit') : error,
                                );
                            }
                        });
                    },
                },
            ]
        );
    };

    const femalePair = bothFemaleGenero(currentUserGenero, userProfile?.genero);
    const isOrganizerProfile = userProfile?.es_organizador === true;
    const orgMeta = userProfile?.organizador ?? {};

    const handleToggleFollow = async () => {
        if (!profileId || followBusy || friendStatus === 'self') return;
        setFollowBusy(true);
        const prev = followingOrganizer;
        setFollowingOrganizer(!prev);
        setFollowersCount((n) => Math.max(0, n + (prev ? -1 : 1)));
        const { error } = prev ? await unfollowOrganizer(profileId) : await followOrganizer(profileId);
        setFollowBusy(false);
        if (error) {
            setFollowingOrganizer(prev);
            setFollowersCount((n) => Math.max(0, n + (prev ? 1 : -1)));
            Alert.alert(t('profile.error'), t('organizer.followError'));
        }
    };

    const openMessage = () => {
        if (!userProfile?.id || !currentUserId) return;
        router.push(`/direct-chat/${userProfile.id}`);
    };

    const openPlan = (planId: string) => {
        const fromLists =
            upcomingPlans.find((p) => String(p.id) === String(planId)) ||
            organizedPlans.find((p) => String(p.id) === String(planId)) ||
            attendedPlans.find((p) => String(p.id) === String(planId));
        if (fromLists) {
            seedPlanDetailFromFeed(
                {
                    ...fromLists,
                    creador_id: profileId,
                    host: userProfile
                        ? {
                              id: userProfile.id,
                              nombre: userProfile.nombre ?? t('profile.user'),
                              avatar_url: userProfile.avatar_url,
                              isCreator: true,
                          }
                        : undefined,
                    participantsList: userProfile
                        ? [
                              {
                                  id: userProfile.id,
                                  nombre: userProfile.nombre ?? t('profile.user'),
                                  avatar_url: userProfile.avatar_url,
                                  isCreator: true,
                              },
                          ]
                        : [],
                    es_organizador: userProfile?.es_organizador === true,
                } as Record<string, unknown>,
            );
        }
        prefetchPlanDetail(planId);
        router.push({ pathname: '/plan/[id]', params: { id: planId } });
    };

    const displayName = userProfile?.nombre?.trim() || t('profile.user');
    const aboutText = (userProfile?.descripcion ?? '').trim();
    const organizerCopy = organizerProfileCopy(aboutText, orgMeta);

    const openMoreMenu = () => {
        if (!userProfile || friendStatus === 'self') return;
        const ownerUx = ownerActionsVisible(isOwner || peekIsOwner());
        const buttons: Array<{ text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }> = [];
        // Eliminar primero: debe verse siempre en el menú del owner (no perderse entre otras opciones).
        if (ownerUx) {
            buttons.push({
                text: t(isOrganizerProfile ? 'admin.deleteCommunityConfirm' : 'admin.deleteUserConfirm'),
                style: 'destructive',
                onPress: handleOwnerDeleteUser,
            });
        }
        if (friendStatus === 'friends') {
            buttons.push({
                text: t(femalePair ? 'userprofile.unfriendF' : 'userprofile.unfriend'),
                style: 'destructive',
                onPress: handleRemoveFriend,
            });
        }
        buttons.push({
            text: t(isOrganizerProfile ? 'userprofile.reportOrganizer' : 'userprofile.report'),
            style: 'destructive',
            onPress: () => router.push({ pathname: '/report-user', params: { userId: userProfile.id } }),
        });
        buttons.push({
            text: blocked
                ? t(isOrganizerProfile ? 'userprofile.unblockOrganizer' : 'userprofile.unblock')
                : t(isOrganizerProfile ? 'userprofile.blockOrganizer' : 'userprofile.block'),
            style: blocked ? undefined : 'destructive',
            onPress: handleToggleBlock,
        });
        buttons.push({ text: t('common.cancel'), style: 'cancel' });
        Alert.alert(displayName, undefined, buttons);
    };

    const hobbies = userProfile?.ambientes_preferidos?.length
        ? userProfile.ambientes_preferidos
        : (userProfile?.etiquetas ?? []);
    const ready = !!userProfile;
    const showProfileSkeleton = useDelayedVisible(loading && !ready);
    const viewerFemale = currentUserGenero === 'femenino';

    const personRep = personRepeatStat(stats, {
        isSelf: friendStatus === 'self',
        genero: userProfile?.genero,
        t,
    });
    const profileAffinity =
        userProfile && viewerAffinity
            ? resolveAndRememberPairAffinity({
                  isSelf: friendStatus === 'self',
                  viewer: viewerAffinity,
                  viewerId: currentUserId,
                  targetId: userProfile.id,
                  target: affinityPersonFromProfile({
                      age: userProfile.edad,
                      tags: hobbies,
                      habitos: parseHabitos(userProfile.habitos_consumo),
                      stats,
                      badgeStats,
                      friendsCount,
                  }),
                  isFriends: friendStatus === 'friends',
                  mutualFriends: mutualFriends.total,
                  sharedCommunities,
                  firstRepeat,
              })
            : null;
    const reviewsLabel = isOrganizerProfile
        ? `${stats.numeroValoraciones} ${t(
              stats.numeroValoraciones === 1 ? 'userprofile.review' : 'userprofile.reviews',
          )}`
        : personRep.label;

    const showActions = friendStatus !== 'self' && !blockedEitherWay;
    const canFriend = showActions && !isOrganizerProfile && !currentUserIsOrganizer;
    const canFollow = showActions && isOrganizerProfile;
    const primaryFriendLabel =
        friendStatus === 'friends'
            ? t(viewerFemale ? 'profilev.iAmFriendF' : 'profilev.iAmFriend')
            : friendStatus === 'pending_sent'
              ? t('userprofile.requestSent')
              : friendStatus === 'pending_received'
                ? t('userprofile.acceptFriend')
                : t(userProfile?.genero === 'femenino' ? 'profilev.addFriendF' : 'profilev.addFriend');
    const primaryFriendIcon =
        friendStatus === 'friends' || friendStatus === 'pending_sent'
            ? 'checkmark'
            : friendStatus === 'pending_received'
              ? 'person-add'
              : 'person-add-outline';
    const onPrimaryFriend =
        friendStatus === 'friends'
            ? handleRemoveFriend
            : friendStatus === 'pending_sent'
              ? handleCancelRequest
              : friendStatus === 'pending_received'
                ? () => void handleAccept()
                : handleSendRequest;

    return (
        <View style={[styles.page, { backgroundColor: colors.background }]}>
            {!ready ? (
                <SafeAreaView style={[styles.loadingContainer, { backgroundColor: colors.background }]} edges={['top']}>
                    <View style={styles.loadingTop}>
                        <FrostedIconButton icon="chevron-back" onPress={() => router.back()} accessibilityLabel={t('common.back')} />
                    </View>
                    <View style={styles.loadingBody}>
                        {showProfileSkeleton ? (
                            <ProfileScreenSkeleton />
                        ) : loading ? null : (
                            <>
                                <Ionicons name="alert-circle-outline" size={40} color="#94A3B8" />
                                <Text style={[styles.errorText, { color: colors.textMuted }]}>{t('userprofile.loadError')}</Text>
                            </>
                        )}
                    </View>
                </SafeAreaView>
            ) : (
                <ScrollView
                    ref={scrollRef}
                    onScroll={onScroll}
                    scrollEventThrottle={scrollEventThrottle}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={styles.scroll}
                    removeClippedSubviews={false}
                >
                    <ProfileHero
                        variant={isOrganizerProfile ? 'organizer' : 'person'}
                        coverUrl={userProfile.cover_url || orgMeta.portada || null}
                        avatarUrl={userProfile.avatar_url}
                        name={displayName}
                        age={
                            isOrganizerProfile
                                ? null
                                : parsePrivacy(userProfile.perfil_gustos).mostrar_edad === false
                                  ? null
                                  : userProfile.edad
                        }
                        flagCode={
                            isOrganizerProfile
                                ? null
                                : parsePrivacy(userProfile.perfil_gustos).mostrar_nacionalidad === false
                                  ? null
                                  : parseCountryCode(userProfile.perfil_gustos)
                        }
                        placeLabel={
                            isOrganizerProfile
                                ? null
                                : parsePrivacy(userProfile.perfil_gustos).mostrar_ubicacion === false
                                  ? null
                                  : formatProfilePlace(parseProfilePlace(userProfile.perfil_gustos))
                        }
                        instagram={null}
                        verified={isOrganizerProfile}
                        stickyBack
                        onBack={() => router.back()}
                        onMore={friendStatus === 'self' ? undefined : openMoreMenu}
                        onCoverPress={undefined}
                        backLabel={t('common.back')}
                        moreLabel={t('profilev.moreOptions')}
                    />

                    {isOrganizerProfile ? (
                        <OrganizerIdentity
                            name={displayName}
                            verifiedLabel={t('profilev.verifiedCommunity')}
                            description={organizerCopy.description}
                            web={orgMeta.web}
                            instagram={orgMeta.instagram}
                            whatsapp={orgMeta.whatsapp}
                            whatsappLabel={t('organizer.whatsappGroup')}
                            avatar={
                                <TouchableOpacity
                                    onPress={() => setAvatarOpen(true)}
                                    activeOpacity={0.9}
                                    style={{ borderWidth: 4, borderColor: '#FFF', borderRadius: 56, backgroundColor: '#FFF' }}
                                >
                                    <ProfileAvatar
                                        uri={userProfile.avatar_url}
                                        name={displayName}
                                        size={104}
                                        recyclingKey={userProfile.id}
                                    />
                                </TouchableOpacity>
                            }
                        />
                    ) : null}

                    <ProfileStatsCard
                        leftValue={isOrganizerProfile ? formatMembers(organizerPlansCount) : stats.numeroPlanesRealizados}
                        leftLabel={t('profilev.statPlans')}
                        rating={stats.valoracionMedia}
                        reviewsLabel={reviewsLabel}
                        middleMode={isOrganizerProfile ? 'stars' : 'repeat'}
                        repeatPct={isOrganizerProfile ? null : personRep.repeatPct}
                        middleText={isOrganizerProfile ? undefined : personRep.middleText}
                        rightValue={isOrganizerProfile ? formatMembers(followersCount) : friendsCount}
                        rightLabel={isOrganizerProfile ? t('profilev.statMembers') : t('userprofile.friendsLabel')}
                        overlapHero={!isOrganizerProfile}
                        onRightPress={
                            isOrganizerProfile && profileId
                                ? () => router.push({ pathname: '/organizer-members', params: { id: profileId } })
                                : undefined
                        }
                    />

                    {!isOrganizerProfile && friendStatus !== 'self' && mutualFriends.total > 0 ? (
                        <View style={styles.socialProof}>
                            {mutualFriends.items.length ? (
                                <MutualAvatarsRow
                                    people={mutualFriends.items}
                                    tone="dark"
                                    label={t(
                                        mutualFriends.total === 1
                                            ? 'profilev.mutualOne'
                                            : 'profilev.mutualMany',
                                        { n: mutualFriends.total },
                                    )}
                                />
                            ) : (
                                <Text style={[styles.socialFallback, { color: colors.textMuted }]}>
                                    {t(
                                        mutualFriends.total === 1
                                            ? 'profilev.mutualOne'
                                            : 'profilev.mutualMany',
                                        { n: mutualFriends.total },
                                    )}
                                </Text>
                            )}
                        </View>
                    ) : null}

                    {isOrganizerProfile && (followersCount > 0 || followerPreviews.length > 0) ? (
                        <View style={styles.socialProof}>
                            <FollowersAvatarsRow people={followerPreviews} total={followersCount} />
                        </View>
                    ) : null}

                    {canFollow ? (
                        <ProfileDualActions
                            primaryLabel={followingOrganizer ? t('organizer.following') : t('organizer.follow')}
                            primaryIcon={followingOrganizer ? 'checkmark' : 'heart-outline'}
                            onPrimary={() => void handleToggleFollow()}
                            primaryTone="purple"
                            primaryActive={followingOrganizer}
                            secondaryLabel={t('profilev.message')}
                            secondaryIcon="chatbubble-outline"
                            onSecondary={openMessage}
                        />
                    ) : null}

                    {canFriend ? (
                        <ProfileDualActions
                            primaryLabel={primaryFriendLabel}
                            primaryIcon={primaryFriendIcon}
                            onPrimary={onPrimaryFriend ?? (() => undefined)}
                            primaryTone="green"
                            primaryActive={friendStatus === 'friends' || friendStatus === 'pending_sent'}
                            secondaryLabel={t('profilev.message')}
                            secondaryIcon="chatbubble-outline"
                            onSecondary={openMessage}
                            extra={
                                friendStatus === 'pending_received' ? (
                                    <TouchableOpacity style={styles.rejectLink} onPress={() => void handleReject()}>
                                        <Text style={styles.rejectLinkText}>{t('userprofile.reject')}</Text>
                                    </TouchableOpacity>
                                ) : null
                            }
                        />
                    ) : null}

                    <ProfileReputationStats
                        stats={isOrganizerProfile ? stats : badgeStats}
                        isSelf={friendStatus === 'self'}
                        genero={isOrganizerProfile ? null : userProfile.genero}
                        affinityLevel={profileAffinity?.level ?? 0}
                        affinityScore={profileAffinity?.score}
                        showAffinity={
                            !isOrganizerProfile
                            && friendStatus !== 'self'
                            && !!currentUserId
                            && !currentUserIsOrganizer
                            && profileAffinity != null
                        }
                        viewerAvatarUrl={currentUserAvatarUrl ?? peekChromeAvatar(currentUserId)}
                        viewerName={currentUserNombre}
                        targetAvatarUrl={userProfile.avatar_url}
                        targetName={userProfile.nombre}
                        variant={isOrganizerProfile ? 'organizer' : 'person'}
                    />

                    {!isOrganizerProfile ? (
                        <>
                            {aboutText ? (
                                <ProfileSection title={t('userprofile.aboutMe')}>
                                    <TranslatedText
                                        text={aboutText}
                                        style={[styles.aboutText, { color: '#1E293B' }]}
                                    />
                                </ProfileSection>
                            ) : null}
                            {hobbies.length > 0 ? (
                                <ProfileSection title={t('userprofile.interests')}>
                                    <InterestTiles tags={hobbies} genero={userProfile.genero} t={t} />
                                </ProfileSection>
                            ) : null}
                            {parsePrivacy(userProfile.perfil_gustos).mostrar_planes !== false &&
                            attendedPlans.length > 0 ? (
                            <ProfileSection title={t('profilev.attendedPlans')}>
                                <AttendedPlansRow
                                    plans={attendedPlans}
                                    emptyLabel={t('profilev.attendedEmpty')}
                                    lang={lang}
                                    onPressPlan={openPlan}
                                />
                            </ProfileSection>
                            ) : null}
                        </>
                    ) : (
                        <>
                            {organizedPlans.length > 0 ? (
                                <ProfileSection title={t('organizer.organizedPlans')}>
                                    <AttendedPlansRow
                                        plans={organizedPlans.map(organizerPlanCard)}
                                        emptyLabel=""
                                        lang={lang}
                                        onPressPlan={openPlan}
                                    />
                                </ProfileSection>
                            ) : null}
                            {upcomingPlans.length > 0 ? (
                                <ProfileSection title={t('organizer.upcomingPlans')}>
                                    <AttendedPlansRow
                                        plans={upcomingPlans.map(organizerPlanCard)}
                                        emptyLabel=""
                                        lang={lang}
                                        showWhen
                                        onPressPlan={openPlan}
                                    />
                                </ProfileSection>
                            ) : null}
                            {(orgMeta.galeria?.length ?? 0) > 0 ? (
                                <ProfileSection title={t('organizer.moments')}>
                                    <ScrollView
                                        horizontal
                                        showsHorizontalScrollIndicator={false}
                                        nestedScrollEnabled
                                        contentContainerStyle={{ gap: 12, paddingRight: 8 }}
                                    >
                                        {(orgMeta.galeria ?? []).map((item, i) => (
                                            <GalleryThumb
                                                key={item.url}
                                                item={item}
                                                onPress={() => setGalleryIndex(i)}
                                            />
                                        ))}
                                    </ScrollView>
                                </ProfileSection>
                            ) : null}
                            {organizerCopy.information ? (
                                <ProfileSection title={t('organizer.fieldInfo')}>
                                    <TranslatedText text={organizerCopy.information} style={[styles.aboutText, { color: colors.textMuted }]} />
                                </ProfileSection>
                            ) : null}
                        </>
                    )}
                </ScrollView>
            )}

            {ready ? (
                <ProfileStickyBack onBack={() => router.back()} backLabel={t('common.back')} />
            ) : null}

            <AvatarLightbox
                visible={avatarOpen}
                uri={userProfile?.avatar_url}
                name={displayName}
                onClose={() => setAvatarOpen(false)}
            />
            <MediaLightbox
                visible={galleryIndex != null}
                items={orgMeta.galeria ?? []}
                initialIndex={galleryIndex ?? 0}
                onClose={() => setGalleryIndex(null)}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    page: { flex: 1 },
    scroll: { paddingBottom: 112 },
    loadingContainer: { flex: 1 },
    loadingTop: { paddingHorizontal: 16 },
    loadingBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
    errorText: { fontSize: 16, textAlign: 'center', marginTop: 16 },
    socialProof: { paddingHorizontal: 20, marginTop: 16 },
    socialFallback: { color: MUTED, fontWeight: '700', fontSize: 13, textAlign: 'center' },
    aboutText: { color: '#1E293B', fontSize: 16, lineHeight: 24, fontWeight: '500' },
    rejectLink: { alignSelf: 'center', paddingVertical: 4 },
    rejectLinkText: { color: DANGER, fontWeight: '700' },
    galleryThumb: { width: 92, height: 92, borderRadius: 14, overflow: 'hidden', marginRight: 8 },
    galleryThumbImg: { width: 92, height: 92 },
    galleryPlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.28)',
    },
});

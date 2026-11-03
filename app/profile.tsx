/*
perfil del usuario
*/
import {
    Ionicons } from '@expo/vector-icons';
import { useFocusEffect,
    useRouter } from 'expo-router';
import { useCallback,
    useEffect,
    useRef,
    useState } from 'react';
import {
    ScrollView,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { createProfileStyles } from '../features/profile/profileStyles';
import { useAppTheme, useThemedStyles } from '../lib/appTheme';
import type { ProfileUiSnapshot, QuickAction } from '../features/profile/types';
import { PeopleSearchIcon } from '../components/PeopleSearchIcon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { ProfileReputationStats } from '../components/ProfileReputationStats';
import { MediaLightbox } from '../components/MediaLightbox';
import { TranslatedText } from '../components/TranslatedText';
import {
    AttendedPlansRow,
    EditProfileButton,
    FrostedIconButton,
    ProfileStickyBack,
    GalleryThumb,
    InterestTiles,
    OrganizerIdentity,
    FollowersAvatarsRow,
    ProfileHero,
    ProfileSection,
    ProfileStatsCard,
    OrganizerInsightsButton,
    formatMembers,
} from '../components/profile-ui/ProfileRedesign';
import { getFriendsCount } from '../lib/friends';
import {
    getOrganizerFollowStats,
    getOrganizerMembers,
    getOrganizerPastPlans,
    getOrganizerPlansCount,
    getOrganizerUpcomingPlans,
    organizerPlanCard,
    organizerProfileCopy,
    parseOrganizerMeta,
    syncOrganizerAvatarFromRequest,
    type OrganizerMeta,
    type OrganizerUpcomingPlan,
} from '../lib/organizer';
import { useT } from '../lib/i18n';
import { hapticLight } from '../lib/haptics';
import { getProfileNotificationCount, subscribeProfileNotifications } from '../lib/notifications';
import { getAuthUser } from '../lib/auth';
import { useAuthSession } from '../lib/authSession';
import { formatCountdown, resolveRatingUiPhase } from '../lib/planLifecycle';
import { warmFriendsAndSavedPlans } from '../lib/prefetchHome';
import {
    getPendingRatingPlans,
    mergeAttendedPlansOptimistic,
    subscribeRatingSession,
    type PendingRatingPlan,
} from '../lib/ratings';
import { subscribeMyPlanHide } from '../lib/myPlansHide';
import {
    getPublicAttendedPlans,
    type PublicAttendedPlan,
} from '../lib/profileSocial';
import { shouldPreferProfileCache } from '../lib/profileOptimistic';
import {
    loadProfileRow,
    resolveDisplayName,
    syncProfileFromAuth,
} from '../lib/profile';
import { diskGet, diskSet } from '../lib/diskCache';
import { loadProfileScreen } from '../lib/profileScreen';
import { screenCacheKey, ScreenCacheTTL } from '../lib/screenCaches';
import { rememberChromeAvatar, peekChromeAvatar } from '../lib/chromeAvatar';
import { cacheGetStale, cacheSet } from '../lib/ttlCache';
import { EMPTY_STATS, getUserStats, personRepeatStat, type UserStats } from '../lib/stats';
import { EMPTY_BADGE_STATS, getBadgeStats, peekBadgeStats, type BadgeStats } from '../lib/badgeStats';
import { getUserBadges } from '../lib/badges';
import { perfEnd, perfStart, perfTimed } from '../lib/perfLog';
import {
    DEFAULT_PRIVACY,
    calcAge,
    parseHabitos,
    parsePrivacy,
    type Genero,
    type HabitoConsumo,
    type ProfilePrivacy,
} from '../lib/profileFields';
import { parseCountryCode } from '../lib/countryFlags';
import {
    hydrateEditProfileHints,
    shouldShowEditProfileHints,
    subscribeEditProfileHints,
} from '../lib/editProfileHints';
import { formatProfilePlace, parseProfilePlace, ensureAutoProfilePlace, mergePerfilGustosPlace, isManualProfilePlace } from '../lib/profilePlace';
import { readCoverUrl } from '../lib/profileCover';
import { theme } from '../theme';
import { useScrollViewRestore } from '../hooks/useScrollViewRestore';
import { ScreenKeys } from '../lib/screenState';

const INK = theme.colors.text;

export default function ProfileScreen() {
    const router = useRouter();
    const { t, lang } = useT();
    const { colors } = useAppTheme();
    const styles = useThemedStyles(createProfileStyles);
    const { userId, session } = useAuthSession();
    const cachedProfile = userId ? cacheGetStale<ProfileUiSnapshot>(screenCacheKey.profileUI(userId)) : null;
    const [user, setUser] = useState<any>(() => session?.user ?? null);
    const [nombre, setNombre] = useState(() => cachedProfile?.nombre ?? '');
    const [avatarUrl, setAvatarUrl] = useState<string | null>(() => {
        const fromCache = cachedProfile?.avatarUrl ?? null;
        if (fromCache) return fromCache;
        const fromChrome = userId ? peekChromeAvatar(userId) : null;
        if (fromChrome) return fromChrome;
        const meta = session?.user?.user_metadata?.avatar_url;
        return typeof meta === 'string' ? meta : null;
    });
    const [coverUrl, setCoverUrl] = useState<string | null>(() => cachedProfile?.coverUrl ?? null);
    const [attendedPlans, setAttendedPlans] = useState<PublicAttendedPlan[]>(() => cachedProfile?.attendedPlans ?? []);
    const [upcomingPlans, setUpcomingPlans] = useState<OrganizerUpcomingPlan[]>([]);
    const [organizedPlans, setOrganizedPlans] = useState<OrganizerUpcomingPlan[]>([]);
    const [friendsCount, setFriendsCount] = useState(() => cachedProfile?.friendsCount ?? 0);
    const [isOrganizer, setIsOrganizer] = useState(() => cachedProfile?.isOrganizer === true);
    const [organizerMeta, setOrganizerMeta] = useState<OrganizerMeta>(() => cachedProfile?.organizer ?? {});
    const [followersCount, setFollowersCount] = useState(() => cachedProfile?.followersCount ?? 0);
    const [followerPreviews, setFollowerPreviews] = useState<Array<{ id: string; nombre: string; avatar_url: string | null }>>([]);
    const [organizerPlansCount, setOrganizerPlansCount] = useState(0);
    const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
    const [friendsNotifCount, setFriendsNotifCount] = useState(() => cachedProfile?.friendsNotifCount ?? 0);
    const [planNotifCount, setPlanNotifCount] = useState(() => cachedProfile?.planRequests ?? 0);
    const [pendingRatings, setPendingRatings] = useState<PendingRatingPlan[]>(() => cachedProfile?.pendingRatings ?? []);
    const [nowTick, setNowTick] = useState(Date.now());
    const [aboutMe, setAboutMe] = useState(() => cachedProfile?.aboutMe ?? '');
    const [stats, setStats] = useState<UserStats>(() => cachedProfile?.stats ?? EMPTY_STATS);
    const [badgeStats, setBadgeStats] = useState<BadgeStats>(() => cachedProfile?.badgeStats ?? EMPTY_BADGE_STATS);
    const [age, setAge] = useState<number | null>(() => cachedProfile?.age ?? null);
    const [genero, setGenero] = useState<Genero | null>(() => cachedProfile?.genero ?? null);
    const [habitoBebida, setHabitoBebida] = useState<HabitoConsumo>(() => cachedProfile?.habitoBebida ?? 'no_especificado');
    const [habitoTabaco, setHabitoTabaco] = useState<HabitoConsumo>(() => cachedProfile?.habitoTabaco ?? 'no_especificado');
    const [aficiones, setAficiones] = useState<string[]>(() => cachedProfile?.aficiones ?? []);
    const [privacy, setPrivacy] = useState<ProfilePrivacy>(() => cachedProfile?.privacy ?? DEFAULT_PRIVACY);
    const [perfilGustos, setPerfilGustos] = useState<Record<string, unknown>>(() => cachedProfile?.perfilGustos ?? {});
    const [showEditHints, setShowEditHints] = useState(() => shouldShowEditProfileHints());
    const hasHydratedRef = useRef(!!cachedProfile);
    const sessionUserRef = useRef(session?.user ?? null);
    sessionUserRef.current = session?.user ?? null;
    const { scrollRef, onScroll, scrollEventThrottle } = useScrollViewRestore(ScreenKeys.PROFILE, {
        restore: false,
    });

    const applyProfileSnapshot = useCallback((snap: ProfileUiSnapshot) => {
        setNombre(snap.nombre);
        setAboutMe(snap.aboutMe);
        setAvatarUrl(snap.avatarUrl);
        setCoverUrl(snap.coverUrl ?? null);
        setAge(snap.age);
        setGenero(snap.genero);
        setHabitoBebida(snap.habitoBebida);
        setHabitoTabaco(snap.habitoTabaco);
        setAficiones(snap.aficiones);
        setPerfilGustos(snap.perfilGustos);
        setPrivacy(snap.privacy);
        setStats(snap.stats);
        setFriendsCount(snap.friendsCount);
        setFriendsNotifCount(snap.friendsNotifCount);
        setIsOrganizer(snap.isOrganizer === true);
        setOrganizerMeta(snap.organizer ?? {});
        setFollowersCount(snap.followersCount ?? 0);
        setPendingRatings(snap.pendingRatings);
        setBadgeStats(snap.badgeStats ?? EMPTY_BADGE_STATS);
        if (snap.attendedPlans?.length) setAttendedPlans(snap.attendedPlans);
        hasHydratedRef.current = true;
    }, []);

    useEffect(() => {
        void hydrateEditProfileHints().then(() => setShowEditHints(shouldShowEditProfileHints()));
        return subscribeEditProfileHints((seen) => setShowEditHints(!seen));
    }, []);

    useEffect(() => {
        if (!pendingRatings.some((p) => resolveRatingUiPhase(p, nowTick) === 'waiting')) return;
        const id = setInterval(() => setNowTick(Date.now()), 1000);
        return () => clearInterval(id);
    }, [pendingRatings, nowTick]);

    useEffect(() => {
        if (!userId) return;
        return subscribeRatingSession((evt) => {
            if (evt.userId !== userId) return;
            if (evt.type === 'removed') {
                setPendingRatings((prev) => prev.filter((p) => p.planId !== evt.planId));
                return;
            }
            if (evt.type === 'attended') {
                setAttendedPlans((prev) => (prev.some((p) => p.id === evt.plan.id) ? prev : [evt.plan, ...prev]));
                setStats((prev) => {
                    const snap = cacheGetStale<ProfileUiSnapshot>(screenCacheKey.profileUI(userId));
                    if (snap?.stats) return snap.stats;
                    return {
                        ...prev,
                        numeroPlanesRealizados: prev.numeroPlanesRealizados + 1,
                    };
                });
            }
        });
    }, [userId]);

    useEffect(() => {
        if (!userId) return;
        return subscribeMyPlanHide((evt) => {
            if (evt.userId !== userId) return;
            if (evt.type === 'attended' || evt.type === 'my-list') {
                setAttendedPlans((prev) => prev.filter((p) => p.id !== evt.planId));
            }
        });
    }, [userId]);

    // Badges de amigos / solicitudes de plan: si se atienden en Amigos o en el detalle del plan, bajan aquí también.
    useEffect(() => {
        if (!userId) return;
        return subscribeProfileNotifications(() => {
            void getProfileNotificationCount(userId, { force: true }).then((notifs) => {
                setFriendsNotifCount(notifs.friendRequests + notifs.planInvites + notifs.planRequests);
                setPlanNotifCount(notifs.planRequests);
            });
        });
    }, [userId]);

    const fetchUserData = useCallback(async () => {
        perfStart('profile.total');
        const authUser = sessionUserRef.current ?? (await getAuthUser());
        if (!authUser) return;

        setUser(authUser);

        let stale = cacheGetStale<ProfileUiSnapshot>(screenCacheKey.profileUI(authUser.id));
        if (!stale) {
            stale = await diskGet<ProfileUiSnapshot>(screenCacheKey.profileUI(authUser.id), 3 * 24 * 60 * 60 * 1000);
            if (stale?.userId === authUser.id) {
                cacheSet(screenCacheKey.profileUI(authUser.id), stale, ScreenCacheTTL.profileUI);
            } else {
                stale = null;
            }
        }
        if (stale && stale.userId === authUser.id) {
            applyProfileSnapshot(stale);
            if (shouldPreferProfileCache()) {
                // Edit reciente: pintar ya la caché (ubicación/nacionalidad) y no pisar con red.
                hasHydratedRef.current = true;
                perfEnd('profile.total');
                return;
            }
        } else if (shouldPreferProfileCache()) {
            // Guardado reciente sin snap usable: no abortar; la fila de red traerá la ubi.
        }

        // Si hay soft-stale de badges y el snap no traía, pintar ya.
        if (!stale?.badgeStats) {
            const peeked = peekBadgeStats(authUser.id);
            if (peeked) setBadgeStats(peeked);
        }

        const applyProfileFields = (profile: {
            nombre: string;
            nombre_usuario: string | null;
            avatar_url: string | null;
            cover_url?: string | null;
            descripcion: string;
            etiquetas: string[];
            fecha_nacimiento: string | null;
            genero: string | null;
            habitos_consumo: Record<string, unknown>;
            ambientes_preferidos: string[];
            perfil_gustos: Record<string, unknown>;
        }) => {
            setNombre(profile.nombre);
            setAboutMe(profile.descripcion);
            setAvatarUrl(profile.avatar_url);
            setCoverUrl(profile.cover_url ?? null);
            setAge(calcAge(profile.fecha_nacimiento));
            setGenero((profile.genero as Genero) || null);
            const habitos = parseHabitos(profile.habitos_consumo);
            setHabitoBebida(habitos.bebida);
            setHabitoTabaco(habitos.tabaco);
            setAficiones(profile.ambientes_preferidos?.length ? profile.ambientes_preferidos : profile.etiquetas);
            setPerfilGustos(profile.perfil_gustos);
            setPrivacy(parsePrivacy(profile.perfil_gustos));
        };

        const screen = await loadProfileScreen(authUser.id);
        if (screen && !shouldPreferProfileCache()) {
            applyProfileFields({
                nombre: screen.profile.nombre ?? '',
                nombre_usuario: screen.profile.nombre_usuario,
                avatar_url: screen.profile.avatar_url,
                cover_url: screen.profile.cover_url,
                descripcion: screen.profile.descripcion ?? '',
                etiquetas: screen.profile.etiquetas,
                fecha_nacimiento: screen.profile.fecha_nacimiento,
                genero: screen.profile.genero,
                habitos_consumo: screen.profile.habitos_consumo,
                ambientes_preferidos: screen.profile.ambientes_preferidos,
                perfil_gustos: screen.profile.perfil_gustos,
            });
            const organizer = screen.profile.es_organizador;
            const orgMeta = parseOrganizerMeta(screen.profile.organizador);
            setIsOrganizer(organizer);
            setOrganizerMeta(orgMeta);
            const attended = organizer ? [] : mergeAttendedPlansOptimistic(authUser.id, screen.attended);
            setAttendedPlans(attended);
            setStats(screen.stats);
            setBadgeStats(screen.badges);
            setFriendsCount(Math.max(screen.stats.numeroAmistades || 0, friendsCount));
            hasHydratedRef.current = true;
            if (organizer) {
                const [followStats, upcoming, organized, orgPlanCount, orgMembers] = await Promise.all([
                    getOrganizerFollowStats(authUser.id),
                    getOrganizerUpcomingPlans(authUser.id, 8),
                    getOrganizerPastPlans(authUser.id, 12),
                    getOrganizerPlansCount(authUser.id),
                    getOrganizerMembers(authUser.id),
                ]);
                setFollowersCount(followStats.followers ?? 0);
                setUpcomingPlans(upcoming);
                setOrganizedPlans(organized);
                setOrganizerPlansCount(orgPlanCount);
                setFollowerPreviews(orgMembers.map((member) => ({
                    id: member.id,
                    nombre: member.nombre ?? '',
                    avatar_url: member.avatar_url,
                })));
            }
            const snap: ProfileUiSnapshot = {
                userId: authUser.id,
                nombre: screen.profile.nombre ?? '',
                nombreUsuario: screen.profile.nombre_usuario,
                aboutMe: screen.profile.descripcion ?? '',
                avatarUrl: screen.profile.avatar_url,
                coverUrl: screen.profile.cover_url,
                age: calcAge(screen.profile.fecha_nacimiento),
                genero: (screen.profile.genero as Genero) || null,
                habitoBebida: parseHabitos(screen.profile.habitos_consumo).bebida,
                habitoTabaco: parseHabitos(screen.profile.habitos_consumo).tabaco,
                aficiones: screen.profile.ambientes_preferidos.length
                    ? screen.profile.ambientes_preferidos
                    : screen.profile.etiquetas,
                perfilGustos: screen.profile.perfil_gustos,
                privacy: parsePrivacy(screen.profile.perfil_gustos),
                stats: screen.stats,
                friendsCount: screen.stats.numeroAmistades || 0,
                friendsNotifCount,
                planRequests: planNotifCount,
                pendingRatings,
                badges: getUserBadges(screen.badges),
                badgeStats: screen.badges,
                isOrganizer: organizer,
                organizer: orgMeta,
                followersCount,
                attendedPlans: attended,
            };
            cacheSet(screenCacheKey.profileUI(authUser.id), snap, ScreenCacheTTL.profileUI);
            void diskSet(screenCacheKey.profileUI(authUser.id), snap);
            rememberChromeAvatar(authUser.id, screen.profile.avatar_url);
            void (async () => {
                const [exactFriends, notifs, nextRatings] = await Promise.all([
                    getFriendsCount(authUser.id).catch(() => screen.stats.numeroAmistades || 0),
                    getProfileNotificationCount(authUser.id).catch(() => null),
                    getPendingRatingPlans(authUser.id).catch(() => [] as PendingRatingPlan[]),
                ]);
                setFriendsCount(exactFriends);
                setPendingRatings(nextRatings);
                if (notifs) {
                    setFriendsNotifCount(notifs.friendRequests + notifs.planInvites + notifs.planRequests);
                    setPlanNotifCount(notifs.planRequests);
                }
            })();
            perfEnd('profile.total');
            return;
        }

        const row = await perfTimed('profile.loadRow', () => loadProfileRow(authUser.id));
        // Edit optimista terminado mientras cargábamos: preferir caché si existe.
        if (shouldPreferProfileCache()) {
            const fresh = cacheGetStale<ProfileUiSnapshot>(screenCacheKey.profileUI(authUser.id));
            if (fresh && fresh.userId === authUser.id) {
                applyProfileSnapshot(fresh);
                hasHydratedRef.current = true;
                perfEnd('profile.total');
                return;
            }
            // Sin caché: seguir con la fila de red (ya tiene la ubi del RPC).
        }
        let profileFields: {
            nombre: string;
            nombre_usuario: string | null;
            avatar_url: string | null;
            cover_url?: string | null;
            descripcion: string;
            etiquetas: string[];
            fecha_nacimiento: string | null;
            genero: string | null;
            habitos_consumo: Record<string, unknown>;
            ambientes_preferidos: string[];
            perfil_gustos: Record<string, unknown>;
        };

        if (row.data) {
            profileFields = {
                nombre: row.data.nombre?.trim() || resolveDisplayName(authUser),
                nombre_usuario: row.data.nombre_usuario ?? null,
                avatar_url:
                    row.data.avatar_url
                    ?? (typeof authUser.user_metadata?.avatar_url === 'string'
                        ? authUser.user_metadata.avatar_url
                        : null),
                cover_url: readCoverUrl(row.data),
                descripcion: row.data.descripcion ?? '',
                etiquetas: row.data.etiquetas ?? [],
                fecha_nacimiento: row.data.fecha_nacimiento ?? null,
                genero: row.data.genero ?? null,
                habitos_consumo: (row.data.habitos_consumo as Record<string, unknown>) ?? {},
                ambientes_preferidos: row.data.ambientes_preferidos ?? [],
                perfil_gustos: (row.data.perfil_gustos as Record<string, unknown>) ?? {},
            };
        } else {
            profileFields = await perfTimed('profile.syncProfile', () => syncProfileFromAuth(authUser));
        }
        applyProfileFields(profileFields);
        const organizer = row.data?.es_organizador === true;
        // Auto-ubicación en background: no pisa una ciudad ya mostrada / elegida.
        if (!organizer) {
            void ensureAutoProfilePlace(authUser.id).then((autoPlace) => {
                if (!autoPlace || shouldPreferProfileCache()) return;
                setPerfilGustos((prev) => {
                    if (isManualProfilePlace(prev) || parseProfilePlace(prev)?.ciudad) return prev;
                    return mergePerfilGustosPlace(prev, autoPlace);
                });
            });
        }
        if (organizer) {
            void syncOrganizerAvatarFromRequest(authUser.id).then((syncedAvatar) => {
                if (syncedAvatar) setAvatarUrl(syncedAvatar);
            });
        }
        const orgMeta = parseOrganizerMeta(row.data?.organizador);
        setIsOrganizer(organizer);
        setOrganizerMeta(orgMeta);

        const [userStats, followStats, attended, upcoming, organized, orgPlanCount, badgeStats, orgMembers] = await Promise.all([
            perfTimed('profile.userStats', () => getUserStats(authUser.id)),
            organizer
                ? perfTimed('profile.followers', () => getOrganizerFollowStats(authUser.id))
                : Promise.resolve({ followers: 0, following: false }),
            organizer ? Promise.resolve([]) : getPublicAttendedPlans(authUser.id, 12),
            organizer ? getOrganizerUpcomingPlans(authUser.id, 8) : Promise.resolve([]),
            organizer ? getOrganizerPastPlans(authUser.id, 12) : Promise.resolve([]),
            organizer ? getOrganizerPlansCount(authUser.id) : Promise.resolve(0),
            organizer ? Promise.resolve(null) : getBadgeStats(authUser.id, { userCreatedAt: authUser.created_at }),
            organizer ? getOrganizerMembers(authUser.id) : Promise.resolve([]),
        ]);
        if (shouldPreferProfileCache()) {
            const fresh = cacheGetStale<ProfileUiSnapshot>(screenCacheKey.profileUI(authUser.id));
            if (fresh && fresh.userId === authUser.id) {
                applyProfileSnapshot(fresh);
                hasHydratedRef.current = true;
                perfEnd('profile.total');
                return;
            }
            // Sin caché: continuar y pintar la fila de red.
        }
        setAttendedPlans(organizer ? [] : mergeAttendedPlansOptimistic(authUser.id, attended));
        if (!organizer) {
            for (const p of attended.slice(0, 3)) {
                void import('../lib/planDetailCache').then(({ prefetchPlanDetail }) => {
                    prefetchPlanDetail(p.id);
                });
            }
        }
        setUpcomingPlans(upcoming);
        setOrganizedPlans(organized);
        setOrganizerPlansCount(orgPlanCount);

        const friendsCountVal = Math.max(userStats.numeroAmistades || 0, friendsCount);
        const friendsNotif = friendsNotifCount;
        const ratings = pendingRatings;

        setStats(userStats);
        if (badgeStats) setBadgeStats(badgeStats);
        setFriendsCount(friendsCountVal);
        setFollowersCount(followStats.followers ?? 0);
        setFollowerPreviews(
            orgMembers.map((row) => ({
                id: row.id,
                nombre: row.nombre ?? '',
                avatar_url: row.avatar_url,
            })),
        );
        setPendingRatings(ratings);
        hasHydratedRef.current = true;

        const snap: ProfileUiSnapshot = {
            userId: authUser.id,
            nombre: profileFields.nombre,
            nombreUsuario: profileFields.nombre_usuario,
            aboutMe: profileFields.descripcion,
            avatarUrl: profileFields.avatar_url,
            coverUrl: profileFields.cover_url ?? null,
            age: calcAge(profileFields.fecha_nacimiento),
            genero: (profileFields.genero as Genero) || null,
            habitoBebida: parseHabitos(profileFields.habitos_consumo).bebida,
            habitoTabaco: parseHabitos(profileFields.habitos_consumo).tabaco,
            aficiones: profileFields.ambientes_preferidos?.length
                ? profileFields.ambientes_preferidos
                : profileFields.etiquetas,
            perfilGustos: profileFields.perfil_gustos,
            privacy: parsePrivacy(profileFields.perfil_gustos),
            stats: userStats,
            friendsCount: friendsCountVal,
            friendsNotifCount: friendsNotif,
            planRequests: planNotifCount,
            pendingRatings: ratings,
            badges: badgeStats ? getUserBadges(badgeStats) : [],
            badgeStats: badgeStats ?? undefined,
            isOrganizer: organizer,
            organizer: orgMeta,
            followersCount: followStats.followers ?? 0,
            attendedPlans: organizer ? [] : mergeAttendedPlansOptimistic(authUser.id, attended),
        };
        cacheSet(screenCacheKey.profileUI(authUser.id), snap, ScreenCacheTTL.profileUI);
        void diskSet(screenCacheKey.profileUI(authUser.id), snap);

        void (async () => {
            const [exactFriends, notifs, nextRatings] = await Promise.all([
                getFriendsCount(authUser.id).catch(() => friendsCountVal),
                getProfileNotificationCount(authUser.id).catch(() => null),
                getPendingRatingPlans(authUser.id).catch(() => [] as PendingRatingPlan[]),
            ]);
            if (shouldPreferProfileCache()) return;
            setFriendsCount(exactFriends);
            if (notifs) {
                const nextNotif = notifs.friendRequests + notifs.planInvites + notifs.planRequests;
                setFriendsNotifCount(nextNotif);
                setPlanNotifCount(notifs.planRequests);
                snap.friendsNotifCount = nextNotif;
                snap.planRequests = notifs.planRequests;
            }
            setPendingRatings(nextRatings);
            snap.friendsCount = exactFriends;
            snap.pendingRatings = nextRatings;
            cacheSet(screenCacheKey.profileUI(authUser.id), snap, ScreenCacheTTL.profileUI);
            void diskSet(screenCacheKey.profileUI(authUser.id), snap);
        })();
        rememberChromeAvatar(authUser.id, profileFields.avatar_url ?? null);
        perfEnd('profile.total');
    }, [applyProfileSnapshot]);

    useEffect(() => {
        if (!userId || cachedProfile) return;
        let alive = true;
        void diskGet<ProfileUiSnapshot>(screenCacheKey.profileUI(userId), 3 * 24 * 60 * 60 * 1000).then((snap) => {
            if (!alive || !snap || snap.userId !== userId) return;
            if (hasHydratedRef.current) return;
            cacheSet(screenCacheKey.profileUI(userId), snap, ScreenCacheTTL.profileUI);
            applyProfileSnapshot(snap);
        });
        return () => {
            alive = false;
        };
    }, [userId, cachedProfile, applyProfileSnapshot]);

    useFocusEffect(
        useCallback(() => {
            void fetchUserData();
            // Precargar Amigos / Guardados mientras estás en perfil (antes de entrar).
            warmFriendsAndSavedPlans();
        }, [fetchUserData])
    );

    const quickActions: QuickAction[] = isOrganizer
        ? []
        : [
            { key: 'friends', icon: 'people', labelKey: 'profile.friends', route: '/friends', color: INK, bg: theme.colors.surfaceSubtle, badge: friendsNotifCount },
            { key: 'search', icon: 'search', labelKey: 'profile.searchUsers', route: '/search-profiles', color: INK, bg: theme.colors.surfaceSubtle },
            { key: 'saved', icon: 'bookmark', labelKey: 'profile.saved', route: '/saved-plans', color: INK, bg: theme.colors.surfaceSubtle },
        ];

    const displayName = nombre.trim() || (user ? resolveDisplayName(user, t('profile.user')) : t('profile.user'));
    const galleryItems = isOrganizer ? (organizerMeta.galeria ?? []) : [];
    const organizerCopy = organizerProfileCopy(aboutMe, organizerMeta);

    const personRep = personRepeatStat(stats, { isSelf: true, genero, t });
    const reviewsLabel = isOrganizer
        ? `${stats.numeroValoraciones} ${t(
              stats.numeroValoraciones === 1 ? 'profile.review' : 'profile.reviews',
          )}`
        : personRep.label;

    const openRatingCount = pendingRatings.filter((p) => resolveRatingUiPhase(p, nowTick) === 'open').length;

    return (
        <View style={[styles.safe, { backgroundColor: colors.background }]}>
            <SafeAreaView style={styles.safeInner} edges={['left', 'right']}>
            <ScrollView
                ref={scrollRef}
                onScroll={onScroll}
                scrollEventThrottle={scrollEventThrottle}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[styles.scroll, { paddingHorizontal: 0, paddingBottom: 100 }]}
                keyboardShouldPersistTaps="handled"
            >
                <View style={styles.scrollPressable}>
                    <ProfileHero
                        variant={isOrganizer ? 'organizer' : 'person'}
                        coverUrl={coverUrl}
                        avatarUrl={avatarUrl}
                        name={displayName}
                        age={isOrganizer || privacy.mostrar_edad === false ? null : age}
                        flagCode={
                            isOrganizer || privacy.mostrar_nacionalidad === false
                                ? null
                                : parseCountryCode(perfilGustos)
                        }
                        placeLabel={
                            isOrganizer || privacy.mostrar_ubicacion === false
                                ? null
                                : formatProfilePlace(parseProfilePlace(perfilGustos))
                        }
                        instagram={null}
                        verified={isOrganizer}
                        stickyBack
                        onBack={() => router.back()}
                        onCoverPress={undefined}
                        coverEdit={false}
                        backLabel={t('common.back')}
                        topRight={
                            <FrostedIconButton
                                icon="settings-outline"
                                onPress={() => router.push('/settings')}
                                accessibilityLabel={t('settings.title')}
                            />
                        }
                    />
                    {isOrganizer ? (
                        <OrganizerIdentity
                            name={displayName}
                            verifiedLabel={t('profilev.verifiedCommunity')}
                            description={organizerCopy.description || undefined}
                            web={organizerMeta.web}
                            instagram={organizerMeta.instagram}
                            whatsapp={organizerMeta.whatsapp}
                            whatsappLabel={t('organizer.whatsappGroup')}
                            avatar={
                                <View style={{ borderWidth: 4, borderColor: '#FFF', borderRadius: 56, backgroundColor: '#FFF' }}>
                                    <ProfileAvatar uri={avatarUrl} name={displayName} size={104} recyclingKey={user?.id} />
                                </View>
                            }
                        />
                    ) : null}

                    <ProfileStatsCard
                        leftValue={isOrganizer ? formatMembers(organizerPlansCount) : stats.numeroPlanesRealizados}
                        leftLabel={t('profilev.statPlans')}
                        leftBadge={isOrganizer ? 0 : planNotifCount}
                        rating={stats.valoracionMedia}
                        reviewsLabel={reviewsLabel}
                        middleMode={isOrganizer ? 'stars' : 'repeat'}
                        repeatPct={isOrganizer ? null : personRep.repeatPct}
                        middleText={isOrganizer ? undefined : personRep.middleText}
                        rightValue={isOrganizer ? formatMembers(followersCount) : friendsCount}
                        rightLabel={isOrganizer ? t('profilev.statMembers') : t('profile.friendsLabel')}
                        rightBadge={isOrganizer ? 0 : friendsNotifCount}
                        overlapHero={!isOrganizer}
                        onLeftPress={() => {
                            hapticLight();
                            router.push('/my-plans');
                        }}
                        onRightPress={
                            isOrganizer
                                ? () => {
                                    if (!user?.id) return;
                                    router.push({ pathname: '/organizer-members', params: { id: user.id } });
                                }
                                : () =>
                                      router.push({
                                          pathname: '/friends',
                                          params: { tab: friendsNotifCount > 0 ? 'requests' : 'friends' },
                                      })
                        }
                    />

                    {isOrganizer && (followersCount > 0 || followerPreviews.length > 0) ? (
                        <View style={{ paddingHorizontal: 20 }}>
                            <FollowersAvatarsRow people={followerPreviews} total={followersCount} />
                        </View>
                    ) : null}

                    {isOrganizer ? (
                        <OrganizerInsightsButton
                            label={t('insights.open')}
                            onPress={() => router.push('/organizer-insights')}
                        />
                    ) : null}

                    <EditProfileButton
                        label={t('settings.editProfile')}
                        onPress={() => router.push('/edit-profile')}
                        tone={isOrganizer ? 'purple' : 'green'}
                        showHintBadge={!isOrganizer && showEditHints}
                    />

                    {pendingRatings.length > 0 ? (
                        <View style={styles.ratingsHighlight} pointerEvents="box-none">
                            <View style={styles.ratingsHighlightHead} pointerEvents="none">
                                <View style={styles.ratingsHighlightIcon}>
                                    <Ionicons name="star" size={14} color={colors.onPrimary} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.ratingsHighlightTitle}>{t('ratings.section')}</Text>
                                    <Text style={styles.ratingsHighlightSub}>
                                        {openRatingCount === 0
                                            ? t('ratings.waitingTitle')
                                            : openRatingCount === 1
                                                ? t('ratings.sectionHintOne')
                                                : t('ratings.sectionHint', { n: openRatingCount })}
                                    </Text>
                                </View>
                                <View style={styles.ratingsHighlightBadge}>
                                    <Text style={styles.ratingsHighlightBadgeText}>{openRatingCount}</Text>
                                </View>
                            </View>
                            <View style={styles.ratingsList}>
                                {pendingRatings.map((item) => {
                                    const waiting = resolveRatingUiPhase(item, nowTick) === 'waiting';
                                    const remaining = Math.max(0, item.unlockAt - nowTick);
                                    return (
                                        <TouchableOpacity
                                            key={item.planId}
                                            style={[styles.ratingCard, waiting ? styles.ratingCardWait : styles.ratingCardOpen]}
                                            activeOpacity={waiting ? 1 : 0.85}
                                            disabled={waiting}
                                            accessibilityRole="button"
                                            accessibilityHint={waiting ? undefined : t('ratings.sectionCardCta')}
                                            onPress={() =>
                                                router.push({ pathname: '/rate-plan', params: { planId: item.planId } })
                                            }
                                        >
                                            <View style={[styles.ratingIconWrap, waiting ? styles.ratingIconWait : styles.ratingIconOpen]}>
                                                <Ionicons
                                                    name={waiting ? 'hourglass-outline' : 'star'}
                                                    size={18}
                                                    color={waiting ? colors.warning : colors.onPrimary}
                                                />
                                            </View>
                                            <View style={{ flex: 1 }}>
                                                <Text style={styles.ratingCardTitle} numberOfLines={1}>{item.titulo}</Text>
                                                {waiting ? (
                                                    <Text style={styles.ratingCardSub}>
                                                        {t('ratings.unlockIn', { time: formatCountdown(remaining) })}
                                                    </Text>
                                                ) : (
                                                    <Text style={styles.ratingCardSub}>{t('ratings.sectionCardCta')}</Text>
                                                )}
                                            </View>
                                            {!waiting && <Ionicons name="chevron-forward" size={16} color={colors.primary} />}
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        </View>
                    ) : null}

                    {isOrganizer ? (
                        <ProfileReputationStats
                            stats={stats}
                            isSelf
                            variant="organizer"
                        />
                    ) : (
                        <ProfileReputationStats
                            stats={badgeStats}
                            isSelf
                            genero={genero}
                        />
                    )}

                    {!isOrganizer ? (
                        <>
                            {aboutMe.trim() ? (
                                <ProfileSection title={t('profile.aboutMe')}>
                                    <TranslatedText
                                        text={aboutMe.trim()}
                                        style={{ color: '#1E293B', fontSize: 16, lineHeight: 24, fontWeight: '500' }}
                                    />
                                </ProfileSection>
                            ) : null}
                            <ProfileSection title={t('userprofile.interests')}>
                                <InterestTiles tags={aficiones} genero={genero} t={t} />
                            </ProfileSection>
                            {privacy.mostrar_planes !== false && attendedPlans.length > 0 ? (
                            <ProfileSection title={t('profilev.attendedPlansSelf')}>
                                <AttendedPlansRow
                                    plans={attendedPlans}
                                    emptyLabel={t('profilev.attendedEmpty')}
                                    lang={lang}
                                    onPressPlan={(id) =>
                                        router.push({
                                            pathname: '/plan/[id]',
                                            params: { id, from: 'attended' },
                                        })
                                    }
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
                                        onPressPlan={(id) => router.push({ pathname: '/plan/[id]', params: { id } })}
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
                                        onPressPlan={(id) => router.push({ pathname: '/plan/[id]', params: { id } })}
                                    />
                                </ProfileSection>
                            ) : null}
                        </>
                    )}

                {galleryItems.length > 0 ? (
                    <ProfileSection title={t('organizer.moments')}>
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            nestedScrollEnabled
                            contentContainerStyle={styles.badgeRow}
                        >
                            {galleryItems.map((item, i) => (
                                <GalleryThumb
                                    key={item.url}
                                    item={item}
                                    onPress={() => setGalleryIndex(i)}
                                />
                            ))}
                        </ScrollView>
                    </ProfileSection>
                ) : null}

                {quickActions.length > 0 ? (
                <View style={styles.quickGrid}>
                    {quickActions.map((action) => (
                        <TouchableOpacity
                            key={action.key}
                            style={[styles.quickTile, isOrganizer && styles.orgQuickTile]}
                            onPressIn={() => warmFriendsAndSavedPlans(user?.id)}
                            onPress={() => {
                                if (action.key === 'friends' && (action.badge ?? 0) > 0) {
                                    router.push({ pathname: '/friends', params: { tab: 'requests' } });
                                } else {
                                    router.push(action.route as any);
                                }
                            }}
                            activeOpacity={0.85}
                        >
                            <View style={[styles.quickIconWrap, { backgroundColor: action.bg }]}>
                                {action.key === 'search' ? (
                                    <PeopleSearchIcon size={22} color={action.color} />
                                ) : (
                                    <Ionicons name={action.icon} size={22} color={action.color} />
                                )}
                                {(action.badge ?? 0) > 0 && (
                                    <View style={styles.quickBadge}>
                                        <Text style={styles.quickBadgeText}>
                                            {(action.badge ?? 0) > 9 ? '9+' : action.badge}
                                        </Text>
                                    </View>
                                )}
                            </View>
                            <Text style={[styles.quickLabel, isOrganizer && styles.orgQuickLabel]} numberOfLines={2}>{t(action.labelKey)}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
                ) : null}

                {isOrganizer && organizerCopy.information ? (
                    <ProfileSection title={t('organizer.fieldInfo')}>
                        <TranslatedText
                            text={organizerCopy.information}
                            style={{ color: colors.textMuted, fontSize: 16, lineHeight: 24, fontWeight: '500' }}
                        />
                    </ProfileSection>
                ) : null}
                </View>
            </ScrollView>

            <ProfileStickyBack onBack={() => router.back()} backLabel={t('common.back')} />

            <MediaLightbox
                visible={galleryIndex != null}
                items={galleryItems}
                initialIndex={galleryIndex ?? 0}
                onClose={() => setGalleryIndex(null)}
            />

            </SafeAreaView>
        </View>
    );
}

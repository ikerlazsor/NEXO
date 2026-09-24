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
import { screenCacheKey, ScreenCacheTTL } from '../lib/screenCaches';
import { rememberChromeAvatar, peekChromeAvatar } from '../lib/chromeAvatar';
import { cacheGetStale, cacheSet } from '../lib/ttlCache';
import { EMPTY_STATS, getUserStats, personRepeatStat, type UserStats } from '../lib/stats';
import { EMPTY_BADGE_STATS, getBadgeStats, type BadgeStats } from '../lib/badgeStats';
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
    const [attendedPlans, setAttendedPlans] = useState<PublicAttendedPlan[]>([]);
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
    const hasHydratedRef = useRef(!!cachedProfile);
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
        hasHydratedRef.current = true;
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
        const authUser = await getAuthUser();
        if (!authUser) return;

        setUser(authUser);

        const stale = cacheGetStale<ProfileUiSnapshot>(screenCacheKey.profileUI(authUser.id));
        if (stale && stale.userId === authUser.id) {
            applyProfileSnapshot(stale);
            if (shouldPreferProfileCache()) {
                // Edit reciente: no pisar con red hasta que el write termine.
                hasHydratedRef.current = true;
                perfEnd('profile.total');
                return;
            }
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

        const row = await perfTimed('profile.loadRow', () => loadProfileRow(authUser.id));
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
        if (organizer) {
            const syncedAvatar = await syncOrganizerAvatarFromRequest(authUser.id);
            if (syncedAvatar && syncedAvatar !== profileFields.avatar_url) {
                profileFields = { ...profileFields, avatar_url: syncedAvatar };
                applyProfileFields(profileFields);
            }
        }
        const orgMeta = parseOrganizerMeta(row.data?.organizador);
        setIsOrganizer(organizer);
        setOrganizerMeta(orgMeta);

        const [userStats, friendsCountVal, notifs, ratings, followStats, attended, upcoming, organized, orgPlanCount, badgeStats, orgMembers] = await Promise.all([
            perfTimed('profile.userStats', () => getUserStats(authUser.id)),
            perfTimed('profile.friendsCount', () => getFriendsCount(authUser.id)),
            perfTimed('profile.notifications', () => getProfileNotificationCount(authUser.id)),
            perfTimed('profile.ratings', () => getPendingRatingPlans(authUser.id)),
            organizer
                ? perfTimed('profile.followers', () => getOrganizerFollowStats(authUser.id))
                : Promise.resolve({ followers: 0, following: false }),
            organizer ? Promise.resolve([]) : getPublicAttendedPlans(authUser.id, 12),
            organizer ? getOrganizerUpcomingPlans(authUser.id, 8) : Promise.resolve([]),
            organizer ? getOrganizerPastPlans(authUser.id, 12) : Promise.resolve([]),
            organizer ? getOrganizerPlansCount(authUser.id) : Promise.resolve(0),
            organizer
                ? Promise.resolve(null)
                : getBadgeStats(authUser.id, { userCreatedAt: authUser.created_at }),
            organizer ? getOrganizerMembers(authUser.id) : Promise.resolve([]),
        ]);
        setAttendedPlans(organizer ? [] : mergeAttendedPlansOptimistic(authUser.id, attended));
        if (!organizer) {
            for (const p of attended.slice(0, 12)) {
                void import('../lib/planDetailCache').then(({ prefetchPlanDetail }) => {
                    prefetchPlanDetail(p.id);
                });
            }
        }
        setUpcomingPlans(upcoming);
        setOrganizedPlans(organized);
        setOrganizerPlansCount(orgPlanCount);

        const friendsNotif = notifs.friendRequests + notifs.planInvites + notifs.planRequests;

        setStats(userStats);
        if (badgeStats) setBadgeStats(badgeStats);
        setFriendsCount(friendsCountVal);
        setFriendsNotifCount(friendsNotif);
        setPlanNotifCount(notifs.planRequests);
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
            planRequests: notifs.planRequests,
            pendingRatings: ratings,
            badges: badgeStats ? getUserBadges(badgeStats) : [],
            badgeStats: badgeStats ?? undefined,
            isOrganizer: organizer,
            organizer: orgMeta,
            followersCount: followStats.followers ?? 0,
        };
        cacheSet(screenCacheKey.profileUI(authUser.id), snap, ScreenCacheTTL.profileUI);
        rememberChromeAvatar(authUser.id, profileFields.avatar_url ?? null);
        perfEnd('profile.total');
    }, [applyProfileSnapshot]);

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
                        genero={isOrganizer || privacy.mostrar_genero === false ? null : genero}
                        flagCode={
                            isOrganizer || privacy.mostrar_edad === false || privacy.mostrar_genero === false
                                ? null
                                : parseCountryCode(perfilGustos)
                        }
                        verified={isOrganizer}
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
                                        {pendingRatings.length === 1
                                            ? t('ratings.sectionHintOne')
                                            : t('ratings.sectionHint', { n: pendingRatings.length })}
                                    </Text>
                                </View>
                                <View style={styles.ratingsHighlightBadge}>
                                    <Text style={styles.ratingsHighlightBadgeText}>{pendingRatings.length}</Text>
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

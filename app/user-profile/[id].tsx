import {
    Ionicons } from '@expo/vector-icons';
import { useFocusEffect,
    useLocalSearchParams,
    useRouter } from 'expo-router';
import { startTransition,
    useCallback,
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
import { ProfileAvatar } from '../../components/ProfileAvatar';
import { ProfileReputationStats } from '../../components/ProfileReputationStats';
import { BadgeDetailModal, BadgeTile } from '../../components/TrophyBadge';
import { getAuthUser } from '../../lib/auth';
import { getUserBadges, type UserBadge } from '../../lib/badges';
import { getBadgeStats } from '../../lib/badgeStats';
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
import { renderRatingStars } from '../../lib/profileRating';
import { EMPTY_STATS, formatRatingScore, getUserStats, type UserStats } from '../../lib/stats';
import { cacheGetStale, cacheIsFresh, cacheInvalidate, cacheSet } from '../../lib/ttlCache';
import { screenCacheKey } from '../../lib/screenCaches';
import { ensureDirectConversation } from '../../lib/directChat';
import { getAdminProfileAccess, getMyProfile, getPublicProfile } from '../../lib/profileData';
import { useScrollViewRestore } from '../../hooks/useScrollViewRestore';
import { ScreenKeys } from '../../lib/screenState';
import { bothFemaleGenero, getPersonalityLabel, parseHabitos, parsePrivacy, type ProfilePrivacy } from '../../lib/profileFields';
import { deleteUserAdmin } from '../../lib/moderation';
import { fetchAccountAccess } from '../../lib/roles';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F172A';
const MUTED = '#64748B';
const BG = '#F8FAFC';
const SURFACE = '#FFFFFF';
const BORDER = '#E2E8F0';
const SUCCESS = '#22C55E';
const DANGER = '#EF4444';
const USER_PROFILE_TTL_MS = 90_000;
const userProfileKey = (id: string) => `userProfile:${id}`;

type PublicProfile = {
    id: string;
    nombre: string | null;
    avatar_url: string | null;
    descripcion: string | null;
    etiquetas: string[] | null;
    edad: number | null;
    genero: string | null;
    nombre_usuario: string | null;
    habitos_consumo: Record<string, unknown> | null;
    ambientes_preferidos: string[] | null;
    perfil_gustos: Record<string, unknown> | null;
};

type UserProfileSnapshot = {
    userProfile: PublicProfile;
    friendsCount: number;
    stats: UserStats;
    badges: UserBadge[];
    privacy: ProfilePrivacy;
    friendStatus: FriendStatus | null;
    requestId: string | null;
    blocked: boolean;
    blockedEitherWay: boolean;
    currentUserId: string | null;
    currentUserGenero: string | null;
    sharedPlans: number;
};

export default function UserProfileScreen() {
    const router = useRouter();
    const { t } = useT();
    const { id, isFriend } = useLocalSearchParams<{ id: string | string[]; isFriend?: string }>();
    const profileId = Array.isArray(id) ? id[0] : id;
    const friendHint = isFriend === '1';
    const scrollKey = profileId ? `${ScreenKeys.USER_PROFILE}:${profileId}` : ScreenKeys.USER_PROFILE;
    // Sin restore automático: al entrar recolocaba el scroll y se veía un "bote".
    const { scrollRef, onScroll, scrollEventThrottle } = useScrollViewRestore(scrollKey, { restore: false });

    const cached = profileId ? cacheGetStale<UserProfileSnapshot>(userProfileKey(profileId)) : null;

    const [loading, setLoading] = useState(() => !cached?.userProfile);
    const [userProfile, setUserProfile] = useState<PublicProfile | null>(() => cached?.userProfile ?? null);
    const [currentUserId, setCurrentUserId] = useState<string | null>(() => cached?.currentUserId ?? null);
    const [friendStatus, setFriendStatus] = useState<FriendStatus | null>(
        () => cached?.friendStatus ?? (friendHint ? 'friends' : 'none'),
    );
    const [requestId, setRequestId] = useState<string | null>(() => cached?.requestId ?? null);
    const [friendsCount, setFriendsCount] = useState(() => cached?.friendsCount ?? 0);
    const [stats, setStats] = useState<UserStats>(() => cached?.stats ?? EMPTY_STATS);
    const [blocked, setBlocked] = useState(() => cached?.blocked ?? false);
    const [blockedEitherWay, setBlockedEitherWay] = useState(() => cached?.blockedEitherWay ?? false);
    const [privacy, setPrivacy] = useState<ProfilePrivacy | null>(() => cached?.privacy ?? null);
    const [badges, setBadges] = useState<UserBadge[]>(() => cached?.badges ?? []);
    const [selectedBadge, setSelectedBadge] = useState<UserBadge | null>(null);
    const [avatarOpen, setAvatarOpen] = useState(false);
    const [sharedPlans, setSharedPlans] = useState(() => cached?.sharedPlans ?? 0);
    const [currentUserGenero, setCurrentUserGenero] = useState<string | null>(
        () => cached?.currentUserGenero ?? null,
    );
    const [isOwner, setIsOwner] = useState(false);
    const [targetIsStaff, setTargetIsStaff] = useState(false);
    const [deletingUser, setDeletingUser] = useState(false);
    const hasDataRef = useRef(!!cached?.userProfile);
    /** Promesa del envío en curso (para poder cancelar antes de tener requestId). */
    const pendingSendRef = useRef<Promise<string | null> | null>(null);
    const cancelDesiredRef = useRef(false);

    const applySnapshot = useCallback((snap: UserProfileSnapshot) => {
        setUserProfile(snap.userProfile);
        setFriendsCount(snap.friendsCount);
        setStats(snap.stats);
        setBadges(snap.badges);
        setPrivacy(snap.privacy);
        setFriendStatus(snap.friendStatus);
        setRequestId(snap.requestId);
        setBlocked(snap.blocked);
        setBlockedEitherWay(snap.blockedEitherWay);
        setCurrentUserId(snap.currentUserId);
        setCurrentUserGenero(snap.currentUserGenero);
        setSharedPlans(snap.sharedPlans);
        hasDataRef.current = true;
    }, []);

    const loadProfile = useCallback(async (opts?: { force?: boolean }) => {
        if (!profileId) return;
        const profileKey = userProfileKey(profileId);

        try {
            const stale = cacheGetStale<UserProfileSnapshot>(profileKey);
            if (stale?.userProfile) {
                // Solo hidratar si aún no hay UI: evita un segundo layout al refrescar.
                if (!hasDataRef.current) {
                    applySnapshot(stale);
                }
                setLoading(false);
                if (!opts?.force && cacheIsFresh(profileKey)) return;
            } else if (!hasDataRef.current) {
                setLoading(true);
            }

            const user = await getAuthUser();

            const friendPromise =
                user && user.id !== profileId
                    ? Promise.all([
                          getFriendStatus(user.id, profileId),
                          isUserBlocked(user.id, profileId),
                          isBlockedEitherWay(user.id, profileId),
                          countSharedAttendedPlans(user.id, profileId),
                          getMyProfile(),
                      ])
                    : Promise.resolve(null);

            const [profile, count, userStats, badgeStats, friendData, access] = await Promise.all([
                getPublicProfile(profileId),
                getFriendsCount(profileId),
                getUserStats(profileId),
                getBadgeStats(profileId),
                friendPromise,
                user ? fetchAccountAccess(user.id) : Promise.resolve(null),
            ]);

            if (!profile) throw new Error('profile_missing');

            setIsOwner(!!access?.isOwner);
            const targetAccess = access?.isOwner
                ? await getAdminProfileAccess(profileId)
                : null;
            const targetRol = targetAccess?.rol;
            setTargetIsStaff(targetRol === 'owner' || targetRol === 'admin');

            const nextProfile: PublicProfile = {
                id: profile.id,
                nombre: profile.nombre,
                nombre_usuario: profile.nombre_usuario,
                avatar_url: profile.avatar_url,
                descripcion: profile.descripcion,
                etiquetas: Array.isArray(profile.etiquetas) ? profile.etiquetas : [],
                edad: profile.edad,
                genero: profile.genero,
                habitos_consumo: (profile.habitos_consumo as Record<string, unknown>) ?? {},
                ambientes_preferidos: Array.isArray(profile.ambientes_preferidos) ? profile.ambientes_preferidos : [],
                perfil_gustos: (profile.perfil_gustos as Record<string, unknown>) ?? {},
            };

            let nextFriendStatus: FriendStatus | null = 'none';
            let nextRequestId: string | null = null;
            let nextBlocked = false;
            let nextBlockedEitherWay = false;
            let nextSharedPlans = 0;
            let nextMyGenero: string | null = null;

            if (friendData) {
                const [status, isBlocked, eitherWay, shared, myProfileRes] = friendData;
                nextFriendStatus = status.status;
                nextRequestId = status.requestId;
                nextBlocked = isBlocked;
                nextBlockedEitherWay = eitherWay;
                nextSharedPlans = shared;
                nextMyGenero = (myProfileRes.data?.genero as string | null) ?? null;
            } else if (user?.id === profileId) {
                nextFriendStatus = 'self';
            }

            const snap: UserProfileSnapshot = {
                userProfile: nextProfile,
                // Amigos públicos desde stats (amistades RLS solo deja ver las propias).
                friendsCount: Math.max(count, userStats.numeroAmistades || 0),
                stats: userStats,
                badges: getUserBadges(badgeStats),
                privacy: parsePrivacy(profile.perfil_gustos),
                friendStatus: nextFriendStatus,
                requestId: nextRequestId,
                blocked: nextBlocked,
                blockedEitherWay: nextBlockedEitherWay,
                currentUserId: user?.id ?? null,
                currentUserGenero: nextMyGenero,
                sharedPlans: nextSharedPlans,
            };

            cacheSet(profileKey, snap, USER_PROFILE_TTL_MS);
            if (hasDataRef.current) {
                // Refresco en background: no forzar un segundo layout brusco al entrar.
                startTransition(() => applySnapshot(snap));
            } else {
                applySnapshot(snap);
            }
        } catch (error) {
            if (__DEV__) console.error('Error fetching user profile:', error);
            if (!hasDataRef.current) setUserProfile(null);
        } finally {
            setLoading(false);
        }
    }, [profileId, applySnapshot]);

    useFocusEffect(
        useCallback(() => {
            void loadProfile();
            // La amistad puede cambiar en otro dispositivo mientras la caché sigue "fresca".
            let cancelled = false;
            void (async () => {
                if (!profileId) return;
                const user = await getAuthUser();
                if (!user || user.id === profileId) return;
                try {
                    const status = await getFriendStatus(user.id, profileId);
                    if (cancelled) return;
                    setFriendStatus(status.status);
                    setRequestId(status.requestId);
                    const prev = cacheGetStale<UserProfileSnapshot>(userProfileKey(profileId));
                    if (prev) {
                        cacheSet(
                            userProfileKey(profileId),
                            {
                                ...prev,
                                friendStatus: status.status,
                                requestId: status.requestId,
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
        }, [loadProfile, profileId])
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
                if (!cancelDesiredRef.current) {
                    setFriendStatus(prevStatus);
                    setRequestId(prevRequestId);
                    hapticError();
                    Alert.alert(
                        t('userprofile.sendFail'),
                        error === 'friend_request_daily_limit' ? t('friends.requestDailyLimit') : error,
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

        Alert.alert(t('userprofile.nowFriends'), t('userprofile.nowFriendsMsg'));
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
        if (!isOwner || !profileId || friendStatus === 'self' || targetIsStaff || deletingUser) return;
        Alert.alert(t('admin.deleteUserTitle'), t('admin.deleteUserMsg'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('admin.deleteUserConfirm'),
                style: 'destructive',
                onPress: () => {
                    setDeletingUser(true);
                    void (async () => {
                        const { error } = await deleteUserAdmin(profileId);
                        setDeletingUser(false);
                        if (error) {
                            const key = `admin.err.${error}` as const;
                            const msg =
                                error === 'cannot_moderate_staff'
                                    ? t('admin.err.cannot_moderate_staff')
                                    : error === 'not_authorized'
                                      ? t('admin.err.not_authorized')
                                      : error === 'user_not_found'
                                        ? t('admin.err.user_not_found')
                                        : error === 'invalid_target'
                                          ? t('admin.err.invalid_target')
                                          : error;
                            Alert.alert(t('admin.error'), typeof msg === 'string' ? msg : t(key));
                            return;
                        }
                        Alert.alert(t('admin.userDeleted'));
                        router.back();
                    })();
                },
            },
        ]);
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
        if (!requestId || !userProfile) return;
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
                        void removeFriend(prevRequestId!).then(({ error }) => {
                            if (error) {
                                setFriendStatus(prevStatus);
                                setRequestId(prevRequestId);
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
                        });
                    },
                },
            ]
        );
    };

    const handleToggleBlock = () => {
        if (!currentUserId || !profileId || !userProfile) return;

        if (blocked) {
            Alert.alert(t('userprofile.unblockTitle'), t('userprofile.unblockConfirm'), [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('userprofile.unblock'),
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
            t('userprofile.blockTitle'),
            t('userprofile.blockConfirmName', { name: userProfile.nombre || t('chats.user') }),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('userprofile.block'),
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

    const renderFriendAction = () => {
        if (friendStatus === 'self' || blockedEitherWay) return null;

        if (friendStatus === 'friends') {
            return (
                <View style={[styles.actionSlot, styles.friendsActions]}>
                    <TouchableOpacity
                        style={styles.chatBtn}
                        onPress={() => {
                            if (!userProfile?.id || !currentUserId) return;
                            void ensureDirectConversation(currentUserId, userProfile.id).then(() => {
                                cacheInvalidate(screenCacheKey.chatsList(currentUserId));
                            });
                            router.push(`/direct-chat/${userProfile.id}`);
                        }}
                        activeOpacity={0.88}
                        accessibilityRole="button"
                        accessibilityLabel={t('chat.directSubtitle')}
                    >
                        <Ionicons name="chatbubble" size={22} color="#FFF" />
                    </TouchableOpacity>
                    <View style={styles.friendsBadge}>
                        <Ionicons name="checkmark-circle" size={18} color={SUCCESS} />
                        <Text style={styles.friendsBadgeText}>
                            {t(femalePair ? 'userprofile.areFriendsF' : 'userprofile.areFriends')}
                        </Text>
                    </View>
                    <TouchableOpacity style={styles.removeFriendBtn} onPress={handleRemoveFriend} activeOpacity={0.85}>
                        <Ionicons name="heart-dislike-outline" size={17} color={DANGER} />
                        <Text style={styles.removeFriendText}>
                            {t(femalePair ? 'userprofile.unfriendF' : 'userprofile.unfriend')}
                        </Text>
                    </TouchableOpacity>
                </View>
            );
        }

        if (friendStatus === 'pending_sent') {
            return (
                <TouchableOpacity style={[styles.actionSlot, styles.pendingBtn]} onPress={handleCancelRequest} activeOpacity={0.85}>
                    <Ionicons name="time-outline" size={18} color="#64748B" />
                    <Text style={styles.pendingBtnText}>{t('userprofile.requestSent')}</Text>
                </TouchableOpacity>
            );
        }

        if (friendStatus === 'pending_received') {
            return (
                <View style={[styles.actionSlot, styles.receivedActions]}>
                    <TouchableOpacity style={styles.acceptBtn} onPress={handleAccept} activeOpacity={0.88}>
                        <Ionicons name="person-add" size={18} color="#FFF" />
                        <Text style={styles.acceptBtnText}>{t('userprofile.acceptFriend')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.rejectBtn} onPress={handleReject} activeOpacity={0.85}>
                        <Text style={styles.rejectBtnText}>{t('userprofile.reject')}</Text>
                    </TouchableOpacity>
                </View>
            );
        }

        return (
            <TouchableOpacity style={[styles.actionSlot, styles.addFriendBtn]} onPress={handleSendRequest} activeOpacity={0.88}>
                <Ionicons name="person-add-outline" size={20} color="#FFF" />
                <Text style={styles.addFriendText}>{t('userprofile.addFriend')}</Text>
            </TouchableOpacity>
        );
    };

    const displayName = userProfile?.nombre?.trim() || t('profile.user');
    const aboutText = (userProfile?.descripcion ?? '').trim();
    const hobbies = userProfile?.ambientes_preferidos?.length
        ? userProfile.ambientes_preferidos
        : (userProfile?.etiquetas ?? []);
    const age = userProfile?.edad ?? null;
    const habitos = parseHabitos(userProfile?.habitos_consumo ?? null);
    const priv = privacy ?? parsePrivacy(userProfile?.perfil_gustos);
    const ready = !!userProfile;

    const detailItems: {
        key: string;
        label: string;
        value: string;
        kind: 'age' | 'gender' | 'bebida' | 'tabaco';
        genero?: string;
    }[] = [];
    if (ready) {
        if (priv.mostrar_edad && age) {
            detailItems.push({ key: 'age', label: t('profile.age'), value: String(age), kind: 'age' });
        }
        if (priv.mostrar_genero && userProfile.genero) {
            detailItems.push({
                key: 'gender',
                label: t('profile.gender'),
                value: t('genero.' + userProfile.genero),
                kind: 'gender',
                genero: userProfile.genero,
            });
        }
        if (priv.mostrar_bebida && habitos.bebida !== 'no_especificado') {
            detailItems.push({
                key: 'bebida',
                label: t('profile.drinking'),
                value: t('habito.' + habitos.bebida),
                kind: 'bebida',
            });
        }
        if (priv.mostrar_tabaco && habitos.tabaco !== 'no_especificado') {
            detailItems.push({
                key: 'tabaco',
                label: t('profile.smoking'),
                value: t('habito.' + habitos.tabaco),
                kind: 'tabaco',
            });
        }
    }

    return (
        <SafeAreaView style={styles.safe} edges={['top']}>
            <View style={styles.topBar}>
                <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} activeOpacity={0.8}>
                    <Ionicons name="chevron-back" size={24} color={INK} />
                </TouchableOpacity>
                <Text style={styles.topTitle}>{t('userprofile.title')}</Text>
                <View style={styles.iconBtnPlaceholder} />
            </View>

            {!ready ? (
                <View style={styles.loadingContainer}>
                    {loading ? (
                        <ActivityIndicator size="large" color={PRIMARY_DARK} />
                    ) : (
                        <>
                            <Ionicons name="alert-circle-outline" size={40} color="#94A3B8" />
                            <Text style={styles.errorText}>{t('userprofile.loadError')}</Text>
                        </>
                    )}
                </View>
            ) : (
                <ScrollView
                    ref={scrollRef}
                    onScroll={onScroll}
                    scrollEventThrottle={scrollEventThrottle}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={styles.scroll}
                    removeClippedSubviews={false}
                >
                    <View style={styles.heroCard}>
                        <TouchableOpacity
                            onPress={() => setAvatarOpen(true)}
                            activeOpacity={0.9}
                            accessibilityRole="imagebutton"
                            style={
                                friendStatus === 'friends'
                                    ? [styles.avatarRingFriend, { width: 108, height: 108, borderRadius: 54 }]
                                    : undefined
                            }
                        >
                            <ProfileAvatar
                                uri={userProfile.avatar_url}
                                name={displayName}
                                size={96}
                                recyclingKey={userProfile.id}
                            />
                        </TouchableOpacity>

                        <Text style={styles.displayName} numberOfLines={1}>{displayName}</Text>
                        <Text
                            style={[styles.username, !userProfile.nombre_usuario && styles.usernameHidden]}
                            numberOfLines={1}
                        >
                            {userProfile.nombre_usuario ? `@${userProfile.nombre_usuario}` : ' '}
                        </Text>

                        <View style={styles.statsRow}>
                            <View style={styles.statItem}>
                                <Text style={styles.statValue}>{stats.numeroPlanesRealizados}</Text>
                                <Text style={styles.statLabel}>{t('userprofile.plansLabel')}</Text>
                            </View>
                            <View style={styles.statDivider} />
                            <View style={styles.statItem}>
                                <Text style={styles.statValue}>{formatRatingScore(stats.valoracionMedia)}</Text>
                                <View style={styles.starsRow}>{renderRatingStars(stats.valoracionMedia, 12)}</View>
                                <Text style={styles.statMeta}>
                                    {stats.numeroValoraciones}{' '}
                                    {t(stats.numeroValoraciones === 1 ? 'userprofile.review' : 'userprofile.reviews')}
                                </Text>
                            </View>
                            <View style={styles.statDivider} />
                            <View style={styles.statItem}>
                                <Text style={styles.statValue}>{friendsCount}</Text>
                                <Text style={styles.statLabel}>{t('userprofile.friendsLabel')}</Text>
                            </View>
                        </View>

                        <View style={styles.reputationSlot} collapsable={false}>
                            <ProfileReputationStats
                                stats={stats}
                                displayName={displayName}
                                genero={userProfile.genero}
                            />
                        </View>

                        {friendStatus !== 'self' && !blockedEitherWay && sharedPlans > 0 ? (
                            <View style={styles.sharedPlansBanner}>
                                <Ionicons name="calendar-outline" size={16} color={PRIMARY_DARK} style={{ marginTop: 1 }} />
                                <Text style={styles.sharedPlansText}>
                                    {t(
                                        sharedPlans === 1
                                            ? femalePair
                                                ? 'userprofile.sharedPlansOneF'
                                                : 'userprofile.sharedPlansOne'
                                            : femalePair
                                              ? 'userprofile.sharedPlansManyF'
                                              : 'userprofile.sharedPlansMany',
                                        { name: displayName, n: sharedPlans },
                                    )}
                                </Text>
                            </View>
                        ) : null}

                        {friendStatus !== 'self' && !blockedEitherWay ? (
                            <View style={styles.actionWrap} collapsable={false}>
                                {renderFriendAction()}
                            </View>
                        ) : null}
                    </View>

                    {aboutText ? (
                        <View style={styles.card}>
                            <Text style={styles.cardTitle}>{t('userprofile.aboutMe')}</Text>
                            <Text style={styles.aboutText}>{aboutText}</Text>
                        </View>
                    ) : null}

                    {detailItems.length > 0 ? (
                        <View style={styles.detailsWrap}>
                            {detailItems.map((item) => {
                                const isMale = item.genero === 'masculino';
                                const isFemale = item.genero === 'femenino';
                                return (
                                    <View
                                        key={item.key}
                                        style={[
                                            styles.detailChip,
                                            item.kind === 'gender' && isMale && styles.detailChipMale,
                                            item.kind === 'gender' && isFemale && styles.detailChipFemale,
                                        ]}
                                    >
                                        {item.kind === 'age' ? (
                                            <Ionicons name="calendar-outline" size={15} color={PRIMARY_DARK} />
                                        ) : null}
                                        {item.kind === 'gender' ? (
                                            <Ionicons
                                                name={
                                                    isMale
                                                        ? 'male'
                                                        : isFemale
                                                          ? 'female'
                                                          : item.genero === 'no_binario'
                                                            ? 'male-female'
                                                            : 'ellipsis-horizontal'
                                                }
                                                size={16}
                                                color={isMale ? '#2563EB' : isFemale ? '#DB2777' : PRIMARY_DARK}
                                            />
                                        ) : null}
                                        {item.kind === 'bebida' ? (
                                            <Ionicons name="wine-outline" size={15} color={PRIMARY_DARK} />
                                        ) : null}
                                        {item.kind === 'tabaco' ? (
                                            <Ionicons name="leaf-outline" size={15} color={PRIMARY_DARK} />
                                        ) : null}
                                        <Text
                                            style={[
                                                styles.detailChipText,
                                                item.kind === 'gender' && isMale && styles.detailChipTextMale,
                                                item.kind === 'gender' && isFemale && styles.detailChipTextFemale,
                                            ]}
                                            numberOfLines={1}
                                        >
                                            {item.value}
                                        </Text>
                                    </View>
                                );
                            })}
                        </View>
                    ) : null}

                    {priv.mostrar_aficiones && hobbies.length > 0 ? (
                        <View style={styles.card}>
                            <View style={styles.tagsWrap}>
                                {hobbies.map((tag, index) => (
                                    <View key={`${tag}-${index}`} style={styles.tag}>
                                        <Text style={styles.tagText}>
                                            {getPersonalityLabel(tag, userProfile.genero, t)}
                                        </Text>
                                    </View>
                                ))}
                            </View>
                        </View>
                    ) : null}

                    <View style={styles.card}>
                        <View style={styles.cardHeaderRow}>
                            <Text style={styles.cardTitleInline}>{t('profile.badges')}</Text>
                            <Text style={styles.cardMeta}>
                                {badges.filter((b) => b.unlocked).length}/{badges.length}
                            </Text>
                        </View>
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            nestedScrollEnabled
                            contentContainerStyle={styles.badgeRow}
                        >
                            {badges.map((badge) => (
                                <BadgeTile
                                    key={badge.family.id}
                                    badge={badge}
                                    onPress={() => setSelectedBadge(badge)}
                                />
                            ))}
                        </ScrollView>
                    </View>

                    {friendStatus !== 'self' ? (
                        <View style={styles.safetyActions} collapsable={false}>
                            <TouchableOpacity
                                style={styles.reportBtn}
                                onPress={() =>
                                    router.push({
                                        pathname: '/report-user',
                                        params: { userId: userProfile.id },
                                    })
                                }
                                activeOpacity={0.85}
                            >
                                <Text style={styles.reportBtnText}>{t('userprofile.report')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.blockBtn} onPress={handleToggleBlock} activeOpacity={0.85}>
                                <Text style={[styles.blockBtnText, blocked && { color: '#64748B' }]}>
                                    {blocked ? t('userprofile.unblock') : t('userprofile.block')}
                                </Text>
                            </TouchableOpacity>
                            {isOwner && !targetIsStaff ? (
                                <TouchableOpacity
                                    style={styles.ownerDeleteUserBtn}
                                    onPress={handleOwnerDeleteUser}
                                    activeOpacity={0.85}
                                    disabled={deletingUser}
                                >
                                    {deletingUser ? (
                                        <ActivityIndicator color="#FFF" />
                                    ) : (
                                        <Text style={styles.ownerDeleteUserBtnText}>
                                            {t('admin.deleteUserConfirm')}
                                        </Text>
                                    )}
                                </TouchableOpacity>
                            ) : null}
                        </View>
                    ) : null}
                </ScrollView>
            )}

            <BadgeDetailModal
                badge={selectedBadge}
                visible={!!selectedBadge}
                onClose={() => setSelectedBadge(null)}
            />
            <AvatarLightbox
                visible={avatarOpen}
                uri={userProfile?.avatar_url}
                name={displayName}
                onClose={() => setAvatarOpen(false)}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: BG },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 32 },
    errorText: { fontSize: 16, color: MUTED, textAlign: 'center' },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    iconBtn: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: SURFACE,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: BORDER,
    },
    iconBtnPlaceholder: { width: 40 },
    topTitle: { fontSize: 17, fontWeight: '700', color: INK },
    scroll: { paddingHorizontal: 20, paddingBottom: 36 },
    heroCard: {
        backgroundColor: SURFACE,
        borderRadius: 16,
        marginBottom: 14,
        paddingVertical: 24,
        paddingHorizontal: 20,
        borderWidth: 1,
        borderColor: BORDER,
        alignItems: 'center',
    },
    avatarRingFriend: {
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 3,
        borderColor: '#10B981',
        backgroundColor: '#ECFDF5',
    },
    displayName: {
        fontSize: 22,
        fontWeight: '700',
        color: INK,
        textAlign: 'center',
        marginTop: 14,
        paddingHorizontal: 20,
    },
    username: {
        fontSize: 14,
        fontWeight: '600',
        color: MUTED,
        marginTop: 4,
        textAlign: 'center',
        minHeight: 20,
    },
    usernameHidden: { opacity: 0 },
    reputationSlot: {
        width: '100%',
        minHeight: 0,
    },
    sharedPlansBanner: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        width: '100%',
        marginTop: 14,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 12,
        backgroundColor: '#EFF6FF',
        borderWidth: 1,
        borderColor: '#DBEAFE',
    },
    sharedPlansText: {
        flex: 1,
        minWidth: 0,
        flexShrink: 1,
        fontSize: 13,
        fontWeight: '700',
        color: PRIMARY_DARK,
        lineHeight: 18,
    },
    statsRow: {
        flexDirection: 'row',
        marginTop: 18,
        width: '100%',
        backgroundColor: '#F8FAFC',
        borderRadius: 18,
        paddingVertical: 14,
        borderWidth: 1,
        borderColor: '#EEF3FB',
    },
    statItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    statDivider: { width: 1, backgroundColor: '#E2E8F0', marginVertical: 4 },
    statValue: { fontSize: 20, fontWeight: '900', color: INK },
    starsRow: { flexDirection: 'row', marginTop: 2 },
    statMeta: { fontSize: 9, color: '#94A3B8', marginTop: 2, fontWeight: '600' },
    statLabel: {
        fontSize: 10,
        fontWeight: '700',
        color: '#64748B',
        marginTop: 4,
        textTransform: 'uppercase',
        textAlign: 'center',
    },
    actionWrap: {
        paddingHorizontal: 4,
        marginTop: 16,
        width: '100%',
        justifyContent: 'flex-start',
    },
    actionSlot: {
        width: '100%',
        justifyContent: 'center',
    },
    addFriendBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: PRIMARY_DARK,
        paddingVertical: 14,
        borderRadius: 12,
        minHeight: 52,
    },
    addFriendText: { color: '#FFF', fontWeight: '700', fontSize: 14, textAlign: 'center', flexShrink: 1 },
    pendingBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: '#F1F5F9',
        paddingVertical: 13,
        borderRadius: 16,
        minHeight: 52,
    },
    pendingBtnText: { color: '#64748B', fontWeight: '700', fontSize: 14 },
    friendsActions: { gap: 10 },
    chatBtn: {
        width: '100%',
        minHeight: 48,
        borderRadius: 14,
        backgroundColor: PRIMARY,
        alignItems: 'center',
        justifyContent: 'center',
    },
    friendsBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: '#ECFDF5',
        paddingVertical: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#BBF7D0',
    },
    friendsBadgeText: { color: SUCCESS, fontWeight: '800', fontSize: 14 },
    removeFriendBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 12,
        borderRadius: 16,
        backgroundColor: '#FEF2F2',
        borderWidth: 1,
        borderColor: '#FECACA',
    },
    removeFriendText: { color: DANGER, fontWeight: '700', fontSize: 14 },
    receivedActions: { gap: 10 },
    acceptBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: SUCCESS,
        paddingVertical: 14,
        borderRadius: 16,
    },
    acceptBtnText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
    rejectBtn: { alignItems: 'center', paddingVertical: 8 },
    rejectBtnText: { color: DANGER, fontWeight: '700', fontSize: 14 },
    card: {
        backgroundColor: SURFACE,
        borderRadius: 16,
        padding: 18,
        marginBottom: 14,
        borderWidth: 1,
        borderColor: BORDER,
    },
    cardTitle: { fontSize: 16, fontWeight: '700', color: INK, marginBottom: 12 },
    cardTitleInline: { fontSize: 16, fontWeight: '700', color: INK },
    cardHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    cardMeta: { fontSize: 13, fontWeight: '700', color: MUTED },
    badgeRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        paddingVertical: 4,
        paddingRight: 4,
    },
    aboutText: { fontSize: 15, color: '#334155', lineHeight: 22 },
    aboutEmptyText: { fontSize: 14, color: MUTED, lineHeight: 21 },
    detailsWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 14,
    },
    detailChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: SURFACE,
        borderRadius: 999,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderWidth: 1,
        borderColor: BORDER,
    },
    detailChipMale: {
        backgroundColor: '#EFF6FF',
        borderColor: '#BFDBFE',
    },
    detailChipFemale: {
        backgroundColor: '#FDF2F8',
        borderColor: '#FBCFE8',
    },
    detailChipText: { fontSize: 13, fontWeight: '700', color: INK, maxWidth: 160 },
    detailChipTextMale: { color: '#2563EB' },
    detailChipTextFemale: { color: '#DB2777' },
    tagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    tag: {
        backgroundColor: '#F1F5F9',
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: BORDER,
    },
    tagText: { fontSize: 13, color: INK, fontWeight: '600' },
    safetyActions: { gap: 10, marginTop: 2 },
    reportBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 13,
        borderRadius: 16,
        backgroundColor: '#FFF',
        borderWidth: 1,
        borderColor: '#FECACA',
    },
    reportBtnText: { color: DANGER, fontWeight: '700', fontSize: 14 },
    blockBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 13,
        borderRadius: 16,
        backgroundColor: '#FFF',
        borderWidth: 1,
        borderColor: '#FECACA',
    },
    blockBtnText: { color: DANGER, fontWeight: '700', fontSize: 14 },
    ownerDeleteUserBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 14,
        borderRadius: 16,
        backgroundColor: DANGER,
        marginTop: 4,
    },
    ownerDeleteUserBtnText: { color: '#FFF', fontWeight: '800', fontSize: 14 },
});

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
import { useT } from '../../lib/i18n';
import { renderRatingStars } from '../../lib/profileRating';
import { EMPTY_STATS, formatRatingScore, getUserStats, type UserStats } from '../../lib/stats';
import { cacheGetStale, cacheSet } from '../../lib/ttlCache';
import { supabase } from '../../lib/supabase';
import { useScrollViewRestore } from '../../hooks/useScrollViewRestore';
import { ScreenKeys } from '../../lib/screenState';
import { calcAge, getPersonalityLabel, parseHabitos, parsePrivacy, type ProfilePrivacy } from '../../lib/profileFields';

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
    fecha_nacimiento: string | null;
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
    const [actionLoading, setActionLoading] = useState(false);
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
    const [badgesLoading, setBadgesLoading] = useState(() => !cached?.badges?.length);
    const [avatarOpen, setAvatarOpen] = useState(false);
    const [sharedPlans, setSharedPlans] = useState(() => cached?.sharedPlans ?? 0);
    const hasDataRef = useRef(!!cached?.userProfile);

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
        setSharedPlans(snap.sharedPlans);
        setBadgesLoading(false);
        hasDataRef.current = true;
    }, []);

    const loadProfile = useCallback(async () => {
        if (!profileId) return;

        try {
            const stale = cacheGetStale<UserProfileSnapshot>(userProfileKey(profileId));
            if (stale?.userProfile) {
                // Solo hidratar si aún no hay UI: evita un segundo layout al refrescar.
                if (!hasDataRef.current) {
                    applySnapshot(stale);
                }
                setLoading(false);
            } else if (!hasDataRef.current) {
                setLoading(true);
                setBadgesLoading(true);
            }

            const user = await getAuthUser();

            const friendPromise =
                user && user.id !== profileId
                    ? Promise.all([
                          getFriendStatus(user.id, profileId),
                          isUserBlocked(user.id, profileId),
                          isBlockedEitherWay(user.id, profileId),
                          countSharedAttendedPlans(user.id, profileId),
                      ])
                    : Promise.resolve(null);

            const [{ data: profile, error }, count, userStats, badgeStats, friendData] = await Promise.all([
                supabase
                    .from('perfiles')
                    .select('id, nombre, nombre_usuario, avatar_url, descripcion, etiquetas, fecha_nacimiento, genero, habitos_consumo, ambientes_preferidos, perfil_gustos')
                    .eq('id', profileId)
                    .single(),
                getFriendsCount(profileId),
                getUserStats(profileId),
                getBadgeStats(profileId),
                friendPromise,
            ]);

            if (error || !profile) throw error ?? new Error('profile_missing');

            const nextProfile: PublicProfile = {
                id: profile.id,
                nombre: profile.nombre,
                nombre_usuario: profile.nombre_usuario,
                avatar_url: profile.avatar_url,
                descripcion: profile.descripcion,
                etiquetas: Array.isArray(profile.etiquetas) ? profile.etiquetas : [],
                fecha_nacimiento: profile.fecha_nacimiento,
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

            if (friendData) {
                const [status, isBlocked, eitherWay, shared] = friendData;
                nextFriendStatus = status.status;
                nextRequestId = status.requestId;
                nextBlocked = isBlocked;
                nextBlockedEitherWay = eitherWay;
                nextSharedPlans = shared;
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
                sharedPlans: nextSharedPlans,
            };

            cacheSet(userProfileKey(profileId), snap, USER_PROFILE_TTL_MS);
            if (hasDataRef.current) {
                // Refresco en background: no forzar un segundo layout brusco al entrar.
                startTransition(() => applySnapshot(snap));
            } else {
                applySnapshot(snap);
            }
        } catch (error) {
            console.error('Error fetching user profile:', error);
            if (!hasDataRef.current) setUserProfile(null);
        } finally {
            setLoading(false);
        }
    }, [profileId, applySnapshot]);

    useFocusEffect(
        useCallback(() => {
            loadProfile();
        }, [loadProfile])
    );

    const handleSendRequest = async () => {
        if (!currentUserId || !profileId) return;

        setActionLoading(true);
        const { error } = await sendFriendRequest(currentUserId, profileId);
        setActionLoading(false);

        if (error) {
            Alert.alert(
                t('userprofile.sendFail'),
                error === 'friend_request_daily_limit' ? t('friends.requestDailyLimit') : error,
            );
            return;
        }

        setFriendStatus('pending_sent');
        const { data: pending } = await supabase
            .from('amistades')
            .select('id')
            .eq('usuario_origen_id', currentUserId)
            .eq('usuario_destino_id', profileId)
            .eq('estado', 'pendiente')
            .maybeSingle();
        const nextRequestId = pending?.id ?? null;
        setRequestId(nextRequestId);
        const prev = cacheGetStale<UserProfileSnapshot>(userProfileKey(profileId));
        if (prev) {
            cacheSet(userProfileKey(profileId), {
                ...prev,
                friendStatus: 'pending_sent',
                requestId: nextRequestId,
            }, USER_PROFILE_TTL_MS);
        }
    };

    const handleAccept = async () => {
        if (!requestId) return;

        setActionLoading(true);
        const { error } = await acceptFriendRequest(requestId);
        setActionLoading(false);

        if (error) {
            Alert.alert(t('profile.error'), error.message);
            return;
        }

        Alert.alert(t('userprofile.nowFriends'), t('userprofile.nowFriendsMsg'));
        await loadProfile();
    };

    const handleReject = async () => {
        if (!requestId) return;

        setActionLoading(true);
        const { error } = await rejectFriendRequest(requestId);
        setActionLoading(false);

        if (error) {
            Alert.alert(t('profile.error'), error.message);
            return;
        }

        await loadProfile();
    };

    const handleCancelRequest = async () => {
        if (!requestId) return;

        setActionLoading(true);
        const { error } = await cancelFriendRequest(requestId);
        setActionLoading(false);

        if (error) {
            Alert.alert(t('profile.error'), error.message);
            return;
        }
        await loadProfile();
    };

    const handleRemoveFriend = () => {
        if (!requestId || !userProfile) return;

        Alert.alert(
            t('userprofile.unfriendTitle'),
            t('userprofile.unfriendConfirmName', { name: userProfile.nombre || t('chats.user') }),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('friends.removeBtn'),
                    style: 'destructive',
                    onPress: async () => {
                        setActionLoading(true);
                        const { error } = await removeFriend(requestId);
                        setActionLoading(false);

                        if (error) {
                            Alert.alert(t('profile.error'), error.message);
                            return;
                        }

                        await loadProfile();
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
                    onPress: async () => {
                        setActionLoading(true);
                        const { error } = await unblockUser(currentUserId, profileId);
                        setActionLoading(false);
                        if (error) {
                            Alert.alert(t('profile.error'), error);
                            return;
                        }
                        setBlocked(false);
                        await loadProfile();
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
                    onPress: async () => {
                        setActionLoading(true);
                        const { error } = await blockUser(currentUserId, profileId);
                        setActionLoading(false);
                        if (error) {
                            Alert.alert(
                                t('profile.error'),
                                error === 'block_daily_limit' ? t('blocks.dailyLimit') : error,
                            );
                            return;
                        }
                        setBlocked(true);
                        setBlockedEitherWay(true);
                        setFriendStatus('none');
                        setRequestId(null);
                    },
                },
            ]
        );
    };

    const renderFriendAction = () => {
        if (friendStatus === 'self' || blockedEitherWay) return null;

        if (actionLoading) {
            return (
                <View style={[styles.actionSlot, styles.actionLoading]}>
                    <ActivityIndicator color={PRIMARY_DARK} />
                </View>
            );
        }

        if (friendStatus === 'friends') {
            return (
                <View style={[styles.actionSlot, styles.friendsActions]}>
                    <View style={styles.friendsBadge}>
                        <Ionicons name="checkmark-circle" size={18} color={SUCCESS} />
                        <Text style={styles.friendsBadgeText}>{t('userprofile.areFriends')}</Text>
                    </View>
                    <TouchableOpacity style={styles.removeFriendBtn} onPress={handleRemoveFriend} activeOpacity={0.85}>
                        <Ionicons name="person-remove-outline" size={17} color={DANGER} />
                        <Text style={styles.removeFriendText}>{t('userprofile.unfriend')}</Text>
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
    const age = userProfile ? calcAge(userProfile.fecha_nacimiento) : null;
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
                                            ? 'userprofile.sharedPlansOne'
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
                        <View style={styles.badgeGrid}>
                            {badges.map((badge) => (
                                <BadgeTile
                                    key={badge.family.id}
                                    badge={badge}
                                    onPress={() => setSelectedBadge(badge)}
                                />
                            ))}
                        </View>
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
        minHeight: 108,
        justifyContent: 'flex-start',
    },
    actionSlot: {
        width: '100%',
        minHeight: 52,
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
    },
    addFriendText: { color: '#FFF', fontWeight: '700', fontSize: 15 },
    pendingBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: '#F1F5F9',
        paddingVertical: 13,
        borderRadius: 16,
    },
    pendingBtnText: { color: '#64748B', fontWeight: '700', fontSize: 14 },
    friendsActions: { gap: 10 },
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
    actionLoading: { paddingVertical: 14, alignItems: 'center' },
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
    badgeGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        justifyContent: 'center',
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
});

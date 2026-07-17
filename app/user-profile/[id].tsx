import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ProfileAvatar } from '../../components/ProfileAvatar';
import { BadgeDetailModal, BadgeTile } from '../../components/TrophyBadge';
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
import { useT } from '../../lib/i18n';
import { renderRatingStars } from '../../lib/profileRating';
import { EMPTY_STATS, getUserStats, type UserStats } from '../../lib/stats';
import { supabase } from '../../lib/supabase';
import { useScrollViewRestore } from '../../hooks/useScrollViewRestore';
import { ScreenKeys } from '../../lib/screenState';
import { calcAge, parseHabitos, parsePrivacy, type ProfilePrivacy } from '../../lib/profileFields';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F172A';
const MUTED = '#64748B';
const BG = '#F8FAFC';
const SURFACE = '#FFFFFF';
const BORDER = '#E2E8F0';
const SUCCESS = '#22C55E';
const DANGER = '#EF4444';

type PublicProfile = {
    id: string;
    nombre: string | null;
    avatar_url: string | null;
    descripcion: string | null;
    etiquetas: string[] | null;
    fecha_nacimiento: string | null;
    genero: string | null;
    habitos_consumo: Record<string, unknown> | null;
    ambientes_preferidos: string[] | null;
    perfil_gustos: Record<string, unknown> | null;
};

export default function UserProfileScreen() {
    const router = useRouter();
    const { t } = useT();
    const { id, isFriend } = useLocalSearchParams<{ id: string | string[]; isFriend?: string }>();
    const profileId = Array.isArray(id) ? id[0] : id;
    const friendHint = isFriend === '1';
    const scrollKey = profileId ? `${ScreenKeys.USER_PROFILE}:${profileId}` : ScreenKeys.USER_PROFILE;
    const { scrollRef, onScroll, scrollEventThrottle } = useScrollViewRestore(scrollKey);

    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [userProfile, setUserProfile] = useState<PublicProfile | null>(null);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [friendStatus, setFriendStatus] = useState<FriendStatus | null>(friendHint ? 'friends' : null);
    const [requestId, setRequestId] = useState<string | null>(null);
    const [friendsCount, setFriendsCount] = useState(0);
    const [stats, setStats] = useState<UserStats>(EMPTY_STATS);
    const [blocked, setBlocked] = useState(false);
    const [blockedEitherWay, setBlockedEitherWay] = useState(false);
    const [privacy, setPrivacy] = useState<ProfilePrivacy | null>(null);
    const [badges, setBadges] = useState<UserBadge[]>([]);
    const [selectedBadge, setSelectedBadge] = useState<UserBadge | null>(null);
    const [badgesLoading, setBadgesLoading] = useState(true);
    const hasDataRef = useRef(false);

    const loadProfile = useCallback(async () => {
        if (!profileId) return;

        try {
            if (!hasDataRef.current) setLoading(true);

            const { data: { user } } = await supabase.auth.getUser();
            setCurrentUserId(user?.id ?? null);

            const friendPromise =
                user && user.id !== profileId
                    ? Promise.all([
                          getFriendStatus(user.id, profileId),
                          isUserBlocked(user.id, profileId),
                          isBlockedEitherWay(user.id, profileId),
                      ])
                    : Promise.resolve(null);

            const { data: profile, error } = await supabase
                .from('perfiles')
                .select('id, nombre, avatar_url, descripcion, etiquetas, fecha_nacimiento, genero, habitos_consumo, ambientes_preferidos, perfil_gustos')
                .eq('id', profileId)
                .single();

            if (error) throw error;

            setUserProfile({
                id: profile.id,
                nombre: profile.nombre,
                avatar_url: profile.avatar_url,
                descripcion: profile.descripcion,
                etiquetas: Array.isArray(profile.etiquetas) ? profile.etiquetas : [],
                fecha_nacimiento: profile.fecha_nacimiento,
                genero: profile.genero,
                habitos_consumo: (profile.habitos_consumo as Record<string, unknown>) ?? {},
                ambientes_preferidos: Array.isArray(profile.ambientes_preferidos) ? profile.ambientes_preferidos : [],
                perfil_gustos: (profile.perfil_gustos as Record<string, unknown>) ?? {},
            });
            setPrivacy(parsePrivacy(profile.perfil_gustos));

            const [count, userStats, badgeStats] = await Promise.all([
                getFriendsCount(profileId),
                getUserStats(profileId),
                getBadgeStats(profileId),
            ]);
            setFriendsCount(count);
            setStats(userStats);
            const allBadges = getUserBadges(badgeStats);
            setBadges(allBadges);
            setBadgesLoading(false);
            hasDataRef.current = true;

            const friendData = await friendPromise;
            if (friendData) {
                const [status, isBlocked, eitherWay] = friendData;
                setFriendStatus(status.status);
                setRequestId(status.requestId);
                setBlocked(isBlocked);
                setBlockedEitherWay(eitherWay);
            } else if (user?.id === profileId) {
                setFriendStatus('self');
                setRequestId(null);
                setBlocked(false);
                setBlockedEitherWay(false);
            } else {
                setFriendStatus('none');
            }
        } catch (error) {
            console.error('Error fetching user profile:', error);
            setUserProfile(null);
        } finally {
            setLoading(false);
        }
    }, [profileId]);

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
            Alert.alert(t('userprofile.sendFail'), error);
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
        setRequestId(pending?.id ?? null);
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
                            Alert.alert(t('profile.error'), error);
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

        if (friendStatus === null || actionLoading) {
            return (
                <View style={styles.actionLoading}>
                    <ActivityIndicator color={PRIMARY_DARK} />
                </View>
            );
        }

        if (friendStatus === 'friends') {
            return (
                <View style={styles.friendsActions}>
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
                <TouchableOpacity style={styles.pendingBtn} onPress={handleCancelRequest} activeOpacity={0.85}>
                    <Ionicons name="time-outline" size={18} color="#64748B" />
                    <Text style={styles.pendingBtnText}>{t('userprofile.requestSent')}</Text>
                </TouchableOpacity>
            );
        }

        if (friendStatus === 'pending_received') {
            return (
                <View style={styles.receivedActions}>
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
            <TouchableOpacity style={styles.addFriendBtn} onPress={handleSendRequest} activeOpacity={0.88}>
                <Ionicons name="person-add-outline" size={20} color="#FFF" />
                <Text style={styles.addFriendText}>{t('userprofile.addFriend')}</Text>
            </TouchableOpacity>
        );
    };

    if (loading && !userProfile) {
        return (
            <SafeAreaView style={styles.safe} edges={['top']}>
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={PRIMARY_DARK} />
                </View>
            </SafeAreaView>
        );
    }

    if (!userProfile) {
        return (
            <SafeAreaView style={styles.safe} edges={['top']}>
                <View style={styles.topBar}>
                    <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} activeOpacity={0.8}>
                        <Ionicons name="chevron-back" size={24} color={INK} />
                    </TouchableOpacity>
                    <Text style={styles.topTitle}>{t('userprofile.title')}</Text>
                    <View style={styles.iconBtnPlaceholder} />
                </View>
                <View style={styles.errorContainer}>
                    <Ionicons name="alert-circle-outline" size={40} color="#94A3B8" />
                    <Text style={styles.errorText}>{t('userprofile.loadError')}</Text>
                </View>
            </SafeAreaView>
        );
    }

    const displayName = userProfile.nombre?.trim() || t('profile.user');
    const aboutText = (userProfile.descripcion ?? '').trim();
    const hobbies = userProfile.ambientes_preferidos?.length
        ? userProfile.ambientes_preferidos
        : (userProfile.etiquetas ?? []);
    const age = calcAge(userProfile.fecha_nacimiento);
    const habitos = parseHabitos(userProfile.habitos_consumo);
    const priv = privacy ?? parsePrivacy(userProfile.perfil_gustos);

    const detailRows: { label: string; value: string }[] = [];
    if (priv.mostrar_edad && age) detailRows.push({ label: t('profile.age'), value: String(age) });
    if (priv.mostrar_genero && userProfile.genero) {
        detailRows.push({ label: t('profile.gender'), value: t('genero.' + userProfile.genero) });
    }
    if (priv.mostrar_bebida && habitos.bebida !== 'no_especificado') {
        detailRows.push({ label: t('profile.drinking'), value: t('habito.' + habitos.bebida) });
    }
    if (priv.mostrar_tabaco && habitos.tabaco !== 'no_especificado') {
        detailRows.push({ label: t('profile.smoking'), value: t('habito.' + habitos.tabaco) });
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

            <ScrollView
                ref={scrollRef}
                onScroll={onScroll}
                scrollEventThrottle={scrollEventThrottle}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scroll}
            >
                <View style={styles.heroCard}>
                    <ProfileAvatar uri={userProfile.avatar_url} name={displayName} size={96} recyclingKey={userProfile.id} />

                    <Text style={styles.displayName} numberOfLines={1}>{displayName}</Text>

                    <View style={styles.ratingRow}>
                        <View style={styles.stars}>{renderRatingStars(stats.valoracionMedia, 13)}</View>
                        <Text style={styles.ratingMeta}>
                            {stats.valoracionMedia.toFixed(1)}/5 · {stats.numeroValoraciones} {t('userprofile.reviews')}
                        </Text>
                    </View>

                    <View style={styles.statsRow}>
                        <View style={styles.statItem}>
                            <Text style={styles.statValue}>{friendsCount}</Text>
                            <Text style={styles.statLabel}>{t('userprofile.friendsLabel')}</Text>
                        </View>
                        <View style={styles.statItem}>
                            <Text style={styles.statValue}>{stats.numeroPlanesRealizados}</Text>
                            <Text style={styles.statLabel}>{t('userprofile.plansLabel')}</Text>
                        </View>
                    </View>

                    <View style={styles.actionWrap}>{renderFriendAction()}</View>
                </View>

                <View style={styles.card}>
                    <Text style={styles.cardTitle}>{t('userprofile.aboutMe')}</Text>
                    {aboutText ? (
                        <Text style={styles.aboutText}>{aboutText}</Text>
                    ) : (
                        <Text style={styles.aboutEmptyText}>{t('userprofile.aboutEmpty')}</Text>
                    )}
                </View>

                {detailRows.length > 0 && (
                    <View style={styles.card}>
                        <Text style={styles.cardTitle}>{t('userprofile.details')}</Text>
                        {detailRows.map((row) => (
                            <View key={row.label} style={styles.detailRow}>
                                <Text style={styles.detailLabel}>{row.label}</Text>
                                <Text style={styles.detailValue}>{row.value}</Text>
                            </View>
                        ))}
                    </View>
                )}

                {priv.mostrar_aficiones && hobbies.length > 0 && (
                    <View style={styles.card}>
                        <Text style={styles.cardTitle}>{t('profile.hobbies')}</Text>
                        <View style={styles.tagsWrap}>
                            {hobbies.map((tag, index) => (
                                <View key={`${tag}-${index}`} style={styles.tag}>
                                    <Text style={styles.tagText}>{t('personality.' + tag) || tag}</Text>
                                </View>
                            ))}
                        </View>
                    </View>
                )}

                <View style={styles.card}>
                    <View style={styles.cardHeaderRow}>
                        <Text style={styles.cardTitleInline}>{t('profile.badges')}</Text>
                        <Text style={styles.cardMeta}>
                            {badges.filter((b) => b.unlocked).length}/{badges.length}
                        </Text>
                    </View>
                    <View style={styles.badgeGrid}>
                        {badgesLoading ? (
                            <ActivityIndicator color={PRIMARY_DARK} style={{ marginVertical: 24, alignSelf: 'center' }} />
                        ) : (
                            badges.map((badge) => (
                                <BadgeTile
                                    key={badge.family.id}
                                    badge={badge}
                                    onPress={() => setSelectedBadge(badge)}
                                />
                            ))
                        )}
                    </View>
                </View>

                {friendStatus !== 'self' && currentUserId && (
                    <TouchableOpacity style={styles.blockBtn} onPress={handleToggleBlock} activeOpacity={0.85}>
                        <Ionicons name={blocked ? 'lock-open-outline' : 'ban-outline'} size={17} color={blocked ? '#64748B' : DANGER} />
                        <Text style={[styles.blockBtnText, blocked && { color: '#64748B' }]}>
                            {blocked ? t('userprofile.unblock') : t('userprofile.block')}
                        </Text>
                    </TouchableOpacity>
                )}

            </ScrollView>

            <BadgeDetailModal
                badge={selectedBadge}
                visible={!!selectedBadge}
                onClose={() => setSelectedBadge(null)}
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
    ratingRow: { alignItems: 'center', marginTop: 10, gap: 6 },
    stars: { flexDirection: 'row' },
    ratingMeta: { fontSize: 13, color: MUTED, fontWeight: '500' },
    statsRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 16,
        paddingTop: 14,
        width: '100%',
        borderTopWidth: 1,
        borderTopColor: BORDER,
        gap: 32,
    },
    statItem: { alignItems: 'center', minWidth: 72 },
    statValue: { fontSize: 20, fontWeight: '700', color: INK },
    statLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: MUTED,
        marginTop: 4,
        textTransform: 'uppercase',
    },
    actionWrap: { paddingHorizontal: 4, marginTop: 16, width: '100%' },
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
    badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
    aboutText: { fontSize: 15, color: '#334155', lineHeight: 22 },
    aboutEmptyText: { fontSize: 14, color: MUTED, lineHeight: 21 },
    detailRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: BORDER,
    },
    detailLabel: { fontSize: 13, fontWeight: '600', color: MUTED, textTransform: 'uppercase' },
    detailValue: { fontSize: 15, fontWeight: '600', color: INK },
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
        marginTop: 2,
    },
    blockBtnText: { color: DANGER, fontWeight: '700', fontSize: 14 },
});

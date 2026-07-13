import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
    acceptFriendRequest,
    cancelFriendRequest,
    getAvatarUri,
    getFriendStatus,
    getFriendsCount,
    rejectFriendRequest,
    removeFriend,
    sendFriendRequest,
    type FriendStatus,
} from '../../lib/friends';
import { useT } from '../../lib/i18n';
import {
    DEFAULT_RATING,
    DEFAULT_REVIEW_COUNT,
    renderRatingStars,
} from '../../lib/profileRating';
import { supabase } from '../../lib/supabase';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const BG_TOP = '#DCEBFF';
const BG_BOTTOM = '#F2F7FF';
const SUCCESS = '#22C55E';
const DANGER = '#EF4444';

type PublicProfile = {
    id: string;
    nombre: string | null;
    avatar_url: string | null;
    about_me: string | null;
    tags: string[] | null;
};

export default function UserProfileScreen() {
    const router = useRouter();
    const { t } = useT();
    const { id } = useLocalSearchParams<{ id: string | string[] }>();
    const profileId = Array.isArray(id) ? id[0] : id;

    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [userProfile, setUserProfile] = useState<PublicProfile | null>(null);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [friendStatus, setFriendStatus] = useState<FriendStatus>('none');
    const [requestId, setRequestId] = useState<string | null>(null);
    const [friendsCount, setFriendsCount] = useState(0);

    const loadProfile = useCallback(async () => {
        if (!profileId) return;

        try {
            setLoading(true);

            const { data: { user } } = await supabase.auth.getUser();
            setCurrentUserId(user?.id ?? null);

            const { data: profile, error } = await supabase
                .from('perfiles')
                .select('id, nombre, avatar_url, about_me, tags')
                .eq('id', profileId)
                .single();

            if (error) throw error;

            setUserProfile({
                id: profile.id,
                nombre: profile.nombre,
                avatar_url: profile.avatar_url,
                about_me: profile.about_me,
                tags: Array.isArray(profile.tags) ? profile.tags : [],
            });

            const count = await getFriendsCount(profileId);
            setFriendsCount(count);

            if (user && user.id !== profileId) {
                const status = await getFriendStatus(user.id, profileId);
                setFriendStatus(status.status);
                setRequestId(status.requestId);
            } else {
                setFriendStatus('self');
                setRequestId(null);
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

        Alert.alert(t('userprofile.requestSentTitle'), t('userprofile.requestSentMsg'));
        await loadProfile();
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

    const renderFriendAction = () => {
        if (friendStatus === 'self') return null;

        if (actionLoading) {
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
                <LinearGradient
                    colors={[PRIMARY, PRIMARY_DARK]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.addFriendGradient}
                >
                    <Ionicons name="person-add-outline" size={20} color="#FFF" />
                    <Text style={styles.addFriendText}>{t('userprofile.addFriend')}</Text>
                </LinearGradient>
            </TouchableOpacity>
        );
    };

    if (loading) {
        return (
            <SafeAreaView style={styles.safe} edges={['top']}>
                <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={StyleSheet.absoluteFill} />
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={PRIMARY_DARK} />
                </View>
            </SafeAreaView>
        );
    }

    if (!userProfile) {
        return (
            <SafeAreaView style={styles.safe} edges={['top']}>
                <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={StyleSheet.absoluteFill} />
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

    const avatarUri = getAvatarUri(userProfile);
    const displayName = userProfile.nombre?.trim() || t('profile.user');
    const initial = displayName[0]?.toUpperCase() || '?';
    const aboutText = (userProfile.about_me ?? '').trim();
    const tags = userProfile.tags ?? [];

    return (
        <SafeAreaView style={styles.safe} edges={['top']}>
            <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={StyleSheet.absoluteFill} />

            <View style={styles.topBar}>
                <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} activeOpacity={0.8}>
                    <Ionicons name="chevron-back" size={24} color={INK} />
                </TouchableOpacity>
                <Text style={styles.topTitle}>{t('userprofile.title')}</Text>
                <View style={styles.iconBtnPlaceholder} />
            </View>

            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scroll}
            >
                <View style={styles.heroCard}>
                    <LinearGradient
                        colors={['#5BB5FF', PRIMARY_DARK]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.heroBanner}
                    />

                    <View style={styles.avatarBlock}>
                        <LinearGradient colors={['#FFF', '#E3ECFB']} style={styles.avatarRing}>
                            {avatarUri ? (
                                <Image source={{ uri: avatarUri }} style={styles.avatarImg} />
                            ) : (
                                <LinearGradient colors={[PRIMARY, PRIMARY_DARK]} style={styles.avatarFallback}>
                                    <Text style={styles.avatarInitial}>{initial}</Text>
                                </LinearGradient>
                            )}
                        </LinearGradient>
                    </View>

                    <Text style={styles.displayName} numberOfLines={1}>{displayName}</Text>

                    <View style={styles.ratingRow}>
                        <View style={styles.stars}>{renderRatingStars(DEFAULT_RATING, 13)}</View>
                        <Text style={styles.ratingMeta}>
                            {DEFAULT_RATING.toFixed(1)}/10 · {DEFAULT_REVIEW_COUNT} {t('userprofile.reviews')}
                        </Text>
                    </View>

                    <View style={styles.statsRow}>
                        <View style={styles.statItem}>
                            <Text style={styles.statValue}>{friendsCount}</Text>
                            <Text style={styles.statLabel}>{t('userprofile.friendsLabel')}</Text>
                        </View>
                    </View>

                    <View style={styles.actionWrap}>{renderFriendAction()}</View>
                </View>

                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <View style={styles.cardHeaderLeft}>
                            <View style={[styles.cardIcon, { backgroundColor: '#EFF6FF' }]}>
                                <Ionicons name="document-text-outline" size={18} color={PRIMARY_DARK} />
                            </View>
                            <Text style={styles.cardTitle}>{t('userprofile.aboutMe')}</Text>
                        </View>
                    </View>
                    {aboutText ? (
                        <View style={styles.aboutBox}>
                            <Text style={styles.aboutText}>{aboutText}</Text>
                        </View>
                    ) : (
                        <View style={styles.aboutEmptyBox}>
                            <Ionicons name="information-circle-outline" size={22} color="#94A3B8" />
                            <Text style={styles.aboutEmptyText}>{t('userprofile.aboutEmpty')}</Text>
                        </View>
                    )}
                </View>

                {tags.length > 0 && (
                    <View style={styles.card}>
                        <View style={styles.cardHeader}>
                            <View style={styles.cardHeaderLeft}>
                                <View style={[styles.cardIcon, { backgroundColor: '#FEF3C7' }]}>
                                    <Ionicons name="sparkles-outline" size={18} color="#D97706" />
                                </View>
                                <Text style={styles.cardTitle}>{t('profile.personality')}</Text>
                            </View>
                        </View>
                        <View style={styles.tagsWrap}>
                            {tags.map((tag, index) => (
                                <View key={`${tag}-${index}`} style={styles.tag}>
                                    <Text style={styles.tagText}>{tag}</Text>
                                </View>
                            ))}
                        </View>
                    </View>
                )}

            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: BG_BOTTOM },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 32 },
    errorText: { fontSize: 16, color: '#64748B', textAlign: 'center' },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    iconBtn: {
        width: 42,
        height: 42,
        borderRadius: 14,
        backgroundColor: 'rgba(255,255,255,0.88)',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.95)',
    },
    iconBtnPlaceholder: { width: 42 },
    topTitle: { fontSize: 18, fontWeight: '900', color: INK, letterSpacing: -0.3 },
    scroll: { paddingHorizontal: 20, paddingBottom: 36 },
    heroCard: {
        backgroundColor: '#FFF',
        borderRadius: 28,
        marginBottom: 16,
        paddingBottom: 20,
        borderWidth: 1,
        borderColor: '#EEF3FB',
        overflow: 'hidden',
        shadowColor: PRIMARY_DARK,
        shadowOpacity: 0.12,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 6,
    },
    heroBanner: { height: 88 },
    avatarBlock: { alignItems: 'center', marginTop: -46 },
    avatarRing: {
        width: 98,
        height: 98,
        borderRadius: 49,
        padding: 4,
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarImg: {
        width: 90,
        height: 90,
        borderRadius: 45,
        backgroundColor: '#E3ECFB',
    },
    avatarFallback: {
        width: 90,
        height: 90,
        borderRadius: 45,
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarInitial: { fontSize: 34, fontWeight: '900', color: '#FFF' },
    displayName: {
        fontSize: 24,
        fontWeight: '900',
        color: INK,
        textAlign: 'center',
        marginTop: 12,
        paddingHorizontal: 20,
        letterSpacing: -0.4,
    },
    ratingRow: { alignItems: 'center', marginTop: 10, gap: 6 },
    stars: { flexDirection: 'row' },
    ratingMeta: { fontSize: 13, color: '#64748B', fontWeight: '600' },
    statsRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 16,
        paddingTop: 14,
        marginHorizontal: 20,
        borderTopWidth: 1,
        borderTopColor: '#EEF3FB',
    },
    statItem: { alignItems: 'center', minWidth: 80 },
    statValue: { fontSize: 20, fontWeight: '900', color: INK },
    statLabel: {
        fontSize: 11,
        fontWeight: '700',
        color: '#64748B',
        marginTop: 4,
        textTransform: 'uppercase',
    },
    actionWrap: { paddingHorizontal: 20, marginTop: 16 },
    addFriendBtn: { borderRadius: 16, overflow: 'hidden' },
    addFriendGradient: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 14,
    },
    addFriendText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
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
        backgroundColor: '#FFF',
        borderRadius: 22,
        padding: 16,
        marginBottom: 14,
        borderWidth: 1,
        borderColor: '#EEF3FB',
        shadowColor: PRIMARY_DARK,
        shadowOpacity: 0.06,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 14,
    },
    cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    cardIcon: {
        width: 36,
        height: 36,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    cardTitle: { fontSize: 16, fontWeight: '800', color: INK },
    aboutBox: {
        backgroundColor: '#F8FBFF',
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: '#DBEAFE',
        position: 'relative',
    },
    aboutText: {
        fontSize: 15,
        color: '#334155',
        lineHeight: 24,
    },
    aboutEmptyBox: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        backgroundColor: '#F8FAFC',
        borderRadius: 16,
        padding: 14,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    aboutEmptyText: {
        flex: 1,
        fontSize: 14,
        color: '#94A3B8',
        lineHeight: 21,
    },
    tagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    tag: {
        backgroundColor: '#EFF6FF',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#BFDBFE',
    },
    tagText: { fontSize: 13, color: PRIMARY_DARK, fontWeight: '700' },
    detailText: { fontSize: 15, color: '#475569', fontWeight: '600' },
});

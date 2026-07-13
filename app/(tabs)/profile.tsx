import { Ionicons } from '@expo/vector-icons';
import { decode } from 'base64-arraybuffer';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getFriendsCount } from '../../lib/friends';
import { useT } from '../../lib/i18n';
import { getProfileNotificationCount } from '../../lib/notifications';
import { getAuthUser } from '../../lib/auth';
import {
    deleteAccount,
    isUsernameTaken,
    normalizeUsername,
    resolveDisplayName,
    syncProfileFromAuth,
    updateProfileFields,
    USERNAME_MAX_LENGTH,
} from '../../lib/profile';
import {
    DEFAULT_PLANS_DONE,
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

const PERSONALITY_OPTIONS = [
    'Deportista', 'Viajero', 'Aventurero', 'Tranquilo', 'Yoga',
    'Foodie', 'Fiestero', 'Lectura', 'De terraceo', 'Más de noche', 'Más de día',
];

type QuickAction = {
    key: string;
    icon: keyof typeof Ionicons.glyphMap;
    labelKey: string;
    route: string;
    color: string;
    bg: string;
    badge?: number;
};

export default function ProfileScreen() {
    const router = useRouter();
    const { t } = useT();
    const [loading, setLoading] = useState(false);
    const [user, setUser] = useState<any>(null);
    const [nombre, setNombre] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [tags, setTags] = useState<string[]>([]);
    const [showTagModal, setShowTagModal] = useState(false);
    const [friendsCount, setFriendsCount] = useState(0);
    const [friendsNotifCount, setFriendsNotifCount] = useState(0);
    const [planRequests, setPlanRequests] = useState(0);
    const [aboutMe, setAboutMe] = useState('');
    const [isEditingAboutMe, setIsEditingAboutMe] = useState(false);
    const [deletingAccount, setDeletingAccount] = useState(false);

    useFocusEffect(
        useCallback(() => {
            fetchUserData();
        }, [])
    );

    const fetchFriendsStats = useCallback(async (userId: string) => {
        try {
            setFriendsCount(await getFriendsCount(userId));
        } catch {
            setFriendsCount(0);
        }
    }, []);

    const fetchNotificationCounts = useCallback(async (userId: string) => {
        try {
            const counts = await getProfileNotificationCount(userId);
            setFriendsNotifCount(counts.friendRequests + counts.planInvites);
            setPlanRequests(counts.planRequests);
        } catch {
            setFriendsNotifCount(0);
            setPlanRequests(0);
        }
    }, []);

    useFocusEffect(
        useCallback(() => {
            if (user?.id) {
                fetchFriendsStats(user.id);
                fetchNotificationCounts(user.id);
            }
        }, [user?.id, fetchFriendsStats, fetchNotificationCounts])
    );

    const fetchUserData = async () => {
        const authUser = await getAuthUser();
        if (!authUser) return;

        setUser(authUser);
        const profile = await syncProfileFromAuth(authUser);
        setNombre(profile.nombre);
        setTags(profile.tags);
        setAboutMe(profile.about_me);
        setAvatarUrl(profile.avatar_url);

        await fetchFriendsStats(authUser.id);
        await fetchNotificationCounts(authUser.id);
    };

    const uploadImage = async (uri: string) => {
        if (!user?.id) return;
        try {
            setLoading(true);
            const fileName = `${user.id}/avatar.jpg`;
            const response = await fetch(uri);
            const blob = await response.blob();

            const base64data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const data = reader.result?.toString().split(',')[1];
                    if (data) resolve(data);
                    else reject(new Error('read_failed'));
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });

            const { error: uploadError } = await supabase.storage
                .from('avatars')
                .upload(fileName, decode(base64data), { contentType: 'image/jpeg', upsert: true });

            if (uploadError) {
                Alert.alert(t('profile.error'), t('profile.uploadError') + ': ' + uploadError.message);
                return;
            }

            const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(fileName);
            const urlWithTimestamp = `${publicUrl}?t=${Date.now()}`;

            await supabase.from('perfiles').update({ avatar_url: urlWithTimestamp }).eq('id', user.id);
            void supabase.auth.updateUser({ data: { avatar_url: urlWithTimestamp } });
            setAvatarUrl(urlWithTimestamp);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : t('profile.uploadError');
            Alert.alert(t('profile.error'), msg);
        } finally {
            setLoading(false);
        }
    };

    const pickImage = async (useCamera: boolean) => {
        const result = useCamera
            ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.4 })
            : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.4 });

        if (!result.canceled && result.assets[0]?.uri) {
            uploadImage(result.assets[0].uri);
        }
    };

    const showPhotoMenu = () => {
        Alert.alert(t('profile.photoTitle'), t('profile.photoChoice'), [
            { text: t('profile.camera'), onPress: () => pickImage(true) },
            { text: t('profile.gallery'), onPress: () => pickImage(false) },
            { text: t('profile.cancel'), style: 'cancel' },
        ]);
    };

    const addTag = (tag: string) => {
        if (tags.length >= 5) {
            Alert.alert(t('profile.tagLimitTitle'), t('profile.tagLimit'));
            return;
        }
        if (!tags.includes(tag)) {
            const updatedTags = [...tags, tag];
            setTags(updatedTags);
            updateProfileData({ tags: updatedTags });
        }
        setShowTagModal(false);
    };

    const removeTag = (tagToRemove: string) => {
        const updatedTags = tags.filter((tag) => tag !== tagToRemove);
        setTags(updatedTags);
        updateProfileData({ tags: updatedTags });
    };

    const updateProfileData = async (data: Record<string, unknown>): Promise<{ error: string | null }> => {
        if (!user?.id) return { error: null };
        return updateProfileFields(user.id, data);
    };

    const saveName = async () => {
        if (!user?.id) return;
        const trimmed = normalizeUsername(nombre);
        if (!trimmed) {
            Alert.alert(t('profile.error'), t('login.fillAll'));
            return;
        }
        if (trimmed.length > USERNAME_MAX_LENGTH) {
            Alert.alert(t('profile.error'), t('login.usernameMaxHint'));
            return;
        }
        const taken = await isUsernameTaken(trimmed, user.id);
        if (taken) {
            Alert.alert(t('profile.error'), t('login.usernameTaken'));
            return;
        }
        setNombre(trimmed);
        setIsEditing(false);
        const { error } = await updateProfileData({ nombre: trimmed });
        if (error) {
            const isDuplicate =
                error.toLowerCase().includes('unique') ||
                error.toLowerCase().includes('duplicate') ||
                error.includes('perfiles_nombre_lower_unique');
            Alert.alert(t('profile.error'), isDuplicate ? t('login.usernameTaken') : error);
            await fetchUserData();
        }
    };

    const quickActions: QuickAction[] = [
        {
            key: 'plans',
            icon: 'albums',
            labelKey: 'profile.myPlans',
            route: '/my-plans',
            color: PRIMARY_DARK,
            bg: '#EFF6FF',
            badge: planRequests,
        },
        {
            key: 'friends',
            icon: 'people',
            labelKey: 'profile.friends',
            route: '/friends',
            color: '#0EA5E9',
            bg: '#E0F2FE',
            badge: friendsNotifCount,
        },
        {
            key: 'saved',
            icon: 'heart',
            labelKey: 'profile.saved',
            route: '/saved-plans',
            color: '#EC4899',
            bg: '#FCE7F3',
        },
        {
            key: 'chats',
            icon: 'chatbubbles',
            labelKey: 'profile.chats',
            route: '/chats',
            color: '#8B5CF6',
            bg: '#EDE9FE',
        },
    ];

    const displayName = nombre.trim() || (user ? resolveDisplayName(user, t('profile.user')) : t('profile.user'));
    const initial = displayName[0]?.toUpperCase() || '?';

    const confirmDeleteAccount = () => {
        Alert.alert(
            t('profile.deleteAccountTitle'),
            t('profile.deleteAccountMsg'),
            [
                { text: t('profile.cancel'), style: 'cancel' },
                {
                    text: t('profile.deleteAccountConfirm'),
                    style: 'destructive',
                    onPress: handleDeleteAccount,
                },
            ]
        );
    };

    const handleDeleteAccount = async () => {
        setDeletingAccount(true);
        try {
            const { error } = await deleteAccount();
            if (error) {
                Alert.alert(t('profile.error'), t('profile.deleteAccountError') + (error ? `\n${error}` : ''));
                return;
            }
            router.replace('/login');
        } finally {
            setDeletingAccount(false);
        }
    };

    return (
        <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
            <LinearGradient colors={[BG_TOP, BG_BOTTOM]} style={StyleSheet.absoluteFill} />

            <View style={styles.topBar}>
                <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} activeOpacity={0.8}>
                    <Ionicons name="chevron-back" size={24} color={INK} />
                </TouchableOpacity>
                <Text style={styles.topTitle}>{t('profile.myProfile')}</Text>
                <TouchableOpacity onPress={() => router.push('/settings')} style={styles.iconBtn} activeOpacity={0.8}>
                    <Ionicons name="settings-outline" size={22} color={INK} />
                </TouchableOpacity>
            </View>

            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scroll}
                keyboardShouldPersistTaps="handled"
            >
                {/* Hero card */}
                <View style={styles.heroCard}>
                    <LinearGradient
                        colors={['#5BB5FF', PRIMARY_DARK]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.heroBanner}
                    />

                    <View style={styles.avatarBlock}>
                        <View style={styles.avatarWrap}>
                            <LinearGradient colors={['#FFF', '#E3ECFB']} style={styles.avatarRing}>
                                <TouchableOpacity onPress={showPhotoMenu} style={styles.avatar} activeOpacity={0.9}>
                                    {avatarUrl ? (
                                        <Image source={{ uri: avatarUrl }} style={styles.avatarImg} />
                                    ) : (
                                        <LinearGradient colors={[PRIMARY, PRIMARY_DARK]} style={styles.avatarFallback}>
                                            <Text style={styles.avatarInitial}>{initial}</Text>
                                        </LinearGradient>
                                    )}
                                </TouchableOpacity>
                            </LinearGradient>
                            <TouchableOpacity onPress={showPhotoMenu} style={styles.cameraBtn} activeOpacity={0.85}>
                                <Ionicons name="camera" size={15} color="#FFF" />
                            </TouchableOpacity>
                        </View>
                    </View>

                    <View style={styles.nameBlock}>
                        {isEditing ? (
                            <View style={styles.nameEditRow}>
                                <TextInput
                                    style={styles.nameInput}
                                    value={nombre}
                                    onChangeText={(text) => setNombre(text.slice(0, USERNAME_MAX_LENGTH))}
                                    autoFocus
                                    maxLength={USERNAME_MAX_LENGTH}
                                />
                                <TouchableOpacity
                                    onPress={saveName}
                                    style={styles.nameSaveBtn}
                                >
                                    <Ionicons name="checkmark" size={20} color="#FFF" />
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <TouchableOpacity style={styles.nameRow} onPress={() => setIsEditing(true)} activeOpacity={0.7}>
                                <Text style={styles.displayName} numberOfLines={1}>{displayName}</Text>
                                <View style={styles.editNameChip}>
                                    <Ionicons name="pencil" size={12} color={PRIMARY_DARK} />
                                </View>
                            </TouchableOpacity>
                        )}
                        {user?.email ? (
                            <Text style={styles.email} numberOfLines={1}>{user.email}</Text>
                        ) : null}
                    </View>

                    <View style={styles.statsRow}>
                        <View style={styles.statItem}>
                            <Text style={styles.statValue}>{DEFAULT_PLANS_DONE}</Text>
                            <Text style={styles.statLabel}>{t('profile.plansDone')}</Text>
                        </View>
                        <View style={styles.statDivider} />
                        <View style={styles.statItem}>
                            <Text style={styles.statValue}>{DEFAULT_RATING.toFixed(1)}</Text>
                            <View style={styles.starsRow}>{renderRatingStars(DEFAULT_RATING, 12)}</View>
                            <Text style={styles.statMeta}>{DEFAULT_REVIEW_COUNT} {t('profile.reviews')}</Text>
                        </View>
                        <View style={styles.statDivider} />
                        <TouchableOpacity
                            style={styles.statItem}
                            onPress={() => router.push('/friends')}
                            activeOpacity={0.75}
                        >
                            <View style={styles.statBadgeWrap}>
                                <Text style={styles.statValue}>{friendsCount}</Text>
                                {friendsNotifCount > 0 && (
                                    <View style={styles.statNotif}>
                                        <Text style={styles.statNotifText}>
                                            {friendsNotifCount > 9 ? '9+' : friendsNotifCount}
                                        </Text>
                                    </View>
                                )}
                            </View>
                            <Text style={styles.statLabel}>{t('profile.friendsLabel')}</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Quick actions */}
                <Text style={styles.sectionHeading}>{t('profile.quickActions')}</Text>
                <View style={styles.quickGrid}>
                    {quickActions.map((action) => (
                        <TouchableOpacity
                            key={action.key}
                            style={styles.quickTile}
                            onPress={() => router.push(action.route as any)}
                            activeOpacity={0.85}
                        >
                            <View style={[styles.quickIconWrap, { backgroundColor: action.bg }]}>
                                <Ionicons name={action.icon} size={22} color={action.color} />
                                {(action.badge ?? 0) > 0 && (
                                    <View style={styles.quickBadge}>
                                        <Text style={styles.quickBadgeText}>
                                            {(action.badge ?? 0) > 9 ? '9+' : action.badge}
                                        </Text>
                                    </View>
                                )}
                            </View>
                            <Text style={styles.quickLabel} numberOfLines={2}>{t(action.labelKey)}</Text>
                        </TouchableOpacity>
                    ))}
                </View>

                {/* About me */}
                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <View style={styles.cardHeaderLeft}>
                            <View style={[styles.cardIcon, { backgroundColor: '#EFF6FF' }]}>
                                <Ionicons name="document-text-outline" size={18} color={PRIMARY_DARK} />
                            </View>
                            <Text style={styles.cardTitle}>{t('profile.aboutMe')}</Text>
                        </View>
                        <Text style={styles.cardMeta}>{aboutMe.length}/400</Text>
                    </View>
                    {isEditingAboutMe ? (
                        <View style={styles.aboutEdit}>
                            <TextInput
                                style={styles.aboutInput}
                                value={aboutMe}
                                onChangeText={(text) => { if (text.length <= 400) setAboutMe(text); }}
                                placeholder={t('profile.aboutPlaceholder')}
                                placeholderTextColor="#94A3B8"
                                multiline
                                autoFocus
                            />
                            <TouchableOpacity
                                style={styles.aboutSave}
                                onPress={async () => {
                                    setIsEditingAboutMe(false);
                                    await updateProfileData({ about_me: aboutMe });
                                }}
                            >
                                <Ionicons name="checkmark-circle" size={28} color={PRIMARY_DARK} />
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <Pressable style={styles.aboutDisplay} onPress={() => setIsEditingAboutMe(true)}>
                            <Text style={aboutMe ? styles.aboutText : styles.aboutPlaceholder}>
                                {aboutMe || t('profile.aboutEmpty')}
                            </Text>
                            <Ionicons name="create-outline" size={18} color="#94A3B8" />
                        </Pressable>
                    )}
                </View>

                {/* Personality */}
                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <View style={styles.cardHeaderLeft}>
                            <View style={[styles.cardIcon, { backgroundColor: '#FEF3C7' }]}>
                                <Ionicons name="sparkles-outline" size={18} color="#D97706" />
                            </View>
                            <Text style={styles.cardTitle}>{t('profile.personality')}</Text>
                        </View>
                        <Text style={styles.cardMeta}>{tags.length}/5</Text>
                    </View>
                    <View style={styles.tagsWrap}>
                        {tags.map((tag) => (
                            <View key={tag} style={styles.tagChip}>
                                <Text style={styles.tagText}>{t('personality.' + tag) || tag}</Text>
                                <TouchableOpacity onPress={() => removeTag(tag)} hitSlop={8}>
                                    <Ionicons name="close" size={14} color={PRIMARY_DARK} />
                                </TouchableOpacity>
                            </View>
                        ))}
                        {tags.length < 5 && (
                            <TouchableOpacity style={styles.addTag} onPress={() => setShowTagModal(true)} activeOpacity={0.85}>
                                <Ionicons name="add" size={18} color={PRIMARY_DARK} />
                                <Text style={styles.addTagText}>{t('profile.addPersonality')}</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                </View>

                <TouchableOpacity
                    style={styles.logoutBtn}
                    onPress={async () => {
                        await supabase.auth.signOut();
                        router.replace('/login');
                    }}
                    activeOpacity={0.85}
                >
                    <Ionicons name="log-out-outline" size={20} color="#DC2626" />
                    <Text style={styles.logoutText}>{t('profile.logout')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.deleteAccountBtn}
                    onPress={confirmDeleteAccount}
                    disabled={deletingAccount}
                    activeOpacity={0.85}
                >
                    {deletingAccount ? (
                        <ActivityIndicator color="#991B1B" />
                    ) : (
                        <>
                            <Ionicons name="trash-outline" size={20} color="#991B1B" />
                            <Text style={styles.deleteAccountText}>{t('profile.deleteAccount')}</Text>
                        </>
                    )}
                </TouchableOpacity>
            </ScrollView>

            <Modal visible={showTagModal} transparent animationType="slide">
                <Pressable style={styles.modalOverlay} onPress={() => setShowTagModal(false)}>
                    <Pressable style={styles.modalSheet} onPress={() => {}}>
                        <View style={styles.modalHandle} />
                        <Text style={styles.modalTitle}>{t('profile.howDefine')}</Text>
                        <Text style={styles.modalSub}>{t('profile.tagLimit')}</Text>
                        <ScrollView contentContainerStyle={styles.modalTags} showsVerticalScrollIndicator={false}>
                            {PERSONALITY_OPTIONS.map((option) => {
                                const selected = tags.includes(option);
                                return (
                                    <TouchableOpacity
                                        key={option}
                                        style={[styles.modalTag, selected && styles.modalTagDisabled]}
                                        onPress={() => addTag(option)}
                                        disabled={selected}
                                        activeOpacity={0.8}
                                    >
                                        <Text style={[styles.modalTagText, selected && styles.modalTagTextDisabled]}>
                                            {t('personality.' + option) || option}
                                        </Text>
                                        {selected && <Ionicons name="checkmark-circle" size={18} color="#94A3B8" />}
                                    </TouchableOpacity>
                                );
                            })}
                        </ScrollView>
                        <TouchableOpacity style={styles.modalClose} onPress={() => setShowTagModal(false)}>
                            <Text style={styles.modalCloseText}>{t('profile.cancel')}</Text>
                        </TouchableOpacity>
                    </Pressable>
                </Pressable>
            </Modal>

            {loading && (
                <View style={styles.loadingOverlay}>
                    <View style={styles.loadingBox}>
                        <ActivityIndicator size="large" color={PRIMARY_DARK} />
                        <Text style={styles.loadingText}>{t('profile.uploading')}</Text>
                    </View>
                </View>
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: BG_BOTTOM },
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
        backgroundColor: 'rgba(255,255,255,0.85)',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.9)',
    },
    topTitle: { fontSize: 17, fontWeight: '800', color: INK, letterSpacing: -0.3 },
    scroll: { paddingHorizontal: 20, paddingBottom: 40 },
    heroCard: {
        backgroundColor: '#FFF',
        borderRadius: 28,
        overflow: 'hidden',
        marginBottom: 24,
        shadowColor: PRIMARY_DARK,
        shadowOpacity: 0.14,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 10 },
        elevation: 8,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.8)',
    },
    heroBanner: { height: 88 },
    avatarBlock: { alignItems: 'center', marginTop: -52 },
    avatarWrap: { position: 'relative' },
    avatarRing: {
        width: 108,
        height: 108,
        borderRadius: 54,
        padding: 4,
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatar: {
        width: 100,
        height: 100,
        borderRadius: 50,
        overflow: 'hidden',
        backgroundColor: '#E3ECFB',
    },
    avatarImg: { width: '100%', height: '100%' },
    avatarFallback: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    avatarInitial: { fontSize: 38, fontWeight: '900', color: '#FFF' },
    cameraBtn: {
        position: 'absolute',
        bottom: 4,
        right: 4,
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: INK,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 2.5,
        borderColor: '#FFF',
    },
    nameBlock: { alignItems: 'center', paddingHorizontal: 24, marginTop: 10 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%' },
    displayName: { fontSize: 22, fontWeight: '900', color: INK, letterSpacing: -0.4 },
    editNameChip: {
        width: 26,
        height: 26,
        borderRadius: 13,
        backgroundColor: '#EFF6FF',
        justifyContent: 'center',
        alignItems: 'center',
    },
    nameEditRow: {
        flexDirection: 'row',
        alignItems: 'center',
        width: '100%',
        gap: 8,
    },
    nameInput: {
        flex: 1,
        fontSize: 18,
        fontWeight: '700',
        color: INK,
        borderBottomWidth: 2,
        borderBottomColor: PRIMARY,
        paddingVertical: 6,
        textAlign: 'center',
    },
    nameSaveBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: PRIMARY_DARK,
        justifyContent: 'center',
        alignItems: 'center',
    },
    email: { fontSize: 13, color: '#64748B', marginTop: 4, fontWeight: '500' },
    statsRow: {
        flexDirection: 'row',
        marginTop: 22,
        marginHorizontal: 16,
        marginBottom: 20,
        backgroundColor: '#F8FAFC',
        borderRadius: 18,
        paddingVertical: 14,
        borderWidth: 1,
        borderColor: '#EEF3FB',
    },
    statItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    statDivider: { width: 1, backgroundColor: '#E2E8F0', marginVertical: 4 },
    statValue: { fontSize: 20, fontWeight: '900', color: INK },
    statLabel: {
        fontSize: 10,
        color: '#64748B',
        fontWeight: '700',
        textTransform: 'uppercase',
        marginTop: 4,
        textAlign: 'center',
    },
    statMeta: { fontSize: 9, color: '#94A3B8', marginTop: 2, fontWeight: '600' },
    starsRow: { flexDirection: 'row', marginTop: 2 },
    statBadgeWrap: { position: 'relative', alignItems: 'center' },
    statNotif: {
        position: 'absolute',
        top: -6,
        right: -16,
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: '#EF4444',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 4,
    },
    statNotifText: { color: '#FFF', fontSize: 10, fontWeight: '800' },
    sectionHeading: {
        fontSize: 12,
        fontWeight: '800',
        color: '#64748B',
        textTransform: 'uppercase',
        letterSpacing: 0.8,
        marginBottom: 12,
        marginLeft: 4,
    },
    quickGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: 24,
    },
    quickTile: {
        flexGrow: 1,
        flexBasis: '46%',
        maxWidth: '48%',
        backgroundColor: '#FFF',
        borderRadius: 20,
        padding: 16,
        alignItems: 'center',
        shadowColor: PRIMARY_DARK,
        shadowOpacity: 0.06,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
        borderWidth: 1,
        borderColor: '#EEF3FB',
    },
    quickIconWrap: {
        width: 52,
        height: 52,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 10,
        position: 'relative',
    },
    quickBadge: {
        position: 'absolute',
        top: -4,
        right: -4,
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: '#EF4444',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 4,
        borderWidth: 2,
        borderColor: '#FFF',
    },
    quickBadgeText: { color: '#FFF', fontSize: 10, fontWeight: '800' },
    quickLabel: {
        fontSize: 13,
        fontWeight: '700',
        color: INK,
        textAlign: 'center',
        lineHeight: 18,
    },
    card: {
        backgroundColor: '#FFF',
        borderRadius: 22,
        padding: 18,
        marginBottom: 16,
        shadowColor: PRIMARY_DARK,
        shadowOpacity: 0.06,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
        borderWidth: 1,
        borderColor: '#EEF3FB',
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 14,
    },
    cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    cardIcon: {
        width: 34,
        height: 34,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
    },
    cardTitle: { fontSize: 16, fontWeight: '800', color: INK },
    cardMeta: { fontSize: 11, color: '#94A3B8', fontWeight: '700' },
    aboutEdit: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    aboutInput: {
        flex: 1,
        fontSize: 15,
        color: INK,
        lineHeight: 22,
        minHeight: 88,
        textAlignVertical: 'top',
        backgroundColor: '#F8FAFC',
        borderRadius: 14,
        padding: 14,
        borderWidth: 1,
        borderColor: '#E3ECFB',
    },
    aboutSave: { paddingTop: 4 },
    aboutDisplay: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        backgroundColor: '#F8FAFC',
        borderRadius: 14,
        padding: 14,
        borderWidth: 1,
        borderColor: '#EEF3FB',
    },
    aboutText: { flex: 1, fontSize: 15, color: INK, lineHeight: 22 },
    aboutPlaceholder: { flex: 1, fontSize: 15, color: '#94A3B8', lineHeight: 22 },
    tagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    tagChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#EFF6FF',
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#BFDBFE',
    },
    tagText: { color: PRIMARY_DARK, fontWeight: '700', fontSize: 13 },
    addTag: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: 20,
        borderWidth: 1.5,
        borderColor: PRIMARY_DARK,
        borderStyle: 'dashed',
        backgroundColor: '#FAFCFF',
    },
    addTagText: { color: PRIMARY_DARK, fontWeight: '700', fontSize: 13 },
    logoutBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        marginTop: 8,
        paddingVertical: 16,
        borderRadius: 18,
        backgroundColor: '#FFF',
        borderWidth: 1,
        borderColor: '#FECACA',
    },
    logoutText: { color: '#DC2626', fontWeight: '800', fontSize: 15 },
    deleteAccountBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        marginTop: 12,
        paddingVertical: 16,
        borderRadius: 18,
        backgroundColor: '#FEF2F2',
        borderWidth: 1,
        borderColor: '#FECACA',
    },
    deleteAccountText: { color: '#991B1B', fontWeight: '800', fontSize: 15 },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(15, 42, 74, 0.45)',
        justifyContent: 'flex-end',
    },
    modalSheet: {
        backgroundColor: '#FFF',
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        paddingHorizontal: 20,
        paddingBottom: 28,
        maxHeight: '75%',
    },
    modalHandle: {
        width: 40,
        height: 4,
        borderRadius: 2,
        backgroundColor: '#E2E8F0',
        alignSelf: 'center',
        marginTop: 12,
        marginBottom: 16,
    },
    modalTitle: { fontSize: 18, fontWeight: '900', color: INK, textAlign: 'center' },
    modalSub: { fontSize: 13, color: '#94A3B8', textAlign: 'center', marginTop: 6, marginBottom: 16 },
    modalTags: { gap: 8, paddingBottom: 8 },
    modalTag: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#F8FAFC',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#EEF3FB',
    },
    modalTagDisabled: { opacity: 0.55, backgroundColor: '#F1F5F9' },
    modalTagText: { fontWeight: '700', color: INK, fontSize: 15 },
    modalTagTextDisabled: { color: '#94A3B8' },
    modalClose: { marginTop: 12, paddingVertical: 14, alignItems: 'center' },
    modalCloseText: { color: '#64748B', fontWeight: '700', fontSize: 15 },
    loadingOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(255,255,255,0.65)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingBox: {
        backgroundColor: '#FFF',
        paddingHorizontal: 28,
        paddingVertical: 22,
        borderRadius: 20,
        alignItems: 'center',
        gap: 12,
        shadowColor: '#000',
        shadowOpacity: 0.1,
        shadowRadius: 16,
        elevation: 6,
    },
    loadingText: { fontSize: 14, fontWeight: '600', color: INK },
});

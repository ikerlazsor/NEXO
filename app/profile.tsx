/*
perfil del usuario
*/
import {
    Ionicons } from '@expo/vector-icons';
import { decode } from 'base64-arraybuffer';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect,
    useRouter } from 'expo-router';
import { useCallback,
    useEffect,
    useRef,
    useState } from 'react';
import {
    ActivityIndicator,
    InteractionManager,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Alert } from '../lib/nexoAlert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { ProfileReputationStats } from '../components/ProfileReputationStats';
import { BadgeDetailModal, BadgeTile } from '../components/TrophyBadge';
import { ProfileDetailsSection } from '../components/ProfileDetailsSection';
import { getFriendsCount } from '../lib/friends';
import { useT } from '../lib/i18n';
import { getProfileNotificationCount } from '../lib/notifications';
import { getAuthUser } from '../lib/auth';
import { formatCountdown } from '../lib/planLifecycle';
import { warmFriendsAndSavedPlans } from '../lib/prefetchHome';
import { getPendingRatingPlans, type PendingRatingPlan } from '../lib/ratings';
import {
    deleteAccount,
    DISPLAY_NAME_MAX_LENGTH,
    isUsernameTaken,
    isValidDisplayName,
    isValidUsername,
    normalizeDisplayName,
    formatUsernameInput,
    normalizeUsername,
    loadProfileRow,
    resolveDisplayName,
    syncProfileFromAuth,
    updateDisplayName,
    updateProfileFields,
    updateUsername,
    getUsernameCooldownDaysLeft,
    USERNAME_MAX_LENGTH,
} from '../lib/profile';
import { screenCacheKey, ScreenCacheTTL } from '../lib/screenCaches';
import { cacheGetStale, cacheSet } from '../lib/ttlCache';
import { renderRatingStars } from '../lib/profileRating';
import { EMPTY_STATS, formatRatingScore, getUserStats, type UserStats } from '../lib/stats';
import { getUserBadges, type UserBadge } from '../lib/badges';
import { getBadgeStats } from '../lib/badgeStats';
import { perfEnd, perfStart, perfTimed } from '../lib/perfLog';
import {
    AFICIONES_OPTIONS,
    calcAge,
    getPersonalityLabel,
    parseHabitos,
    mergePerfilGustosPrivacy,
    parsePrivacy,
    type Genero,
    type HabitoConsumo,
    type ProfilePrivacy,
} from '../lib/profileFields';
import { supabase } from '../lib/supabase';
import { useScrollViewRestore } from '../hooks/useScrollViewRestore';
import { ScreenKeys } from '../lib/screenState';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';
const BG = '#F8FAFC';
const SURFACE = '#FFFFFF';
const BORDER = '#E2E8F0';

const PERSONALITY_OPTIONS = [...AFICIONES_OPTIONS];
const PERSONALITY_MAX = 3;

type QuickAction = {
    key: string;
    icon: keyof typeof Ionicons.glyphMap;
    labelKey: string;
    route: string;
    color: string;
    bg: string;
    badge?: number;
};

type ProfileUiSnapshot = {
    userId: string;
    nombre: string;
    nombreUsuario: string | null;
    aboutMe: string;
    avatarUrl: string | null;
    age: number | null;
    genero: Genero | null;
    habitoBebida: HabitoConsumo;
    habitoTabaco: HabitoConsumo;
    aficiones: string[];
    perfilGustos: Record<string, unknown>;
    privacy: ProfilePrivacy;
    stats: UserStats;
    friendsCount: number;
    friendsNotifCount: number;
    planRequests: number;
    pendingRatings: PendingRatingPlan[];
    badges: UserBadge[];
};

export default function ProfileScreen() {
    const router = useRouter();
    const { t } = useT();
    const [loading, setLoading] = useState(false);
    const [user, setUser] = useState<any>(null);
    const [nombre, setNombre] = useState('');
    const [nombreUsuario, setNombreUsuario] = useState<string | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [isEditingUsername, setIsEditingUsername] = useState(false);
    const [usernameDraft, setUsernameDraft] = useState('');
    const [usernameCooldownDays, setUsernameCooldownDays] = useState(0);
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [friendsCount, setFriendsCount] = useState(0);
    const [friendsNotifCount, setFriendsNotifCount] = useState(0);
    const [planRequests, setPlanRequests] = useState(0);
    const [pendingRatings, setPendingRatings] = useState<PendingRatingPlan[]>([]);
    const [nowTick, setNowTick] = useState(Date.now());
    const [aboutMe, setAboutMe] = useState('');
    const [isEditingAboutMe, setIsEditingAboutMe] = useState(false);
    const [deletingAccount, setDeletingAccount] = useState(false);
    const [stats, setStats] = useState<UserStats>(EMPTY_STATS);
    const [age, setAge] = useState<number | null>(null);
    const [genero, setGenero] = useState<Genero | null>(null);
    const [habitoBebida, setHabitoBebida] = useState<HabitoConsumo>('no_especificado');
    const [habitoTabaco, setHabitoTabaco] = useState<HabitoConsumo>('no_especificado');
    const [aficiones, setAficiones] = useState<string[]>([]);
    const [showAficionModal, setShowAficionModal] = useState(false);
    const [badges, setBadges] = useState<UserBadge[]>([]);
    const [badgesLoading, setBadgesLoading] = useState(false);
    const [selectedBadge, setSelectedBadge] = useState<UserBadge | null>(null);
    const [privacy, setPrivacy] = useState<ProfilePrivacy>({ mostrar_edad: true, mostrar_genero: true, mostrar_bebida: true, mostrar_tabaco: true, mostrar_aficiones: true });
    const [perfilGustos, setPerfilGustos] = useState<Record<string, unknown>>({});
    const hasHydratedRef = useRef(false);
    const { scrollRef, onScroll, scrollEventThrottle } = useScrollViewRestore(ScreenKeys.PROFILE);

    const applyProfileSnapshot = useCallback((snap: ProfileUiSnapshot) => {
        setNombre(snap.nombre);
        setNombreUsuario(snap.nombreUsuario);
        setAboutMe(snap.aboutMe);
        setAvatarUrl(snap.avatarUrl);
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
        setPlanRequests(snap.planRequests);
        setPendingRatings(snap.pendingRatings);
        setBadges(snap.badges);
        setBadgesLoading(false);
        hasHydratedRef.current = true;
    }, []);

    useFocusEffect(
        useCallback(() => {
            void fetchUserData();
            // Precargar Amigos / Guardados mientras estás en perfil (antes de entrar).
            warmFriendsAndSavedPlans();
        }, [])
    );

    useEffect(() => {
        if (!pendingRatings.some((p) => p.phase === 'waiting')) return;
        const id = setInterval(() => setNowTick(Date.now()), 1000);
        return () => clearInterval(id);
    }, [pendingRatings]);

    const fetchUserData = async () => {
        perfStart('profile.total');
        const authUser = await getAuthUser();
        if (!authUser) return;

        setUser(authUser);

        const stale = cacheGetStale<ProfileUiSnapshot>(screenCacheKey.profileUI(authUser.id));
        if (stale && stale.userId === authUser.id) {
            applyProfileSnapshot(stale);
        } else if (!hasHydratedRef.current) {
            setBadgesLoading(true);
        }

        const applyProfileFields = (profile: {
            nombre: string;
            nombre_usuario: string | null;
            avatar_url: string | null;
            descripcion: string;
            etiquetas: string[];
            fecha_nacimiento: string | null;
            genero: string | null;
            habitos_consumo: Record<string, unknown>;
            ambientes_preferidos: string[];
            perfil_gustos: Record<string, unknown>;
        }) => {
            setNombre(profile.nombre);
            setNombreUsuario(profile.nombre_usuario);
            setAboutMe(profile.descripcion);
            setAvatarUrl(profile.avatar_url);
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

        await new Promise<void>((resolve) => {
            InteractionManager.runAfterInteractions(() => resolve());
        });

        const [userStats, badgeStats, friendsCountVal, notifs, ratings] = await Promise.all([
            perfTimed('profile.userStats', () => getUserStats(authUser.id)),
            perfTimed('profile.badgeStats', () =>
                getBadgeStats(authUser.id, { userCreatedAt: authUser.created_at }),
            ),
            perfTimed('profile.friendsCount', () => getFriendsCount(authUser.id)),
            perfTimed('profile.notifications', () => getProfileNotificationCount(authUser.id)),
            perfTimed('profile.ratings', () => getPendingRatingPlans(authUser.id)),
        ]);

        const nextBadges = getUserBadges(badgeStats);
        const friendsNotif = notifs.friendRequests + notifs.planInvites;

        setStats(userStats);
        setFriendsCount(friendsCountVal);
        setFriendsNotifCount(friendsNotif);
        setPlanRequests(notifs.planRequests);
        setPendingRatings(ratings);
        setBadges(nextBadges);
        setBadgesLoading(false);
        hasHydratedRef.current = true;

        const snap: ProfileUiSnapshot = {
            userId: authUser.id,
            nombre: profileFields.nombre,
            nombreUsuario: profileFields.nombre_usuario,
            aboutMe: profileFields.descripcion,
            avatarUrl: profileFields.avatar_url,
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
            badges: nextBadges,
        };
        cacheSet(screenCacheKey.profileUI(authUser.id), snap, ScreenCacheTTL.profileUI);
        perfEnd('profile.total');
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

    const addAficion = (tag: string) => {
        if (aficiones.length >= PERSONALITY_MAX) {
            Alert.alert(t('profile.tagLimitTitle'), t('profile.tagLimit'));
            return;
        }
        if (!aficiones.includes(tag)) {
            const updated = [...aficiones, tag];
            setAficiones(updated);
            updateProfileData({ ambientes_preferidos: updated, etiquetas: updated });
        }
        setShowAficionModal(false);
    };

    const removeAficion = (tagToRemove: string) => {
        const updated = aficiones.filter((tag) => tag !== tagToRemove);
        setAficiones(updated);
        updateProfileData({ ambientes_preferidos: updated, etiquetas: updated });
    };

    const savePrivacy = async (next: ProfilePrivacy) => {
        setPrivacy(next);
        await updateProfileData({
            perfil_gustos: mergePerfilGustosPrivacy(perfilGustos, next),
        });
    };

    const saveHabitos = async (bebida: HabitoConsumo, tabaco: HabitoConsumo) => {
        setHabitoBebida(bebida);
        setHabitoTabaco(tabaco);
        await updateProfileData({ habitos_consumo: { bebida, tabaco } });
    };

    const updateProfileData = async (data: Record<string, unknown>): Promise<{ error: string | null }> => {
        if (!user?.id) return { error: null };
        return updateProfileFields(user.id, data);
    };

    const saveName = async () => {
        if (!user?.id) return;
        const trimmed = normalizeDisplayName(nombre);
        if (!isValidDisplayName(trimmed)) {
            Alert.alert(t('profile.error'), t('profile.displayNameHint'));
            return;
        }
        setNombre(trimmed);
        setIsEditing(false);
        const { error } = await updateDisplayName(user.id, trimmed);
        if (error) {
            Alert.alert(t('profile.error'), error);
            await fetchUserData();
        }
    };

    const saveUsername = async () => {
        if (!user?.id) return;
        const handle = normalizeUsername(usernameDraft);
        if (!isValidUsername(handle)) {
            Alert.alert(t('profile.error'), t('login.usernameInvalid'));
            return;
        }
        if (handle === normalizeUsername(nombreUsuario ?? '')) {
            setIsEditingUsername(false);
            return;
        }
        try {
            const taken = await isUsernameTaken(handle, user.id);
            if (taken) {
                Alert.alert(t('profile.error'), t('login.usernameTaken'));
                return;
            }
        } catch {
            Alert.alert(t('profile.error'), t('login.usernameCheckFailed'));
            return;
        }
        const prev = nombreUsuario;
        setNombreUsuario(handle);
        setIsEditingUsername(false);
        const { error, daysLeft } = await updateUsername(user.id, handle);
        if (error) {
            setNombreUsuario(prev);
            if (error === 'username_cooldown') {
                const days = (daysLeft ?? (await getUsernameCooldownDaysLeft(user.id))) || 1;
                setUsernameCooldownDays(days);
                Alert.alert(
                    t('profile.error'),
                    t('profile.usernameCooldown', { days }),
                );
                return;
            }
            const isDuplicate =
                error === 'username_taken' ||
                error.toLowerCase().includes('unique') ||
                error.toLowerCase().includes('duplicate');
            Alert.alert(
                t('profile.error'),
                isDuplicate ? t('login.usernameTaken') : t('login.usernameInvalid'),
            );
            await fetchUserData();
            return;
        }
        const days = await getUsernameCooldownDaysLeft(user.id);
        setUsernameCooldownDays(days);
    };

    const beginEditUsername = async () => {
        if (!user?.id) return;
        const days = await getUsernameCooldownDaysLeft(user.id);
        setUsernameCooldownDays(days);
        if (days > 0) {
            Alert.alert(t('profile.error'), t('profile.usernameCooldown', { days }));
            return;
        }
        setUsernameDraft(formatUsernameInput(nombreUsuario ?? ''));
        setIsEditingUsername(true);
    };

    const cancelEditUsername = () => {
        if (!isEditingUsername) return;
        setIsEditingUsername(false);
        setUsernameDraft(formatUsernameInput(nombreUsuario ?? ''));
    };

    const quickActions: QuickAction[] = [
        { key: 'friends', icon: 'people', labelKey: 'profile.friends', route: '/friends', color: INK, bg: '#F1F5F9', badge: friendsNotifCount },
        { key: 'saved', icon: 'heart', labelKey: 'profile.saved', route: '/saved-plans', color: INK, bg: '#F1F5F9' },
    ];

    const displayName = nombre.trim() || (user ? resolveDisplayName(user, t('profile.user')) : t('profile.user'));

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
        <View style={styles.safe}>
            <LinearGradient
                colors={['#DBEAFE', '#EFF6FF', BG]}
                locations={[0, 0.35, 0.7]}
                style={StyleSheet.absoluteFill}
            />
            <SafeAreaView style={styles.safeInner} edges={['top', 'left', 'right']}>
            <View style={styles.topBar}>
                <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} activeOpacity={0.8}>
                    <Ionicons name="chevron-back" size={22} color={INK} />
                </TouchableOpacity>
                <Text style={styles.topTitle}>{t('profile.myProfile')}</Text>
                <TouchableOpacity onPress={() => router.push('/settings')} style={styles.iconBtn} activeOpacity={0.8}>
                    <Ionicons name="settings-outline" size={20} color={INK} />
                </TouchableOpacity>
            </View>

            <ScrollView
                ref={scrollRef}
                onScroll={onScroll}
                scrollEventThrottle={scrollEventThrottle}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scroll}
                keyboardShouldPersistTaps="handled"
                onScrollBeginDrag={cancelEditUsername}
            >
                <Pressable style={styles.scrollPressable} onPress={cancelEditUsername}>
                <View style={styles.heroCard}>
                    <LinearGradient
                        colors={['#FFFFFF', '#F8FBFF']}
                        style={styles.heroGlow}
                    />
                    <View style={styles.avatarBlock}>
                        <TouchableOpacity onPress={showPhotoMenu} activeOpacity={0.9}>
                            <ProfileAvatar uri={avatarUrl} name={displayName} size={104} recyclingKey={user?.id} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={showPhotoMenu} style={styles.cameraBtn} activeOpacity={0.85}>
                            <Ionicons name="camera" size={15} color="#FFF" />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.nameBlock}>
                        {isEditing ? (
                            <View style={styles.nameEditRow}>
                                <TextInput
                                    style={styles.nameInput}
                                    value={nombre}
                                    onChangeText={(text) => setNombre(text.slice(0, DISPLAY_NAME_MAX_LENGTH))}
                                    autoFocus
                                    maxLength={DISPLAY_NAME_MAX_LENGTH}
                                    autoCapitalize="words"
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
                                <View style={styles.nameSideSlot} />
                                <Text style={styles.displayName} numberOfLines={1}>{displayName}</Text>
                                <View style={styles.editNameChip}>
                                    <Ionicons name="pencil" size={12} color={PRIMARY_DARK} />
                                </View>
                            </TouchableOpacity>
                        )}
                        {isEditingUsername ? (
                            <Pressable style={styles.usernameEditRow} onPress={(e) => e.stopPropagation()}>
                                <Text style={styles.atPrefix}>@</Text>
                                <TextInput
                                    style={styles.usernameInput}
                                    value={usernameDraft}
                                    onChangeText={(text) => setUsernameDraft(formatUsernameInput(text))}
                                    autoFocus
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    spellCheck={false}
                                    maxLength={USERNAME_MAX_LENGTH}
                                />
                                <TouchableOpacity onPress={saveUsername} style={styles.nameSaveBtn}>
                                    <Ionicons name="checkmark" size={18} color="#FFF" />
                                </TouchableOpacity>
                            </Pressable>
                        ) : (
                            <TouchableOpacity
                                style={styles.usernameTap}
                                onPress={beginEditUsername}
                                activeOpacity={0.7}
                            >
                                <Text style={styles.username} numberOfLines={1}>
                                    @{nombreUsuario || '—'}
                                </Text>
                            </TouchableOpacity>
                        )}
                    </View>

                    <View style={styles.statsRow}>
                        <TouchableOpacity
                            style={styles.statItem}
                            onPress={() => router.push('/my-plans')}
                            activeOpacity={0.8}
                        >
                            <Text style={styles.statValue}>{stats.numeroPlanesRealizados}</Text>
                            <Text style={styles.statLabel}>{t('profile.plansDone')}</Text>
                        </TouchableOpacity>
                        <View style={styles.statDivider} />
                        <View style={styles.statItem}>
                            <Text style={styles.statValue}>{formatRatingScore(stats.valoracionMedia)}</Text>
                            <View style={styles.starsRow}>{renderRatingStars(stats.valoracionMedia, 12)}</View>
                            <Text style={styles.statMeta}>
                                {stats.numeroValoraciones}{' '}
                                {t(stats.numeroValoraciones === 1 ? 'profile.review' : 'profile.reviews')}
                            </Text>
                        </View>
                        <View style={styles.statDivider} />
                        <TouchableOpacity
                            style={styles.statItem}
                            onPress={() => router.push({ pathname: '/friends', params: { tab: 'friends' } })}
                            onPressIn={() => warmFriendsAndSavedPlans(user?.id)}
                            activeOpacity={0.8}
                        >
                            <View style={styles.statBadgeWrap}>
                                <Text style={styles.statValue}>{friendsCount}</Text>
                            </View>
                            <Text style={styles.statLabel}>{t('profile.friendsLabel')}</Text>
                        </TouchableOpacity>
                    </View>

                    <ProfileReputationStats
                        stats={stats}
                        isSelf
                        displayName={displayName}
                        genero={genero}
                    />
                </View>

                {pendingRatings.length > 0 ? (
                    <>
                        <Text style={styles.sectionHeading}>{t('ratings.section')}</Text>
                        <View style={styles.ratingsList}>
                            {pendingRatings.map((item) => {
                                const waiting = item.phase === 'waiting';
                                const remaining = Math.max(0, item.unlockAt - nowTick);
                                const openCount = Math.max(item.pendingCount, waiting ? item.totalPeers : item.pendingCount);
                                return (
                                    <TouchableOpacity
                                        key={item.planId}
                                        style={[styles.ratingCard, waiting ? styles.ratingCardWait : styles.ratingCardOpen]}
                                        activeOpacity={waiting ? 1 : 0.85}
                                        disabled={waiting}
                                        onPress={() =>
                                            router.push({ pathname: '/rate-plan', params: { planId: item.planId } })
                                        }
                                    >
                                        <View style={[styles.ratingIconWrap, waiting ? styles.ratingIconWait : styles.ratingIconOpen]}>
                                            <Ionicons
                                                name={waiting ? 'hourglass-outline' : 'star'}
                                                size={18}
                                                color={waiting ? '#B45309' : '#FFF'}
                                            />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.ratingCardTitle} numberOfLines={1}>{item.titulo}</Text>
                                            <Text style={styles.ratingCardSub}>
                                                {waiting
                                                    ? t('ratings.unlockIn', { time: formatCountdown(remaining) })
                                                    : item.pendingCount === 0
                                                      ? t('ratings.readyContinue')
                                                      : item.pendingCount === 1
                                                        ? t('ratings.readyToRateOne')
                                                        : t('ratings.readyToRate', { n: item.pendingCount })}
                                            </Text>
                                            {!waiting && item.totalPeers > 0 ? (
                                                <View style={styles.ratingMiniTrack}>
                                                    <View
                                                        style={[
                                                            styles.ratingMiniFill,
                                                            {
                                                                width: `${Math.round(
                                                                    ((item.totalPeers - item.pendingCount) / item.totalPeers) * 100,
                                                                )}%`,
                                                            },
                                                        ]}
                                                    />
                                                </View>
                                            ) : null}
                                        </View>
                                        {!waiting && openCount > 0 && (
                                            <View style={styles.ratingReadyBadge}>
                                                <Text style={styles.ratingReadyText}>{item.pendingCount}</Text>
                                            </View>
                                        )}
                                        {!waiting && <Ionicons name="chevron-forward" size={16} color="#CBD5E1" />}
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    </>
                ) : null}

                <View style={styles.quickGrid}>
                    {quickActions.map((action) => (
                        <TouchableOpacity
                            key={action.key}
                            style={styles.quickTile}
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

                <ProfileDetailsSection
                    age={age}
                    genero={genero}
                    habitoBebida={habitoBebida}
                    habitoTabaco={habitoTabaco}
                    privacy={privacy}
                    onSaveHabitos={saveHabitos}
                    onPrivacyChange={savePrivacy}
                />

                {/* About me */}
                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <Text style={styles.cardTitle}>{t('profile.aboutMe')}</Text>
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
                                    await updateProfileData({ descripcion: aboutMe });
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

                {/* Personalidad */}
                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <Text style={styles.cardTitle}>{t('profile.personality')}</Text>
                        <View style={styles.hobbyHeaderRight}>
                            <Text style={styles.cardMeta}>{aficiones.length}/{PERSONALITY_MAX}</Text>
                            <Switch
                                value={privacy.mostrar_aficiones}
                                onValueChange={(v) => savePrivacy({ ...privacy, mostrar_aficiones: v })}
                                trackColor={{ false: '#E2E8F0', true: '#BFDBFE' }}
                                thumbColor={privacy.mostrar_aficiones ? PRIMARY_DARK : '#94A3B8'}
                            />
                        </View>
                    </View>
                    <View style={styles.tagsWrap}>
                        {!privacy.mostrar_aficiones ? (
                            <Text style={styles.personalityHidden}>{t('profile.hidden')}</Text>
                        ) : (
                            <>
                                {aficiones.map((tag) => (
                                    <View key={tag} style={styles.tagChip}>
                                        <Text style={styles.tagText}>{getPersonalityLabel(tag, genero, t)}</Text>
                                        <TouchableOpacity onPress={() => removeAficion(tag)} hitSlop={8}>
                                            <Ionicons name="close" size={14} color={PRIMARY_DARK} />
                                        </TouchableOpacity>
                                    </View>
                                ))}
                                {aficiones.length < PERSONALITY_MAX && (
                                    <TouchableOpacity style={styles.addTag} onPress={() => setShowAficionModal(true)} activeOpacity={0.85}>
                                        <Ionicons name="add" size={18} color={PRIMARY_DARK} />
                                        <Text style={styles.addTagText}>{t('profile.addPersonality')}</Text>
                                    </TouchableOpacity>
                                )}
                            </>
                        )}
                    </View>
                </View>

                {/* Insignias */}
                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <Text style={styles.cardTitle}>{t('profile.badges')}</Text>
                        <Text style={styles.cardMeta}>
                            {badges.filter((b) => b.unlocked).length}/{badges.length}
                        </Text>
                    </View>
                    {badgesLoading ? (
                        <ActivityIndicator color={PRIMARY_DARK} style={{ marginVertical: 24, alignSelf: 'center' }} />
                    ) : (
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
                    )}
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
                </Pressable>
            </ScrollView>

            <Modal visible={showAficionModal} transparent animationType="slide">
                <Pressable style={styles.modalOverlay} onPress={() => setShowAficionModal(false)}>
                    <Pressable style={styles.modalSheet} onPress={() => {}}>
                        <View style={styles.modalHandle} />
                        <Text style={styles.modalTitle}>{t('profile.pickPersonality')}</Text>
                        <Text style={styles.modalSub}>{t('profile.tagLimit')}</Text>
                        <ScrollView contentContainerStyle={styles.modalTags} showsVerticalScrollIndicator={false}>
                            {PERSONALITY_OPTIONS.map((option) => {
                                const selected = aficiones.includes(option);
                                return (
                                    <TouchableOpacity
                                        key={option}
                                        style={[styles.modalTag, selected && styles.modalTagDisabled]}
                                        onPress={() => addAficion(option)}
                                        disabled={selected}
                                        activeOpacity={0.8}
                                    >
                                        <Text style={[styles.modalTagText, selected && styles.modalTagTextDisabled]}>
                                            {getPersonalityLabel(option, genero, t)}
                                        </Text>
                                        {selected && <Ionicons name="checkmark-circle" size={18} color="#94A3B8" />}
                                    </TouchableOpacity>
                                );
                            })}
                        </ScrollView>
                        <TouchableOpacity style={styles.modalClose} onPress={() => setShowAficionModal(false)}>
                            <Text style={styles.modalCloseText}>{t('profile.cancel')}</Text>
                        </TouchableOpacity>
                    </Pressable>
                </Pressable>
            </Modal>

            <BadgeDetailModal
                badge={selectedBadge}
                visible={!!selectedBadge}
                onClose={() => setSelectedBadge(null)}
            />

            {loading && (
                <View style={styles.loadingOverlay}>
                    <View style={styles.loadingBox}>
                        <ActivityIndicator size="large" color={PRIMARY_DARK} />
                        <Text style={styles.loadingText}>{t('profile.uploading')}</Text>
                    </View>
                </View>
            )}
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: BG },
    safeInner: { flex: 1 },
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
        borderRadius: 21,
        backgroundColor: 'rgba(255,255,255,0.92)',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(226,232,240,0.9)',
        ...Platform.select({
            ios: { shadowColor: '#0F2A4A', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
            android: { elevation: 2 },
        }),
    },
    topTitle: { fontSize: 18, fontWeight: '800', color: INK, letterSpacing: -0.3 },
    scroll: { paddingHorizontal: 18, paddingBottom: 48 },
    scrollPressable: { flexGrow: 1 },
    heroCard: {
        backgroundColor: SURFACE,
        borderRadius: 28,
        paddingVertical: 28,
        paddingHorizontal: 18,
        marginBottom: 12,
        alignItems: 'center',
        overflow: 'hidden',
        ...Platform.select({
            ios: { shadowColor: '#1E3A8A', shadowOpacity: 0.1, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } },
            android: { elevation: 4 },
        }),
    },
    heroGlow: {
        ...StyleSheet.absoluteFillObject,
    },
    avatarBlock: { position: 'relative', marginBottom: 16 },
    cameraBtn: {
        position: 'absolute',
        bottom: 2,
        right: 2,
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: PRIMARY_DARK,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 3,
        borderColor: SURFACE,
    },
    hobbyHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    nameBlock: { alignItems: 'center', paddingHorizontal: 16, marginTop: 4, width: '100%' },
    nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', maxWidth: '100%' },
    nameSideSlot: { width: 28, height: 28 },
    displayName: {
        fontSize: 26,
        fontWeight: '800',
        color: INK,
        letterSpacing: -0.6,
        textAlign: 'center',
        flexShrink: 1,
    },
    editNameChip: {
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: '#EFF6FF',
        justifyContent: 'center',
        alignItems: 'center',
        marginLeft: 8,
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
    usernameTap: { alignItems: 'center', marginTop: 4 },
    username: { fontSize: 14, color: '#64748B', fontWeight: '600', textAlign: 'center' },
    usernameEditRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 6,
        gap: 4,
        maxWidth: '100%',
    },
    atPrefix: { fontSize: 14, fontWeight: '700', color: '#94A3B8' },
    usernameInput: {
        minWidth: 120,
        maxWidth: 200,
        fontSize: 14,
        fontWeight: '600',
        color: INK,
        borderBottomWidth: 1.5,
        borderBottomColor: PRIMARY,
        paddingVertical: 4,
        textAlign: 'center',
    },
    statsRow: {
        flexDirection: 'row',
        marginTop: 22,
        marginHorizontal: 4,
        marginBottom: 4,
        backgroundColor: '#F8FBFF',
        borderRadius: 22,
        paddingVertical: 18,
        paddingHorizontal: 6,
        borderWidth: 1,
        borderColor: '#E0EFFF',
        width: '100%',
    },
    historyBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginHorizontal: 16,
        marginBottom: 20,
        paddingVertical: 12,
        paddingHorizontal: 14,
        backgroundColor: '#EFF6FF',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#DBEAFE',
    },
    historyBtnText: { flex: 1, fontSize: 14, fontWeight: '800', color: INK },
    ratingsEmpty: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: SURFACE,
        marginBottom: 8,
        padding: 16,
        borderRadius: 18,
        ...Platform.select({
            ios: { shadowColor: '#0F2A4A', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
            android: { elevation: 1 },
        }),
    },
    ratingsEmptyText: { flex: 1, color: MUTED, fontWeight: '600', fontSize: 13 },
    ratingsList: { marginBottom: 8, gap: 10 },
    ratingCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: SURFACE,
        borderRadius: 18,
        padding: 15,
        borderWidth: 1,
    },
    ratingCardWait: { borderColor: '#FCD34D', backgroundColor: '#FFFBEB' },
    ratingCardOpen: { borderColor: '#BFDBFE', backgroundColor: '#EFF6FF' },
    ratingIconWrap: {
        width: 40,
        height: 36,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    ratingIconWait: { backgroundColor: '#FDE68A' },
    ratingIconOpen: { backgroundColor: PRIMARY_DARK },
    ratingCardTitle: { fontSize: 14, fontWeight: '800', color: INK },
    ratingCardSub: { fontSize: 12, fontWeight: '600', color: MUTED, marginTop: 2 },
    ratingMiniTrack: {
        height: 4,
        backgroundColor: '#E2E8F0',
        borderRadius: 2,
        marginTop: 8,
        overflow: 'hidden',
    },
    ratingMiniFill: { height: '100%', backgroundColor: PRIMARY_DARK, borderRadius: 2 },
    ratingReadyBadge: {
        minWidth: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: '#EF4444',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 6,
    },
    ratingReadyText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
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
        fontSize: 13,
        fontWeight: '800',
        color: INK,
        letterSpacing: -0.2,
        marginBottom: 12,
        marginTop: 14,
        marginLeft: 2,
    },
    quickGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
        marginTop: 2,
        marginBottom: 20,
    },
    quickTile: {
        flexGrow: 1,
        flexBasis: '46%',
        maxWidth: '48%',
        backgroundColor: SURFACE,
        borderRadius: 20,
        paddingVertical: 18,
        paddingHorizontal: 12,
        alignItems: 'center',
        ...Platform.select({
            ios: { shadowColor: '#0F2A4A', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
            android: { elevation: 2 },
        }),
    },
    quickIconWrap: {
        width: 56,
        height: 56,
        borderRadius: 18,
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
        backgroundColor: SURFACE,
        borderRadius: 22,
        padding: 20,
        marginBottom: 16,
        ...Platform.select({
            ios: { shadowColor: '#0F2A4A', shadowOpacity: 0.05, shadowRadius: 14, shadowOffset: { width: 0, height: 4 } },
            android: { elevation: 2 },
        }),
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
    cardTitle: { fontSize: 17, fontWeight: '800', color: INK, letterSpacing: -0.2 },
    cardMeta: { fontSize: 12, color: '#94A3B8', fontWeight: '700' },
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
    personalityHidden: {
        fontSize: 14,
        fontWeight: '600',
        color: '#94A3B8',
        fontStyle: 'italic',
        paddingVertical: 4,
    },
    tagChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#F1F5F9',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: BORDER,
    },
    tagText: { fontSize: 13, color: INK, fontWeight: '600' },
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
    searchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: '#F8FAFC',
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderWidth: 1,
        borderColor: '#EEF3FB',
        marginBottom: 8,
    },
    searchInput: { flex: 1, fontSize: 15, color: INK },
    searchResult: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
        gap: 12,
    },
    searchAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#E3ECFB' },
    searchName: { fontSize: 15, fontWeight: '700', color: INK },
    searchUsername: { fontSize: 12, color: '#94A3B8', marginTop: 2 },
    detailLabel: { fontSize: 12, fontWeight: '700', color: '#64748B', marginBottom: 8, marginTop: 12, textTransform: 'uppercase' },
    ageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    ageChip: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 12,
        backgroundColor: '#F8FAFC',
        borderWidth: 1,
        borderColor: '#E3ECFB',
    },
    ageChipActive: { backgroundColor: '#EFF6FF', borderColor: PRIMARY },
    ageChipText: { fontWeight: '700', color: MUTED },
    ageChipTextActive: { color: PRIMARY_DARK },
    genderRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    genderChipSm: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 12,
        backgroundColor: '#F8FAFC',
        borderWidth: 1,
        borderColor: '#E3ECFB',
    },
    genderChipSmActive: { backgroundColor: '#EFF6FF', borderColor: PRIMARY },
    genderChipSmText: { fontSize: 12, fontWeight: '700', color: MUTED },
    genderChipSmTextActive: { color: PRIMARY_DARK },
    habitRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    habitChip: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 12,
        backgroundColor: '#F8FAFC',
        borderWidth: 1,
        borderColor: '#E3ECFB',
    },
    habitChipActive: { backgroundColor: '#ECFDF5', borderColor: '#22C55E' },
    habitChipText: { fontWeight: '700', color: MUTED, fontSize: 13 },
    habitChipTextActive: { color: '#059669' },
    badgeRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        paddingVertical: 4,
        paddingRight: 4,
    },
});

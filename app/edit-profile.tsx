import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { CoverPresetPicker } from '../components/profile-ui/CoverPresetPicker';
import { GalleryThumb } from '../components/profile-ui/ProfileRedesign';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { ScreenHeader } from '../components/ScreenHeader';
import { PersonalityPickerModal } from '../features/profile/PersonalityPickerModal';
import { useAppTheme, useThemedStyles } from '../lib/appTheme';
import { getAuthUser } from '../lib/auth';
import { uploadAvatarFromUri } from '../lib/avatar';
import { rememberChromeAvatar } from '../lib/chromeAvatar';
import { useT } from '../lib/i18n';
import { Alert } from '../lib/nexoAlert';
import {
    MAX_ORGANIZER_GALLERY,
    ORGANIZER_DESC_MAX,
    ORGANIZER_DESC_MIN,
    ORGANIZER_INFO_MAX,
    ORGANIZER_INFO_MIN,
    organizerProfileCopy,
    parseOrganizerMeta,
    saveOrganizerMeta,
    updateOrganizerGallery,
    uploadOrganizerMedia,
    type OrganizerMedia,
    type OrganizerMeta,
} from '../lib/organizer';
import { invalidateAllPlanDetailCaches } from '../lib/planDetailCache';
import {
    DISPLAY_NAME_MAX_LENGTH,
    isValidDisplayName,
    loadProfileRow,
    normalizeDisplayName,
    resolveDisplayName,
    updateDisplayName,
    updateProfileFields,
} from '../lib/profile';
import { ORGANIZER_COVER_PRESETS, readCoverUrl, saveProfileCover, uploadCoverFromUri } from '../lib/profileCover';
import { getPersonalityLabel, mergePerfilGustosPrivacy, parsePrivacy, type Genero, type ProfilePrivacy } from '../lib/profileFields';
import { getInterestAccent, getInterestIcon, PERSONALITY_MAX } from '../lib/profileInterests';
import { invalidateProfilePresentationCaches } from '../lib/screenCaches';
import { theme, type ThemeColors } from '../theme';

const INK = theme.colors.text;
const PRIMARY_DARK = theme.colors.primary;

export default function EditProfileScreen() {
    const router = useRouter();
    const { t } = useT();
    const { colors } = useAppTheme();
    const styles = useThemedStyles(createEditProfileStyles);
    const [ready, setReady] = useState(false);
    const [saving, setSaving] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);
    const [isOrganizer, setIsOrganizer] = useState(false);
    const [organizerMeta, setOrganizerMeta] = useState<OrganizerMeta>({});
    const [nombre, setNombre] = useState('');
    const [aboutMe, setAboutMe] = useState('');
    const [organizerInfo, setOrganizerInfo] = useState('');
    const [organizerWeb, setOrganizerWeb] = useState('');
    const [organizerInstagram, setOrganizerInstagram] = useState('');
    const [organizerWhatsapp, setOrganizerWhatsapp] = useState('');
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [coverUrl, setCoverUrl] = useState<string | null>(null);
    const [coverPicking, setCoverPicking] = useState(false);
    const [aficiones, setAficiones] = useState<string[]>([]);
    const [genero, setGenero] = useState<Genero | null>(null);
    const [privacy, setPrivacy] = useState<ProfilePrivacy>(parsePrivacy(null));
    const [perfilGustos, setPerfilGustos] = useState<unknown>(null);
    const [showAficionModal, setShowAficionModal] = useState(false);
    const [galleryBusy, setGalleryBusy] = useState(false);
    const [avatarUploading, setAvatarUploading] = useState(false);

    const aboutMax = isOrganizer ? ORGANIZER_DESC_MAX : 400;
    const galleryItems = organizerMeta.galeria ?? [];
    const galleryMax = MAX_ORGANIZER_GALLERY;

    const load = useCallback(async () => {
        const user = await getAuthUser();
        if (!user) {
            router.replace('/login');
            return;
        }
        setUserId(user.id);
        const row = await loadProfileRow(user.id);
        const data = row.data;
        const org = parseOrganizerMeta(data?.organizador);
        setIsOrganizer(data?.es_organizador === true);
        setOrganizerMeta(org);
        setNombre(data?.nombre?.trim() || resolveDisplayName(user, t('profile.user')));
        if (data?.es_organizador) {
            const copy = organizerProfileCopy(data?.descripcion, org);
            setAboutMe(copy.description);
            setOrganizerInfo(copy.information);
        } else {
            setAboutMe(data?.descripcion ?? '');
            setOrganizerInfo('');
        }
        setOrganizerWeb(org.web ?? '');
        setOrganizerInstagram(org.instagram ?? '');
        setOrganizerWhatsapp(org.whatsapp ?? '');
        setAvatarUrl(data?.avatar_url ?? null);
        setCoverUrl(readCoverUrl(data));
        setAficiones(data?.ambientes_preferidos?.length ? data.ambientes_preferidos : data?.etiquetas ?? []);
        setGenero((data?.genero as Genero) || null);
        setPerfilGustos(data?.perfil_gustos ?? null);
        setPrivacy(parsePrivacy(data?.perfil_gustos));
        setReady(true);
    }, [router, t]);

    useFocusEffect(
        useCallback(() => {
            void load();
        }, [load]),
    );

    const pickAvatar = async (useCamera: boolean) => {
        if (!userId || avatarUploading) return;
        try {
            if (useCamera) {
                const current = await ImagePicker.getCameraPermissionsAsync();
                const cam = current.granted ? current : await ImagePicker.requestCameraPermissionsAsync();
                if (!cam.granted) {
                    Alert.alert(t('onboarding.notice'), t('onboarding.cameraPermission'));
                    return;
                }
            } else {
                const current = await ImagePicker.getMediaLibraryPermissionsAsync();
                const lib = current.granted ? current : await ImagePicker.requestMediaLibraryPermissionsAsync();
                if (!lib.granted) {
                    Alert.alert(t('onboarding.notice'), t('onboarding.galleryPermission'));
                    return;
                }
            }
            const result = useCamera
                ? await ImagePicker.launchCameraAsync({
                    mediaTypes: ['images'],
                    allowsEditing: Platform.OS === 'ios',
                    aspect: [1, 1],
                    quality: 0.4,
                })
                : await ImagePicker.launchImageLibraryAsync({
                    mediaTypes: ['images'],
                    allowsEditing: false,
                    quality: 0.55,
                });
            if (result.canceled || !result.assets[0]?.uri) return;
            const uri = result.assets[0].uri;
            setAvatarUrl(uri);
            setAvatarUploading(true);
            const { url, error } = await uploadAvatarFromUri(userId, uri);
            if (error || !url) throw new Error(error || 'upload_failed');
            setAvatarUrl(url);
            rememberChromeAvatar(userId, url);
            invalidateProfilePresentationCaches(userId);
            invalidateAllPlanDetailCaches();
        } catch {
            Alert.alert(t('profile.error'), t('onboarding.photoError'));
        } finally {
            setAvatarUploading(false);
        }
    };

    const persistPrivacy = (next: ProfilePrivacy) => {
        setPrivacy(next);
        const merged = mergePerfilGustosPrivacy(perfilGustos, next) as Record<string, unknown>;
        if (coverUrl) merged.cover_url = coverUrl;
        setPerfilGustos(merged);
        if (userId) void updateProfileFields(userId, { perfil_gustos: merged });
    };

    const addAficion = (tag: string) => {
        if (aficiones.includes(tag) || aficiones.length >= PERSONALITY_MAX) return;
        const updated = [...aficiones, tag];
        setAficiones(updated);
        if (userId) {
            void updateProfileFields(userId, { ambientes_preferidos: updated, etiquetas: updated });
            invalidateProfilePresentationCaches(userId);
            invalidateAllPlanDetailCaches();
        }
        setShowAficionModal(false);
    };

    const removeAficion = (tag: string) => {
        const updated = aficiones.filter((item) => item !== tag);
        setAficiones(updated);
        if (userId) {
            void updateProfileFields(userId, { ambientes_preferidos: updated, etiquetas: updated });
            invalidateProfilePresentationCaches(userId);
            invalidateAllPlanDetailCaches();
        }
    };

    const persistCover = (key: string) => {
        setCoverUrl(key);
        setOrganizerMeta((prev) => ({ ...prev, portada: key }));
        setPerfilGustos((prev) => {
            const base =
                prev && typeof prev === 'object'
                    ? { ...(prev as Record<string, unknown>) }
                    : {};
            return { ...base, cover_url: key };
        });
        if (!userId) return;
        void saveProfileCover(userId, key, {
            organizador: { ...organizerMeta, portada: key },
            perfilGustos: {
                ...((perfilGustos && typeof perfilGustos === 'object'
                    ? perfilGustos
                    : {}) as Record<string, unknown>),
                cover_url: key,
            },
        }).then(() => {
            invalidateProfilePresentationCaches(userId);
        });
    };

    const pickCoverFromGallery = async () => {
        if (!userId || coverPicking) return;
        const current = await ImagePicker.getMediaLibraryPermissionsAsync();
        const lib = current.granted ? current : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!lib.granted) {
            Alert.alert(t('onboarding.notice'), t('onboarding.galleryPermission'));
            return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: false,
            quality: 0.55,
        });
        if (result.canceled || !result.assets[0]?.uri) return;
        setCoverPicking(true);
        const { url, error } = await uploadCoverFromUri(userId, result.assets[0].uri, {
            organizador: { ...organizerMeta, portada: organizerMeta.portada },
            perfilGustos: {
                ...((perfilGustos && typeof perfilGustos === 'object'
                    ? perfilGustos
                    : {}) as Record<string, unknown>),
            },
        });
        setCoverPicking(false);
        if (error || !url) {
            Alert.alert(t('profile.error'), t('onboarding.photoError'));
            return;
        }
        persistCover(url);
    };

    const persistGallery = async (next: OrganizerMedia[]) => {
        if (!isOrganizer) return false;
        const { error } = await updateOrganizerGallery(next);
        if (error) {
            Alert.alert(t('profile.error'), t('organizer.mediaError'));
            return false;
        }
        setOrganizerMeta((prev) => ({ ...prev, galeria: next }));
        return true;
    };

    const addGalleryMedia = async () => {
        if (!isOrganizer || galleryBusy || galleryItems.length >= galleryMax || !userId) return;
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) return;
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images', 'videos'],
            allowsMultipleSelection: true,
            allowsEditing: false,
            selectionLimit: galleryMax - galleryItems.length,
            quality: 0.6,
            videoMaxDuration: 60,
        });
        if (result.canceled) return;
        setGalleryBusy(true);
        const uploaded: OrganizerMedia[] = [];
        let failed = 0;
        const assets = result.assets;
        const concurrency = 3;
        for (let i = 0; i < assets.length; i += concurrency) {
            const chunk = assets.slice(i, i + concurrency);
            const results = await Promise.all(
                chunk.map((asset) => {
                    const mime = (asset.mimeType ?? '').toLowerCase();
                    const uri = asset.uri.toLowerCase();
                    const kind: 'image' | 'video' =
                        asset.type === 'video'
                        || mime.startsWith('video/')
                        || (typeof asset.duration === 'number' && asset.duration > 0)
                        || /\.(mp4|mov|m4v|webm)$/.test(uri)
                            ? 'video'
                            : 'image';
                    return uploadOrganizerMedia(userId, asset.uri, kind, asset.mimeType);
                }),
            );
            for (const item of results) {
                if (item) uploaded.push(item);
                else failed += 1;
            }
        }
        setGalleryBusy(false);
        if (uploaded.length) await persistGallery([...galleryItems, ...uploaded].slice(0, galleryMax));
        if (failed) Alert.alert(t('profile.error'), t('organizer.mediaError'));
    };

    const save = async () => {
        if (!userId || saving) return;
        const trimmed = normalizeDisplayName(nombre);
        if (!isValidDisplayName(trimmed)) {
            Alert.alert(t('profile.error'), t('profile.displayNameHint'));
            return;
        }
        if (isOrganizer && aboutMe.trim().length < ORGANIZER_DESC_MIN) {
            Alert.alert(t('organizer.applyIncompleteTitle'), t('organizer.profileAboutRequired'));
            return;
        }
        if (isOrganizer && organizerInfo.trim().length < ORGANIZER_INFO_MIN) {
            Alert.alert(t('organizer.applyIncompleteTitle'), t('organizer.profileInfoRequired'));
            return;
        }
        setSaving(true);
        const gustos = mergePerfilGustosPrivacy(perfilGustos, privacy) as Record<string, unknown>;
        if (isOrganizer && coverUrl) gustos.cover_url = coverUrl;

        const uid = userId;
        const nextMeta: OrganizerMeta | null = isOrganizer
            ? {
                  ...organizerMeta,
                  web: organizerWeb.trim() || null,
                  instagram: organizerInstagram.trim().replace(/^@/, '') || null,
                  whatsapp: organizerWhatsapp.trim() || null,
                  informacion: organizerInfo.trim(),
                  portada: coverUrl || organizerMeta.portada,
              }
            : null;
        const about = aboutMe.trim();
        const name = trimmed;
        const cover = coverUrl;

        // Salir ya; persistir en segundo plano (antes el Save esperaba toda la red).
        setSaving(false);
        invalidateProfilePresentationCaches(uid);
        invalidateAllPlanDetailCaches();
        // Invalidar caches adicionales para actualización instantánea en toda la app
        cacheInvalidate(screenCacheKey.feedSnapshot);
        cacheInvalidate(screenCacheKey.friends(uid));
        router.back();

        void (async () => {
            try {
                if (isOrganizer && cover) {
                    const coverRes = await saveProfileCover(uid, cover, {
                        organizador: { ...(nextMeta ?? organizerMeta), portada: cover },
                        perfilGustos: gustos,
                    });
                    if (coverRes.error) {
                        Alert.alert(t('profile.error'), coverRes.error);
                        return;
                    }
                }
                if (nextMeta) {
                    const metaRes = await saveOrganizerMeta(uid, nextMeta);
                    if (metaRes.error) {
                        Alert.alert(t('profile.error'), metaRes.error);
                        return;
                    }
                }
                const nameRes = await updateDisplayName(uid, name);
                if (nameRes.error) {
                    Alert.alert(t('profile.error'), nameRes.error);
                    return;
                }
                const { error: aboutError } = await updateProfileFields(uid, {
                    descripcion: about,
                    perfil_gustos: gustos,
                });
                if (aboutError) {
                    Alert.alert(t('profile.error'), aboutError);
                }
            } catch {
                Alert.alert(t('profile.error'), t('createplan.saveError'));
            }
        })();
    };

    return (
        <View style={styles.root}>
            <LinearGradient colors={[colors.gradientTop, colors.gradientBottom]} style={StyleSheet.absoluteFill} />
            <SafeAreaView style={{ flex: 1 }} edges={['top']}>
                <ScreenHeader compact embedded title={t('settings.editProfile')} onBack={() => router.back()} />
                {!ready ? (
                    <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
                ) : (
                    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
                        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                            {isOrganizer ? (
                                <>
                                    <Text style={styles.label}>{t('organizer.fieldCover')}</Text>
                                    <CoverPresetPicker
                                        value={coverUrl}
                                        presets={ORGANIZER_COVER_PRESETS}
                                        wide
                                        pickingCustom={coverPicking}
                                        customPreviewUri={!coverUrl || coverUrl.startsWith('nexo_cover:') ? null : coverUrl}
                                        onPickCustom={() => void pickCoverFromGallery()}
                                        onSelect={persistCover}
                                        t={t}
                                    />
                                </>
                            ) : null}

                            <Text style={[styles.label, !isOrganizer && styles.labelFirst]}>{t('profile.photoTitle')}</Text>
                            <View style={styles.avatarWrap}>
                                <ProfileAvatar uri={avatarUrl} name={nombre} size={88} recyclingKey={userId ?? 'edit'} />
                                {avatarUploading ? <ActivityIndicator style={StyleSheet.absoluteFill} color={colors.primary} /> : null}
                            </View>
                            <View style={styles.photoActions}>
                                <TouchableOpacity
                                    style={styles.photoActionBtn}
                                    onPress={() => void pickAvatar(true)}
                                    disabled={avatarUploading}
                                    activeOpacity={0.85}
                                >
                                    <Ionicons name="camera" size={18} color={colors.primary} />
                                    <Text style={styles.photoActionText}>{t('profile.camera')}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={styles.photoActionBtn}
                                    onPress={() => void pickAvatar(false)}
                                    disabled={avatarUploading}
                                    activeOpacity={0.85}
                                >
                                    <Ionicons name="images" size={18} color={colors.primary} />
                                    <Text style={styles.photoActionText}>{t('profile.gallery')}</Text>
                                </TouchableOpacity>
                            </View>

                            <Text style={styles.label}>{t('profile.displayName')}</Text>
                            <TextInput
                                style={styles.input}
                                value={nombre}
                                onChangeText={(text) => setNombre(text.slice(0, DISPLAY_NAME_MAX_LENGTH))}
                                maxLength={DISPLAY_NAME_MAX_LENGTH}
                                autoCapitalize="words"
                            />

                            <Text style={styles.label}>
                                {isOrganizer ? t('organizer.fieldAbout') : t('profile.aboutMe')}
                            </Text>
                            <TextInput
                                style={[styles.input, styles.area]}
                                value={aboutMe}
                                onChangeText={(text) => setAboutMe(text.slice(0, aboutMax))}
                                multiline
                                maxLength={aboutMax}
                                placeholder={isOrganizer ? t('organizer.profileAboutPlaceholder') : t('profile.aboutPlaceholder')}
                                placeholderTextColor={colors.textSubtle}
                            />
                            <Text style={styles.counter}>{aboutMe.length}/{aboutMax}</Text>

                            {isOrganizer ? (
                                <>
                                    <Text style={styles.label}>{t('organizer.fieldWeb')}</Text>
                                    <TextInput
                                        style={styles.input}
                                        value={organizerWeb}
                                        onChangeText={setOrganizerWeb}
                                        autoCapitalize="none"
                                        keyboardType="url"
                                        placeholder="https://"
                                        placeholderTextColor={colors.textSubtle}
                                    />
                                    <Text style={styles.label}>{t('organizer.fieldInstagram')}</Text>
                                    <TextInput
                                        style={styles.input}
                                        value={organizerInstagram}
                                        onChangeText={setOrganizerInstagram}
                                        autoCapitalize="none"
                                        placeholder="@club"
                                        placeholderTextColor={colors.textSubtle}
                                    />
                                    <Text style={styles.label}>{t('organizer.fieldWhatsapp')}</Text>
                                    <TextInput
                                        style={styles.input}
                                        value={organizerWhatsapp}
                                        onChangeText={setOrganizerWhatsapp}
                                        autoCapitalize="none"
                                        keyboardType="url"
                                        placeholder={t('organizer.fieldWhatsappPlaceholder')}
                                        placeholderTextColor={colors.textSubtle}
                                    />
                                </>
                            ) : null}

                            {!isOrganizer ? (
                                <>
                                    <Text style={styles.label}>{t('userprofile.interests')}</Text>
                                    <View style={styles.interestRow}>
                                        {aficiones.map((tag) => {
                                            const accent = getInterestAccent(tag);
                                            return (
                                            <View key={tag} style={styles.interestTile}>
                                                <View
                                                    style={[
                                                        styles.interestIcon,
                                                        { backgroundColor: accent.bg, borderColor: accent.border },
                                                    ]}
                                                >
                                                    <Ionicons name={getInterestIcon(tag)} size={24} color={accent.icon} />
                                                    <Pressable
                                                        onPress={() => removeAficion(tag)}
                                                        hitSlop={8}
                                                        style={styles.interestX}
                                                    >
                                                        <Ionicons name="close" size={12} color="#FFF" />
                                                    </Pressable>
                                                </View>
                                                <Text style={styles.interestLabel} numberOfLines={1}>
                                                    {getPersonalityLabel(tag, genero, t)}
                                                </Text>
                                            </View>
                                            );
                                        })}
                                        {aficiones.length < PERSONALITY_MAX ? (
                                            <TouchableOpacity style={styles.interestTile} onPress={() => setShowAficionModal(true)}>
                                                <View style={styles.interestAdd}>
                                                    <Ionicons name="add" size={26} color={colors.primary} />
                                                </View>
                                                <Text style={styles.interestLabel}>{t('profile.addPersonality')}</Text>
                                            </TouchableOpacity>
                                        ) : null}
                                    </View>
                                    <Text style={styles.label}>{t('profilev.attendedPlansSelf')}</Text>
                                    <View style={styles.privacyRow}>
                                        <Text style={styles.privacyLabel}>{t('profile.showOnProfile')}</Text>
                                        <Switch
                                            value={privacy.mostrar_planes}
                                            onValueChange={(value) => persistPrivacy({ ...privacy, mostrar_planes: value })}
                                            trackColor={{ true: colors.primary, false: colors.borderStrong }}
                                            thumbColor="#FFF"
                                        />
                                    </View>
                                </>
                            ) : (
                                <>
                                    <View style={styles.momentsHead}>
                                        <Text style={styles.label}>{t('organizer.moments')}</Text>
                                        {galleryBusy ? <ActivityIndicator size="small" color={colors.primary} /> : (
                                            <Text style={styles.counter}>{galleryItems.length}/{galleryMax}</Text>
                                        )}
                                    </View>
                                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                                        {galleryItems.map((item) => (
                                            <View key={item.url} style={styles.moment}>
                                                <GalleryThumb item={item} size={88} />
                                                <Pressable style={styles.momentX} onPress={() => void persistGallery(galleryItems.filter((g) => g.url !== item.url))}>
                                                    <Ionicons name="close" size={12} color="#FFF" />
                                                </Pressable>
                                            </View>
                                        ))}
                                        {galleryItems.length < galleryMax ? (
                                            <Pressable style={styles.momentAdd} onPress={() => void addGalleryMedia()}>
                                                <Ionicons name="add" size={26} color={colors.primary} />
                                            </Pressable>
                                        ) : null}
                                    </ScrollView>
                                    <Text style={styles.label}>{t('organizer.fieldInfo')}</Text>
                                    <TextInput
                                        style={[styles.input, styles.areaTall]}
                                        value={organizerInfo}
                                        onChangeText={(text) => setOrganizerInfo(text.slice(0, ORGANIZER_INFO_MAX))}
                                        multiline
                                        maxLength={ORGANIZER_INFO_MAX}
                                        placeholder={t('organizer.profileInfoPlaceholder')}
                                        placeholderTextColor={colors.textSubtle}
                                    />
                                    <Text style={styles.counter}>{organizerInfo.length}/{ORGANIZER_INFO_MAX}</Text>
                                </>
                            )}

                            <TouchableOpacity style={styles.save} onPress={() => void save()} disabled={saving}>
                                {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveText}>{t('common.save')}</Text>}
                            </TouchableOpacity>
                        </ScrollView>
                    </KeyboardAvoidingView>
                )}
            </SafeAreaView>
            <PersonalityPickerModal
                visible={showAficionModal}
                selected={aficiones}
                genero={genero}
                onAdd={addAficion}
                onClose={() => setShowAficionModal(false)}
            />
        </View>
    );
}

function createEditProfileStyles(c: ThemeColors) {
    const INK = c.text;
    const PRIMARY_DARK = c.primary;
    return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.backgroundAlt },
    content: { paddingHorizontal: 20, paddingBottom: 40 },
    label: { color: INK, fontWeight: '800', fontSize: 13, marginBottom: 8, marginTop: 22 },
    labelFirst: { marginTop: 4 },
    input: {
        backgroundColor: c.surface,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: c.border,
        paddingHorizontal: 14,
        paddingVertical: 12,
        color: INK,
        fontSize: 15,
        fontWeight: '600',
    },
    area: { minHeight: 110, textAlignVertical: 'top' },
    areaTall: { minHeight: 168, textAlignVertical: 'top' },
    hint: { marginTop: 6, color: c.textSubtle, fontWeight: '600', fontSize: 12, lineHeight: 16 },
    counter: { marginTop: 6, color: c.textSubtle, fontWeight: '700', fontSize: 12 },
    userRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    at: { fontSize: 18, fontWeight: '800', color: INK },
    avatarWrap: { alignSelf: 'flex-start' },
    photoActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
    photoActionBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: c.primarySoft,
        borderWidth: 1.5,
        borderColor: c.primaryBorder,
        borderRadius: 14,
        paddingVertical: 12,
    },
    photoActionText: { fontSize: 14, fontWeight: '800', color: PRIMARY_DARK },
    linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
    linkBtnText: { color: PRIMARY_DARK, fontWeight: '800' },
    interestRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
    interestTile: { width: 82, alignItems: 'center', gap: 8 },
    interestIcon: {
        width: 72,
        height: 72,
        borderRadius: 22,
        backgroundColor: c.surfaceSubtle,
        borderWidth: 1.5,
        borderColor: c.border,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#0F2A4A',
        shadowOpacity: 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: 2,
    },
    interestX: {
        position: 'absolute',
        top: -4,
        right: -4,
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: 'rgba(15,23,42,0.72)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    interestAdd: {
        width: 72,
        height: 72,
        borderRadius: 22,
        borderWidth: 1.5,
        borderColor: c.primaryBorder,
        borderStyle: 'dashed',
        backgroundColor: c.primarySoft,
        alignItems: 'center',
        justifyContent: 'center',
    },
    interestLabel: { fontSize: 12, fontWeight: '800', color: INK, textAlign: 'center' },
    privacyRow: {
        backgroundColor: c.surface,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: c.border,
        paddingHorizontal: 14,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    privacyLabel: { flex: 1, color: INK, fontWeight: '700', fontSize: 14 },
    visRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
    visChip: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: c.surfaceSubtle,
        borderRadius: 12,
        paddingVertical: 10,
        paddingHorizontal: 6,
    },
    visChipOn: { backgroundColor: INK },
    visChipText: { color: c.textMuted, fontWeight: '800', fontSize: 12, textAlign: 'center' },
    visChipTextOn: { color: c.onPrimary },
    momentsHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
    moment: { width: 88, height: 88, borderRadius: 14, overflow: 'hidden' },
    momentImg: { width: 88, height: 88 },
    momentX: {
        position: 'absolute',
        top: 6,
        right: 6,
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: 'rgba(15,23,42,0.7)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    momentAdd: {
        width: 88,
        height: 88,
        borderRadius: 14,
        backgroundColor: c.primarySoft,
        alignItems: 'center',
        justifyContent: 'center',
    },
    save: {
        marginTop: 24,
        backgroundColor: PRIMARY_DARK,
        borderRadius: 16,
        minHeight: 50,
        alignItems: 'center',
        justifyContent: 'center',
    },
    saveText: { color: c.onPrimary, fontWeight: '800', fontSize: 16 },
    badgePickRow: { gap: 10, paddingVertical: 8, paddingRight: 12 },
    badgePick: {
        width: 92,
        alignItems: 'center',
        gap: 6,
        paddingVertical: 10,
        paddingHorizontal: 8,
        borderRadius: 16,
        backgroundColor: c.surface,
        borderWidth: 1.5,
        borderColor: c.border,
    },
    badgePickOn: { borderColor: c.primary, backgroundColor: c.primarySoft },
    badgePickName: { fontSize: 11, fontWeight: '700', color: c.textMuted, textAlign: 'center' },
    badgePickNameOn: { color: c.primary },
    });
}


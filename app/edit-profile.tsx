import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useNavigation, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { CoverPresetPicker } from '../components/profile-ui/CoverPresetPicker';
import { GalleryThumb } from '../components/profile-ui/ProfileRedesign';
import { AvatarCropModal } from '../components/AvatarCropModal';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { ScreenHeader } from '../components/ScreenHeader';
import { PersonalityPickerModal } from '../features/profile/PersonalityPickerModal';
import { holdAppUpdateReload } from '../lib/appUpdates';
import { useAppTheme, useThemedStyles } from '../lib/appTheme';
import { getAuthUser } from '../lib/auth';
import { uploadAvatarFromUri } from '../lib/avatar';
import { rememberChromeAvatar } from '../lib/chromeAvatar';
import {
    COUNTRY_FLAGS,
    countryCodeToFlagEmoji,
    mergePerfilGustosCountry,
    parseCountryCode,
} from '../lib/countryFlags';
import {
    hydrateEditProfileHints,
    markEditProfileHintsSeen,
    shouldShowEditProfileHints,
    subscribeEditProfileHints,
} from '../lib/editProfileHints';
import { useT } from '../lib/i18n';
import { getUserCoords } from '../lib/location';
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
import {
    getPersonalityLabel,
    mergePerfilGustosPrivacy,
    parsePrivacy,
    calcAge,
    isValidAge,
    type Genero,
    type ProfilePrivacy,
} from '../lib/profileFields';
import { getInterestAccent, getInterestIcon, PERSONALITY_MAX } from '../lib/profileInterests';
import {
    ensureAutoProfilePlace,
    formatProfilePlace,
    mergePerfilGustosPlace,
    parseProfilePlace,
    placesEqual,
    reverseGeocodePlace,
    setPerfilNacionalidad,
    setPerfilUbicacion,
    type ProfilePlace,
} from '../lib/profilePlace';
import { noteProfileOptimisticWrite, shouldPreferProfileCache } from '../lib/profileOptimistic';
import { subscribePlacePick } from '../lib/profilePlacePick';
import { configurePerfilGustosWriter, enqueuePerfilGustosWrite } from '../lib/perfilGustosWrite';
import { invalidateProfilePresentationCaches, screenCacheKey, ScreenCacheTTL } from '../lib/screenCaches';
import { theme, type ThemeColors } from '../theme';
import { cacheGetStale, cacheInvalidate, cacheInvalidatePrefix, cacheSet } from '../lib/ttlCache';
import type { ProfileUiSnapshot } from '../features/profile/types';

const INK = theme.colors.text;
const PRIMARY_DARK = theme.colors.primary;

export default function EditProfileScreen() {
    const router = useRouter();
    const navigation = useNavigation();
    const { t, lang } = useT();
    const { colors } = useAppTheme();
    const styles = useThemedStyles(createEditProfileStyles);
    const [ready, setReady] = useState(false);
    const [saving, setSaving] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);
    const [isOrganizer, setIsOrganizer] = useState(false);
    const [organizerMeta, setOrganizerMeta] = useState<OrganizerMeta>({});
    const [nombre, setNombre] = useState('');
    const [ageYears, setAgeYears] = useState(22);
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
    const [countryCode, setCountryCode] = useState<string | null>(null);
    const [place, setPlace] = useState<ProfilePlace | null>(null);
    const [showFlagPicker, setShowFlagPicker] = useState(false);
    const [placeLocating, setPlaceLocating] = useState(false);
    const [aboutEditing, setAboutEditing] = useState(false);
    const [showHints, setShowHints] = useState(() => shouldShowEditProfileHints());
    const [showAficionModal, setShowAficionModal] = useState(false);
    const [galleryBusy, setGalleryBusy] = useState(false);
    const [avatarUploading, setAvatarUploading] = useState(false);
    const [editingName, setEditingName] = useState(false);
    const [cropUri, setCropUri] = useState<string | null>(null);
    const [cropWidth, setCropWidth] = useState<number | null>(null);
    const [cropHeight, setCropHeight] = useState<number | null>(null);
    const scrollRef = useRef<ScrollView>(null);
    const aboutRef = useRef<TextInput>(null);
    const scrollYRef = useRef(0);
    const readyRef = useRef(false);
    const countryCodeRef = useRef<string | null>(null);
    /** Nacionalidad ya confirmada en servidor (los autosave de privacidad/ubi no escriben la UI pendiente). */
    const countryCodeSavedRef = useRef<string | null>(null);
    const placeRef = useRef<ProfilePlace | null>(null);
    /** Ubicación ya confirmada en servidor (misma idea que la bandera). */
    const placeSavedRef = useRef<ProfilePlace | null>(null);
    /** Pendiente de Guardar: load() no debe pisar con la BD. */
    const placeDirtyRef = useRef(false);
    const countryDirtyRef = useRef(false);
    const persistPlaceRef = useRef<(next: ProfilePlace | null) => void>(() => undefined);
    const allowLeaveRef = useRef(false);
    const baselineRef = useRef<{
        nombre: string;
        aboutMe: string;
        countryCode: string | null;
        place: ProfilePlace | null;
        organizerWeb: string;
        organizerInstagram: string;
        organizerWhatsapp: string;
        organizerInfo: string;
    } | null>(null);

    const aboutMax = isOrganizer ? ORGANIZER_DESC_MAX : 400;
    const galleryItems = organizerMeta.galeria ?? [];
    const galleryMax = MAX_ORGANIZER_GALLERY;

    const load = useCallback(async () => {
        const user = await getAuthUser();
        if (!user) {
            router.replace('/login');
            return;
        }
        if (shouldPreferProfileCache() && readyRef.current) {
            return;
        }
        setUserId(user.id);
        configurePerfilGustosWriter(user.id, async (gustos) => {
            // Autosave: solo nacionalidad/ubicación YA guardadas. Nunca pisar con valores pendientes.
            let sealed =
                countryCodeSavedRef.current != null
                    ? mergePerfilGustosCountry(gustos, countryCodeSavedRef.current)
                    : { ...gustos };
            if (placeSavedRef.current?.ciudad) {
                sealed = mergePerfilGustosPlace(sealed, placeSavedRef.current, { manual: true });
            }
            // Si placeSavedRef no tiene ciudad, no borres ubicacion del payload (evita race con RPC/GPS).
            const { error } = await updateProfileFields(user.id, { perfil_gustos: sealed });
            if (error) {
                Alert.alert(t('profile.error'), error);
                return;
            }
            noteProfileOptimisticWrite(20_000);
            cacheInvalidate(`userProfile:${user.id}`);
            cacheInvalidate(screenCacheKey.feedSnapshot);
            cacheInvalidatePrefix('planDetail:');
            // No invalidar profileUI mientras hay un edit optimista (p.ej. ubicación recién guardada).
            if (!shouldPreferProfileCache()) {
                invalidateProfilePresentationCaches(user.id);
            }
        });

        // Pintar ya desde caché de perfil (entrada instantánea).
        const stale = cacheGetStale<ProfileUiSnapshot>(screenCacheKey.profileUI(user.id));
        if (stale && stale.userId === user.id && !readyRef.current) {
            setIsOrganizer(stale.isOrganizer === true);
            setOrganizerMeta(stale.organizer ?? {});
            setNombre(stale.nombre);
            setAboutMe(stale.aboutMe);
            setAvatarUrl(stale.avatarUrl);
            setCoverUrl(stale.coverUrl ?? null);
            setAficiones(stale.aficiones);
            setGenero(stale.genero);
            setPerfilGustos(stale.perfilGustos);
            setPrivacy(stale.privacy);
            const cachedCountry = parseCountryCode(stale.perfilGustos);
            setCountryCode(cachedCountry);
            countryCodeRef.current = cachedCountry;
            countryCodeSavedRef.current = cachedCountry;
            const cachedPlace = parseProfilePlace(stale.perfilGustos);
            setPlace(cachedPlace);
            placeRef.current = cachedPlace;
            placeSavedRef.current = cachedPlace;
            if (stale.age && isValidAge(stale.age)) setAgeYears(stale.age);
            const org = stale.organizer ?? {};
            setOrganizerWeb(org.web ?? '');
            setOrganizerInstagram(org.instagram ?? '');
            setOrganizerWhatsapp(org.whatsapp ?? '');
            if (stale.isOrganizer) {
                const copy = organizerProfileCopy(stale.aboutMe, org);
                setOrganizerInfo(copy.information);
            }
            baselineRef.current = {
                nombre: stale.nombre.trim(),
                aboutMe: stale.aboutMe,
                countryCode: cachedCountry,
                place: cachedPlace,
                organizerWeb: org.web ?? '',
                organizerInstagram: org.instagram ?? '',
                organizerWhatsapp: org.whatsapp ?? '',
                organizerInfo: stale.isOrganizer
                    ? organizerProfileCopy(stale.aboutMe, org).information
                    : '',
            };
            allowLeaveRef.current = false;
            setReady(true);
            readyRef.current = true;
        }

        const row = await loadProfileRow(user.id);
        const data = row.data;
        const org = parseOrganizerMeta(data?.organizador);
        setIsOrganizer(data?.es_organizador === true);
        setOrganizerMeta(org);
        setNombre(data?.nombre?.trim() || resolveDisplayName(user, t('profile.user')));
        const loadedAge = calcAge(data?.fecha_nacimiento);
        setAgeYears(loadedAge && isValidAge(loadedAge) ? loadedAge : 22);
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
        const loadedCountry = parseCountryCode(data?.perfil_gustos);
        if (!countryDirtyRef.current) {
            setCountryCode(loadedCountry);
            countryCodeRef.current = loadedCountry;
            countryCodeSavedRef.current = loadedCountry;
        }
        const nextPlace = parseProfilePlace(data?.perfil_gustos);
        if (!placeDirtyRef.current) {
            setPlace(nextPlace);
            placeRef.current = nextPlace;
            placeSavedRef.current = nextPlace;
        }
        const effectiveCountry = countryDirtyRef.current ? countryCodeRef.current : loadedCountry;
        const effectivePlace = placeDirtyRef.current ? placeRef.current : nextPlace;
        const loadedAbout = data?.es_organizador
            ? organizerProfileCopy(data?.descripcion, org).description
            : (data?.descripcion ?? '');
        const loadedInfo = data?.es_organizador
            ? organizerProfileCopy(data?.descripcion, org).information
            : '';
        baselineRef.current = {
            nombre: (data?.nombre?.trim() || resolveDisplayName(user, t('profile.user'))).trim(),
            aboutMe: loadedAbout,
            countryCode: effectiveCountry,
            place: effectivePlace,
            organizerWeb: org.web ?? '',
            organizerInstagram: org.instagram ?? '',
            organizerWhatsapp: org.whatsapp ?? '',
            organizerInfo: loadedInfo,
        };
        allowLeaveRef.current = false;
        setReady(true);
        readyRef.current = true;

        // Auto-ubicación en segundo plano: no bloquea ni pisa la nacionalidad.
        if (!data?.es_organizador && !effectivePlace?.ciudad && !placeDirtyRef.current) {
            void ensureAutoProfilePlace(user.id).then((autoPlace) => {
                if (!autoPlace || shouldPreferProfileCache() || placeDirtyRef.current) return;
                setPlace((prev) => {
                    if (prev?.ciudad) return prev;
                    placeRef.current = autoPlace;
                    placeSavedRef.current = autoPlace;
                    return autoPlace;
                });
                setPerfilGustos((prev: Record<string, unknown> | null) => mergePerfilGustosPlace(prev, autoPlace));
                baselineRef.current = baselineRef.current
                    ? { ...baselineRef.current, place: autoPlace }
                    : baselineRef.current;
            });
        }
    }, [router, t]);

    useEffect(() => {
        void hydrateEditProfileHints().then(() => setShowHints(shouldShowEditProfileHints()));
        return subscribeEditProfileHints((seen) => setShowHints(!seen));
    }, []);

    useEffect(() => {
        return subscribePlacePick((next) => {
            noteProfileOptimisticWrite(12_000);
            persistPlaceRef.current(next);
        });
    }, []);

    const hasUnsavedChanges = useCallback(() => {
        const b = baselineRef.current;
        if (!b || !readyRef.current) return false;
        if (nombre.trim() !== b.nombre.trim()) return true;
        if (aboutMe !== b.aboutMe) return true;
        if ((countryCode || null) !== (b.countryCode || null)) return true;
        if (!placesEqual(place, b.place)) return true;
        if (isOrganizer) {
            if (organizerWeb.trim() !== (b.organizerWeb || '').trim()) return true;
            if (
                organizerInstagram.trim().replace(/^@/, '') !==
                (b.organizerInstagram || '').trim().replace(/^@/, '')
            ) {
                return true;
            }
            if (organizerWhatsapp.trim() !== (b.organizerWhatsapp || '').trim()) return true;
            if (organizerInfo !== b.organizerInfo) return true;
        }
        return false;
    }, [
        nombre,
        aboutMe,
        countryCode,
        place,
        isOrganizer,
        organizerWeb,
        organizerInstagram,
        organizerWhatsapp,
        organizerInfo,
    ]);

    useFocusEffect(
        useCallback(() => {
            void hydrateEditProfileHints().then(() => setShowHints(shouldShowEditProfileHints()));
            void load();
            return () => {
                void markEditProfileHintsSeen();
            };
        }, [load]),
    );

    const buildGustos = useCallback(
        (
            nextPrivacy: ProfilePrivacy = privacy,
            nextCountry: string | null = countryCodeRef.current,
            nextPlace: ProfilePlace | null = placeRef.current,
        ) => {
            let merged = mergePerfilGustosPrivacy(perfilGustos, nextPrivacy) as Record<string, unknown>;
            merged = mergePerfilGustosCountry(merged, nextCountry);
            // null no borra: los autosaves no deben vaciar ubicacion en BD.
            if (nextPlace?.ciudad) {
                merged = mergePerfilGustosPlace(merged, nextPlace, { manual: true });
            }
            if (coverUrl) merged.cover_url = coverUrl;
            return merged;
        },
        [perfilGustos, privacy, coverUrl],
    );

    const persistGustos = useCallback(
        (merged: Record<string, unknown>, patch?: Partial<ProfileUiSnapshot>) => {
            // Autosaves: nacionalidad/ubicación pendientes no se mezclan hasta Guardar.
            let withCountry =
                countryCodeSavedRef.current != null
                    ? mergePerfilGustosCountry(merged, countryCodeSavedRef.current)
                    : { ...merged };
            const withPlace =
                placeSavedRef.current?.ciudad
                    ? mergePerfilGustosPlace(withCountry, placeSavedRef.current, { manual: true })
                    : withCountry;
            setPerfilGustos(withPlace);
            if (!userId) return;
            const profileKey = screenCacheKey.profileUI(userId);
            const prevSnap = cacheGetStale<ProfileUiSnapshot>(profileKey);
            if (prevSnap) {
                cacheSet(
                    profileKey,
                    { ...prevSnap, perfilGustos: withPlace, ...patch },
                    ScreenCacheTTL.profileUI,
                );
            }
            noteProfileOptimisticWrite(20_000);
            enqueuePerfilGustosWrite(userId, withPlace);
        },
        [userId],
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
                    allowsEditing: false,
                    quality: 0.85,
                })
                : await ImagePicker.launchImageLibraryAsync({
                    mediaTypes: ['images'],
                    allowsEditing: false,
                    quality: 0.85,
                });
            if (result.canceled || !result.assets[0]?.uri) return;
            const asset = result.assets[0];
            setCropUri(asset.uri);
            setCropWidth(asset.width ?? null);
            setCropHeight(asset.height ?? null);
        } catch {
            Alert.alert(t('profile.error'), t('onboarding.photoError'));
        }
    };

    const uploadCroppedAvatar = async (uri: string) => {
        if (!userId || avatarUploading) return;
        setCropUri(null);
        setCropWidth(null);
        setCropHeight(null);
        try {
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
        noteProfileOptimisticWrite(12_000);
        setPrivacy(next);
        persistGustos(buildGustos(next, countryCodeSavedRef.current, placeSavedRef.current), {
            privacy: next,
        });
    };

    const persistCountry = (nextCode: string | null) => {
        noteProfileOptimisticWrite(15_000);
        countryDirtyRef.current = true;
        countryCodeRef.current = nextCode;
        setCountryCode(nextCode);
        setShowFlagPicker(false);
        if (nextCode && privacy.mostrar_nacionalidad === false) {
            const nextPrivacy = { ...privacy, mostrar_nacionalidad: true };
            setPrivacy(nextPrivacy);
            // No persiste la bandera aún; solo el toggle de privacidad con la bandera YA guardada.
            persistGustos(buildGustos(nextPrivacy, countryCodeSavedRef.current, placeSavedRef.current), {
                privacy: nextPrivacy,
            });
        }
    };

    const persistPlace = (nextPlace: ProfilePlace | null) => {
        // Solo UI hasta Guardar (como la nacionalidad).
        noteProfileOptimisticWrite(15_000);
        placeDirtyRef.current = true;
        placeRef.current = nextPlace;
        setPlace(nextPlace);
        if (nextPlace?.ciudad && privacy.mostrar_ubicacion === false) {
            const nextPrivacy = { ...privacy, mostrar_ubicacion: true };
            setPrivacy(nextPrivacy);
            persistGustos(buildGustos(nextPrivacy, countryCodeSavedRef.current, placeSavedRef.current), {
                privacy: nextPrivacy,
            });
        }
    };
    persistPlaceRef.current = persistPlace;

    const fillPlaceFromGps = async (): Promise<ProfilePlace | null> => {
        setPlaceLocating(true);
        try {
            const coords = await getUserCoords({ requestPermission: true, force: true });
            if (!coords) return null;
            return await reverseGeocodePlace(coords);
        } finally {
            setPlaceLocating(false);
        }
    };

    const onToggleLocation = async (value: boolean) => {
        if (!value) {
            persistPrivacy({ ...privacy, mostrar_ubicacion: false });
            return;
        }
        let nextPlace = placeRef.current;
        if (!nextPlace?.ciudad) {
            const geo = await fillPlaceFromGps();
            if (geo) {
                nextPlace = geo;
                placeRef.current = geo;
                setPlace(geo);
            }
        }
        const nextPrivacy = { ...privacy, mostrar_ubicacion: true };
        setPrivacy(nextPrivacy);
        // Toggle visible ya; la ciudad nueva (si la hay) espera a Guardar.
        persistGustos(buildGustos(nextPrivacy, countryCodeSavedRef.current, placeSavedRef.current), {
            privacy: nextPrivacy,
        });
    };

    const openPlacePicker = () => {
        router.push('/edit-profile-place' as Href);
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
        setPerfilGustos((prev: unknown) => {
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
        const gustos = (
            isOrganizer
                ? (() => {
                      const merged = mergePerfilGustosCountry(
                          mergePerfilGustosPrivacy(perfilGustos, privacy),
                          countryCodeRef.current,
                      ) as Record<string, unknown>;
                      if (coverUrl) merged.cover_url = coverUrl;
                      return merged;
                  })()
                : buildGustos(privacy, countryCodeRef.current, placeRef.current)
        ) as Record<string, unknown>;
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

        // Salir tras persistir ubi (evita carrera con auto-GPS); el resto en segundo plano.
        setSaving(false);
        const profileKey = screenCacheKey.profileUI(uid);
        const prevSnap = cacheGetStale<ProfileUiSnapshot>(profileKey);
        const nextCountry = countryCodeRef.current;
        const nextPlace = placeRef.current;
        countryCodeSavedRef.current = nextCountry;
        placeSavedRef.current = nextPlace;
        placeDirtyRef.current = false;
        countryDirtyRef.current = false;
        const sealedForCache = nextPlace?.ciudad
            ? mergePerfilGustosPlace(
                  mergePerfilGustosCountry(
                      (gustos && typeof gustos === 'object' ? { ...gustos } : {}) as Record<string, unknown>,
                      nextCountry,
                  ),
                  nextPlace,
                  { manual: true },
              )
            : mergePerfilGustosPlace(
                  mergePerfilGustosCountry(
                      (gustos && typeof gustos === 'object' ? { ...gustos } : {}) as Record<string, unknown>,
                      nextCountry,
                  ),
                  null,
                  { clear: true },
              );
        const nextPrivacy = nextPlace?.ciudad
            ? { ...privacy, mostrar_ubicacion: true }
            : privacy;
        if (nextPrivacy !== privacy) setPrivacy(nextPrivacy);
        const nextSnap: ProfileUiSnapshot = {
            ...(prevSnap ?? {
                userId: uid,
                nombre: name,
                nombreUsuario: null,
                aboutMe: about,
                avatarUrl: avatarUrl ?? null,
                coverUrl: cover ?? null,
                aficiones: aficiones,
                perfilGustos: sealedForCache,
                privacy: nextPrivacy,
                genero: genero,
                age: ageYears && isValidAge(ageYears) ? ageYears : null,
                habitoBebida: 'no_especificado' as const,
                habitoTabaco: 'no_especificado' as const,
                stats: {
                    valoracionMedia: 0,
                    porcentajeRepetiria: 0,
                    porcentajeAsistencia: 0,
                    numeroValoraciones: 0,
                    numeroEvaluadoresDistintos: 0,
                    numeroPlanesRealizados: 0,
                    numeroAmistades: 0,
                    aspectoPositivoMasVotado: null,
                    aspectoNegativoMasVotado: null,
                    numeroExpulsiones: 0,
                },
                friendsCount: 0,
                friendsNotifCount: 0,
                planRequests: 0,
                pendingRatings: [],
                badges: [],
                isOrganizer,
            }),
            nombre: name,
            aboutMe: about,
            avatarUrl: avatarUrl ?? prevSnap?.avatarUrl ?? null,
            coverUrl: cover ?? prevSnap?.coverUrl ?? null,
            aficiones: aficiones.length ? aficiones : (prevSnap?.aficiones ?? []),
            perfilGustos: sealedForCache,
            privacy: nextPrivacy,
            genero: genero ?? prevSnap?.genero ?? null,
            age: ageYears && isValidAge(ageYears) ? ageYears : (prevSnap?.age ?? null),
            organizer: nextMeta ?? prevSnap?.organizer,
            isOrganizer: isOrganizer || prevSnap?.isOrganizer === true,
        };
        cacheSet(profileKey, nextSnap, ScreenCacheTTL.profileUI);
        rememberChromeAvatar(uid, avatarUrl);
        // Ventana larga: el auto-GPS no debe pisar la ubi recién elegida.
        noteProfileOptimisticWrite(45_000);
        invalidateAllPlanDetailCaches();
        cacheInvalidate(screenCacheKey.feedSnapshot);
        cacheInvalidate(screenCacheKey.friends(uid));
        cacheInvalidate(`userProfile:${uid}`);
        allowLeaveRef.current = true;
        baselineRef.current = {
            nombre: name,
            aboutMe: about,
            countryCode: nextCountry,
            place: nextPlace,
            organizerWeb: organizerWeb.trim(),
            organizerInstagram: organizerInstagram.trim().replace(/^@/, ''),
            organizerWhatsapp: organizerWhatsapp.trim(),
            organizerInfo: organizerInfo,
        };

        // Guardar perfil no puede quedar a medias por un reinicio de OTA.
        const releaseUpdateHold = holdAppUpdateReload();
        try {
            const placeRes = await setPerfilUbicacion(nextPlace);
            if (placeRes.error) {
                Alert.alert(t('profile.error'), placeRes.error);
                releaseUpdateHold();
                return;
            }
        } catch {
            Alert.alert(t('profile.error'), t('createplan.saveError'));
            releaseUpdateHold();
            return;
        }

        // Reafirmar caché justo antes de volver (por si un autosave la invalidó).
        cacheSet(profileKey, nextSnap, ScreenCacheTTL.profileUI);
        noteProfileOptimisticWrite(45_000);
        router.back();

        void (async () => {
            try {
                const natRes = await setPerfilNacionalidad(nextCountry);
                if (natRes.error) {
                    Alert.alert(t('profile.error'), natRes.error);
                    return;
                }
                if (isOrganizer && cover) {
                    const coverRes = await saveProfileCover(uid, cover, {
                        organizador: { ...(nextMeta ?? organizerMeta), portada: cover },
                        perfilGustos: sealedForCache,
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
                enqueuePerfilGustosWrite(uid, sealedForCache);
                // Mantener la snap optimista tras el write en cola.
                cacheSet(profileKey, nextSnap, ScreenCacheTTL.profileUI);
                noteProfileOptimisticWrite(45_000);
                const { error: aboutError } = await updateProfileFields(uid, {
                    descripcion: about,
                });
                if (aboutError) {
                    Alert.alert(t('profile.error'), aboutError);
                }
            } catch {
                Alert.alert(t('profile.error'), t('createplan.saveError'));
            } finally {
                releaseUpdateHold();
            }
        })();
    };

    const saveRef = useRef(save);
    saveRef.current = save;

    useEffect(() => {
        const unsub = navigation.addListener('beforeRemove', (e) => {
            if (allowLeaveRef.current || !hasUnsavedChanges()) return;
            e.preventDefault();
            Alert.alert(t('profile.unsavedTitle'), t('profile.unsavedBody'), [
                {
                    text: t('profile.discardChanges'),
                    style: 'destructive',
                    onPress: () => {
                        placeDirtyRef.current = false;
                        countryDirtyRef.current = false;
                        allowLeaveRef.current = true;
                        navigation.dispatch(e.data.action);
                    },
                },
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('common.save'),
                    onPress: () => {
                        void saveRef.current();
                    },
                },
            ]);
        });
        return unsub;
    }, [navigation, hasUnsavedChanges, t]);

    return (
        <View style={styles.root}>
            <LinearGradient colors={[colors.gradientTop, colors.gradientBottom]} style={StyleSheet.absoluteFill} />
            <SafeAreaView style={{ flex: 1 }} edges={['top']}>
                <ScreenHeader compact embedded title={t('settings.editProfile')} onBack={() => router.back()} />
                {!ready ? (
                    <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
                ) : (
                    <KeyboardAvoidingView
                        behavior={undefined}
                        style={{ flex: 1 }}
                    >
                        <ScrollView
                            ref={scrollRef}
                            contentContainerStyle={styles.content}
                            keyboardShouldPersistTaps="handled"
                            keyboardDismissMode="on-drag"
                            onScroll={(e) => {
                                scrollYRef.current = e.nativeEvent.contentOffset.y;
                            }}
                            scrollEventThrottle={16}
                        >
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

                            <TouchableOpacity
                                style={[styles.avatarWrap, !isOrganizer && styles.avatarWrapFirst]}
                                onPress={() => {
                                    Alert.alert(t('profile.photoTitle'), undefined, [
                                        {
                                            text: t('profile.camera'),
                                            onPress: () => {
                                                void pickAvatar(true);
                                            },
                                        },
                                        {
                                            text: t('profile.gallery'),
                                            onPress: () => {
                                                void pickAvatar(false);
                                            },
                                        },
                                        { text: t('common.cancel'), style: 'cancel' },
                                    ]);
                                }}
                                activeOpacity={0.88}
                                disabled={avatarUploading}
                            >
                                <ProfileAvatar uri={avatarUrl} name={nombre} size={176} recyclingKey={userId ?? 'edit'} />
                                {avatarUploading ? (
                                    <ActivityIndicator style={StyleSheet.absoluteFill} color={colors.primary} />
                                ) : (
                                    <View style={styles.avatarEditBadge}>
                                        <Ionicons name="camera" size={16} color="#FFF" />
                                    </View>
                                )}
                            </TouchableOpacity>

                            <View style={styles.nameEditBlock}>
                                {editingName ? (
                                    <TextInput
                                        style={styles.nameInput}
                                        value={nombre}
                                        onChangeText={(text) => setNombre(text.slice(0, DISPLAY_NAME_MAX_LENGTH))}
                                        maxLength={DISPLAY_NAME_MAX_LENGTH}
                                        autoCapitalize="words"
                                        autoFocus
                                        onBlur={() => setEditingName(false)}
                                        onSubmitEditing={() => setEditingName(false)}
                                        returnKeyType="done"
                                    />
                                ) : (
                                    <Text style={styles.nameDisplay} numberOfLines={1}>
                                        {nombre || t('profile.user')}
                                    </Text>
                                )}
                                <TouchableOpacity
                                    style={styles.namePencilBtn}
                                    onPress={() => setEditingName((v) => !v)}
                                    activeOpacity={0.85}
                                    hitSlop={8}
                                    accessibilityLabel={t('profile.displayName')}
                                >
                                    <Ionicons name="brush" size={18} color={PRIMARY_DARK} />
                                </TouchableOpacity>
                            </View>

                            <View style={[styles.labelAfterHero, styles.fieldTitleRow]}>
                                <Text style={styles.label}>
                                    {isOrganizer ? t('organizer.fieldAbout') : t('profile.aboutMe')}
                                </Text>
                                {!isOrganizer && showHints ? <View style={styles.hintDot} /> : null}
                            </View>
                            {aboutEditing ? (
                                <TextInput
                                    ref={aboutRef}
                                    style={[styles.input, styles.area]}
                                    value={aboutMe}
                                    onChangeText={(text) => setAboutMe(text.slice(0, aboutMax))}
                                    multiline
                                    maxLength={aboutMax}
                                    autoFocus
                                    onBlur={() => setAboutEditing(false)}
                                    placeholder={isOrganizer ? t('organizer.profileAboutPlaceholder') : t('profile.aboutPlaceholder')}
                                    placeholderTextColor={colors.textSubtle}
                                />
                            ) : (
                                <Pressable
                                    onPress={() => setAboutEditing(true)}
                                    style={[styles.input, styles.area, styles.aboutTapTarget]}
                                >
                                    <Text
                                        style={aboutMe.trim() ? styles.aboutFilledText : styles.aboutPlaceholderText}
                                    >
                                        {aboutMe.trim()
                                            || (isOrganizer
                                                ? t('organizer.profileAboutPlaceholder')
                                                : t('profile.aboutPlaceholder'))}
                                    </Text>
                                </Pressable>
                            )}
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
                                    <View style={styles.interestSection}>
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
                                    </View>

                                    <View style={styles.fieldCard}>
                                        <TouchableOpacity
                                            style={styles.fieldMain}
                                            onPress={openPlacePicker}
                                            activeOpacity={0.85}
                                            accessibilityLabel={t('profile.location')}
                                        >
                                            <Ionicons
                                                name="location-outline"
                                                size={28}
                                                color={place ? colors.primary : colors.textSubtle}
                                            />
                                            <View style={styles.fieldTextCol}>
                                                <Text style={styles.fieldTitle}>{t('profile.location')}</Text>
                                                <Text style={styles.fieldSub} numberOfLines={1}>
                                                    {formatProfilePlace(place) || t('profile.pickCity')}
                                                </Text>
                                            </View>
                                            <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
                                        </TouchableOpacity>
                                        <Switch
                                            value={privacy.mostrar_ubicacion}
                                            onValueChange={(value) => void onToggleLocation(value)}
                                            trackColor={{ true: colors.primary, false: colors.borderStrong }}
                                            thumbColor="#FFF"
                                        />
                                    </View>

                                    <View style={styles.fieldCard}>
                                        <TouchableOpacity
                                            style={styles.fieldMain}
                                            onPress={() => setShowFlagPicker(true)}
                                            activeOpacity={0.85}
                                            accessibilityLabel={t('profile.nationality')}
                                        >
                                            {countryCodeToFlagEmoji(countryCode) ? (
                                                <Text style={styles.flagEmoji}>{countryCodeToFlagEmoji(countryCode)}</Text>
                                            ) : (
                                                <Ionicons name="flag-outline" size={28} color={colors.textSubtle} />
                                            )}
                                            <View style={styles.fieldTextCol}>
                                                <View style={styles.fieldTitleRow}>
                                                    <Text style={styles.fieldTitle}>{t('profile.nationality')}</Text>
                                                    {showHints ? <View style={styles.hintDot} /> : null}
                                                </View>
                                                <Text style={styles.fieldSub} numberOfLines={1}>
                                                    {(() => {
                                                        const country = COUNTRY_FLAGS.find((c) => c.code === countryCode);
                                                        if (!country) return t('profile.nationalityHint');
                                                        return lang === 'en' ? country.nameEn : country.nameEs;
                                                    })()}
                                                </Text>
                                            </View>
                                            <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
                                        </TouchableOpacity>
                                        <Switch
                                            value={privacy.mostrar_nacionalidad}
                                            onValueChange={(value) =>
                                                persistPrivacy({ ...privacy, mostrar_nacionalidad: value })
                                            }
                                            trackColor={{ true: colors.primary, false: colors.borderStrong }}
                                            thumbColor="#FFF"
                                        />
                                    </View>

                                    <View style={styles.privacyRow}>
                                        <View style={styles.privacyCopy}>
                                            <Text style={styles.fieldTitle}>{t('profile.age')}</Text>
                                            <Text style={styles.ageValueInline}>{ageYears}</Text>
                                        </View>
                                        <Switch
                                            value={privacy.mostrar_edad}
                                            onValueChange={(value) => persistPrivacy({ ...privacy, mostrar_edad: value })}
                                            trackColor={{ true: colors.primary, false: colors.borderStrong }}
                                            thumbColor="#FFF"
                                        />
                                    </View>

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
            <AvatarCropModal
                visible={!!cropUri}
                uri={cropUri}
                imageWidth={cropWidth}
                imageHeight={cropHeight}
                onCancel={() => {
                    setCropUri(null);
                    setCropWidth(null);
                    setCropHeight(null);
                }}
                onConfirm={(cropped) => {
                    void uploadCroppedAvatar(cropped);
                }}
            />
            <Modal
                visible={showFlagPicker}
                transparent
                animationType="fade"
                onRequestClose={() => setShowFlagPicker(false)}
            >
                <View style={styles.flagModalOverlay}>
                    <Pressable style={styles.flagModalBackdrop} onPress={() => setShowFlagPicker(false)} />
                    <View style={[styles.flagModalSheet, styles.flagModalSheetTall]}>
                        <Text style={styles.flagModalTitle}>{t('profile.nationality')}</Text>
                        <ScrollView
                            style={styles.flagModalScrollTall}
                            contentContainerStyle={styles.flagModalList}
                            showsVerticalScrollIndicator={false}
                        >
                            <TouchableOpacity
                                style={[styles.flagPickRow, !countryCode && styles.flagPickRowOn]}
                                onPress={() => persistCountry(null)}
                                activeOpacity={0.85}
                            >
                                <View style={styles.flagPickEmptyIcon}>
                                    <Ionicons name="close" size={16} color={colors.textSubtle} />
                                </View>
                                <Text style={styles.flagPickRowName} numberOfLines={1}>
                                    {t('profile.flagNone')}
                                </Text>
                            </TouchableOpacity>
                            {COUNTRY_FLAGS.map((country) => {
                                const active = countryCode === country.code;
                                const emoji = countryCodeToFlagEmoji(country.code);
                                return (
                                    <TouchableOpacity
                                        key={country.code}
                                        style={[styles.flagPickRow, active && styles.flagPickRowOn]}
                                        onPress={() => persistCountry(country.code)}
                                        activeOpacity={0.85}
                                    >
                                        <Text style={styles.flagPickRowEmoji}>{emoji}</Text>
                                        <Text style={styles.flagPickRowName} numberOfLines={1}>
                                            {lang === 'en' ? country.nameEn : country.nameEs}
                                        </Text>
                                        {active ? (
                                            <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                                        ) : null}
                                    </TouchableOpacity>
                                );
                            })}
                        </ScrollView>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

function createEditProfileStyles(c: ThemeColors) {
    const INK = c.text;
    const PRIMARY_DARK = c.primary;
    return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.backgroundAlt },
    content: { paddingHorizontal: 20, paddingBottom: 96 },
    label: { color: INK, fontWeight: '800', fontSize: 13, marginBottom: 8, marginTop: 22 },
    labelFirst: { marginTop: 4 },
    labelAfterHero: { marginTop: 28 },
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
    avatarWrap: { alignSelf: 'center', marginTop: 12 },
    avatarWrapFirst: { marginTop: 8 },
    avatarEditBadge: {
        position: 'absolute',
        right: 6,
        bottom: 6,
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: PRIMARY_DARK,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: '#FFF',
    },
    nameEditBlock: {
        marginTop: 16,
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        minHeight: 44,
        paddingHorizontal: 52,
    },
    nameDisplay: {
        fontSize: 26,
        fontWeight: '800',
        color: INK,
        letterSpacing: -0.4,
        textAlign: 'center',
        width: '100%',
    },
    nameInput: {
        width: '100%',
        backgroundColor: c.surface,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: c.border,
        paddingHorizontal: 14,
        paddingVertical: 10,
        color: INK,
        fontSize: 22,
        fontWeight: '800',
        textAlign: 'center',
    },
    namePencilBtn: {
        position: 'absolute',
        right: 8,
        top: '50%',
        marginTop: -20,
        width: 40,
        height: 40,
        borderRadius: 14,
        backgroundColor: c.primarySoft,
        borderWidth: 1,
        borderColor: c.primaryBorder,
        alignItems: 'center',
        justifyContent: 'center',
    },
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
    interestSection: { marginTop: 22 },
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
    fieldCard: {
        marginTop: 16,
        backgroundColor: c.surface,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: c.border,
        paddingHorizontal: 12,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    fieldMain: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minWidth: 0,
    },
    fieldTextCol: { flex: 1, minWidth: 0, gap: 2 },
    fieldTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    fieldTitle: { color: INK, fontWeight: '800', fontSize: 14 },
    fieldSub: { color: c.textMuted, fontWeight: '600', fontSize: 13 },
    privacyCopy: { flex: 1, gap: 2, minWidth: 0 },
    ageValueInline: {
        fontSize: 20,
        fontWeight: '800',
        color: INK,
        letterSpacing: -0.4,
    },
    hintDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: '#EF4444',
        borderWidth: 2,
        borderColor: '#FFF',
    },
    flagEmoji: {
        fontSize: 30,
        lineHeight: 34,
    },
    placeModalSheet: {
        paddingBottom: Math.max(28, 36),
        maxHeight: '78%',
    },
    cityResultsScroll: {
        marginTop: 12,
        maxHeight: 280,
    },
    citySearchStatus: {
        marginTop: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    citySearchHint: {
        color: c.textMuted,
        fontWeight: '600',
        fontSize: 13,
    },
    citySearchEmpty: {
        marginTop: 12,
        color: c.textMuted,
        fontWeight: '600',
        fontSize: 13,
    },
    cityResultCountry: {
        marginTop: 2,
        color: c.textMuted,
        fontWeight: '600',
        fontSize: 12,
    },
    aboutTapTarget: {
        justifyContent: 'flex-start',
    },
    aboutFilledText: {
        color: INK,
        fontSize: 15,
        fontWeight: '600',
        lineHeight: 22,
    },
    aboutPlaceholderText: {
        color: c.textSubtle,
        fontSize: 15,
        fontWeight: '600',
        lineHeight: 22,
    },
    placeGpsBtn: {
        marginTop: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        minHeight: 44,
        borderRadius: 14,
        borderWidth: 1.5,
        borderColor: c.primaryBorder,
        backgroundColor: c.primarySoft,
    },
    placeGpsText: { color: PRIMARY_DARK, fontWeight: '800', fontSize: 14 },
    flagModalOverlay: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    flagModalBackdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: c.overlay,
    },
    flagModalSheet: {
        backgroundColor: c.surface,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        maxHeight: '72%',
        paddingTop: 16,
        paddingHorizontal: 16,
    },
    flagModalSheetTall: {
        maxHeight: '92%',
        minHeight: '78%',
        paddingBottom: 28,
    },
    flagModalTitle: {
        fontSize: 17,
        fontWeight: '800',
        color: INK,
        marginBottom: 12,
        textAlign: 'center',
    },
    flagModalScroll: {
        maxHeight: 420,
    },
    flagModalScrollTall: {
        flex: 1,
    },
    flagModalList: {
        gap: 8,
        paddingBottom: 12,
    },
    flagPickRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderRadius: 14,
        backgroundColor: c.backgroundAlt,
        borderWidth: 1.5,
        borderColor: c.border,
    },
    flagPickRowOn: {
        borderColor: c.primary,
        backgroundColor: c.primarySoft,
    },
    flagPickRowEmoji: {
        fontSize: 26,
        lineHeight: 32,
        width: 36,
        textAlign: 'center',
    },
    flagPickEmptyIcon: {
        width: 36,
        height: 36,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: c.surfaceSubtle,
    },
    flagPickRowName: {
        flex: 1,
        fontSize: 15,
        fontWeight: '700',
        color: INK,
    },
    privacyRow: {
        marginTop: 22,
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


import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Dimensions,
    Keyboard,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
    type KeyboardEvent,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Alert } from '../lib/nexoAlert';
import { ScreenHeader } from '../components/ScreenHeader';
import { CoverPresetPicker } from '../components/profile-ui/CoverPresetPicker';
import { getAuthUser } from '../lib/auth';
import { getMyProfile } from '../lib/profileData';
import {
    ORGANIZER_DESC_MAX,
    ORGANIZER_DESC_MIN,
    ORGANIZER_INFO_MAX,
    ORGANIZER_INFO_MIN,
    ORGANIZER_TYPES,
    submitOrganizerRequest,
    getMyOrganizerRequest,
    uploadPendingOrganizerLogo,
    uploadPendingOrganizerCover,
    type OrganizerType,
} from '../lib/organizer';
import { coverPresetKey, ORGANIZER_COVER_PRESETS } from '../lib/profileCover';
import { hapticSuccess } from '../lib/haptics';
import { useT } from '../lib/i18n';
import { theme } from '../theme';

const INK = theme.colors.text;
const PRIMARY_DARK = theme.colors.primary;

function resolveTipo(cats: string[]): OrganizerType {
    const found = cats.find((code): code is OrganizerType =>
        (ORGANIZER_TYPES as readonly string[]).includes(code),
    );
    if (found) return found;
    return 'leisure';
}

export default function OrganizerApplyScreen() {
    const router = useRouter();
    const { t } = useT();
    const insets = useSafeAreaInsets();
    const scrollRef = useRef<ScrollView>(null);
    const aboutRef = useRef<TextInput>(null);
    const infoRef = useRef<TextInput>(null);
    const focusedFieldRef = useRef<TextInput | null>(null);
    const scrollYRef = useRef(0);
    const keyboardHeightRef = useRef(0);
    const [keyboardPad, setKeyboardPad] = useState(0);
    const [ready, setReady] = useState(false);
    const [isOrganizer, setIsOrganizer] = useState(false);
    const [pending, setPending] = useState(false);
    const [sending, setSending] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);
    const [nombre, setNombre] = useState('');
    const [categorias, setCategorias] = useState<string[]>(['community']);
    const [web, setWeb] = useState('');
    const [instagram, setInstagram] = useState('');
    const [whatsapp, setWhatsapp] = useState('');
    const [descripcion, setDescripcion] = useState('');
    const [informacion, setInformacion] = useState('');
    const [coverKey, setCoverKey] = useState(coverPresetKey('running_4'));
    const [coverPreviewUri, setCoverPreviewUri] = useState<string | null>(null);
    const [uploadingCover, setUploadingCover] = useState(false);
    const [avatarUri, setAvatarUri] = useState<string | null>(null);
    const [pendingLogoUrl, setPendingLogoUrl] = useState<string | null>(null);
    const [uploadingPhoto, setUploadingPhoto] = useState(false);

    useFocusEffect(
        useCallback(() => {
            let alive = true;
            void (async () => {
                const [profile, request, user] = await Promise.all([
                    getMyProfile(),
                    getMyOrganizerRequest(),
                    getAuthUser(),
                ]);
                if (!alive) return;
                setUserId(user?.id ?? profile.data?.id ?? null);
                setIsOrganizer(profile.data?.es_organizador === true);
                setPending(request?.estado === 'pendiente');
                if (profile.data?.nombre) setNombre((prev) => prev || profile.data!.nombre || '');
                setReady(true);
            })();
            return () => {
                alive = false;
            };
        }, []),
    );

    /** Sube solo lo justo para dejar el recuadro justo encima del teclado. */
    const ensureAboveKeyboard = (input: TextInput | null) => {
        if (!input) return;
        // Android (resize): la ventana ya se encoge. iOS: el teclado tapa y hay que restar.
        const kb = Platform.OS === 'ios' ? keyboardHeightRef.current : 0;
        input.measureInWindow((_x, y, _w, h) => {
            const winH = Dimensions.get('window').height;
            const gap = 12;
            const fieldBottom = y + h;
            const visibleBottom = winH - kb - gap;
            const overlap = fieldBottom - visibleBottom;
            if (overlap > 4) {
                scrollRef.current?.scrollTo({
                    y: Math.max(0, scrollYRef.current + overlap),
                    animated: true,
                });
            }
        });
    };

    useEffect(() => {
        const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
        const onShow = (e: KeyboardEvent) => {
            const h = e.endCoordinates.height;
            keyboardHeightRef.current = h;
            // Solo iOS necesita padding extra para poder hacer scroll por encima del teclado.
            setKeyboardPad(Platform.OS === 'ios' ? h : 24);
            setTimeout(() => {
                ensureAboveKeyboard(focusedFieldRef.current);
            }, Platform.OS === 'ios' ? 50 : 100);
        };
        const onHide = () => {
            keyboardHeightRef.current = 0;
            setKeyboardPad(0);
            focusedFieldRef.current = null;
        };
        const showSub = Keyboard.addListener(showEvt, onShow);
        const hideSub = Keyboard.addListener(hideEvt, onHide);
        return () => {
            showSub.remove();
            hideSub.remove();
        };
    }, []);

    const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        scrollYRef.current = e.nativeEvent.contentOffset.y;
    };

    const pickLogo = async () => {
        const lib = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!lib.granted) {
            Alert.alert(t('onboarding.notice'), t('onboarding.galleryPermission'));
            return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.55,
        });
        if (result.canceled || !result.assets[0]?.uri || !userId) return;
        const localUri = result.assets[0].uri;
        setAvatarUri(localUri);
        setUploadingPhoto(true);
        const { url, error } = await uploadPendingOrganizerLogo(userId, localUri);
        setUploadingPhoto(false);
        if (error || !url) {
            Alert.alert(t('profile.error'), t('onboarding.photoError'));
            setAvatarUri(null);
            setPendingLogoUrl(null);
            return;
        }
        setPendingLogoUrl(url);
    };

    const pickCover = async () => {
        const lib = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!lib.granted) {
            Alert.alert(t('onboarding.notice'), t('onboarding.galleryPermission'));
            return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [2, 1],
            quality: 0.55,
        });
        if (result.canceled || !result.assets[0]?.uri || !userId) return;
        const localUri = result.assets[0].uri;
        setCoverPreviewUri(localUri);
        setUploadingCover(true);
        const { url, error } = await uploadPendingOrganizerCover(userId, localUri);
        setUploadingCover(false);
        if (error || !url) {
            Alert.alert(t('profile.error'), t('onboarding.photoError'));
            setCoverPreviewUri(null);
            return;
        }
        setCoverKey(url);
    };

    const collectMissing = (): string[] => {
        const missing: string[] = [];
        if (nombre.trim().length < 2) missing.push(t('organizer.fieldName'));
        if (uploadingPhoto) missing.push(t('organizer.applyPhotoUploading'));
        else if (!pendingLogoUrl) missing.push(t('organizer.fieldPhoto'));
        if (uploadingCover) missing.push(t('organizer.applyCoverUploading'));
        else if (!coverKey.trim()) missing.push(t('organizer.fieldCover'));
        if (descripcion.trim().length < ORGANIZER_DESC_MIN) {
            missing.push(t('organizer.applyNeedAbout', { min: ORGANIZER_DESC_MIN }));
        }
        if (informacion.trim().length < ORGANIZER_INFO_MIN) {
            missing.push(t('organizer.applyNeedInfo', { min: ORGANIZER_INFO_MIN }));
        }
        return missing;
    };

    const submit = async () => {
        if (sending) return;
        let logoUrl = pendingLogoUrl;
        if (!logoUrl && avatarUri && userId && !uploadingPhoto) {
            setUploadingPhoto(true);
            const { url, error } = await uploadPendingOrganizerLogo(userId, avatarUri);
            setUploadingPhoto(false);
            if (!error && url) {
                logoUrl = url;
                setPendingLogoUrl(url);
            }
        }
        const missing = collectMissing();
        if (logoUrl) {
            const photoIdx = missing.findIndex(
                (m) => m === t('organizer.fieldPhoto') || m === t('organizer.applyPhotoUploading'),
            );
            if (photoIdx >= 0) missing.splice(photoIdx, 1);
        }
        if (missing.length > 0) {
            Alert.alert(t('organizer.applyIncompleteTitle'), missing.map((m) => `· ${m}`).join('\n'));
            return;
        }
        if (!logoUrl) {
            Alert.alert(t('organizer.applyIncompleteTitle'), `· ${t('organizer.fieldPhoto')}`);
            return;
        }
        setSending(true);
        const { error } = await submitOrganizerRequest({
            nombre,
            tipo: resolveTipo(categorias),
            ciudad: '',
            web,
            instagram,
            whatsapp,
            descripcion,
            informacion,
            coverUrl: coverKey,
            logoUrl,
            categorias,
        });
        setSending(false);
        if (error) {
            Alert.alert(t('organizer.applyError'), t('organizer.applyErrorBody'));
            return;
        }
        hapticSuccess();
        setPending(true);
        Alert.alert(t('organizer.applySentTitle'), t('organizer.applySentBody'));
    };

    return (
        <View style={styles.container}>
            <LinearGradient colors={['#DBEAFE', theme.colors.backgroundAlt]} style={StyleSheet.absoluteFill} />
            <ScreenHeader title={t('organizer.applyTitle')} onBack={() => router.back()} />
            {!ready ? (
                <ActivityIndicator color={PRIMARY_DARK} style={{ marginTop: 40 }} />
            ) : isOrganizer ? (
                <View style={styles.center}>
                    <Ionicons name="checkmark-circle" size={42} color={theme.colors.success} />
                    <Text style={styles.centerTitle}>{t('organizer.alreadyTitle')}</Text>
                    <Text style={styles.centerBody}>{t('organizer.alreadyBody')}</Text>
                </View>
            ) : pending ? (
                <View style={styles.center}>
                    <Ionicons name="time" size={42} color={PRIMARY_DARK} />
                    <Text style={styles.centerTitle}>{t('organizer.pendingTitle')}</Text>
                    <Text style={styles.centerBody}>{t('organizer.pendingBody')}</Text>
                </View>
            ) : (
                <ScrollView
                    ref={scrollRef}
                    contentContainerStyle={[
                        styles.content,
                        { paddingBottom: 40 + insets.bottom + 24 + keyboardPad },
                    ]}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="interactive"
                    showsVerticalScrollIndicator={false}
                    onScroll={onScroll}
                    scrollEventThrottle={16}
                >
                    <Text style={styles.lead}>{t('organizer.applyLead')}</Text>
                    <Text style={styles.label}>{t('organizer.fieldName')}</Text>
                    <TextInput
                        style={styles.input}
                        value={nombre}
                        onChangeText={setNombre}
                        maxLength={80}
                    />
                    <Text style={styles.label}>{t('organizer.fieldPhoto')}</Text>
                    <TouchableOpacity style={styles.photoBtn} onPress={() => void pickLogo()} activeOpacity={0.88}>
                        {uploadingPhoto ? (
                            <ActivityIndicator color={PRIMARY_DARK} />
                        ) : avatarUri ? (
                            <Image source={{ uri: avatarUri }} style={styles.photo} />
                        ) : (
                            <View style={styles.photoPlaceholder}>
                                <Ionicons name="image-outline" size={28} color={PRIMARY_DARK} />
                                <Text style={styles.photoHint}>{t('onboarding.addPhoto')}</Text>
                            </View>
                        )}
                    </TouchableOpacity>
                    <Text style={styles.label}>{t('organizer.fieldCover')}</Text>
                    <CoverPresetPicker
                        value={coverKey}
                        presets={ORGANIZER_COVER_PRESETS}
                        onSelect={(key) => {
                            setCoverKey(key);
                            setCoverPreviewUri(null);
                        }}
                        onPickCustom={() => void pickCover()}
                        customPreviewUri={coverPreviewUri}
                        pickingCustom={uploadingCover}
                        t={t}
                        wide
                    />
                    <Text style={styles.label}>{t('organizer.fieldWeb')}</Text>
                    <TextInput
                        style={styles.input}
                        value={web}
                        onChangeText={setWeb}
                        autoCapitalize="none"
                        keyboardType="url"
                    />
                    <Text style={styles.label}>{t('organizer.fieldInstagram')}</Text>
                    <TextInput
                        style={styles.input}
                        value={instagram}
                        onChangeText={setInstagram}
                        autoCapitalize="none"
                        placeholder="@club"
                        placeholderTextColor="#94A3B8"
                    />
                    <Text style={styles.label}>{t('organizer.fieldWhatsapp')}</Text>
                    <TextInput
                        style={styles.input}
                        value={whatsapp}
                        onChangeText={setWhatsapp}
                        autoCapitalize="none"
                        keyboardType="url"
                        placeholder={t('organizer.fieldWhatsappPlaceholder')}
                        placeholderTextColor="#94A3B8"
                    />
                    <Text style={styles.label}>{t('organizer.fieldAbout')}</Text>
                    <TextInput
                        ref={aboutRef}
                        style={[styles.input, styles.area]}
                        value={descripcion}
                        onChangeText={(text) => setDescripcion(text.slice(0, ORGANIZER_DESC_MAX))}
                        multiline
                        maxLength={ORGANIZER_DESC_MAX}
                        placeholder={t('organizer.profileAboutPlaceholder')}
                        placeholderTextColor="#94A3B8"
                        onFocus={() => {
                            focusedFieldRef.current = aboutRef.current;
                            ensureAboveKeyboard(aboutRef.current);
                        }}
                    />
                    <Text style={styles.counter}>{descripcion.length}/{ORGANIZER_DESC_MAX}</Text>
                    <Text style={styles.label}>{t('organizer.fieldInfo')}</Text>
                    <TextInput
                        ref={infoRef}
                        style={[styles.input, styles.areaTall]}
                        value={informacion}
                        onChangeText={(text) => setInformacion(text.slice(0, ORGANIZER_INFO_MAX))}
                        multiline
                        maxLength={ORGANIZER_INFO_MAX}
                        placeholder={t('organizer.profileInfoPlaceholder')}
                        placeholderTextColor="#94A3B8"
                        onFocus={() => {
                            focusedFieldRef.current = infoRef.current;
                            ensureAboveKeyboard(infoRef.current);
                        }}
                    />
                    <Text style={styles.counter}>{informacion.length}/{ORGANIZER_INFO_MAX}</Text>
                    <TouchableOpacity style={styles.submit} onPress={() => void submit()} disabled={sending}>
                        {sending ? (
                            <ActivityIndicator color="#FFF" />
                        ) : (
                            <Text style={styles.submitText}>{t('organizer.applyCta')}</Text>
                        )}
                    </TouchableOpacity>
                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.backgroundAlt },
    content: { padding: 20, paddingBottom: 40 },
    lead: { color: theme.colors.textMuted, fontSize: 15, lineHeight: 22, marginBottom: 18, fontWeight: '600' },
    label: { color: INK, fontWeight: '800', fontSize: 13, marginBottom: 8, marginTop: 22 },
    input: {
        backgroundColor: '#FFF',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#E3ECFB',
        paddingHorizontal: 14,
        paddingVertical: 12,
        color: INK,
        fontSize: 15,
        fontWeight: '600',
    },
    area: { minHeight: 96, textAlignVertical: 'top' },
    areaTall: { minHeight: 168, textAlignVertical: 'top' },
    hint: { marginTop: -2, marginBottom: 8, color: '#94A3B8', fontWeight: '600', fontSize: 12, lineHeight: 16 },
    counter: { marginTop: 4, color: '#94A3B8', fontWeight: '700', fontSize: 12 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { backgroundColor: '#FFF', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#E3ECFB' },
    chipOn: { backgroundColor: '#EFF6FF', borderColor: '#2563EB' },
    chipText: { color: theme.colors.textMuted, fontWeight: '700', fontSize: 13 },
    chipTextOn: { color: '#1D4ED8' },
    photoBtn: { alignSelf: 'flex-start' },
    photo: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#E2E8F0' },
    photoPlaceholder: {
        width: 88,
        height: 88,
        borderRadius: 44,
        backgroundColor: '#EFF6FF',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
    },
    photoHint: { color: PRIMARY_DARK, fontSize: 11, fontWeight: '700' },
    submit: { marginTop: 22, backgroundColor: '#2563EB', borderRadius: 16, paddingVertical: 15, alignItems: 'center' },
    submitText: { color: '#FFF', fontWeight: '800', fontSize: 16 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
    centerTitle: { marginTop: 12, fontSize: 20, fontWeight: '800', color: INK, textAlign: 'center' },
    centerBody: { marginTop: 8, fontSize: 15, lineHeight: 22, color: theme.colors.textMuted, textAlign: 'center' },
});

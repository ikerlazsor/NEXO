import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Image,
    Keyboard,
    KeyboardAvoidingView,
    NativeScrollEvent,
    NativeSyntheticEvent,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
    type ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AvatarCropModal } from '../components/AvatarCropModal';
import { OnboardingReadyReveal } from '../components/OnboardingReadyReveal';
import { useAppTheme, useThemedStyles } from '../lib/appTheme';
import { getAuthUser } from '../lib/auth';
import { takePendingAuthRoute } from '../lib/authIntent';
import { uploadAvatarFromUri } from '../lib/avatar';
import { clearPendingVerifyEmail } from '../lib/emailVerification';
import { markFirstRunPending } from '../lib/firstRun';
import { hapticLight, hapticMedium, hapticSelection, hapticSuccess } from '../lib/haptics';
import { useT } from '../lib/i18n';
import { getUserCoords } from '../lib/location';
import { Alert } from '../lib/nexoAlert';
import { saveOnboardingPreferences } from '../lib/onboarding';
import { getMyProfile } from '../lib/profileData';
import { clearPendingSignup } from '../lib/pendingSignup';
import { prepareCachesForNewUser, warmAppCaches } from '../lib/prefetchHome';
import {
    getPersonalityLabel,
    ONBOARDING_AFICIONES_OPTIONS,
    ONBOARDING_GENERO_OPTIONS,
    type Genero,
} from '../lib/profileFields';
import {
    deleteAccount,
    DISPLAY_NAME_MAX_LENGTH,
    isValidDisplayName,
    normalizeDisplayName,
    readNombreFromUser,
} from '../lib/profile';
import { getInterestAccent, getInterestIcon, PERSONALITY_MAX, PERSONALITY_MIN } from '../lib/profileInterests';
import { signOutAndClearLocalData } from '../lib/session';
import { type ThemeColors } from '../theme';

const MIN_AGE = 18;
const MAX_AGE = 99;
const DEFAULT_AGE = 24;
/** Pasos con progress (intereses → nombre). Ready es step 5. */
const TOTAL_STEPS = 5;
const AGE_ITEM_H = 52;

const IMG_AVATAR = require('../assets/images/Vacio foto perfil.png');
const IMG_AVATAR_F = require('../assets/images/Vacio foto perfil femenino.png');

let onboardingFinishLock = false;

function dateYearsAgo(years: number): Date {
    const d = new Date();
    d.setFullYear(d.getFullYear() - years);
    return d;
}

function toIsoDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

const AGE_OPTIONS = Array.from({ length: MAX_AGE - MIN_AGE + 1 }, (_, i) => MIN_AGE + i);

export default function OnboardingScreen() {
    const router = useRouter();
    const { t } = useT();
    const { colors, scheme } = useAppTheme();
    const styles = useThemedStyles(createOnboardingStyles);
    const [step, setStep] = useState(0);
    const [age, setAge] = useState(DEFAULT_AGE);
    const [genero, setGenero] = useState<Genero | null>(null);
    const [avatarUri, setAvatarUri] = useState<string | null>(null);
    const [cropUri, setCropUri] = useState<string | null>(null);
    const [cropWidth, setCropWidth] = useState<number | null>(null);
    const [cropHeight, setCropHeight] = useState<number | null>(null);
    const [personalities, setPersonalities] = useState<string[]>([]);
    const [displayName, setDisplayName] = useState('');
    const [cancelling, setCancelling] = useState(false);
    const [saving, setSaving] = useState(false);
    const [completing, setCompleting] = useState(false);
    const [bootstrapped, setBootstrapped] = useState(false);
    const ageListRef = useRef<FlatList<number>>(null);
    const lastHapticAgeRef = useRef(DEFAULT_AGE);

    useEffect(() => {
        let alive = true;
        void (async () => {
            const user = await getAuthUser();
            if (!alive) return;
            if (!user) {
                router.replace('/login');
                return;
            }
            const existing = readNombreFromUser(user);
            if (existing) setDisplayName(existing.slice(0, DISPLAY_NAME_MAX_LENGTH));
            setBootstrapped(true);
            void warmAppCaches(user);
        })();
        return () => {
            alive = false;
        };
    }, [router]);

    useEffect(() => {
        if (step !== 1) return;
        const idx = age - MIN_AGE;
        lastHapticAgeRef.current = age;
        const tmr = setTimeout(() => {
            ageListRef.current?.scrollToOffset({
                offset: idx * AGE_ITEM_H,
                animated: false,
            });
        }, 40);
        return () => clearTimeout(tmr);
        // Only re-align when entering the age step, not while scrolling updates age.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step]);

    const birthDate = useMemo(() => dateYearsAgo(age), [age]);
    const birthValid = age >= MIN_AGE && age <= MAX_AGE;
    const personalitiesValid =
        personalities.length >= PERSONALITY_MIN && personalities.length <= PERSONALITY_MAX;
    const nameValid = isValidDisplayName(normalizeDisplayName(displayName));

    const finishingLabel = useMemo(() => {
        const name = normalizeDisplayName(displayName) || 'Nexo!';
        const young = age >= 18 && age <= 35;
        if (young && genero === 'femenino') return t('onboarding.finishingReina', { name });
        if (young) return t('onboarding.finishingJefe', { name });
        return t('onboarding.finishingNeutral', { name });
    }, [age, displayName, genero, t]);

    const emptyAvatar = genero === 'femenino' ? IMG_AVATAR_F : IMG_AVATAR;

    const togglePersonality = (tag: string) => {
        setPersonalities((prev) => {
            if (prev.includes(tag)) {
                hapticSelection();
                return prev.filter((p) => p !== tag);
            }
            if (prev.length >= PERSONALITY_MAX) return prev;
            hapticSelection();
            return [...prev, tag];
        });
    };

    const pickPhoto = async (useCamera: boolean) => {
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
            if (!result.canceled && result.assets[0]?.uri) {
                const asset = result.assets[0];
                setCropUri(asset.uri);
                setCropWidth(asset.width ?? null);
                setCropHeight(asset.height ?? null);
            }
        } catch (e) {
            console.warn('pickPhoto', e);
            Alert.alert(t('onboarding.notice'), t('onboarding.photoError'));
        }
    };

    const cancelRegistration = () => {
        if (cancelling || completing || saving) return;
        Alert.alert(t('onboarding.cancelRegister'), t('onboarding.cancelRegisterMsg'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('onboarding.cancelRegisterConfirm'),
                style: 'destructive',
                onPress: () => {
                    setTimeout(() => {
                        void (async () => {
                            setCancelling(true);
                            try {
                                await clearPendingSignup();
                                await clearPendingVerifyEmail();
                                const { data: profile, error: profileError } = await getMyProfile();
                                // Cuenta ya terminada, o no se pudo leer: no borrar.
                                if (profileError || profile?.registro_completado) {
                                    router.replace('/(tabs)');
                                    return;
                                }
                                const { error } = await deleteAccount();
                                if (error === 'account_already_registered') {
                                    router.replace('/(tabs)');
                                    return;
                                }
                                if (error) {
                                    await signOutAndClearLocalData({ scope: 'local' });
                                    Alert.alert(t('onboarding.notice'), t('onboarding.cancelRegisterFailed'));
                                }
                                router.replace('/login');
                            } catch {
                                await signOutAndClearLocalData({ scope: 'local' });
                                Alert.alert(t('onboarding.notice'), t('onboarding.cancelRegisterFailed'));
                                router.replace('/login');
                            } finally {
                                setCancelling(false);
                            }
                        })();
                    }, 0);
                },
            },
        ]);
    };

    const handleFinish = async () => {
        if (!birthValid) {
            Alert.alert(t('onboarding.notice'), t('onboarding.birthInvalid'));
            return;
        }
        if (!genero) {
            Alert.alert(t('onboarding.notice'), t('onboarding.pickGender'));
            return;
        }
        if (!avatarUri) {
            Alert.alert(t('onboarding.notice'), t('onboarding.pickPhoto'));
            return;
        }
        if (!personalitiesValid) {
            Alert.alert(
                t('onboarding.notice'),
                t('onboarding.pickPersonalities', { min: PERSONALITY_MIN, max: PERSONALITY_MAX }),
            );
            return;
        }
        if (!nameValid) {
            Alert.alert(t('onboarding.notice'), t('login.displayNameHint'));
            return;
        }
        if (saving || completing || onboardingFinishLock) return;
        onboardingFinishLock = true;

        setSaving(true);
        setCompleting(true);
        try {
            let lastError: string | null = null;
            for (let attempt = 0; attempt < 2; attempt += 1) {
                if (attempt > 0) await new Promise<void>((resolve) => setTimeout(resolve, 700));
                const authUser = await getAuthUser();
                if (!authUser) {
                    router.replace('/login');
                    onboardingFinishLock = false;
                    return;
                }
                const userId = authUser.id;
                const nombre = normalizeDisplayName(displayName);

                const { url, error: uploadError } = await uploadAvatarFromUri(userId, avatarUri);
                if (uploadError || !url) {
                    lastError = uploadError ?? t('profile.uploadError');
                    continue;
                }

                const { error } = await saveOnboardingPreferences(userId, {
                    fecha_nacimiento: toIsoDate(birthDate),
                    genero,
                    avatar_url: url,
                    ambientes_preferidos: personalities,
                    descripcion: '',
                    nombre,
                });
                if (error) {
                    lastError = error;
                    continue;
                }

                await Promise.all([clearPendingSignup(), clearPendingVerifyEmail(), markFirstRunPending()]);
                // Ubicación al entrar a la app (como antes).
                void getUserCoords({ requestPermission: true });

                prepareCachesForNewUser(authUser.id);
                void warmAppCaches(authUser);

                hapticSuccess();
                const nextRoute = await takePendingAuthRoute();
                router.replace(nextRoute);
                return;
            }

            Alert.alert(t('onboarding.error'), lastError ?? t('onboarding.error'));
            setCompleting(false);
            onboardingFinishLock = false;
        } catch (e) {
            const msg = e instanceof Error ? e.message : t('onboarding.error');
            Alert.alert(t('onboarding.error'), msg);
            setCompleting(false);
            onboardingFinishLock = false;
        } finally {
            setSaving(false);
        }
    };

    const syncAgeFromOffset = useCallback((y: number, withHaptic: boolean) => {
        const idx = Math.round(y / AGE_ITEM_H);
        const next = Math.max(MIN_AGE, Math.min(MAX_AGE, MIN_AGE + idx));
        setAge(next);
        if (withHaptic && next !== lastHapticAgeRef.current) {
            lastHapticAgeRef.current = next;
            hapticSelection();
        }
    }, []);

    const onAgeScroll = useCallback(
        (e: NativeSyntheticEvent<NativeScrollEvent>) => {
            syncAgeFromOffset(e.nativeEvent.contentOffset.y, true);
        },
        [syncAgeFromOffset],
    );

    const onAgeScrollEnd = useCallback(
        (e: NativeSyntheticEvent<NativeScrollEvent>) => {
            syncAgeFromOffset(e.nativeEvent.contentOffset.y, true);
        },
        [syncAgeFromOffset],
    );

    const renderAgeItem = useCallback(
        ({ item }: ListRenderItemInfo<number>) => {
            const active = item === age;
            return (
                <View style={styles.ageItem}>
                    <Text style={[styles.ageItemText, active && styles.ageItemTextActive]}>{item}</Text>
                </View>
            );
        },
        [age, styles],
    );

    const renderStepDots = () => (
        <View style={styles.steps}>
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                <View key={i} style={styles.stepGroup}>
                    <View style={[styles.stepDot, step >= i && styles.stepDotActive]} />
                    {i < TOTAL_STEPS - 1 ? (
                        <View style={[styles.stepLine, step > i && styles.stepLineActive]} />
                    ) : null}
                </View>
            ))}
        </View>
    );

    const backTo = (n: number) => (
        <Pressable onPress={() => setStep(n)} style={styles.backLink}>
            <Ionicons name="chevron-back" size={18} color={colors.primary} />
            <Text style={styles.backText}>{t('onboarding.back')}</Text>
        </Pressable>
    );

    const continueBtn = (enabled: boolean, onPress: () => void) => (
        <TouchableOpacity
            style={[styles.btn, !enabled && styles.btnDisabled]}
            onPress={onPress}
            disabled={!enabled}
            activeOpacity={0.9}
        >
            <Text style={styles.btnText}>{t('onboarding.continue')}</Text>
        </TouchableOpacity>
    );

    return (
        <View style={styles.root}>
            <LinearGradient
                colors={[colors.gradientTop, colors.gradientBottom, colors.surface]}
                style={StyleSheet.absoluteFill}
            />

            {!bootstrapped ? (
                <View style={styles.completingOverlay}>
                    <ActivityIndicator size="large" color={colors.primary} />
                </View>
            ) : null}

            {completing && step !== 5 ? (
                <View style={styles.completingOverlay}>
                    <ActivityIndicator size="large" color={colors.primary} />
                    <Text style={styles.completingText}>{finishingLabel}</Text>
                </View>
            ) : null}

            <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
                <KeyboardAvoidingView
                    style={styles.flex}
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                    keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
                >
                    {step < 5 ? renderStepDots() : null}

                    <View style={styles.body}>
                        {step === 0 && (
                            <View style={styles.stepFill}>
                                <Pressable
                                    onPress={cancelRegistration}
                                    style={styles.backLink}
                                    disabled={cancelling}
                                >
                                    {cancelling ? (
                                        <ActivityIndicator size="small" color={colors.primary} />
                                    ) : (
                                        <Ionicons name="chevron-back" size={18} color={colors.primary} />
                                    )}
                                    <Text style={styles.backText}>{t('onboarding.cancelRegister')}</Text>
                                </Pressable>
                                <Text style={[styles.question, styles.interestsQuestion]}>
                                    {t('onboarding.personalitiesQuestion')}
                                </Text>
                                <Text style={styles.interestsHint}>
                                    {t('onboarding.personalitiesHint', { max: PERSONALITY_MAX })}
                                    {`  ·  ${personalities.length}/${PERSONALITY_MAX}`}
                                </Text>
                                <View style={styles.personalityGrid}>
                                    {ONBOARDING_AFICIONES_OPTIONS.map((tag) => {
                                        const active = personalities.includes(tag);
                                        const locked = !active && personalities.length >= PERSONALITY_MAX;
                                        const accent = getInterestAccent(tag);
                                        return (
                                            <TouchableOpacity
                                                key={tag}
                                                style={[
                                                    styles.interestTile,
                                                    {
                                                        backgroundColor: active ? accent.selectedBg : accent.bg,
                                                        borderColor: active
                                                            ? accent.selectedBorder
                                                            : accent.border,
                                                    },
                                                    locked && styles.interestTileLocked,
                                                ]}
                                                onPress={() => togglePersonality(tag)}
                                                activeOpacity={0.85}
                                            >
                                                <View
                                                    style={[
                                                        styles.interestIcon,
                                                        {
                                                            backgroundColor: active
                                                                ? 'rgba(255,255,255,0.22)'
                                                                : 'rgba(255,255,255,0.72)',
                                                            borderColor: active
                                                                ? 'rgba(255,255,255,0.45)'
                                                                : accent.border,
                                                        },
                                                    ]}
                                                >
                                                    <Ionicons
                                                        name={getInterestIcon(tag)}
                                                        size={22}
                                                        color={active ? '#FFF' : accent.icon}
                                                    />
                                                </View>
                                                <Text
                                                    style={[
                                                        styles.interestLabel,
                                                        active && { color: '#FFF' },
                                                    ]}
                                                    numberOfLines={2}
                                                >
                                                    {getPersonalityLabel(tag, genero, t)}
                                                </Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                                {continueBtn(personalitiesValid, () => {
                                    hapticMedium();
                                    setStep(1);
                                })}
                            </View>
                        )}

                        {step === 1 && (
                            <View style={styles.stepFill}>
                                {backTo(0)}
                                <View style={styles.stepCenter}>
                                    <Text style={styles.question}>{t('onboarding.birthQuestion')}</Text>
                                    <View style={styles.ageWheelWrap}>
                                        <View style={styles.ageWheelHighlight} pointerEvents="none" />
                                        <FlatList
                                            ref={ageListRef}
                                            data={AGE_OPTIONS}
                                            keyExtractor={(n) => String(n)}
                                            renderItem={renderAgeItem}
                                            showsVerticalScrollIndicator={false}
                                            snapToInterval={AGE_ITEM_H}
                                            disableIntervalMomentum
                                            decelerationRate="fast"
                                            scrollEventThrottle={16}
                                            getItemLayout={(_d, index) => ({
                                                length: AGE_ITEM_H,
                                                offset: AGE_ITEM_H * index,
                                                index,
                                            })}
                                            contentContainerStyle={{
                                                paddingVertical: AGE_ITEM_H * 2,
                                            }}
                                            style={styles.ageWheel}
                                            onScroll={onAgeScroll}
                                            onMomentumScrollEnd={onAgeScrollEnd}
                                            onScrollEndDrag={onAgeScrollEnd}
                                        />
                                    </View>
                                </View>
                                {continueBtn(birthValid, () => {
                                    hapticLight();
                                    setStep(2);
                                })}
                            </View>
                        )}

                        {step === 2 && (
                            <View style={styles.stepFill}>
                                {backTo(1)}
                                <View style={styles.stepCenter}>
                                    <Text style={styles.question}>{t('onboarding.genderQuestion')}</Text>
                                    <View style={styles.genderGrid}>
                                        {ONBOARDING_GENERO_OPTIONS.map((g) => (
                                            <TouchableOpacity
                                                key={g}
                                                style={[
                                                    styles.genderChip,
                                                    genero === g && styles.genderChipActive,
                                                ]}
                                                onPress={() => {
                                                    hapticSelection();
                                                    setGenero(g);
                                                }}
                                                activeOpacity={0.85}
                                            >
                                                <Text
                                                    style={[
                                                        styles.genderText,
                                                        genero === g && styles.genderTextActive,
                                                    ]}
                                                >
                                                    {t('genero.' + g)}
                                                </Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                </View>
                                {continueBtn(!!genero, () => {
                                    hapticLight();
                                    setStep(3);
                                })}
                            </View>
                        )}

                        {step === 3 && (
                            <View style={styles.stepFill}>
                                {backTo(2)}
                                <View style={styles.stepCenter}>
                                    <Text style={styles.question}>{t('onboarding.photoQuestion')}</Text>
                                    <TouchableOpacity
                                        style={styles.photoBubble}
                                        onPress={() => void pickPhoto(false)}
                                        activeOpacity={0.88}
                                    >
                                        {avatarUri ? (
                                            <Image source={{ uri: avatarUri }} style={styles.photoPreview} />
                                        ) : (
                                            <ExpoImage
                                                source={emptyAvatar}
                                                style={styles.photoPreview}
                                                contentFit="cover"
                                            />
                                        )}
                                    </TouchableOpacity>
                                    <View style={styles.photoActions}>
                                        <TouchableOpacity
                                            style={styles.photoActionBtn}
                                            onPress={() => void pickPhoto(true)}
                                            activeOpacity={0.85}
                                        >
                                            <Ionicons name="camera-outline" size={20} color={colors.primary} />
                                            <Text style={styles.photoActionText}>{t('profile.camera')}</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={styles.photoActionBtn}
                                            onPress={() => void pickPhoto(false)}
                                            activeOpacity={0.85}
                                        >
                                            <Ionicons name="images-outline" size={20} color={colors.primary} />
                                            <Text style={styles.photoActionText}>{t('profile.gallery')}</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                                {continueBtn(!!avatarUri, () => {
                                    hapticLight();
                                    setStep(4);
                                })}
                            </View>
                        )}

                        {step === 4 && (
                            <Pressable style={styles.stepFill} onPress={Keyboard.dismiss}>
                                {backTo(3)}
                                <View style={styles.stepCenter}>
                                    <Text style={styles.question}>{t('onboarding.nameQuestion')}</Text>
                                    <TextInput
                                        style={styles.nameInput}
                                        value={displayName}
                                        onChangeText={(text) =>
                                            setDisplayName(text.slice(0, DISPLAY_NAME_MAX_LENGTH))
                                        }
                                        placeholder={t('onboarding.namePlaceholder')}
                                        placeholderTextColor="rgba(15,42,74,0.35)"
                                        maxLength={DISPLAY_NAME_MAX_LENGTH}
                                        autoCapitalize="words"
                                        autoFocus
                                        keyboardAppearance={scheme}
                                        returnKeyType="done"
                                        blurOnSubmit
                                        onSubmitEditing={Keyboard.dismiss}
                                    />
                                </View>
                                {continueBtn(nameValid, () => {
                                    Keyboard.dismiss();
                                    hapticMedium();
                                    setStep(5);
                                })}
                            </Pressable>
                        )}

                        {step === 5 && (
                            <View style={styles.stepFillCenter}>
                                <OnboardingReadyReveal
                                    name={normalizeDisplayName(displayName) || 'Nexo!'}
                                    avatarUri={avatarUri}
                                    preparingLabel={finishingLabel}
                                    retryLabel={t('onboarding.continue')}
                                    busy={saving || completing}
                                    onFinish={() => void handleFinish()}
                                    avatarSize={156}
                                />
                            </View>
                        )}
                    </View>
                </KeyboardAvoidingView>
            </SafeAreaView>

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
                    setAvatarUri(cropped);
                    setCropUri(null);
                    setCropWidth(null);
                    setCropHeight(null);
                }}
            />
        </View>
    );
}

function createOnboardingStyles(c: ThemeColors) {
    const INK = c.text;
    const PRIMARY = c.brand;
    const PRIMARY_DARK = c.primary;
    return StyleSheet.create({
        root: { flex: 1 },
        flex: { flex: 1 },
        safe: { flex: 1 },
        body: { flex: 1, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
        stepFill: { flex: 1 },
        stepFillCenter: { flex: 1, justifyContent: 'center' },
        stepCenter: { flex: 1, justifyContent: 'center' },
        steps: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            paddingTop: 20,
            paddingBottom: 14,
            paddingHorizontal: 16,
        },
        stepGroup: { flexDirection: 'row', alignItems: 'center' },
        stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.border },
        stepDotActive: { backgroundColor: PRIMARY_DARK, width: 10, height: 10, borderRadius: 5 },
        stepLine: { width: 18, height: 2, backgroundColor: c.border, marginHorizontal: 3 },
        stepLineActive: { backgroundColor: PRIMARY },
        backLink: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            alignSelf: 'flex-start',
            marginBottom: 10,
            paddingVertical: 4,
        },
        backText: { color: PRIMARY_DARK, fontWeight: '700', fontSize: 14 },
        question: {
            fontSize: 22,
            fontWeight: '900',
            color: INK,
            textAlign: 'center',
            marginBottom: 10,
            lineHeight: 28,
        },
        interestsQuestion: {
            marginTop: 18,
            marginBottom: 6,
        },
        interestsHint: {
            fontSize: 13,
            fontWeight: '700',
            color: c.textMuted,
            textAlign: 'center',
            marginBottom: 18,
        },
        personalityGrid: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            gap: 8,
            marginBottom: 12,
            alignContent: 'flex-start',
        },
        interestTile: {
            width: '47%',
            minHeight: 84,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
            borderRadius: 16,
            paddingVertical: 10,
            paddingHorizontal: 8,
            borderWidth: 2,
        },
        interestTileLocked: { opacity: 0.4 },
        interestIcon: {
            width: 40,
            height: 40,
            borderRadius: 12,
            borderWidth: 1.5,
            alignItems: 'center',
            justifyContent: 'center',
        },
        interestLabel: { fontSize: 12, fontWeight: '800', color: INK, textAlign: 'center' },
        ageWheelWrap: {
            height: AGE_ITEM_H * 5,
            marginVertical: 12,
            overflow: 'hidden',
            justifyContent: 'center',
        },
        ageWheel: { flexGrow: 0, height: AGE_ITEM_H * 5, zIndex: 2 },
        ageWheelHighlight: {
            position: 'absolute',
            left: 24,
            right: 24,
            top: AGE_ITEM_H * 2,
            height: AGE_ITEM_H,
            borderRadius: 14,
            backgroundColor: c.primarySoft,
            borderWidth: 1.5,
            borderColor: c.primaryBorder,
            zIndex: 0,
        },
        ageItem: {
            height: AGE_ITEM_H,
            alignItems: 'center',
            justifyContent: 'center',
        },
        ageItemText: { fontSize: 24, fontWeight: '600', color: c.textSubtle, opacity: 0.45 },
        ageItemTextActive: {
            fontSize: 42,
            fontWeight: '900',
            color: PRIMARY_DARK,
            opacity: 1,
        },
        genderGrid: { gap: 12, marginTop: 18 },
        genderChip: {
            backgroundColor: c.surface,
            borderRadius: 16,
            borderWidth: 1.5,
            borderColor: c.border,
            paddingVertical: 16,
            alignItems: 'center',
        },
        genderChipActive: {
            backgroundColor: PRIMARY_DARK,
            borderColor: PRIMARY_DARK,
        },
        genderText: { fontSize: 16, fontWeight: '800', color: INK },
        genderTextActive: { color: '#FFF' },
        photoBubble: {
            alignSelf: 'center',
            width: 188,
            height: 188,
            borderRadius: 94,
            overflow: 'hidden',
            marginTop: 8,
            marginBottom: 18,
            borderWidth: 3,
            borderColor: c.primaryBorder,
            backgroundColor: c.primarySoft,
        },
        photoPreview: { width: '100%', height: '100%' },
        photoActions: {
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 12,
            marginBottom: 8,
        },
        photoActionBtn: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: c.surface,
            borderRadius: 14,
            borderWidth: 1.5,
            borderColor: c.primaryBorder,
            paddingVertical: 12,
            paddingHorizontal: 16,
        },
        photoActionText: { fontSize: 14, fontWeight: '800', color: PRIMARY_DARK },
        nameInput: {
            alignSelf: 'center',
            width: '100%',
            maxWidth: 320,
            backgroundColor: c.surface,
            borderRadius: 16,
            borderWidth: 1.5,
            borderColor: c.border,
            paddingHorizontal: 16,
            paddingVertical: 16,
            textAlign: 'center',
            fontSize: 22,
            fontWeight: '800',
            color: INK,
            marginTop: 12,
        },
        btn: {
            marginTop: 'auto',
            backgroundColor: PRIMARY_DARK,
            borderRadius: 16,
            paddingVertical: 16,
            alignItems: 'center',
        },
        btnDisabled: { opacity: 0.45 },
        btnText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
        completingOverlay: {
            ...StyleSheet.absoluteFillObject,
            backgroundColor: 'rgba(255,255,255,0.72)',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 20,
            gap: 12,
            paddingHorizontal: 28,
        },
        completingText: {
            fontSize: 16,
            fontWeight: '700',
            color: INK,
            textAlign: 'center',
        },
    });
}

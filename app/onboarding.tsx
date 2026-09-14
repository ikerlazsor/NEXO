import {
    Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useCallback,
    useEffect,
    useMemo,
    useRef,
    useState } from 'react';
import {
    ActivityIndicator,
    Image,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { Alert } from '../lib/nexoAlert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getAuthUser } from '../lib/auth';
import { takePendingAuthRoute } from '../lib/authIntent';
import { uploadAvatarFromUri } from '../lib/avatar';
import { clearPendingVerifyEmail } from '../lib/emailVerification';
import { markFirstRunPending } from '../lib/firstRun';
import { useT } from '../lib/i18n';
import { getUserCoords } from '../lib/location';
import { saveOnboardingPreferences } from '../lib/onboarding';
import { clearPendingSignup } from '../lib/pendingSignup';
import {
    prepareCachesForNewUser,
    warmAppCaches,
} from '../lib/prefetchHome';
import {
    AFICIONES_OPTIONS,
    getPersonalityLabel,
    ONBOARDING_GENERO_OPTIONS,
    type Genero,
} from '../lib/profileFields';
import { deleteAccount, readNombreFromUser } from '../lib/profile';
import { hapticLight, hapticMedium, hapticSelection, hapticSuccess } from '../lib/haptics';
import { signOutAndClearLocalData } from '../lib/session';
import { OnboardingReadyReveal } from '../components/OnboardingReadyReveal';
import { getInterestAccent, getInterestIcon, PERSONALITY_MAX, PERSONALITY_MIN } from '../lib/profileInterests';
import { useAppTheme, useThemedStyles } from '../lib/appTheme';
import { type ThemeColors } from '../theme';

const MIN_AGE = 18;
const MAX_AGE = 99;
const ABOUT_MAX = 400;
const TOTAL_STEPS = 5;

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

export default function OnboardingScreen() {
    const router = useRouter();
    const { t, lang } = useT();
    const { colors } = useAppTheme();
    const styles = useThemedStyles(createOnboardingStyles);
    const [step, setStep] = useState(0);
    const [age, setAge] = useState(22);
    const [genero, setGenero] = useState<Genero | null>(null);
    const [avatarUri, setAvatarUri] = useState<string | null>(null);
    const [personalities, setPersonalities] = useState<string[]>([]);
    const [aboutMe, setAboutMe] = useState('');
    const [cancelling, setCancelling] = useState(false);
    const [saving, setSaving] = useState(false);
    const [completing, setCompleting] = useState(false);
    const [bootstrapped, setBootstrapped] = useState(false);
    const [displayName, setDisplayName] = useState('');
    const [sliderWidth, setSliderWidth] = useState(0);
    const [scrollLocked, setScrollLocked] = useState(false);
    const ageRef = useRef(age);
    const trackRef = useRef<View>(null);
    const trackPageXRef = useRef(0);
    const sliderWidthRef = useRef(0);
    ageRef.current = age;
    sliderWidthRef.current = sliderWidth;

    useEffect(() => {
        let alive = true;
        void (async () => {
            const user = await getAuthUser();
            if (!alive) return;
            if (!user) {
                router.replace('/login');
                return;
            }
            setDisplayName(readNombreFromUser(user));
            setBootstrapped(true);
            void warmAppCaches(user);
        })();
        return () => {
            alive = false;
        };
    }, [router]);

    const birthDate = useMemo(() => dateYearsAgo(age), [age]);
    const birthValid = age >= MIN_AGE && age <= MAX_AGE;
    const personalitiesValid =
        personalities.length >= PERSONALITY_MIN && personalities.length <= PERSONALITY_MAX;

    const personalitiesQuestion = useMemo(() => {
        if (age >= 30) return t('onboarding.personalitiesQuestion30');
        return t('onboarding.personalitiesQuestion');
    }, [age, t]);

    const aboutQuestion = useMemo(() => {
        if (age >= 18 && age <= 30 && genero === 'masculino') return t('onboarding.aboutQuestionRey');
        if (age >= 18 && age <= 30 && genero === 'femenino') return t('onboarding.aboutQuestionReina');
        return t('onboarding.aboutQuestion');
    }, [age, genero, t]);

    const finishLabel = useMemo(() => {
        if (!aboutMe.trim()) return t('onboarding.finishEmpty');
        if (age >= 18 && age <= 24) return t('onboarding.finishYoung');
        return t('onboarding.finishGo');
    }, [aboutMe, age, t]);

    const setAgeFromX = useCallback((x: number, width: number) => {
        if (width <= 0) return;
        const ratio = Math.max(0, Math.min(1, x / width));
        const next = Math.round(MIN_AGE + ratio * (MAX_AGE - MIN_AGE));
        if (next !== ageRef.current) {
            hapticSelection();
            ageRef.current = next;
            setAge(next);
        }
    }, []);

    const setAgeFromPageX = useCallback((pageX: number) => {
        setAgeFromX(pageX - trackPageXRef.current, sliderWidthRef.current);
    }, [setAgeFromX]);

    const lockScroll = useCallback(() => setScrollLocked(true), []);
    const unlockScroll = useCallback(() => setScrollLocked(false), []);

    const agePan = useMemo(
        () =>
            Gesture.Pan()
                // Al tocar el slider, se queda con el gesto: un pelín de vertical no abre el scroll.
                .minDistance(0)
                .shouldCancelWhenOutside(false)
                .onBegin((e) => {
                    'worklet';
                    runOnJS(lockScroll)();
                    runOnJS(setAgeFromPageX)(e.absoluteX);
                })
                .onChange((e) => {
                    'worklet';
                    runOnJS(setAgeFromPageX)(e.absoluteX);
                })
                .onFinalize(() => {
                    'worklet';
                    runOnJS(unlockScroll)();
                }),
        [lockScroll, setAgeFromPageX, unlockScroll],
    );

    const onSliderLayout = () => {
        trackRef.current?.measureInWindow((x, _y, width) => {
            trackPageXRef.current = x;
            sliderWidthRef.current = width;
            setSliderWidth(width);
        });
    };

    const onSliderTouchStart = useCallback(() => {
        lockScroll();
        onSliderLayout();
    }, [lockScroll]);

    const ageThumbPct = ((age - MIN_AGE) / (MAX_AGE - MIN_AGE)) * 100;
    const togglePersonality = (tag: string) => {
        setPersonalities((prev) => {
            if (prev.includes(tag)) {
                hapticSelection();
                return prev.filter((p) => p !== tag);
            }
            if (prev.length >= PERSONALITY_MAX) {
                return prev;
            }
            hapticSelection();
            return [...prev, tag];
        });
    };

    const pickPhoto = async (useCamera: boolean) => {
        try {
            if (useCamera) {
                const cam = await ImagePicker.requestCameraPermissionsAsync();
                if (!cam.granted) {
                    Alert.alert(t('onboarding.notice'), t('onboarding.cameraPermission'));
                    return;
                }
            } else {
                const lib = await ImagePicker.requestMediaLibraryPermissionsAsync();
                if (!lib.granted) {
                    Alert.alert(t('onboarding.notice'), t('onboarding.galleryPermission'));
                    return;
                }
            }

            const result = useCamera
                ? await ImagePicker.launchCameraAsync({
                      mediaTypes: ['images'],
                      allowsEditing: true,
                      aspect: [1, 1],
                      quality: 0.5,
                  })
                : await ImagePicker.launchImageLibraryAsync({
                      mediaTypes: ['images'],
                      allowsEditing: true,
                      aspect: [1, 1],
                      quality: 0.5,
                  });

            if (!result.canceled && result.assets[0]?.uri) {
                setAvatarUri(result.assets[0].uri);
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
                                // Borra Auth + perfil: si no, el email queda “ya registrado”.
                                const { error } = await deleteAccount();
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
            Alert.alert(t('onboarding.notice'), t('onboarding.pickPersonalities', { min: PERSONALITY_MIN, max: PERSONALITY_MAX }));
            return;
        }
        if (saving || completing || onboardingFinishLock) return;
        onboardingFinishLock = true;

        setSaving(true);
        setCompleting(true);
        try {
            const authUser = await getAuthUser();
            if (!authUser) {
                router.replace('/login');
                onboardingFinishLock = false;
                return;
            }
            const userId = authUser.id;

            const { url, error: uploadError } = await uploadAvatarFromUri(userId, avatarUri);
            if (uploadError || !url) {
                Alert.alert(t('onboarding.error'), uploadError ?? t('profile.uploadError'));
                setCompleting(false);
                onboardingFinishLock = false;
                return;
            }

            const { error } = await saveOnboardingPreferences(userId, {
                fecha_nacimiento: toIsoDate(birthDate),
                genero,
                avatar_url: url,
                ambientes_preferidos: personalities,
                descripcion: aboutMe.trim(),
            });
            if (error) {
                Alert.alert(t('onboarding.error'), error);
                setCompleting(false);
                onboardingFinishLock = false;
                return;
            }

            await Promise.all([
                clearPendingSignup(),
                clearPendingVerifyEmail(),
                markFirstRunPending(),
            ]);
            // Ubicación opcional: mejora “cerca de mí” al llegar al feed
            void getUserCoords({ requestPermission: true });

            prepareCachesForNewUser(authUser.id);
            void warmAppCaches(authUser);

            hapticSuccess();
            const nextRoute = await takePendingAuthRoute();
            router.replace(nextRoute);
        } catch (e) {
            const msg = e instanceof Error ? e.message : t('onboarding.error');
            Alert.alert(t('onboarding.error'), msg);
            setCompleting(false);
            onboardingFinishLock = false;
        } finally {
            setSaving(false);
        }
    };

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

    return (
        <View style={styles.root}>
            <LinearGradient colors={[colors.gradientTop, colors.gradientBottom, colors.surface]} style={StyleSheet.absoluteFill} />

            {!bootstrapped ? (
                <View style={styles.completingOverlay}>
                    <ActivityIndicator size="large" color={colors.primary} />
                </View>
            ) : null}

            {completing && step !== 5 ? (
                <View style={styles.completingOverlay}>
                    <ActivityIndicator size="large" color={colors.primary} />
                    <Text style={styles.completingText}>{t('onboarding.finishing')}</Text>
                </View>
            ) : null}

            <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
                <KeyboardAvoidingView
                    style={styles.flex}
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                >
                    <ScrollView
                        contentContainerStyle={styles.scroll}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                        scrollEnabled={!scrollLocked}
                        nestedScrollEnabled={false}
                    >
                        {step < 5 ? (
                            <View style={styles.header}>
                                <Text style={styles.title}>{t('onboarding.welcomeTitle')}</Text>
                            </View>
                        ) : null}

                        <View style={styles.card}>
                            {step < 5 ? renderStepDots() : null}

                            {step === 0 && (
                                <>
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
                                    <Text style={styles.question}>{t('onboarding.birthQuestion')}</Text>
                                    <View style={styles.ageHero}>
                                        <Text style={styles.ageNumber}>{age}</Text>
                                        <Text style={styles.ageUnit}>{lang === 'en' ? 'years old' : 'años'}</Text>
                                    </View>
                                    <GestureDetector gesture={agePan}>
                                        <View
                                            ref={trackRef}
                                            style={styles.ageSliderTrackWrap}
                                            onLayout={onSliderLayout}
                                            // Bloqueo síncrono: evita que el ScrollView “robe” el gesto
                                            // en el frame antes de que el Pan active.
                                            onTouchStart={onSliderTouchStart}
                                            onTouchEnd={unlockScroll}
                                            onTouchCancel={unlockScroll}
                                            collapsable={false}
                                        >
                                            <View style={styles.ageSliderTrack}>
                                                <View style={[styles.ageSliderFill, { width: `${ageThumbPct}%` }]} />
                                            </View>
                                            <View
                                                style={[styles.ageSliderThumb, { left: `${ageThumbPct}%` }]}
                                                pointerEvents="none"
                                            />
                                        </View>
                                    </GestureDetector>
                                    <View style={styles.ageRangeRow}>
                                        <Text style={styles.ageRangeLabel}>{MIN_AGE}</Text>
                                        <Text style={styles.ageRangeLabel}>{MAX_AGE}</Text>
                                    </View>
                                    <TouchableOpacity
                                        style={[styles.btn, !birthValid && styles.btnDisabled]}
                                        onPress={() => {
                                            if (!birthValid) return;
                                            hapticLight();
                                            setStep(1);
                                        }}
                                        disabled={!birthValid}
                                        activeOpacity={0.9}
                                    >
                                        <Text style={styles.btnText}>{t('onboarding.continue')}</Text>
                                    </TouchableOpacity>
                                </>
                            )}

                            {step === 1 && (
                                <>
                                    <Pressable onPress={() => setStep(0)} style={styles.backLink}>
                                        <Ionicons name="chevron-back" size={18} color={colors.primary} />
                                        <Text style={styles.backText}>{t('onboarding.back')}</Text>
                                    </Pressable>
                                    <Text style={styles.question}>{t('onboarding.genderQuestion')}</Text>
                                    <View style={styles.genderGrid}>
                                        {ONBOARDING_GENERO_OPTIONS.map((g) => (
                                            <TouchableOpacity
                                                key={g}
                                                style={[styles.genderChip, genero === g && styles.genderChipActive]}
                                                onPress={() => {
                                                    hapticSelection();
                                                    setGenero(g);
                                                }}
                                                activeOpacity={0.85}
                                            >
                                                <Text style={[styles.genderText, genero === g && styles.genderTextActive]}>
                                                    {t('genero.' + g)}
                                                </Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                    <TouchableOpacity
                                        style={[styles.btn, !genero && styles.btnDisabled]}
                                        onPress={() => {
                                            if (!genero) return;
                                            hapticLight();
                                            setStep(2);
                                        }}
                                        disabled={!genero}
                                        activeOpacity={0.9}
                                    >
                                        <Text style={styles.btnText}>{t('onboarding.continue')}</Text>
                                    </TouchableOpacity>
                                </>
                            )}

                            {step === 2 && (
                                <>
                                    <Pressable onPress={() => setStep(1)} style={styles.backLink}>
                                        <Ionicons name="chevron-back" size={18} color={colors.primary} />
                                        <Text style={styles.backText}>{t('onboarding.back')}</Text>
                                    </Pressable>
                                    <Text style={styles.question}>{t('onboarding.photoQuestion')}</Text>
                                    <View style={styles.photoPicker}>
                                        {avatarUri ? (
                                            <Image source={{ uri: avatarUri }} style={styles.photoPreview} />
                                        ) : (
                                            <View style={styles.photoPlaceholder}>
                                                <Ionicons name="person" size={36} color={colors.primary} />
                                                <Text style={styles.photoPlaceholderText}>{t('onboarding.addPhoto')}</Text>
                                            </View>
                                        )}
                                    </View>
                                    <View style={styles.photoActions}>
                                        <TouchableOpacity
                                            style={styles.photoActionBtn}
                                            onPress={() => void pickPhoto(true)}
                                            activeOpacity={0.85}
                                        >
                                            <Ionicons name="camera" size={20} color={colors.primary} />
                                            <Text style={styles.photoActionText}>{t('profile.camera')}</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={styles.photoActionBtn}
                                            onPress={() => void pickPhoto(false)}
                                            activeOpacity={0.85}
                                        >
                                            <Ionicons name="images" size={20} color={colors.primary} />
                                            <Text style={styles.photoActionText}>{t('profile.gallery')}</Text>
                                        </TouchableOpacity>
                                    </View>
                                    <TouchableOpacity
                                        style={[styles.btn, !avatarUri && styles.btnDisabled]}
                                        onPress={() => {
                                            if (!avatarUri) return;
                                            hapticLight();
                                            setStep(3);
                                        }}
                                        disabled={!avatarUri}
                                        activeOpacity={0.9}
                                    >
                                        <Text style={styles.btnText}>{t('onboarding.continue')}</Text>
                                    </TouchableOpacity>
                                </>
                            )}

                            {step === 3 && (
                                <>
                                    <Pressable onPress={() => setStep(2)} style={styles.backLink}>
                                        <Ionicons name="chevron-back" size={18} color={colors.primary} />
                                        <Text style={styles.backText}>{t('onboarding.back')}</Text>
                                    </Pressable>
                                    <Text style={styles.question}>{personalitiesQuestion}</Text>
                                    <View style={styles.personalityGrid}>
                                        {AFICIONES_OPTIONS.map((tag) => {
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
                                                            borderColor: active ? accent.selectedBorder : accent.border,
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
                                                                backgroundColor: active ? '#FFF' : 'rgba(255,255,255,0.72)',
                                                                borderColor: active ? accent.selectedBorder : accent.border,
                                                            },
                                                        ]}
                                                    >
                                                        <Ionicons
                                                            name={getInterestIcon(tag)}
                                                            size={24}
                                                            color={accent.icon}
                                                        />
                                                    </View>
                                                    <Text
                                                        style={[
                                                            styles.interestLabel,
                                                            active && { color: accent.icon },
                                                        ]}
                                                        numberOfLines={2}
                                                    >
                                                        {getPersonalityLabel(tag, genero, t)}
                                                    </Text>
                                                    {active ? (
                                                        <View style={[styles.interestCheck, { backgroundColor: accent.icon }]}>
                                                            <Ionicons name="checkmark" size={11} color="#FFF" />
                                                        </View>
                                                    ) : null}
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                    <TouchableOpacity
                                        style={[styles.btn, !personalitiesValid && styles.btnDisabled]}
                                        onPress={() => {
                                            if (!personalitiesValid) return;
                                            hapticMedium();
                                            setStep(4);
                                        }}
                                        disabled={!personalitiesValid}
                                        activeOpacity={0.9}
                                    >
                                        <Text style={styles.btnText}>{t('onboarding.continue')}</Text>
                                    </TouchableOpacity>
                                </>
                            )}

                            {step === 4 && (
                                <>
                                    <Pressable onPress={() => setStep(3)} style={styles.backLink}>
                                        <Ionicons name="chevron-back" size={18} color={colors.primary} />
                                        <Text style={styles.backText}>{t('onboarding.back')}</Text>
                                    </Pressable>
                                    <Text style={styles.question}>{aboutQuestion}</Text>
                                    <TextInput
                                        style={styles.aboutInput}
                                        value={aboutMe}
                                        onChangeText={(text) => setAboutMe(text.slice(0, ABOUT_MAX))}
                                        placeholder={t('onboarding.aboutPlaceholder')}
                                        placeholderTextColor={colors.textSubtle}
                                        multiline
                                        maxLength={ABOUT_MAX}
                                        textAlignVertical="top"
                                    />
                                    <Text style={styles.aboutCounter}>
                                        {aboutMe.length}/{ABOUT_MAX}
                                    </Text>
                                    <TouchableOpacity
                                        style={styles.btn}
                                        onPress={() => {
                                            hapticMedium();
                                            setStep(5);
                                        }}
                                        activeOpacity={0.9}
                                    >
                                        <Text style={styles.btnText}>{finishLabel}</Text>
                                    </TouchableOpacity>
                                </>
                            )}

                            {step === 5 && (
                                <OnboardingReadyReveal
                                    name={displayName.trim() || 'Nexo!'}
                                    avatarUri={avatarUri}
                                    preparingLabel={t('onboarding.finishing')}
                                    retryLabel={t('onboarding.continue')}
                                    busy={saving || completing}
                                    onFinish={() => void handleFinish()}
                                />
                            )}
                        </View>
                    </ScrollView>
                </KeyboardAvoidingView>
            </SafeAreaView>
        </View>
    );
}

function createOnboardingStyles(c: ThemeColors) {
    const INK = c.text;
    const MUTED = c.textMuted;
    const PRIMARY = c.brand;
    const PRIMARY_DARK = c.primary;
    return StyleSheet.create({
    root: { flex: 1 },
    flex: { flex: 1 },
    safe: { flex: 1 },
    scroll: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 36, justifyContent: 'center' },
    header: { alignItems: 'center', marginBottom: 32, marginTop: 20 },
    title: { fontSize: 26, fontWeight: '900', color: INK, textAlign: 'center' },
    subtitle: { fontSize: 15, color: MUTED, textAlign: 'center', marginTop: 8, lineHeight: 22, paddingHorizontal: 12 },
    card: {
        backgroundColor: c.surface,
        borderRadius: 28,
        padding: 28,
        shadowColor: c.primary,
        shadowOpacity: 0.1,
        shadowRadius: 20,
        elevation: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
    },
    steps: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
    stepGroup: { flexDirection: 'row', alignItems: 'center' },
    stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.border },
    stepDotActive: { backgroundColor: PRIMARY_DARK, width: 10, height: 10, borderRadius: 5 },
    stepLine: { width: 20, height: 2, backgroundColor: c.border, marginHorizontal: 4 },
    stepLineActive: { backgroundColor: PRIMARY },
    question: { fontSize: 20, fontWeight: '800', color: INK, textAlign: 'center', marginBottom: 18, lineHeight: 28 },
    hint: { fontSize: 13, color: MUTED, textAlign: 'center', marginBottom: 24, lineHeight: 20 },
    ageHero: { alignItems: 'center', marginTop: 8, marginBottom: 28 },
    ageNumber: {
        fontSize: 72,
        fontWeight: '900',
        color: PRIMARY_DARK,
        letterSpacing: -2,
        lineHeight: 80,
    },
    ageUnit: { marginTop: 2, fontSize: 16, fontWeight: '700', color: MUTED },
    ageSliderTrackWrap: {
        height: 52,
        justifyContent: 'center',
        marginBottom: 8,
        paddingHorizontal: 4,
        // Zona táctil alta para no “perder” el gesto con un pelín de vertical.
        paddingVertical: 12,
    },
    ageSliderTrack: {
        height: 10,
        borderRadius: 999,
        backgroundColor: c.border,
        overflow: 'hidden',
    },
    ageSliderFill: {
        height: '100%',
        borderRadius: 999,
        backgroundColor: PRIMARY,
    },
    ageSliderThumb: {
        position: 'absolute',
        top: 16,
        marginLeft: -16,
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: c.surface,
        borderWidth: 3,
        borderColor: PRIMARY_DARK,
        shadowColor: c.primary,
        shadowOpacity: 0.18,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: 4,
    },
    ageRangeRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 28,
        paddingHorizontal: 4,
    },
    ageRangeLabel: { fontSize: 12, fontWeight: '700', color: c.textSubtle },
    dateBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        backgroundColor: c.surfaceSubtle,
        borderRadius: 16,
        borderWidth: 1.5,
        borderColor: c.primaryBorder,
        paddingVertical: 16,
        paddingHorizontal: 18,
        marginBottom: 16,
    },
    dateBtnText: { fontSize: 16, fontWeight: '700', color: INK, flexShrink: 1 },
    datePicker: { alignSelf: 'center', marginBottom: 8 },
    agePreview: {
        fontSize: 14,
        fontWeight: '600',
        color: MUTED,
        textAlign: 'center',
        marginBottom: 28,
    },
    photoPicker: {
        alignSelf: 'center',
        marginTop: 4,
        marginBottom: 28,
        borderRadius: 999,
        overflow: 'hidden',
    },
    photoPreview: { width: 140, height: 140, borderRadius: 70 },
    photoPlaceholder: {
        width: 140,
        height: 140,
        borderRadius: 70,
        backgroundColor: c.primarySoft,
        borderWidth: 2,
        borderColor: c.primaryBorder,
        borderStyle: 'dashed',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    photoPlaceholderText: { fontSize: 13, fontWeight: '700', color: PRIMARY_DARK },
    photoActions: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 28,
        justifyContent: 'center',
    },
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
        paddingVertical: 14,
    },
    photoActionText: { fontSize: 14, fontWeight: '800', color: PRIMARY_DARK },
    personalityGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
        marginTop: 8,
        marginBottom: 24,
    },
    interestTile: {
        width: '47%',
        flexGrow: 1,
        alignItems: 'center',
        gap: 8,
        backgroundColor: c.surfaceSubtle,
        borderRadius: 20,
        paddingVertical: 14,
        paddingHorizontal: 10,
        borderWidth: 1.5,
        borderColor: c.primaryBorder,
        position: 'relative',
    },
    interestTileLocked: { opacity: 0.4 },
    interestIcon: {
        width: 58,
        height: 58,
        borderRadius: 18,
        borderWidth: 1.5,
        backgroundColor: c.surface,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: c.text,
        shadowOpacity: 0.06,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 1,
    },
    interestLabel: { fontSize: 12, fontWeight: '800', color: INK, textAlign: 'center' },
    interestCheck: {
        position: 'absolute',
        top: 8,
        right: 8,
        width: 18,
        height: 18,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
    },
    aboutInput: {
        minHeight: 120,
        borderRadius: 16,
        borderWidth: 1.5,
        borderColor: c.primaryBorder,
        backgroundColor: c.surfaceSubtle,
        paddingHorizontal: 16,
        paddingVertical: 14,
        fontSize: 15,
        fontWeight: '600',
        color: INK,
        marginBottom: 8,
    },
    aboutCounter: {
        alignSelf: 'flex-end',
        marginBottom: 20,
        color: c.textSubtle,
        fontWeight: '700',
        fontSize: 12,
    },
    btnWrapper: { borderRadius: 16, overflow: 'hidden', marginTop: 4 },
    btn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 16,
        borderRadius: 16,
        backgroundColor: PRIMARY_DARK,
        marginTop: 4,
    },
    btnDisabled: { opacity: 0.5 },
    btnText: { color: c.onPrimary, fontWeight: '800', fontSize: 16 },
    backLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 20 },
    backText: { color: PRIMARY_DARK, fontWeight: '700', fontSize: 14 },
    genderGrid: { gap: 12, marginBottom: 28, marginTop: 4 },
    genderChip: {
        paddingVertical: 14,
        paddingHorizontal: 18,
        borderRadius: 14,
        backgroundColor: c.surfaceSubtle,
        borderWidth: 1.5,
        borderColor: c.primaryBorder,
        alignItems: 'center',
    },
    genderChipActive: { backgroundColor: c.primarySoft, borderColor: PRIMARY },
    genderText: { fontSize: 15, fontWeight: '700', color: MUTED },
    genderTextActive: { color: PRIMARY_DARK },
    completingOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: c.backgroundAlt,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
        gap: 16,
    },
    completingText: { fontSize: 16, fontWeight: '700', color: INK },
    });
}

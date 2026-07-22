import {
    Ionicons } from '@expo/vector-icons';
import DateTimePicker,
    { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect,
    useMemo,
    useState } from 'react';
import {
    ActivityIndicator,
    Image,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Alert } from '../lib/nexoAlert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getAuthUser } from '../lib/auth';
import { uploadAvatarFromUri } from '../lib/avatar';
import { clearPendingVerifyEmail } from '../lib/emailVerification';
import { useT } from '../lib/i18n';
import { saveOnboardingPreferences } from '../lib/onboarding';
import { clearPendingSignup } from '../lib/pendingSignup';
import {
    prepareCachesForNewUser,
    warmAppCaches,
} from '../lib/prefetchHome';
import {
    AFICIONES_OPTIONS,
    calcAge,
    getPersonalityLabel,
    ONBOARDING_GENERO_OPTIONS,
    type Genero,
} from '../lib/profileFields';
import { supabase } from '../lib/supabase';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';

const MIN_AGE = 18;
const MAX_AGE = 99;
const PERSONALITY_MIN = 1;
const PERSONALITY_MAX = 3;
const TOTAL_STEPS = 4;

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
    const maxBirthDate = useMemo(() => dateYearsAgo(MIN_AGE), []);
    const minBirthDate = useMemo(() => dateYearsAgo(MAX_AGE), []);
    const [step, setStep] = useState(0);
    const [birthDate, setBirthDate] = useState<Date>(maxBirthDate);
    const [showDatePicker, setShowDatePicker] = useState(Platform.OS === 'ios');
    const [genero, setGenero] = useState<Genero | null>(null);
    const [avatarUri, setAvatarUri] = useState<string | null>(null);
    const [personalities, setPersonalities] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);
    const [completing, setCompleting] = useState(false);
    const [bootstrapped, setBootstrapped] = useState(false);

    useEffect(() => {
        let alive = true;
        void (async () => {
            const user = await getAuthUser();
            if (!alive) return;
            if (!user) {
                router.replace('/login');
                return;
            }
            setBootstrapped(true);
            void warmAppCaches(user);
        })();
        return () => {
            alive = false;
        };
    }, [router]);

    const ageFromBirth = calcAge(toIsoDate(birthDate));
    const birthValid =
        ageFromBirth != null && ageFromBirth >= MIN_AGE && ageFromBirth <= MAX_AGE;
    const personalitiesValid =
        personalities.length >= PERSONALITY_MIN && personalities.length <= PERSONALITY_MAX;

    const togglePersonality = (tag: string) => {
        setPersonalities((prev) => {
            if (prev.includes(tag)) return prev.filter((p) => p !== tag);
            if (prev.length >= PERSONALITY_MAX) {
                Alert.alert(t('onboarding.notice'), t('onboarding.personalitiesLimit', { n: PERSONALITY_MAX }));
                return prev;
            }
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

    const onBirthChange = (_: DateTimePickerEvent, selected?: Date) => {
        if (Platform.OS === 'android') setShowDatePicker(false);
        if (selected) setBirthDate(selected);
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
        if (saving || completing) return;

        setSaving(true);
        setCompleting(true);
        try {
            const authUser = await getAuthUser();
            if (!authUser) {
                router.replace('/login');
                return;
            }
            const userId = authUser.id;

            const { url, error: uploadError } = await uploadAvatarFromUri(userId, avatarUri);
            if (uploadError || !url) {
                Alert.alert(t('onboarding.error'), uploadError ?? t('profile.uploadError'));
                setCompleting(false);
                return;
            }

            const { error } = await saveOnboardingPreferences(userId, {
                fecha_nacimiento: toIsoDate(birthDate),
                genero,
                avatar_url: url,
                ambientes_preferidos: personalities,
            });
            if (error) {
                Alert.alert(t('onboarding.error'), error);
                setCompleting(false);
                return;
            }

            await clearPendingSignup();
            await clearPendingVerifyEmail();

            prepareCachesForNewUser(authUser.id);
            void warmAppCaches(authUser);

            router.replace('/(tabs)');
        } catch (e) {
            const msg = e instanceof Error ? e.message : t('onboarding.error');
            Alert.alert(t('onboarding.error'), msg);
            setCompleting(false);
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
            <LinearGradient colors={['#DCEBFF', '#F2F7FF', '#FFFFFF']} style={StyleSheet.absoluteFill} />

            {!bootstrapped ? (
                <View style={styles.completingOverlay}>
                    <ActivityIndicator size="large" color={PRIMARY_DARK} />
                </View>
            ) : null}

            {completing ? (
                <View style={styles.completingOverlay}>
                    <ActivityIndicator size="large" color={PRIMARY_DARK} />
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
                    >
                        <View style={styles.header}>
                            <View style={styles.logoBadge}>
                                <Ionicons name="person-circle-outline" size={32} color={PRIMARY_DARK} />
                            </View>
                            <Text style={styles.title}>{t('onboarding.welcomeTitle')}</Text>
                            <Text style={styles.subtitle}>{t('onboarding.welcomeSub')}</Text>
                        </View>

                        <View style={styles.card}>
                            {renderStepDots()}

                            {step === 0 && (
                                <>
                                    <Pressable
                                        onPress={async () => {
                                            await clearPendingSignup();
                                            await clearPendingVerifyEmail();
                                            await supabase.auth.signOut({ scope: 'local' });
                                            router.replace('/login');
                                        }}
                                        style={styles.backLink}
                                    >
                                        <Ionicons name="chevron-back" size={18} color={PRIMARY_DARK} />
                                        <Text style={styles.backText}>{t('onboarding.cancelRegister')}</Text>
                                    </Pressable>
                                    <Text style={styles.question}>{t('onboarding.birthQuestion')}</Text>
                                    <Text style={styles.hint}>{t('onboarding.birthHint')}</Text>
                                    {Platform.OS === 'android' && (
                                        <TouchableOpacity
                                            style={styles.dateBtn}
                                            onPress={() => setShowDatePicker(true)}
                                            activeOpacity={0.85}
                                        >
                                            <Ionicons name="calendar-outline" size={22} color={PRIMARY_DARK} />
                                            <Text style={styles.dateBtnText}>
                                                {birthDate.toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', {
                                                    day: 'numeric',
                                                    month: 'long',
                                                    year: 'numeric',
                                                })}
                                            </Text>
                                        </TouchableOpacity>
                                    )}
                                    {(showDatePicker || Platform.OS === 'ios') && (
                                        <DateTimePicker
                                            value={birthDate}
                                            mode="date"
                                            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                                            onChange={onBirthChange}
                                            maximumDate={maxBirthDate}
                                            minimumDate={minBirthDate}
                                            locale={lang === 'en' ? 'en-GB' : 'es-ES'}
                                            style={styles.datePicker}
                                        />
                                    )}
                                    {ageFromBirth != null && (
                                        <Text style={styles.agePreview}>
                                            {t('onboarding.birthAgePreview', { age: ageFromBirth })}
                                        </Text>
                                    )}
                                    <TouchableOpacity
                                        style={[styles.btn, !birthValid && styles.btnDisabled]}
                                        onPress={() => birthValid && setStep(1)}
                                        disabled={!birthValid}
                                        activeOpacity={0.9}
                                    >
                                        <Text style={styles.btnText}>{t('onboarding.continue')}</Text>
                                        <Ionicons name="arrow-forward" size={18} color="#FFF" />
                                    </TouchableOpacity>
                                </>
                            )}

                            {step === 1 && (
                                <>
                                    <Pressable onPress={() => setStep(0)} style={styles.backLink}>
                                        <Ionicons name="chevron-back" size={18} color={PRIMARY_DARK} />
                                        <Text style={styles.backText}>{t('onboarding.back')}</Text>
                                    </Pressable>
                                    <Text style={styles.question}>{t('onboarding.genderQuestion')}</Text>
                                    <View style={styles.genderGrid}>
                                        {ONBOARDING_GENERO_OPTIONS.map((g) => (
                                            <TouchableOpacity
                                                key={g}
                                                style={[styles.genderChip, genero === g && styles.genderChipActive]}
                                                onPress={() => setGenero(g)}
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
                                        onPress={() => genero && setStep(2)}
                                        disabled={!genero}
                                        activeOpacity={0.9}
                                    >
                                        <Text style={styles.btnText}>{t('onboarding.continue')}</Text>
                                        <Ionicons name="arrow-forward" size={18} color="#FFF" />
                                    </TouchableOpacity>
                                </>
                            )}

                            {step === 2 && (
                                <>
                                    <Pressable onPress={() => setStep(1)} style={styles.backLink}>
                                        <Ionicons name="chevron-back" size={18} color={PRIMARY_DARK} />
                                        <Text style={styles.backText}>{t('onboarding.back')}</Text>
                                    </Pressable>
                                    <Text style={styles.question}>{t('onboarding.photoQuestion')}</Text>
                                    <Text style={styles.hint}>{t('onboarding.photoHint')}</Text>
                                    <View style={styles.photoPicker}>
                                        {avatarUri ? (
                                            <Image source={{ uri: avatarUri }} style={styles.photoPreview} />
                                        ) : (
                                            <View style={styles.photoPlaceholder}>
                                                <Ionicons name="person" size={36} color={PRIMARY_DARK} />
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
                                            <Ionicons name="camera" size={20} color={PRIMARY_DARK} />
                                            <Text style={styles.photoActionText}>{t('profile.camera')}</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={styles.photoActionBtn}
                                            onPress={() => void pickPhoto(false)}
                                            activeOpacity={0.85}
                                        >
                                            <Ionicons name="images" size={20} color={PRIMARY_DARK} />
                                            <Text style={styles.photoActionText}>{t('profile.gallery')}</Text>
                                        </TouchableOpacity>
                                    </View>
                                    <TouchableOpacity
                                        style={[styles.btn, !avatarUri && styles.btnDisabled]}
                                        onPress={() => avatarUri && setStep(3)}
                                        disabled={!avatarUri}
                                        activeOpacity={0.9}
                                    >
                                        <Text style={styles.btnText}>{t('onboarding.continue')}</Text>
                                        <Ionicons name="arrow-forward" size={18} color="#FFF" />
                                    </TouchableOpacity>
                                </>
                            )}

                            {step === 3 && (
                                <>
                                    <Pressable onPress={() => setStep(2)} style={styles.backLink}>
                                        <Ionicons name="chevron-back" size={18} color={PRIMARY_DARK} />
                                        <Text style={styles.backText}>{t('onboarding.back')}</Text>
                                    </Pressable>
                                    <Text style={styles.question}>{t('onboarding.personalitiesQuestion')}</Text>
                                    <View style={styles.personalityGrid}>
                                        {AFICIONES_OPTIONS.map((tag) => {
                                            const active = personalities.includes(tag);
                                            return (
                                                <TouchableOpacity
                                                    key={tag}
                                                    style={[styles.personalityChip, active && styles.personalityChipActive]}
                                                    onPress={() => togglePersonality(tag)}
                                                    activeOpacity={0.85}
                                                >
                                                    <Text style={[styles.personalityText, active && styles.personalityTextActive]}>
                                                        {getPersonalityLabel(tag, genero, t)}
                                                    </Text>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                    <TouchableOpacity
                                        onPress={handleFinish}
                                        disabled={!personalitiesValid || saving}
                                        activeOpacity={0.9}
                                        style={styles.btnWrapper}
                                    >
                                        <LinearGradient
                                            colors={personalitiesValid ? [PRIMARY, PRIMARY_DARK] : ['#CBD5E1', '#94A3B8']}
                                            style={styles.btn}
                                        >
                                            {saving ? (
                                                <ActivityIndicator color="#FFF" />
                                            ) : (
                                                <>
                                                    <Text style={styles.btnText}>{t('onboarding.finish')}</Text>
                                                    <Ionicons name="checkmark" size={20} color="#FFF" />
                                                </>
                                            )}
                                        </LinearGradient>
                                    </TouchableOpacity>
                                </>
                            )}
                        </View>
                    </ScrollView>
                </KeyboardAvoidingView>
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    flex: { flex: 1 },
    safe: { flex: 1 },
    scroll: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 32, justifyContent: 'center' },
    header: { alignItems: 'center', marginBottom: 28, marginTop: 20 },
    logoBadge: {
        width: 64,
        height: 64,
        borderRadius: 20,
        backgroundColor: '#FFF',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
        shadowColor: PRIMARY_DARK,
        shadowOpacity: 0.12,
        shadowRadius: 12,
        elevation: 4,
    },
    title: { fontSize: 26, fontWeight: '900', color: INK, textAlign: 'center' },
    subtitle: { fontSize: 15, color: MUTED, textAlign: 'center', marginTop: 8, lineHeight: 22, paddingHorizontal: 12 },
    card: {
        backgroundColor: '#FFF',
        borderRadius: 28,
        padding: 24,
        shadowColor: '#1E3A8A',
        shadowOpacity: 0.1,
        shadowRadius: 20,
        elevation: 8,
    },
    steps: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
    stepGroup: { flexDirection: 'row', alignItems: 'center' },
    stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E2E8F0' },
    stepDotActive: { backgroundColor: PRIMARY_DARK, width: 10, height: 10, borderRadius: 5 },
    stepLine: { width: 20, height: 2, backgroundColor: '#E2E8F0', marginHorizontal: 4 },
    stepLineActive: { backgroundColor: PRIMARY },
    question: { fontSize: 20, fontWeight: '800', color: INK, textAlign: 'center', marginBottom: 8 },
    hint: { fontSize: 13, color: MUTED, textAlign: 'center', marginBottom: 20 },
    dateBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        backgroundColor: '#F8FAFC',
        borderRadius: 16,
        borderWidth: 1.5,
        borderColor: '#E3ECFB',
        paddingVertical: 16,
        paddingHorizontal: 18,
        marginBottom: 12,
    },
    dateBtnText: { fontSize: 16, fontWeight: '700', color: INK, flexShrink: 1 },
    datePicker: { alignSelf: 'center', marginBottom: 8 },
    agePreview: {
        fontSize: 14,
        fontWeight: '600',
        color: MUTED,
        textAlign: 'center',
        marginBottom: 20,
    },
    photoPicker: {
        alignSelf: 'center',
        marginBottom: 24,
        borderRadius: 999,
        overflow: 'hidden',
    },
    photoPreview: { width: 140, height: 140, borderRadius: 70 },
    photoPlaceholder: {
        width: 140,
        height: 140,
        borderRadius: 70,
        backgroundColor: '#EFF6FF',
        borderWidth: 2,
        borderColor: '#BFDBFE',
        borderStyle: 'dashed',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    photoPlaceholderText: { fontSize: 13, fontWeight: '700', color: PRIMARY_DARK },
    photoActions: {
        flexDirection: 'row',
        gap: 10,
        marginBottom: 20,
        justifyContent: 'center',
    },
    photoActionBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: '#EFF6FF',
        borderWidth: 1.5,
        borderColor: '#BFDBFE',
        borderRadius: 14,
        paddingVertical: 14,
    },
    photoActionText: { fontSize: 14, fontWeight: '800', color: PRIMARY_DARK },
    personalityGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginTop: 20,
        marginBottom: 20,
        justifyContent: 'center',
    },
    personalityChip: {
        paddingVertical: 14,
        paddingHorizontal: 18,
        borderRadius: 22,
        backgroundColor: '#F8FAFC',
        borderWidth: 1.5,
        borderColor: '#E3ECFB',
    },
    personalityChipActive: { backgroundColor: '#EFF6FF', borderColor: PRIMARY },
    personalityText: { fontSize: 15, fontWeight: '700', color: MUTED },
    personalityTextActive: { color: PRIMARY_DARK },
    btnWrapper: { borderRadius: 16, overflow: 'hidden', marginTop: 8 },
    btn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 16,
        borderRadius: 16,
        backgroundColor: PRIMARY_DARK,
    },
    btnDisabled: { opacity: 0.5 },
    btnText: { color: '#FFF', fontWeight: '800', fontSize: 16 },
    backLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 16 },
    backText: { color: PRIMARY_DARK, fontWeight: '700', fontSize: 14 },
    genderGrid: { gap: 10, marginBottom: 20 },
    genderChip: {
        paddingVertical: 14,
        paddingHorizontal: 18,
        borderRadius: 14,
        backgroundColor: '#F8FAFC',
        borderWidth: 1.5,
        borderColor: '#E3ECFB',
        alignItems: 'center',
    },
    genderChipActive: { backgroundColor: '#EFF6FF', borderColor: PRIMARY },
    genderText: { fontSize: 15, fontWeight: '700', color: MUTED },
    genderTextActive: { color: PRIMARY_DARK },
    completingOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: '#F2F7FF',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
        gap: 16,
    },
    completingText: { fontSize: 16, fontWeight: '700', color: INK },
});

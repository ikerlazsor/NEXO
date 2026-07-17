import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getAuthUser } from '../lib/auth';
import { uploadAvatarFromUri } from '../lib/avatar';
import { useT } from '../lib/i18n';
import { saveOnboardingPreferences } from '../lib/onboarding';
import { AFICIONES_OPTIONS, ONBOARDING_GENERO_OPTIONS, type Genero } from '../lib/profileFields';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';

const MIN_AGE = 18;
const MAX_AGE = 99;
const PERSONALITY_COUNT = 3;
const TOTAL_STEPS = 4;

export default function OnboardingScreen() {
    const router = useRouter();
    const { t } = useT();
    const [step, setStep] = useState(0);
    const [age, setAge] = useState('');
    const [genero, setGenero] = useState<Genero | null>(null);
    const [avatarUri, setAvatarUri] = useState<string | null>(null);
    const [personalities, setPersonalities] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);
    const [completing, setCompleting] = useState(false);

    const parsedAge = parseInt(age, 10);
    const ageValid = Number.isFinite(parsedAge) && parsedAge >= MIN_AGE && parsedAge <= MAX_AGE;
    const personalitiesValid = personalities.length === PERSONALITY_COUNT;

    const togglePersonality = (tag: string) => {
        setPersonalities((prev) => {
            if (prev.includes(tag)) return prev.filter((p) => p !== tag);
            if (prev.length >= PERSONALITY_COUNT) {
                Alert.alert(t('onboarding.notice'), t('onboarding.personalitiesLimit', { n: PERSONALITY_COUNT }));
                return prev;
            }
            return [...prev, tag];
        });
    };

    const pickPhoto = async (useCamera: boolean) => {
        const result = useCamera
            ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.5 })
            : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.5 });

        if (!result.canceled && result.assets[0]?.uri) {
            setAvatarUri(result.assets[0].uri);
        }
    };

    const showPhotoMenu = () => {
        Alert.alert(t('onboarding.photoTitle'), t('onboarding.photoChoice'), [
            { text: t('profile.camera'), onPress: () => pickPhoto(true) },
            { text: t('profile.gallery'), onPress: () => pickPhoto(false) },
            { text: t('profile.cancel'), style: 'cancel' },
        ]);
    };

    const handleFinish = async () => {
        if (!ageValid) {
            Alert.alert(t('onboarding.notice'), t('onboarding.ageInvalid'));
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
            Alert.alert(t('onboarding.notice'), t('onboarding.pickPersonalities', { n: PERSONALITY_COUNT }));
            return;
        }
        if (saving || completing) return;

        setSaving(true);
        setCompleting(true);
        try {
            const user = await getAuthUser();
            if (!user) {
                router.replace('/login');
                return;
            }

            const { url, error: uploadError } = await uploadAvatarFromUri(user.id, avatarUri);
            if (uploadError || !url) {
                Alert.alert(t('onboarding.error'), uploadError ?? t('profile.uploadError'));
                return;
            }

            const { error } = await saveOnboardingPreferences(user.id, {
                age: parsedAge,
                genero,
                avatar_url: url,
                ambientes_preferidos: personalities,
            });
            if (error) {
                Alert.alert(t('onboarding.error'), error);
                setCompleting(false);
                return;
            }
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
                                    <Text style={styles.question}>{t('onboarding.ageQuestion')}</Text>
                                    <Text style={styles.hint}>{t('onboarding.ageHint')}</Text>
                                    <TextInput
                                        style={styles.ageInput}
                                        value={age}
                                        onChangeText={(v) => setAge(v.replace(/[^0-9]/g, '').slice(0, 2))}
                                        placeholder="18"
                                        placeholderTextColor="#94A3B8"
                                        keyboardType="number-pad"
                                        maxLength={2}
                                        autoFocus
                                    />
                                    <TouchableOpacity
                                        style={[styles.btn, !ageValid && styles.btnDisabled]}
                                        onPress={() => ageValid && setStep(1)}
                                        disabled={!ageValid}
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
                                    <TouchableOpacity style={styles.photoPicker} onPress={showPhotoMenu} activeOpacity={0.9}>
                                        {avatarUri ? (
                                            <Image source={{ uri: avatarUri }} style={styles.photoPreview} />
                                        ) : (
                                            <View style={styles.photoPlaceholder}>
                                                <Ionicons name="camera" size={36} color={PRIMARY_DARK} />
                                                <Text style={styles.photoPlaceholderText}>{t('onboarding.addPhoto')}</Text>
                                            </View>
                                        )}
                                    </TouchableOpacity>
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
                                    <Text style={styles.hint}>
                                        {t('onboarding.personalitiesHint', { n: PERSONALITY_COUNT })}
                                        {' · '}
                                        {personalities.length}/{PERSONALITY_COUNT}
                                    </Text>
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
                                                        {t('personality.' + tag)}
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
    ageInput: {
        fontSize: 48,
        fontWeight: '900',
        color: INK,
        textAlign: 'center',
        backgroundColor: '#F8FAFC',
        borderRadius: 20,
        paddingVertical: 20,
        borderWidth: 2,
        borderColor: '#E3ECFB',
        marginBottom: 24,
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
    personalityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20, justifyContent: 'center' },
    personalityChip: {
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 20,
        backgroundColor: '#F8FAFC',
        borderWidth: 1.5,
        borderColor: '#E3ECFB',
    },
    personalityChipActive: { backgroundColor: '#EFF6FF', borderColor: PRIMARY },
    personalityText: { fontSize: 13, fontWeight: '700', color: MUTED },
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

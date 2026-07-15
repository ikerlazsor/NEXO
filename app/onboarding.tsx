import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
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
import { useT } from '../lib/i18n';
import { saveOnboardingPreferences } from '../lib/onboarding';
import { GENERO_OPTIONS, type Genero } from '../lib/profileFields';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';

const MIN_AGE = 18;
const MAX_AGE = 99;

export default function OnboardingScreen() {
    const router = useRouter();
    const { t } = useT();
    const [step, setStep] = useState(0);
    const [age, setAge] = useState('');
    const [genero, setGenero] = useState<Genero | null>(null);
    const [saving, setSaving] = useState(false);

    const parsedAge = parseInt(age, 10);
    const ageValid = Number.isFinite(parsedAge) && parsedAge >= MIN_AGE && parsedAge <= MAX_AGE;

    const handleFinish = async () => {
        if (!ageValid) {
            Alert.alert(t('onboarding.notice'), t('onboarding.ageInvalid'));
            return;
        }
        if (!genero) {
            Alert.alert(t('onboarding.notice'), t('onboarding.pickGender'));
            return;
        }
        if (saving) return;

        setSaving(true);
        try {
            const user = await getAuthUser();
            if (!user) {
                router.replace('/login');
                return;
            }
            const { error } = await saveOnboardingPreferences(user.id, {
                age: parsedAge,
                genero,
            });
            if (error) {
                Alert.alert(t('onboarding.error'), error);
                return;
            }
            router.replace('/(tabs)');
        } catch (e) {
            const msg = e instanceof Error ? e.message : t('onboarding.error');
            Alert.alert(t('onboarding.error'), msg);
        } finally {
            setSaving(false);
        }
    };

    return (
        <View style={styles.root}>
            <LinearGradient colors={['#DCEBFF', '#F2F7FF', '#FFFFFF']} style={StyleSheet.absoluteFill} />

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
                            <View style={styles.steps}>
                                <View style={[styles.stepDot, step >= 0 && styles.stepDotActive]} />
                                <View style={[styles.stepLine, step >= 1 && styles.stepLineActive]} />
                                <View style={[styles.stepDot, step >= 1 && styles.stepDotActive]} />
                            </View>

                            {step === 0 ? (
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
                            ) : (
                                <>
                                    <Pressable onPress={() => setStep(0)} style={styles.backLink}>
                                        <Ionicons name="chevron-back" size={18} color={PRIMARY_DARK} />
                                        <Text style={styles.backText}>{t('onboarding.back')}</Text>
                                    </Pressable>
                                    <Text style={styles.question}>{t('onboarding.genderQuestion')}</Text>
                                    <View style={styles.genderGrid}>
                                        {GENERO_OPTIONS.map((g) => (
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
                                        onPress={handleFinish}
                                        disabled={!genero || saving}
                                        activeOpacity={0.9}
                                        style={styles.btnWrapper}
                                    >
                                        <LinearGradient
                                            colors={genero ? [PRIMARY, PRIMARY_DARK] : ['#CBD5E1', '#94A3B8']}
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
    stepDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#E2E8F0' },
    stepDotActive: { backgroundColor: PRIMARY_DARK, width: 12, height: 12, borderRadius: 6 },
    stepLine: { width: 48, height: 2, backgroundColor: '#E2E8F0', marginHorizontal: 8 },
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
});

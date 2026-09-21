import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Alert } from '../lib/nexoAlert';
import { ingestAuthDeepLink, waitForAuthSession } from '../lib/authDeepLink';
import { useT } from '../lib/i18n';
import { isPasswordPolicyError, isStrongPassword } from '../lib/passwordRules';
import { isPasswordRecoveryPending, setPasswordRecoveryPending } from '../lib/passwordRecovery';
import { supabase } from '../lib/supabase';
import { signOutAndClearLocalData } from '../lib/session';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';
const PLACEHOLDER = '#94A3B8';
const FIELD_BG = '#F5F9FF';
const FIELD_BORDER = '#E3ECFB';

export default function ResetPasswordScreen() {
    const router = useRouter();
    const { t } = useT();
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        let alive = true;
        let settled = false;

        const tryReady = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!alive || settled) return;
            if (session || (await isPasswordRecoveryPending())) {
                settled = true;
                setReady(true);
            }
        };

        void (async () => {
            try {
                const initial = await Linking.getInitialURL();
                try {
                    await ingestAuthDeepLink(initial);
                } catch (e) {
                    if (__DEV__) console.warn('reset-password ingest initial', e);
                }
                if (!alive) return;

                if (await waitForAuthSession(3200)) {
                    await tryReady();
                    if (settled) return;
                }

                const { data: { session } } = await supabase.auth.getSession();
                if (!alive) return;
                if (session || (await isPasswordRecoveryPending())) {
                    settled = true;
                    setReady(true);
                    return;
                }

                Alert.alert(t('login.resetInvalidTitle'), t('login.resetInvalidMsg'));
                router.replace('/login');
            } catch (e) {
                if (!alive) return;
                const msg = e instanceof Error ? e.message : t('login.resetInvalidMsg');
                Alert.alert(t('login.resetInvalidTitle'), msg);
                router.replace('/login');
            }
        })();

        const subLink = Linking.addEventListener('url', ({ url }) => {
            void (async () => {
                try {
                    await ingestAuthDeepLink(url);
                    await tryReady();
                } catch (e) {
                    if (__DEV__) console.warn('reset-password ingest url', e);
                }
            })();
        });

        const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'PASSWORD_RECOVERY' || session) {
                void tryReady();
            }
        });

        return () => {
            alive = false;
            subLink.remove();
            authListener.subscription.unsubscribe();
        };
    }, [router, t]);

    const validatePassword = (pass: string) => isStrongPassword(pass);

    const handleSave = async () => {
        if (!validatePassword(password)) {
            Alert.alert(t('login.weakPassword'), t('login.weakPasswordMsg'));
            return;
        }
        if (password !== confirm) {
            Alert.alert(t('login.notice'), t('login.resetMismatch'));
            return;
        }

        setLoading(true);
        try {
            const { error } = await supabase.auth.updateUser({ password });
            if (error) throw error;
            await setPasswordRecoveryPending(false);
            await signOutAndClearLocalData({ scope: 'local' });
            Alert.alert(t('login.resetDoneTitle'), t('login.resetDoneMsg'));
            router.replace('/login');
        } catch (e: any) {
            const msg = typeof e?.message === 'string' ? e.message : '';
            const errorMessage = isPasswordPolicyError(msg, e?.code)
                ? t('login.weakPasswordMsg')
                : e?.message || t('login.resetInvalidMsg');
            Alert.alert(t('login.authError'), errorMessage);
        } finally {
            setLoading(false);
        }
    };

    if (!ready) {
        return (
            <View style={styles.loadingWrap}>
                <ActivityIndicator size="large" color={PRIMARY_DARK} />
            </View>
        );
    }

    return (
        <View style={styles.root}>
            <LinearGradient colors={['#DCEBFF', '#F2F7FF', '#FFFFFF']} style={StyleSheet.absoluteFill} />
            <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
                <KeyboardAvoidingView
                    style={styles.flex}
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                >
                    <View style={styles.card}>
                        <Text style={styles.title}>{t('login.resetTitle')}</Text>
                        <Text style={styles.sub}>{t('login.resetSub')}</Text>

                        <Text style={styles.label}>{t('login.password')}</Text>
                        <View style={styles.field}>
                            <Ionicons name="lock-closed-outline" size={20} color={PLACEHOLDER} />
                            <TextInput
                                style={styles.input}
                                placeholder="••••••••"
                                placeholderTextColor={PLACEHOLDER}
                                value={password}
                                onChangeText={setPassword}
                                secureTextEntry={!showPassword}
                                autoCapitalize="none"
                            />
                            <TouchableOpacity onPress={() => setShowPassword((v) => !v)}>
                                <Ionicons
                                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                                    size={21}
                                    color={PLACEHOLDER}
                                />
                            </TouchableOpacity>
                        </View>

                        <Text style={styles.label}>{t('login.resetConfirm')}</Text>
                        <View style={styles.field}>
                            <Ionicons name="lock-closed-outline" size={20} color={PLACEHOLDER} />
                            <TextInput
                                style={styles.input}
                                placeholder="••••••••"
                                placeholderTextColor={PLACEHOLDER}
                                value={confirm}
                                onChangeText={setConfirm}
                                secureTextEntry={!showPassword}
                                autoCapitalize="none"
                            />
                        </View>
                        <Text style={styles.hint}>{t('login.weakPasswordMsg')}</Text>

                        <TouchableOpacity
                            onPress={handleSave}
                            disabled={loading}
                            activeOpacity={0.9}
                            style={styles.btnWrap}
                        >
                            <LinearGradient
                                colors={[PRIMARY, PRIMARY_DARK]}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 0 }}
                                style={styles.btn}
                            >
                                {loading ? (
                                    <ActivityIndicator color="#FFF" />
                                ) : (
                                    <Text style={styles.btnText}>{t('login.resetSave')}</Text>
                                )}
                            </LinearGradient>
                        </TouchableOpacity>
                    </View>
                </KeyboardAvoidingView>
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    flex: { flex: 1 },
    safe: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
    loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2F7FF' },
    card: {
        backgroundColor: '#FFF',
        borderRadius: 24,
        padding: 22,
        borderWidth: 1,
        borderColor: FIELD_BORDER,
    },
    title: { fontSize: 22, fontWeight: '900', color: INK, marginBottom: 8 },
    sub: { fontSize: 14, color: MUTED, lineHeight: 20, marginBottom: 20 },
    label: { fontSize: 13, fontWeight: '700', color: MUTED, marginBottom: 8, marginTop: 8 },
    field: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: FIELD_BG,
        borderRadius: 14,
        borderWidth: 1.5,
        borderColor: FIELD_BORDER,
        paddingHorizontal: 14,
    },
    input: { flex: 1, paddingVertical: 14, fontSize: 15.5, color: INK },
    hint: { fontSize: 12, color: PLACEHOLDER, marginTop: 8, marginBottom: 8 },
    btnWrap: { marginTop: 12, borderRadius: 16, overflow: 'hidden' },
    btn: { paddingVertical: 16, alignItems: 'center', borderRadius: 16 },
    btnText: { color: '#FFF', fontWeight: '800', fontSize: 16 },
});

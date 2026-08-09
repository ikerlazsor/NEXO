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
import { useT } from '../lib/i18n';
import { isStrongPassword } from '../lib/passwordRules';
import { setPasswordRecoveryPending } from '../lib/passwordRecovery';
import { supabase } from '../lib/supabase';

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';
const PLACEHOLDER = '#94A3B8';
const FIELD_BG = '#F5F9FF';
const FIELD_BORDER = '#E3ECFB';

function parseAuthParams(url: string): Record<string, string> {
    const out: Record<string, string> = {};
    const collect = (str?: string) => {
        if (!str) return;
        str.split('&').forEach((pair) => {
            const [k, v] = pair.split('=');
            if (k) out[decodeURIComponent(k)] = decodeURIComponent(v || '');
        });
    };
    const qIndex = url.indexOf('?');
    const hIndex = url.indexOf('#');
    if (qIndex !== -1) collect(url.substring(qIndex + 1, hIndex !== -1 ? hIndex : undefined));
    if (hIndex !== -1) collect(url.substring(hIndex + 1));
    return out;
}

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

        const ingestUrl = async (url: string | null) => {
            if (!url) return;
            const params = parseAuthParams(url);
            if (params.access_token && params.refresh_token) {
                await setPasswordRecoveryPending(true);
                const { error } = await supabase.auth.setSession({
                    access_token: params.access_token,
                    refresh_token: params.refresh_token,
                });
                if (error) throw error;
                return;
            }
            if (params.code) {
                await setPasswordRecoveryPending(true);
                const { error } = await supabase.auth.exchangeCodeForSession(params.code);
                if (error) throw error;
            }
        };

        void (async () => {
            try {
                const initial = await Linking.getInitialURL();
                await ingestUrl(initial);
                const { data: { session } } = await supabase.auth.getSession();
                if (!alive) return;
                if (!session) {
                    Alert.alert(t('login.resetInvalidTitle'), t('login.resetInvalidMsg'));
                    router.replace('/login');
                    return;
                }
                setReady(true);
            } catch (e) {
                if (!alive) return;
                const msg = e instanceof Error ? e.message : t('login.resetInvalidMsg');
                Alert.alert(t('login.resetInvalidTitle'), msg);
                router.replace('/login');
            }
        })();

        const sub = Linking.addEventListener('url', ({ url }) => {
            void ingestUrl(url).catch(() => undefined);
        });

        return () => {
            alive = false;
            sub.remove();
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
            await supabase.auth.signOut({ scope: 'local' });
            Alert.alert(t('login.resetDoneTitle'), t('login.resetDoneMsg'));
            router.replace('/login');
        } catch (e: any) {
            Alert.alert(t('login.authError'), e?.message || t('login.resetInvalidMsg'));
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

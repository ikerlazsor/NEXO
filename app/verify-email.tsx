import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { authRedirectPath, ingestAuthDeepLink } from '../lib/authDeepLink';
import { getAuthUser } from '../lib/auth';
import {
    clearPendingVerifyEmail,
    getPendingVerifyEmail,
    isEmailVerified,
    setPendingVerifyEmail,
} from '../lib/emailVerification';
import { useT } from '../lib/i18n';
import { clearPendingSignup } from '../lib/pendingSignup';
import { deleteAccount, ensureProfile } from '../lib/profile';
import { getMyProfile } from '../lib/profileData';
import { holdAppUpdateReload } from '../lib/appUpdates';
import { supabase } from '../lib/supabase';
import { signOutAndClearLocalData } from '../lib/session';

const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';
const OTP_LEN = 6;

function digitsOnly(value: string) {
    return value.replace(/\D/g, '').slice(0, OTP_LEN);
}

export default function VerifyEmailScreen() {
    const router = useRouter();
    const { t } = useT();
    const codeRef = useRef<TextInput>(null);
    const [email, setEmail] = useState<string | null>(null);
    const [code, setCode] = useState('');
    const [checking, setChecking] = useState(true);
    const [verifying, setVerifying] = useState(false);
    const [resending, setResending] = useState(false);
    const [changingEmail, setChangingEmail] = useState(false);

    const goNext = useCallback(async () => {
        await clearPendingVerifyEmail();
        await clearPendingSignup();
        const user = await getAuthUser();
        if (user) {
            await ensureProfile(user).catch(() => {});
        }
        router.replace('/onboarding');
    }, [router]);

    const ingestUrl = useCallback(async (url: string | null) => ingestAuthDeepLink(url), []);

    const refreshStatus = useCallback(async () => {
        const user = await getAuthUser();
        if (user && isEmailVerified(user)) {
            await goNext();
            return true;
        }
        return false;
    }, [goNext]);

    useEffect(() => {
        let alive = true;

        void (async () => {
            try {
                const stored = await getPendingVerifyEmail();
                const user = await getAuthUser();
                const mail = stored || user?.email || null;
                if (alive) setEmail(mail);
                if (mail) await setPendingVerifyEmail(mail);

                const initial = await Linking.getInitialURL();
                try {
                    await ingestUrl(initial);
                } catch {
                    // El usuario puede pegar el código
                }
                if (!alive) return;
                if (await refreshStatus()) return;
            } finally {
                if (alive) setChecking(false);
            }
        })();

        const sub = Linking.addEventListener('url', ({ url }) => {
            void (async () => {
                try {
                    await ingestUrl(url);
                    await refreshStatus();
                } catch (e: any) {
                    Alert.alert(t('verifyEmail.error'), e?.message || t('verifyEmail.linkError'));
                }
            })();
        });

        const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
            if (session?.user && isEmailVerified(session.user)) {
                void goNext();
            }
        });

        return () => {
            alive = false;
            sub.remove();
            authListener.subscription.unsubscribe();
        };
    }, [goNext, ingestUrl, refreshStatus, t]);

    const verifyCode = async (value: string) => {
        const token = digitsOnly(value);
        if (!email) {
            Alert.alert(t('verifyEmail.error'), t('verifyEmail.noEmail'));
            return;
        }
        if (token.length !== OTP_LEN) {
            Alert.alert(t('verifyEmail.error'), t('verifyEmail.codeIncomplete'));
            return;
        }
        if (verifying) return;
        setVerifying(true);
        const releaseUpdateHold = holdAppUpdateReload();
        try {
            // El código puede venir del alta por OTP ('email') o del correo de
            // confirmación clásico ('signup'): se prueban los dos.
            const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
            if (error) {
                const retry = await supabase.auth.verifyOtp({ email, token, type: 'signup' });
                if (retry.error) throw retry.error;
            }
            await refreshStatus();
        } catch (e: any) {
            const msg = typeof e?.message === 'string' ? e.message : '';
            Alert.alert(
                t('verifyEmail.error'),
                /rate limit|too many|security purposes/i.test(msg)
                    ? t('verifyEmail.tooMany')
                    : t('verifyEmail.invalidCode'),
            );
        } finally {
            releaseUpdateHold();
            setVerifying(false);
        }
    };

    const handleCodeChange = (value: string) => {
        const next = digitsOnly(value);
        setCode(next);
        if (next.length === OTP_LEN) {
            void verifyCode(next);
        }
    };

    const handleResend = async () => {
        if (!email) {
            Alert.alert(t('verifyEmail.error'), t('verifyEmail.noEmail'));
            return;
        }
        setResending(true);
        try {
            const redirectTo = authRedirectPath('verify-email');
            // Mismo envío que en login; si la cuenta espera confirmación clásica, se reenvía esa.
            const { error } = await supabase.auth.signInWithOtp({
                email,
                options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
            });
            if (error) {
                const retry = await supabase.auth.resend({
                    type: 'signup',
                    email,
                    options: { emailRedirectTo: redirectTo },
                });
                if (retry.error) throw retry.error;
            }
            setCode('');
            Alert.alert(t('verifyEmail.resentTitle'), t('verifyEmail.resentMsg'));
        } catch (e: any) {
            const msg = typeof e?.message === 'string' ? e.message : '';
            Alert.alert(
                t('verifyEmail.error'),
                /rate limit|too many|security purposes/i.test(msg)
                    ? t('verifyEmail.tooMany')
                    : t('verifyEmail.resendError'),
            );
        } finally {
            setResending(false);
        }
    };

    const handleChangeEmail = () => {
        if (changingEmail) return;
        Alert.alert(t('verifyEmail.changeEmailConfirmTitle'), t('verifyEmail.changeEmailConfirmMsg'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
                text: t('verifyEmail.changeEmailConfirm'),
                style: 'destructive',
                onPress: () => {
                    void (async () => {
                        setChangingEmail(true);
                        try {
                            let deleted = false;
                            const user = await getAuthUser();
                            if (user) {
                                const { data: profile, error: profileError } = await getMyProfile();
                                // Una cuenta ya terminada, o que no se pudo leer, no se borra al cambiar el email.
                                if (!profileError && profile?.registro_completado !== true) {
                                    const { error } = await deleteAccount();
                                    deleted = !error && error !== 'account_already_registered';
                                }
                            }
                            if (!deleted) {
                                await signOutAndClearLocalData({ scope: 'local' });
                            }
                        } finally {
                            await clearPendingVerifyEmail();
                            await clearPendingSignup();
                            setChangingEmail(false);
                            router.replace('/login');
                        }
                    })();
                },
            },
        ]);
    };

    const busy = checking || verifying || resending || changingEmail;

    return (
        <View style={styles.root}>
            <LinearGradient colors={['#DCEBFF', '#F2F7FF', '#FFFFFF']} style={StyleSheet.absoluteFill} />
            <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                    style={styles.flex}
                >
                    <View style={styles.card}>
                        <View style={styles.iconWrap}>
                            <Ionicons name="keypad-outline" size={40} color={PRIMARY_DARK} />
                        </View>
                        <Text style={styles.title}>{t('verifyEmail.title')}</Text>
                        <Text style={styles.sub}>{t('verifyEmail.sub')}</Text>
                        {email ? <Text style={styles.email}>{email}</Text> : null}
                        <Text style={styles.hint}>{t('verifyEmail.hint')}</Text>

                        <TextInput
                            ref={codeRef}
                            value={code}
                            onChangeText={handleCodeChange}
                            keyboardType="number-pad"
                            textContentType="oneTimeCode"
                            autoComplete="one-time-code"
                            maxLength={OTP_LEN}
                            placeholder={'0'.repeat(OTP_LEN)}
                            placeholderTextColor="#94A3B8"
                            style={styles.codeInput}
                            editable={!busy}
                            caretHidden={false}
                            autoFocus
                        />

                        <TouchableOpacity
                            style={[styles.primaryBtn, (busy || code.length !== OTP_LEN) && styles.primaryBtnDisabled]}
                            onPress={() => void verifyCode(code)}
                            disabled={busy || code.length !== OTP_LEN}
                            activeOpacity={0.9}
                        >
                            {verifying || checking ? (
                                <ActivityIndicator color="#FFF" />
                            ) : (
                                <Text style={styles.primaryText}>{t('verifyEmail.confirmCode')}</Text>
                            )}
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.secondaryBtn}
                            onPress={() => void handleResend()}
                            disabled={busy || !email}
                            activeOpacity={0.85}
                        >
                            {resending ? (
                                <ActivityIndicator color={PRIMARY_DARK} />
                            ) : (
                                <Text style={styles.secondaryText}>{t('verifyEmail.resend')}</Text>
                            )}
                        </TouchableOpacity>

                        <TouchableOpacity
                            onPress={handleChangeEmail}
                            style={styles.linkBtn}
                            disabled={busy}
                        >
                            {changingEmail ? (
                                <ActivityIndicator color={PRIMARY_DARK} />
                            ) : (
                                <Text style={styles.linkText}>{t('verifyEmail.changeEmail')}</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                </KeyboardAvoidingView>
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    flex: { flex: 1, justifyContent: 'center' },
    safe: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
    card: {
        backgroundColor: '#FFF',
        borderRadius: 24,
        padding: 24,
        borderWidth: 1,
        borderColor: '#E3ECFB',
        shadowColor: '#0F2A4A',
        shadowOpacity: 0.06,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 3,
    },
    iconWrap: {
        width: 72,
        height: 72,
        borderRadius: 24,
        backgroundColor: '#EFF6FF',
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'center',
        marginBottom: 16,
    },
    title: {
        fontSize: 24,
        fontWeight: '900',
        color: INK,
        textAlign: 'center',
        marginBottom: 8,
    },
    sub: {
        fontSize: 15,
        color: MUTED,
        textAlign: 'center',
        lineHeight: 22,
    },
    email: {
        marginTop: 12,
        fontSize: 16,
        fontWeight: '800',
        color: PRIMARY_DARK,
        textAlign: 'center',
    },
    hint: {
        marginTop: 14,
        fontSize: 13,
        color: MUTED,
        textAlign: 'center',
        lineHeight: 19,
        marginBottom: 18,
    },
    codeInput: {
        letterSpacing: 10,
        fontSize: 28,
        fontWeight: '800',
        color: INK,
        textAlign: 'center',
        borderWidth: 1,
        borderColor: '#BFDBFE',
        backgroundColor: '#F8FBFF',
        borderRadius: 16,
        paddingVertical: 14,
        marginBottom: 16,
        fontVariant: ['tabular-nums'],
    },
    primaryBtn: {
        backgroundColor: PRIMARY_DARK,
        borderRadius: 16,
        paddingVertical: 15,
        alignItems: 'center',
        marginBottom: 10,
    },
    primaryBtnDisabled: { opacity: 0.55 },
    primaryText: { color: '#FFF', fontWeight: '800', fontSize: 16 },
    secondaryBtn: {
        borderRadius: 16,
        paddingVertical: 14,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#BFDBFE',
        backgroundColor: '#F8FBFF',
        marginBottom: 8,
    },
    secondaryText: { color: PRIMARY_DARK, fontWeight: '800', fontSize: 15 },
    linkBtn: { paddingVertical: 12, alignItems: 'center' },
    linkText: { color: MUTED, fontWeight: '700', fontSize: 14 },
});

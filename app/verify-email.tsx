import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Alert } from '../lib/nexoAlert';
import { getAuthUser } from '../lib/auth';
import {
    clearPendingVerifyEmail,
    getPendingVerifyEmail,
    isEmailVerified,
    setPendingVerifyEmail,
} from '../lib/emailVerification';
import { useT } from '../lib/i18n';
import { clearPendingSignup, getPendingSignup } from '../lib/pendingSignup';
import { deleteAccount, ensureProfile } from '../lib/profile';
import { supabase } from '../lib/supabase';

const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';

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

export default function VerifyEmailScreen() {
    const router = useRouter();
    const { t } = useT();
    const [email, setEmail] = useState<string | null>(null);
    const [checking, setChecking] = useState(true);
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

    const ingestUrl = useCallback(
        async (url: string | null) => {
            if (!url) return false;
            const params = parseAuthParams(url);
            if (params.access_token && params.refresh_token) {
                const { error } = await supabase.auth.setSession({
                    access_token: params.access_token,
                    refresh_token: params.refresh_token,
                });
                if (error) throw error;
                return true;
            }
            if (params.code) {
                const { error } = await supabase.auth.exchangeCodeForSession(params.code);
                if (error) throw error;
                return true;
            }
            if (params.type === 'signup' || params.type === 'email') {
                // Token en query legacy
                if (params.token_hash && params.type) {
                    const { error } = await supabase.auth.verifyOtp({
                        type: 'signup',
                        token_hash: params.token_hash,
                    });
                    if (error) throw error;
                    return true;
                }
            }
            return false;
        },
        [],
    );

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
                    // El usuario puede abrir el enlace otra vez
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

        const poll = setInterval(() => {
            void refreshStatus();
        }, 4000);

        return () => {
            alive = false;
            sub.remove();
            authListener.subscription.unsubscribe();
            clearInterval(poll);
        };
    }, [goNext, ingestUrl, refreshStatus, t]);

    const handleResend = async () => {
        if (!email) {
            Alert.alert(t('verifyEmail.error'), t('verifyEmail.noEmail'));
            return;
        }
        setResending(true);
        try {
            const redirectTo = Linking.createURL('verify-email');
            const { error } = await supabase.auth.resend({
                type: 'signup',
                email,
                options: { emailRedirectTo: redirectTo },
            });
            if (error) throw error;
            Alert.alert(t('verifyEmail.resentTitle'), t('verifyEmail.resentMsg'));
        } catch (e: any) {
            Alert.alert(t('verifyEmail.error'), e?.message || t('verifyEmail.resendError'));
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
                                const { error } = await deleteAccount();
                                deleted = !error;
                            }
                            if (!deleted) {
                                const pending = await getPendingSignup();
                                if (pending?.email && pending?.password) {
                                    const { error: signInError } = await supabase.auth.signInWithPassword({
                                        email: pending.email,
                                        password: pending.password,
                                    });
                                    if (!signInError) {
                                        await deleteAccount();
                                    } else {
                                        await supabase.auth.signOut({ scope: 'local' });
                                    }
                                } else {
                                    await supabase.auth.signOut({ scope: 'local' });
                                }
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

    const handleAlreadyVerified = async () => {
        setChecking(true);
        try {
            await supabase.auth.refreshSession();
            const ok = await refreshStatus();
            if (!ok) {
                Alert.alert(t('verifyEmail.notYetTitle'), t('verifyEmail.notYetMsg'));
            }
        } finally {
            setChecking(false);
        }
    };

    return (
        <View style={styles.root}>
            <LinearGradient colors={['#DCEBFF', '#F2F7FF', '#FFFFFF']} style={StyleSheet.absoluteFill} />
            <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
                <View style={styles.card}>
                    <View style={styles.iconWrap}>
                        <Ionicons name="mail-unread-outline" size={40} color={PRIMARY_DARK} />
                    </View>
                    <Text style={styles.title}>{t('verifyEmail.title')}</Text>
                    <Text style={styles.sub}>{t('verifyEmail.sub')}</Text>
                    {email ? <Text style={styles.email}>{email}</Text> : null}
                    <Text style={styles.hint}>{t('verifyEmail.hint')}</Text>

                    <TouchableOpacity
                        style={styles.primaryBtn}
                        onPress={() => void handleAlreadyVerified()}
                        disabled={checking}
                        activeOpacity={0.9}
                    >
                        {checking ? (
                            <ActivityIndicator color="#FFF" />
                        ) : (
                            <Text style={styles.primaryText}>{t('verifyEmail.iConfirmed')}</Text>
                        )}
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.secondaryBtn}
                        onPress={() => void handleResend()}
                        disabled={resending || !email}
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
                        disabled={changingEmail || resending || checking}
                    >
                        {changingEmail ? (
                            <ActivityIndicator color={PRIMARY_DARK} />
                        ) : (
                            <Text style={styles.linkText}>{t('verifyEmail.changeEmail')}</Text>
                        )}
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
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
        marginBottom: 22,
    },
    primaryBtn: {
        backgroundColor: PRIMARY_DARK,
        borderRadius: 16,
        paddingVertical: 15,
        alignItems: 'center',
        marginBottom: 10,
    },
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

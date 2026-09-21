/*
inicio de sesión / registro — Apple, Google o correo con código
*/
import { Ionicons } from '@expo/vector-icons';
import { Asset } from 'expo-asset';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LoginPenguin, PENGUIN_PERCH_RATIO, PENGUIN_SIZE, type PenguinMood } from '../components/LoginPenguin';
import { useAppTheme, useThemedStyles } from '../lib/appTheme';
import { authRedirectPath } from '../lib/authDeepLink';
import { NEXO_NORMS_URL, NEXO_PRIVACY_URL, NEXO_TERMS_URL, openNexoPage } from '../lib/brand';
import { setPendingVerifyEmail } from '../lib/emailVerification';
import { useT } from '../lib/i18n';
import { Alert } from '../lib/nexoAlert';
import { scheduleOnboardingPrefetch } from '../lib/prefetchHome';
import { ensureProfile } from '../lib/profile';
import {
    isAppleAuthSupported,
    SocialAuthCancelledError,
    SocialAuthConfigError,
    signInWithApple,
    signInWithGoogle,
    type SocialProvider,
} from '../lib/socialAuth';
import { supabase } from '../lib/supabase';
import { type ThemeColors } from '../theme';

const EMAIL_MAX_LENGTH = 120;
const OTP_LEN = 6;

type AuthPhase = 'methods' | 'email' | 'code';

const PENGUIN_IDLE = require('../assets/images/Pinguino idle.png');
const PENGUIN_BLINK = require('../assets/images/pinguino pestaneando.png');
const PENGUIN_LOOK = require('../assets/images/pinguino mirando abajo.png');
const PENGUIN_COVER = require('../assets/images/Pinguino ojos tapados.png');
const PENGUIN_ONE = require('../assets/images/Pinguino un ojo tapado.png');
const PENGUIN_SAD = require('../assets/images/Pinguino triste.png');
void Asset.loadAsync([
    PENGUIN_IDLE,
    PENGUIN_BLINK,
    PENGUIN_LOOK,
    PENGUIN_COVER,
    PENGUIN_ONE,
    PENGUIN_SAD,
]).catch(() => {});

function digitsOnly(value: string) {
    return value.replace(/\D/g, '').slice(0, OTP_LEN);
}

function validateEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function LoginScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { t } = useT();
    const { colors, scheme } = useAppTheme();
    const styles = useThemedStyles(createLoginStyles);

    const [phase, setPhase] = useState<AuthPhase>('methods');
    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [socialLoading, setSocialLoading] = useState<'apple' | 'google' | null>(null);
    const [focused, setFocused] = useState(false);
    const codeRef = useRef<TextInput>(null);

    useEffect(() => {
        if (phase === 'code') {
            const tmr = setTimeout(() => codeRef.current?.focus(), 280);
            return () => clearTimeout(tmr);
        }
    }, [phase]);

    const penguinMood: PenguinMood = useMemo(() => {
        if (focused) return 'lookDown';
        return 'idle';
    }, [focused]);

    const socialErrorMessage = (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error ?? '');
        if (error instanceof SocialAuthConfigError) {
            if (error.message === 'missing_google_web_client') return t('login.googleNotConfigured');
            if (error.message === 'apple_unavailable' || error.message === 'apple_ios_only') {
                return t('login.appleUnavailable');
            }
        }
        if (/provider is not enabled|Unsupported provider|validation_failed/i.test(msg)) {
            return t('login.oauthHint');
        }
        if (msg === 'db_error') return t('login.dbSignupError');
        return msg || t('login.oauthFailed');
    };

    const handleSocialAuth = async (provider: SocialProvider) => {
        if (loading || socialLoading) return;
        setSocialLoading(provider);
        try {
            if (provider === 'apple') {
                await signInWithApple();
            } else {
                await signInWithGoogle();
            }
            scheduleOnboardingPrefetch();
        } catch (error) {
            if (error instanceof SocialAuthCancelledError) return;
            Alert.alert(t('login.authError'), socialErrorMessage(error));
        } finally {
            setSocialLoading(null);
        }
    };

    const sendEmailCode = async () => {
        const mail = email.trim().toLowerCase();
        if (!validateEmail(mail)) {
            Alert.alert(t('login.authError'), t('login.invalidEmailMsg'));
            return;
        }
        if (loading) return;
        setLoading(true);
        try {
            const { error } = await supabase.auth.signInWithOtp({
                email: mail,
                options: {
                    emailRedirectTo: authRedirectPath('auth'),
                    shouldCreateUser: true,
                },
            });
            if (error) throw error;
            await setPendingVerifyEmail(mail);
            setPhase('code');
            setCode('');
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : t('login.authError');
            Alert.alert(t('login.authError'), msg);
        } finally {
            setLoading(false);
        }
    };

    const verifyEmailCode = async (raw?: string) => {
        const mail = email.trim().toLowerCase();
        const token = digitsOnly(raw ?? code);
        if (token.length !== OTP_LEN) return;
        if (loading) return;
        setLoading(true);
        Keyboard.dismiss();
        try {
            const { data, error } = await supabase.auth.verifyOtp({
                email: mail,
                token,
                type: 'email',
            });
            if (error) throw error;
            if (data.user) {
                await ensureProfile(data.user).catch(() => {});
            }
            scheduleOnboardingPrefetch();
            // El root layout enruta a onboarding / feed según registro_completado.
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : t('login.authError');
            Alert.alert(t('login.authError'), msg);
            setCode('');
        } finally {
            setLoading(false);
        }
    };

    const resendCode = async () => {
        if (loading) return;
        await sendEmailCode();
    };

    return (
        <View style={styles.container}>
            <View style={styles.heroGradient} />
            {router.canGoBack() ? (
                <TouchableOpacity
                    style={[styles.closeBtn, { top: Math.max(insets.top, 12) + 4 }]}
                    onPress={() => router.back()}
                    accessibilityLabel={t('common.back')}
                    activeOpacity={0.85}
                >
                    <Ionicons name="close" size={24} color={colors.text} />
                </TouchableOpacity>
            ) : null}

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={styles.flex}
            >
                <ScrollView
                    contentContainerStyle={[
                        styles.scrollContainer,
                        { paddingBottom: Math.max(insets.bottom, 16) + 40 },
                    ]}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="on-drag"
                    showsVerticalScrollIndicator={false}
                >
                    <View style={styles.cardStack}>
                        <View style={styles.penguinPerch} pointerEvents="none">
                            <LoginPenguin mood={penguinMood} />
                        </View>
                        <View style={styles.card}>
                            <Text style={styles.title}>{t('login.authTitle')}</Text>

                            {phase === 'methods' ? (
                                <View style={styles.methods}>
                                    {isAppleAuthSupported() ? (
                                        <TouchableOpacity
                                            style={[styles.methodBtn, styles.methodApple]}
                                            onPress={() => void handleSocialAuth('apple')}
                                            disabled={!!socialLoading || loading}
                                            activeOpacity={0.88}
                                        >
                                            {socialLoading === 'apple' ? (
                                                <ActivityIndicator color="#FFF" />
                                            ) : (
                                                <>
                                                    <Ionicons name="logo-apple" size={22} color="#FFF" />
                                                    <Text style={styles.methodAppleText}>
                                                        {t('login.continueApple')}
                                                    </Text>
                                                </>
                                            )}
                                        </TouchableOpacity>
                                    ) : null}

                                    <TouchableOpacity
                                        style={[styles.methodBtn, styles.methodGoogle]}
                                        onPress={() => void handleSocialAuth('google')}
                                        disabled={!!socialLoading || loading}
                                        activeOpacity={0.88}
                                    >
                                        {socialLoading === 'google' ? (
                                            <ActivityIndicator color={colors.text} />
                                        ) : (
                                            <>
                                                <Ionicons name="logo-google" size={20} color={colors.text} />
                                                <Text style={[styles.methodText, { color: colors.text }]}>
                                                    {t('login.continueGoogle')}
                                                </Text>
                                            </>
                                        )}
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        style={[styles.methodBtn, styles.methodEmail]}
                                        onPress={() => setPhase('email')}
                                        disabled={!!socialLoading || loading}
                                        activeOpacity={0.88}
                                    >
                                        <Ionicons name="mail-outline" size={20} color={colors.onPrimary} />
                                        <Text style={styles.methodEmailText}>{t('login.continueEmail')}</Text>
                                    </TouchableOpacity>
                                </View>
                            ) : null}

                            {phase === 'email' ? (
                                <View style={styles.emailPhase}>
                                    <PressableBack
                                        label={t('login.backToMethods')}
                                        onPress={() => setPhase('methods')}
                                        color={colors.primary}
                                    />
                                    <Text style={styles.phaseHint}>{t('login.emailCodeHint')}</Text>
                                    <View style={[styles.fieldWrapper, focused && styles.fieldWrapperFocused]}>
                                        <Ionicons name="mail-outline" size={20} color={colors.primary} />
                                        <TextInput
                                            placeholder={t('login.emailPlaceholder')}
                                            placeholderTextColor={colors.textSubtle}
                                            keyboardAppearance={scheme}
                                            style={styles.fieldInput}
                                            value={email}
                                            onChangeText={(text) => setEmail(text.slice(0, EMAIL_MAX_LENGTH))}
                                            onFocus={() => setFocused(true)}
                                            onBlur={() => setFocused(false)}
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            keyboardType="email-address"
                                            textContentType="emailAddress"
                                            autoComplete="email"
                                            returnKeyType="send"
                                            onSubmitEditing={() => void sendEmailCode()}
                                            maxLength={EMAIL_MAX_LENGTH}
                                        />
                                    </View>
                                    <TouchableOpacity
                                        style={[styles.primaryBtn, loading && styles.btnDisabled]}
                                        onPress={() => void sendEmailCode()}
                                        disabled={loading}
                                        activeOpacity={0.9}
                                    >
                                        {loading ? (
                                            <ActivityIndicator color={colors.onPrimary} />
                                        ) : (
                                            <Text style={styles.primaryBtnText}>{t('login.sendCode')}</Text>
                                        )}
                                    </TouchableOpacity>
                                </View>
                            ) : null}

                            {phase === 'code' ? (
                                <View style={styles.emailPhase}>
                                    <PressableBack
                                        label={t('login.backToMethods')}
                                        onPress={() => {
                                            setPhase('email');
                                            setCode('');
                                        }}
                                        color={colors.primary}
                                    />
                                    <Text style={styles.phaseTitle}>{t('login.codeTitle')}</Text>
                                    <Text style={styles.phaseHint}>
                                        {t('login.codeHint')}
                                        {'\n'}
                                        <Text style={styles.emailHighlight}>{email.trim().toLowerCase()}</Text>
                                    </Text>
                                    <TextInput
                                        ref={codeRef}
                                        style={styles.codeInput}
                                        value={code}
                                        onChangeText={(text) => {
                                            const next = digitsOnly(text);
                                            setCode(next);
                                            if (next.length === OTP_LEN) void verifyEmailCode(next);
                                        }}
                                        keyboardType="number-pad"
                                        textContentType="oneTimeCode"
                                        autoComplete="one-time-code"
                                        maxLength={OTP_LEN}
                                        placeholder="••••••"
                                        placeholderTextColor={colors.textSubtle}
                                        keyboardAppearance={scheme}
                                    />
                                    <TouchableOpacity
                                        style={[
                                            styles.primaryBtn,
                                            (loading || code.length !== OTP_LEN) && styles.btnDisabled,
                                        ]}
                                        onPress={() => void verifyEmailCode()}
                                        disabled={loading || code.length !== OTP_LEN}
                                        activeOpacity={0.9}
                                    >
                                        {loading ? (
                                            <ActivityIndicator color={colors.onPrimary} />
                                        ) : (
                                            <Text style={styles.primaryBtnText}>{t('login.verifyCode')}</Text>
                                        )}
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={styles.resendBtn}
                                        onPress={() => void resendCode()}
                                        disabled={loading}
                                        activeOpacity={0.8}
                                    >
                                        <Text style={styles.resendText}>{t('login.resendCode')}</Text>
                                    </TouchableOpacity>
                                </View>
                            ) : null}

                            <Text style={styles.legal}>
                                {t('login.legalBefore')}
                                <Text style={styles.legalLink} onPress={() => void openNexoPage(NEXO_TERMS_URL)}>
                                    {t('settings.terms')}
                                </Text>
                                {t('login.legalMid1')}
                                <Text style={styles.legalLink} onPress={() => void openNexoPage(NEXO_NORMS_URL)}>
                                    {t('settings.communityNorms')}
                                </Text>
                                {t('login.legalMid2')}
                                <Text style={styles.legalLink} onPress={() => void openNexoPage(NEXO_PRIVACY_URL)}>
                                    {t('settings.privacy')}
                                </Text>
                                {t('login.legalAfter')}
                            </Text>
                        </View>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}

function PressableBack({
    label,
    onPress,
    color,
}: {
    label: string;
    onPress: () => void;
    color: string;
}) {
    return (
        <TouchableOpacity onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 }} activeOpacity={0.8}>
            <Ionicons name="chevron-back" size={18} color={color} />
            <Text style={{ color, fontWeight: '700', fontSize: 14 }}>{label}</Text>
        </TouchableOpacity>
    );
}

function createLoginStyles(c: ThemeColors) {
    return StyleSheet.create({
        container: { flex: 1, backgroundColor: c.backgroundAlt },
        flex: { flex: 1 },
        heroGradient: {
            ...StyleSheet.absoluteFillObject,
            backgroundColor: c.gradientTop,
        },
        closeBtn: {
            position: 'absolute',
            right: 16,
            zIndex: 10,
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: c.surface,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
        },
        scrollContainer: {
            flexGrow: 1,
            justifyContent: 'center',
            paddingHorizontal: 22,
            paddingTop: 72,
        },
        cardStack: {
            position: 'relative',
            marginTop: Math.round(PENGUIN_SIZE * PENGUIN_PERCH_RATIO),
        },
        penguinPerch: {
            position: 'absolute',
            top: -Math.round(PENGUIN_SIZE * PENGUIN_PERCH_RATIO),
            left: 0,
            right: 0,
            alignItems: 'center',
            zIndex: 3,
        },
        card: {
            backgroundColor: c.surface,
            borderRadius: 28,
            paddingHorizontal: 22,
            paddingTop: 28,
            paddingBottom: 22,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
            shadowColor: c.primary,
            shadowOpacity: 0.1,
            shadowRadius: 18,
            elevation: 6,
        },
        title: {
            fontSize: 22,
            fontWeight: '900',
            color: c.text,
            textAlign: 'center',
            marginBottom: 22,
        },
        methods: { gap: 12 },
        methodBtn: {
            minHeight: 56,
            borderRadius: 16,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            paddingHorizontal: 16,
        },
        methodApple: { backgroundColor: '#111827' },
        methodAppleText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
        methodGoogle: {
            backgroundColor: c.surface,
            borderWidth: 1.5,
            borderColor: c.border,
        },
        methodText: { fontSize: 16, fontWeight: '800' },
        methodEmail: { backgroundColor: c.primary },
        methodEmailText: { color: c.onPrimary, fontSize: 16, fontWeight: '800' },
        emailPhase: { gap: 4 },
        phaseTitle: {
            fontSize: 18,
            fontWeight: '800',
            color: c.text,
            textAlign: 'center',
            marginBottom: 6,
        },
        phaseHint: {
            fontSize: 14,
            color: c.textMuted,
            textAlign: 'center',
            lineHeight: 20,
            marginBottom: 16,
        },
        emailHighlight: { fontWeight: '800', color: c.text },
        fieldWrapper: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            backgroundColor: c.surfaceSubtle,
            borderRadius: 14,
            borderWidth: 1.5,
            borderColor: c.border,
            paddingHorizontal: 14,
            minHeight: 54,
            marginBottom: 14,
        },
        fieldWrapperFocused: { borderColor: c.primary },
        fieldInput: { flex: 1, fontSize: 16, color: c.text, paddingVertical: 12 },
        codeInput: {
            alignSelf: 'center',
            width: '100%',
            textAlign: 'center',
            fontSize: 28,
            fontWeight: '800',
            letterSpacing: 10,
            color: c.text,
            backgroundColor: c.surfaceSubtle,
            borderRadius: 14,
            borderWidth: 1.5,
            borderColor: c.border,
            paddingVertical: 16,
            marginBottom: 16,
        },
        primaryBtn: {
            backgroundColor: c.primary,
            borderRadius: 16,
            minHeight: 54,
            alignItems: 'center',
            justifyContent: 'center',
        },
        primaryBtnText: { color: c.onPrimary, fontSize: 16, fontWeight: '800' },
        btnDisabled: { opacity: 0.55 },
        resendBtn: { alignItems: 'center', paddingVertical: 14 },
        resendText: { color: c.primary, fontWeight: '700', fontSize: 14 },
        legal: {
            marginTop: 18,
            fontSize: 12,
            lineHeight: 18,
            color: c.textSubtle,
            textAlign: 'center',
        },
        legalLink: { color: c.primary, fontWeight: '700' },
    });
}

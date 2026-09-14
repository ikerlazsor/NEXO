/*
inicio de sesión / registro
*/
import {
    Ionicons } from '@expo/vector-icons';
import { Asset } from 'expo-asset';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React,
    { useCallback,
    useEffect,
    useMemo,
    useRef,
    useState } from 'react';
import {
    ActivityIndicator,
    Dimensions,
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
import { Alert } from '../lib/nexoAlert';
import { setPendingVerifyEmail, isEmailVerified } from '../lib/emailVerification';
import { useT } from '../lib/i18n';
import { isPasswordPolicyError, isStrongPassword } from '../lib/passwordRules';
import { setPendingSignup } from '../lib/pendingSignup';
import { scheduleOnboardingPrefetch } from '../lib/prefetchHome';
import {
    DISPLAY_NAME_MAX_LENGTH,
    deleteAccount,
    ensureProfile,
    isValidDisplayName,
    normalizeDisplayName,
} from '../lib/profile';
import { resolveOnboardingDone } from '../lib/onboarding';
import {
    isAppleAuthSupported,
    SocialAuthCancelledError,
    SocialAuthConfigError,
    signInWithApple,
    signInWithGoogle,
    type SocialProvider,
} from '../lib/socialAuth';
import { supabase } from '../lib/supabase';
import { signOutAndClearLocalData } from '../lib/session';
import { NEXO_NORMS_URL, NEXO_PRIVACY_URL, NEXO_TERMS_URL, openNexoPage } from '../lib/brand';
import { useAppTheme, useThemedStyles } from '../lib/appTheme';
import { type ThemeColors } from '../theme';

const LOGO = require('../assets/images/nexo-logo-ui.png');
void Asset.fromModule(LOGO).downloadAsync().catch(() => {});

type FieldName = 'nombre' | 'email' | 'password' | null;

/** Borra un auth user incompleto si la contraseña coincide (libera el email). */
async function tryReclaimIncompleteEmail(email: string, password: string): Promise<boolean> {
    const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
    });
    if (error || !data.user) return false;

    const done = await resolveOnboardingDone(
        data.user.id,
        (data.user.user_metadata ?? null) as Record<string, unknown> | null,
    );
    if (done) {
        await signOutAndClearLocalData({ scope: 'local' });
        return false;
    }

    const { error: delError } = await deleteAccount();
    if (delError) {
        // Este flujo auxiliar no debe dejar iniciada una cuenta incompleta.
        await signOutAndClearLocalData({ scope: 'local' });
        return false;
    }
    return true;
}

export default function LoginScreen() {
    const insets = useSafeAreaInsets();
    // Credenciales separadas: login y registro no se mezclan.
    const [loginEmail, setLoginEmail] = useState('');
    const [loginPassword, setLoginPassword] = useState('');
    const [registerEmail, setRegisterEmail] = useState('');
    const [registerPassword, setRegisterPassword] = useState('');
    const [nombre, setNombre] = useState('');
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [focusedField, setFocusedField] = useState<FieldName>(null);
    const [keyboardHeight, setKeyboardHeight] = useState(0);
    const scrollRef = useRef<ScrollView>(null);
    const scrollYRef = useRef(0);
    const fieldRefs = useRef<Partial<Record<Exclude<FieldName, null>, View | null>>>({});
    const inputRefs = useRef<Partial<Record<Exclude<FieldName, null>, TextInput | null>>>({});
    const router = useRouter();
    const { mode } = useLocalSearchParams<{ mode?: string | string[] }>();
    const { t } = useT();
    const { colors, scheme } = useAppTheme();
    const styles = useThemedStyles(createLoginStyles);
    const startOnRegister = (Array.isArray(mode) ? mode[0] : mode) === 'register';
    const [isRegistering, setIsRegistering] = useState(startOnRegister);

    useEffect(() => {
        if (startOnRegister) setIsRegistering(true);
    }, [startOnRegister]);

    const email = isRegistering ? registerEmail : loginEmail;
    const password = isRegistering ? registerPassword : loginPassword;
    const setEmail = isRegistering ? setRegisterEmail : setLoginEmail;
    const setPassword = isRegistering ? setRegisterPassword : setLoginPassword;

    const fieldOrder = useMemo<Exclude<FieldName, null>[]>(
        () => isRegistering
            ? ['nombre', 'email', 'password']
            : ['email', 'password'],
        [isRegistering],
    );

    useEffect(() => {
        const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
        const onShow = Keyboard.addListener(showEvt, (e) => {
            setKeyboardHeight(e.endCoordinates.height);
        });
        const onHide = Keyboard.addListener(hideEvt, () => {
            setKeyboardHeight(0);
        });
        return () => {
            onShow.remove();
            onHide.remove();
        };
    }, []);

    /** Deja visible el campo actual y el siguiente, para poder picarlo con el teclado abierto. */
    const ensureFieldVisible = useCallback((name: Exclude<FieldName, null>, kbH: number) => {
        const idx = fieldOrder.indexOf(name);
        const nextName = idx >= 0 && idx < fieldOrder.length - 1 ? fieldOrder[idx + 1] : null;
        const current = fieldRefs.current[name];
        const next = nextName ? fieldRefs.current[nextName] : null;
        const target = next ?? current;
        if (!target) return;

        target.measureInWindow((_x, y, _w, h) => {
            const winH = Dimensions.get('window').height;
            const visibleBottom = winH - Math.max(kbH, 0) - 14;
            // Si hay siguiente campo, su borde inferior debe quedar por encima del teclado.
            // Si no, solo el actual + un poco de aire.
            const bottom = y + h + (next ? 10 : 8);
            const overflow = bottom - visibleBottom;
            if (overflow <= 6) return;
            scrollRef.current?.scrollTo({
                y: Math.max(0, scrollYRef.current + overflow + 10),
                animated: true,
            });
        });
    }, [fieldOrder]);

    const focusNextField = (name: Exclude<FieldName, null>) => {
        const idx = fieldOrder.indexOf(name);
        const nextName = idx >= 0 && idx < fieldOrder.length - 1 ? fieldOrder[idx + 1] : null;
        if (!nextName) {
            Keyboard.dismiss();
            return;
        }
        inputRefs.current[nextName]?.focus();
    };

    const onFieldFocus = (name: Exclude<FieldName, null>) => {
        setFocusedField(name);
        setTimeout(() => {
            ensureFieldVisible(name, keyboardHeight > 0 ? keyboardHeight : 260);
        }, Platform.OS === 'ios' ? 50 : 80);
        setTimeout(() => {
            ensureFieldVisible(name, keyboardHeight > 0 ? keyboardHeight : 280);
        }, Platform.OS === 'ios' ? 280 : 340);
    };

    useEffect(() => {
        if (!focusedField || keyboardHeight <= 0) return;
        const timer = setTimeout(() => ensureFieldVisible(focusedField, keyboardHeight), 40);
        return () => clearTimeout(timer);
    }, [keyboardHeight, focusedField, isRegistering, ensureFieldVisible]);

    const validatePassword = (pass: string) => isStrongPassword(pass);

    const validateEmail = (mail: string) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(mail.trim());
    };

    const handleForgotPassword = async () => {
        if (!email.trim()) {
            return Alert.alert(t('login.notice'), t('login.resetNeedEmail'));
        }

        setLoading(true);
        try {
            const loginEmail = email.trim().toLowerCase();
            if (!validateEmail(loginEmail)) {
                Alert.alert(t('login.invalidEmail'), t('login.invalidEmailMsg'));
                return;
            }

            const redirectTo = Linking.createURL('reset-password');
            const { error } = await supabase.auth.resetPasswordForEmail(loginEmail, {
                redirectTo,
            });
            if (error) throw error;
            Alert.alert(t('login.resetSentTitle'), t('login.resetSentMsg'));
        } catch (e: any) {
            Alert.alert(t('login.authError'), e?.message || t('login.emailCheckFailed'));
        } finally {
            setLoading(false);
        }
    };

    async function handleAuth() {
        if (!email || !password || (isRegistering && !nombre.trim())) {
            return Alert.alert(t('login.notice'), t('login.fillAll'));
        }

        if (!validateEmail(email)) {
            return Alert.alert(t('login.invalidEmail'), t('login.invalidEmailMsg'));
        }

        if (isRegistering && !validatePassword(password)) {
            return Alert.alert(t('login.weakPassword'), t('login.weakPasswordMsg'));
        }

        const displayName = normalizeDisplayName(nombre);
        if (isRegistering && !isValidDisplayName(displayName)) {
            return Alert.alert(t('login.notice'), t('login.displayNameHint'));
        }

        setLoading(true);
        try {
            if (isRegistering) {
                const registerEmail = email.trim().toLowerCase();
                const redirectTo = Linking.createURL('verify-email');
                const signUpOptions = {
                    emailRedirectTo: redirectTo,
                    data: {
                        nombre: displayName,
                        registro_completado: false,
                    },
                };
                let { data, error } = await supabase.auth.signUp({
                    email: registerEmail,
                    password,
                    options: signUpOptions,
                });
                if (error) throw error;

                if ((data.user?.identities?.length ?? 0) === 0) {
                    const reclaimed = await tryReclaimIncompleteEmail(registerEmail, password);
                    if (!reclaimed) {
                        Alert.alert(t('login.notice'), t('login.emailTaken'));
                        return;
                    }
                    const retry = await supabase.auth.signUp({
                        email: registerEmail,
                        password,
                        options: signUpOptions,
                    });
                    if (retry.error) throw retry.error;
                    data = retry.data;
                    if ((data.user?.identities?.length ?? 0) === 0) {
                        Alert.alert(t('login.notice'), t('login.emailTaken'));
                        return;
                    }
                }

                await setPendingSignup({
                    email: registerEmail,
                    nombre: displayName,
                });
                await setPendingVerifyEmail(registerEmail);

                if (data.session?.user && isEmailVerified(data.session.user)) {
                    const { error: profileError } = await ensureProfile(data.session.user, {
                        nombre: displayName,
                    });
                    if (profileError) {
                        await signOutAndClearLocalData({ scope: 'local' });
                        Alert.alert(
                            t('login.authError'),
                            profileError === 'db_error'
                                ? t('login.dbSignupError')
                                : profileError,
                        );
                        return;
                    }
                    scheduleOnboardingPrefetch();
                    router.replace('/onboarding');
                    return;
                }

                if (data.session?.user) {
                    await ensureProfile(data.session.user, {
                        nombre: displayName,
                    }).catch(() => {});
                }
                scheduleOnboardingPrefetch();
                router.replace('/verify-email');
                return;
            }

            const loginEmail = email.trim().toLowerCase();

            const { data, error } = await supabase.auth.signInWithPassword({
                email: loginEmail,
                password,
            });
            if (error) throw error;

            if (data.user) {
                if (!isEmailVerified(data.user)) {
                    await setPendingVerifyEmail(data.user.email || loginEmail);
                    router.replace('/verify-email');
                    return;
                }
                const { error: profileError } = await ensureProfile(data.user);
                if (profileError) {
                    console.error('Error al crear perfil:', profileError);
                }
            }
        } catch (error: any) {
            const msg = typeof error?.message === 'string' ? error.message : '';
            if (/email not confirmed|email_not_confirmed/i.test(msg)) {
                const fallbackEmail = email.includes('@') ? email.trim().toLowerCase() : null;
                if (fallbackEmail) await setPendingVerifyEmail(fallbackEmail);
                router.replace('/verify-email');
                return;
            }

            let errorMessage = msg || String(error);
            if (msg === 'User already registered'
                || /already\s*(been\s*)?registered|already\s*exists|email.*exist/i.test(msg)) {
                errorMessage = t('login.emailTaken');
            } else if (isPasswordPolicyError(msg, error?.code)) {
                errorMessage = t('login.weakPasswordMsg');
            } else if (msg === 'Invalid login credentials') {
                errorMessage = t('login.invalidCredentials');
            } else if (msg.toLowerCase().includes('database error saving new user')) {
                errorMessage = t('login.dbSignupError');
            }

            Alert.alert(t('login.authError'), errorMessage);
        } finally {
            setLoading(false);
        }
    }

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
        if (loading) return;
        setLoading(true);
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
            setLoading(false);
        }
    };

    const switchMode = (registering: boolean) => {
        if (registering === isRegistering) return;
        setIsRegistering(registering);
        setShowPassword(false);
        setFocusedField(null);
        Keyboard.dismiss();
    };

    const fieldStyle = (name: FieldName) => [
        styles.fieldWrapper,
        focusedField === name && styles.fieldWrapperFocused,
    ];

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
                    ref={scrollRef}
                    contentContainerStyle={[
                        styles.scrollContainer,
                        // Margen bajo para poder subir y dejar visible el siguiente campo.
                        { paddingBottom: Math.max(insets.bottom, 16) + 160 },
                    ]}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="on-drag"
                    showsVerticalScrollIndicator={false}
                    bounces
                    onScroll={(e) => {
                        scrollYRef.current = e.nativeEvent.contentOffset.y;
                    }}
                    scrollEventThrottle={16}
                >
                    {/* ---------- Hero ---------- */}
                    <View style={styles.hero}>
                        <Image
                            source={LOGO}
                            style={styles.logoImage}
                            accessibilityLabel="Nexo!"
                            contentFit="contain"
                            cachePolicy="memory-disk"
                            priority="high"
                            transition={0}
                        />
                    </View>

                    {/* ---------- Tarjeta ---------- */}
                    <View style={styles.card}>
                        <View style={styles.segmented}>
                            <TouchableOpacity
                                testID="auth-mode-login"
                                style={[styles.segmentBtn, !isRegistering && styles.segmentBtnActive]}
                                onPress={() => switchMode(false)}
                                activeOpacity={0.8}
                            >
                                <Text style={[styles.segmentText, !isRegistering && styles.segmentTextActive]}>
                                    {t('login.tabLogin')}
                                </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                testID="auth-mode-register"
                                style={[styles.segmentBtn, isRegistering && styles.segmentBtnActive]}
                                onPress={() => switchMode(true)}
                                activeOpacity={0.8}
                            >
                                <Text style={[styles.segmentText, isRegistering && styles.segmentTextActive]}>
                                    {t('login.tabRegister')}
                                </Text>
                            </TouchableOpacity>
                        </View>

                        {isRegistering && (
                            <>
                                <View
                                    style={styles.fieldBlock}
                                    ref={(r) => {
                                        fieldRefs.current.nombre = r;
                                    }}
                                >
                                    <Text style={styles.label}>{t('login.displayName')}</Text>
                                    <View style={fieldStyle('nombre')}>
                                        <Ionicons name="person-outline" size={20} color={focusedField === 'nombre' ? colors.primary : colors.textSubtle} />
                                        <TextInput
                                            testID="auth-display-name"
                                            placeholder={t('login.displayNamePlaceholder')}
                                            placeholderTextColor={colors.textSubtle}
                                            keyboardAppearance={scheme}
                                            style={styles.fieldInput}
                                            value={nombre}
                                            onChangeText={(text) => setNombre(text.slice(0, DISPLAY_NAME_MAX_LENGTH))}
                                            onFocus={() => onFieldFocus('nombre')}
                                            onBlur={() => setFocusedField(null)}
                                            autoCapitalize="words"
                                            maxLength={DISPLAY_NAME_MAX_LENGTH}
                                            returnKeyType="next"
                                            blurOnSubmit={false}
                                            onSubmitEditing={() => focusNextField('nombre')}
                                            autoComplete="off"
                                            textContentType="none"
                                            importantForAutofill="no"
                                            ref={(r) => {
                                                inputRefs.current.nombre = r;
                                            }}
                                        />
                                    </View>
                                </View>
                            </>
                        )}

                        <View
                            style={styles.fieldBlock}
                            ref={(r) => {
                                fieldRefs.current.email = r;
                            }}
                        >
                            <Text style={styles.label}>
                                {isRegistering ? t('login.email') : t('login.email')}
                            </Text>
                            <View style={fieldStyle('email')}>
                                {isRegistering ? (
                                    <Ionicons name="mail-outline" size={20} color={focusedField === 'email' ? colors.primary : colors.textSubtle} />
                                ) : null}
                                <TextInput
                                    testID="auth-email"
                                    key={isRegistering ? 'reg-email' : 'login-email'}
                                    placeholder={
                                        isRegistering
                                            ? t('login.emailPlaceholder')
                                            : t('login.emailPlaceholder')
                                    }
                                    placeholderTextColor={colors.textSubtle}
                                    keyboardAppearance={scheme}
                                    style={styles.fieldInput}
                                    value={email}
                                    onChangeText={setEmail}
                                    onFocus={() => onFieldFocus('email')}
                                    onBlur={() => setFocusedField(null)}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    keyboardType="email-address"
                                    returnKeyType="next"
                                    blurOnSubmit={false}
                                    onSubmitEditing={() => focusNextField('email')}
                                    autoComplete={isRegistering ? 'email' : 'username'}
                                    textContentType="emailAddress"
                                    importantForAutofill="no"
                                    ref={(r) => {
                                        inputRefs.current.email = r;
                                    }}
                                />
                            </View>
                        </View>

                        <View
                            style={styles.fieldBlock}
                            ref={(r) => {
                                fieldRefs.current.password = r;
                            }}
                        >
                            <Text style={styles.label}>{t('login.password')}</Text>
                            <View style={fieldStyle('password')}>
                                <Ionicons name="lock-closed-outline" size={20} color={focusedField === 'password' ? colors.primary : colors.textSubtle} />
                                <TextInput
                                    testID="auth-password"
                                    key={isRegistering ? 'reg-password' : 'login-password'}
                                    placeholder="••••••••"
                                    placeholderTextColor={colors.textSubtle}
                                    keyboardAppearance={scheme}
                                    style={styles.fieldInput}
                                    value={password}
                                    onChangeText={setPassword}
                                    onFocus={() => onFieldFocus('password')}
                                    onBlur={() => setFocusedField(null)}
                                    secureTextEntry={!showPassword}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    autoComplete={isRegistering ? 'password-new' : 'password'}
                                    textContentType={isRegistering ? 'newPassword' : 'password'}
                                    importantForAutofill="no"
                                    returnKeyType="done"
                                    onSubmitEditing={handleAuth}
                                    ref={(r) => {
                                        inputRefs.current.password = r;
                                    }}
                                />
                                <TouchableOpacity
                                    style={styles.eyeButton}
                                    onPress={() => setShowPassword(!showPassword)}
                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                >
                                    <Ionicons
                                        name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                                        size={21}
                                        color={colors.textSubtle}
                                    />
                                </TouchableOpacity>
                            </View>
                            {isRegistering && (
                                <Text style={styles.inputHint}>{t('login.weakPasswordMsg')}</Text>
                            )}
                            {!isRegistering && (
                                <TouchableOpacity
                                    onPress={handleForgotPassword}
                                    disabled={loading}
                                    style={styles.forgotBtn}
                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                >
                                    <Text style={styles.forgotText}>{t('login.forgotPassword')}</Text>
                                </TouchableOpacity>
                            )}
                        </View>

                        <TouchableOpacity
                            testID="auth-submit"
                            onPress={handleAuth}
                            disabled={loading}
                            activeOpacity={0.9}
                            style={styles.btnPrimaryWrapper}
                        >
                            <LinearGradient
                                colors={[colors.brand, colors.primary]}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 0 }}
                                style={styles.btnPrimary}
                            >
                                {loading ? (
                                    <ActivityIndicator color="#FFF" />
                                ) : (
                                    <Text style={styles.btnText}>
                                        {isRegistering ? t('login.createAccount') : t('login.enter')}
                                    </Text>
                                )}
                            </LinearGradient>
                        </TouchableOpacity>

                        <View style={styles.socialDivider}>
                            <View style={styles.socialDividerLine} />
                            <Text style={styles.socialDividerText}>{t('login.orContinueWith')}</Text>
                            <View style={styles.socialDividerLine} />
                        </View>
                        <View style={styles.socialRow}>
                            {isAppleAuthSupported() ? (
                                <TouchableOpacity
                                    testID="auth-apple"
                                    onPress={() => void handleSocialAuth('apple')}
                                    disabled={loading}
                                    activeOpacity={0.85}
                                    style={[styles.socialBtn, styles.socialBtnApple]}
                                >
                                    <Ionicons name="logo-apple" size={20} color="#FFF" />
                                    <Text style={styles.socialBtnAppleText}>{t('login.apple')}</Text>
                                </TouchableOpacity>
                            ) : null}
                            <TouchableOpacity
                                testID="auth-google"
                                onPress={() => void handleSocialAuth('google')}
                                disabled={loading}
                                activeOpacity={0.85}
                                style={[
                                    styles.socialBtn,
                                    styles.socialBtnGoogle,
                                    !isAppleAuthSupported() && styles.socialBtnFull,
                                ]}
                            >
                                <Ionicons name="logo-google" size={18} color={colors.text} />
                                <Text style={styles.socialBtnGoogleText}>{t('login.google')}</Text>
                            </TouchableOpacity>
                        </View>
                    </View>

                    <Text style={styles.legalText}>
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

                    <TouchableOpacity
                        style={styles.switchLink}
                        onPress={() => switchMode(!isRegistering)}
                        activeOpacity={0.7}
                    >
                        <Text style={styles.switchLinkText}>
                            {isRegistering ? t('login.haveAccount') : t('login.noAccount')}
                        </Text>
                    </TouchableOpacity>
                </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}

function createLoginStyles(c: ThemeColors) {
    const INK = c.text;
    const MUTED = c.textMuted;
    const PRIMARY = c.brand;
    const PRIMARY_DARK = c.primary;
    const DANGER = c.danger;
    const isDark = c.statusBar !== 'dark';
    const pageBg = isDark ? c.backgroundAlt : '#E2EBF2';
    const fieldBg = isDark ? c.surfaceSubtle : '#F5F9FF';
    const fieldBorder = isDark ? c.border : '#E3ECFB';
    return StyleSheet.create({
    container: { flex: 1, backgroundColor: pageBg },
    closeBtn: {
        position: 'absolute',
        left: 16,
        zIndex: 4,
        width: 44,
        height: 44,
        borderRadius: 15,
        backgroundColor: c.surface,
        alignItems: 'center',
        justifyContent: 'center',
        elevation: 3,
        shadowColor: PRIMARY_DARK,
        shadowOpacity: 0.12,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
    },
    flex: { flex: 1 },
    heroGradient: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 380,
        backgroundColor: pageBg,
        borderBottomLeftRadius: 42,
        borderBottomRightRadius: 42,
    },
    scrollContainer: {
        flexGrow: 1,
        paddingHorizontal: 22,
    },
    hero: {
        alignItems: 'center',
        paddingTop: Platform.OS === 'ios' ? 118 : 96,
        paddingBottom: 36,
    },
    logoImage: {
        width: 104,
        height: 104,
        marginBottom: 0,
    },
    card: {
        backgroundColor: c.surface,
        borderRadius: 28,
        padding: 22,
        shadowColor: '#000',
        shadowOpacity: 0.14,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 12 },
        elevation: 10,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
    },
    segmented: {
        flexDirection: 'row',
        backgroundColor: fieldBg,
        borderRadius: 16,
        padding: 4,
        marginBottom: 22,
        borderWidth: 1,
        borderColor: fieldBorder,
    },
    segmentBtn: {
        flex: 1,
        paddingVertical: 11,
        borderRadius: 12,
        alignItems: 'center',
    },
    segmentBtnActive: {
        backgroundColor: c.surface,
        shadowColor: '#1E3A8A',
        shadowOpacity: 0.1,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: 3,
    },
    segmentText: { fontSize: 14, fontWeight: '700', color: MUTED },
    segmentTextActive: { color: PRIMARY_DARK },
    fieldBlock: { marginBottom: 16 },
    label: {
        fontSize: 13,
        fontWeight: '700',
        color: INK,
        marginBottom: 7,
        marginLeft: 4,
    },
    fieldWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: fieldBg,
        borderRadius: 15,
        borderWidth: 1.5,
        borderColor: fieldBorder,
        paddingHorizontal: 14,
    },
    fieldWrapperFocused: {
        borderColor: PRIMARY,
        backgroundColor: c.surface,
    },
    fieldWrapperError: {
        borderColor: DANGER,
        backgroundColor: '#FEF2F2',
    },
    fieldInputError: {
        color: DANGER,
    },
    atPrefixError: {
        color: DANGER,
    },
    fieldErrorText: {
        marginTop: 6,
        fontSize: 12,
        fontWeight: '700',
        color: DANGER,
    },
    fieldInput: {
        flex: 1,
        paddingVertical: 15,
        fontSize: 15.5,
        fontWeight: '400',
        color: INK,
        letterSpacing: 0,
        textTransform: 'none',
    },
    atPrefix: {
        fontSize: 16,
        fontWeight: '700',
        color: MUTED,
        paddingVertical: 15,
    },
    eyeButton: { padding: 2 },
    inputHint: {
        fontSize: 12,
        color: c.textSubtle,
        fontWeight: '500',
        marginTop: 6,
        marginLeft: 4,
    },
    forgotBtn: { alignSelf: 'flex-end', marginTop: 10 },
    forgotText: { color: PRIMARY_DARK, fontWeight: '700', fontSize: 13.5 },
    btnPrimaryWrapper: {
        marginTop: 6,
        borderRadius: 16,
        shadowColor: PRIMARY_DARK,
        shadowOpacity: 0.35,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 7 },
        elevation: 6,
    },
    btnPrimary: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 17,
        borderRadius: 16,
    },
    btnText: { color: '#FFF', fontWeight: '800', fontSize: 16 },
    socialDivider: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginTop: 18,
        marginBottom: 14,
    },
    socialDividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: fieldBorder },
    socialDividerText: { fontSize: 12, fontWeight: '700', color: MUTED, textTransform: 'uppercase' },
    socialRow: { flexDirection: 'row', gap: 10 },
    socialBtn: {
        flex: 1,
        minHeight: 50,
        borderRadius: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingHorizontal: 12,
    },
    socialBtnFull: { flex: 1 },
    socialBtnApple: { backgroundColor: '#111111' },
    socialBtnAppleText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
    socialBtnGoogle: {
        backgroundColor: c.surface,
        borderWidth: 1.5,
        borderColor: fieldBorder,
    },
    socialBtnGoogleText: { color: INK, fontWeight: '800', fontSize: 15 },
    legalText: {
        marginTop: 16,
        paddingHorizontal: 4,
        fontSize: 12.5,
        lineHeight: 18,
        fontWeight: '500',
        color: MUTED,
        textAlign: 'center',
    },
    legalLink: { color: PRIMARY_DARK, fontWeight: '800' },
    switchLink: { marginTop: 22, alignItems: 'center', paddingVertical: 6 },
    switchLinkText: { color: MUTED, fontWeight: '600', fontSize: 14 },
    });
}

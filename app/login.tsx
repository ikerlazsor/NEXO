/*
inicio de sesión / registro
*/
import {
    Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React,
    { useEffect,
    useRef,
    useState } from 'react';
import {
    ActivityIndicator,
    Image,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Alert } from '../lib/nexoAlert';
import { LangPicker } from '../components/LangPicker';
import { setPendingVerifyEmail, isEmailVerified } from '../lib/emailVerification';
import { useT } from '../lib/i18n';
import { clearPendingSignup } from '../lib/pendingSignup';
import { scheduleOnboardingPrefetch } from '../lib/prefetchHome';
import {
    DISPLAY_NAME_MAX_LENGTH,
    ensureProfile,
    isValidDisplayName,
    isEmailTaken,
    isUsernameTaken,
    isValidUsername,
    normalizeDisplayName,
    formatUsernameInput,
    normalizeUsername,
    getLoginEmailByUsername,
    EmailCheckError,
    UsernameCheckError,
    USERNAME_MAX_LENGTH,
} from '../lib/profile';
import { supabase } from '../lib/supabase';

WebBrowser.maybeCompleteAuthSession();

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';
const PLACEHOLDER = '#94A3B8';
const FIELD_BG = '#F5F9FF';
const FIELD_BORDER = '#E3ECFB';
const DANGER = '#DC2626';

type FieldName = 'nombre' | 'username' | 'email' | 'password' | null;
type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

const parseAuthParams = (url: string): Record<string, string> => {
    const out: Record<string, string> = {};
    const collect = (str?: string) => {
        if (!str) return;
        str.split('&').forEach(pair => {
            const [k, v] = pair.split('=');
            if (k) out[decodeURIComponent(k)] = decodeURIComponent(v || '');
        });
    };
    const qIndex = url.indexOf('?');
    const hIndex = url.indexOf('#');
    if (qIndex !== -1) collect(url.substring(qIndex + 1, hIndex !== -1 ? hIndex : undefined));
    if (hIndex !== -1) collect(url.substring(hIndex + 1));
    return out;
};

export default function LoginScreen() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [nombre, setNombre] = useState('');
    const [username, setUsername] = useState('');
    const [loading, setLoading] = useState(false);
    const [isRegistering, setIsRegistering] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [focusedField, setFocusedField] = useState<FieldName>(null);
    const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
    const usernameCheckGen = useRef(0);
    const router = useRouter();
    const { t, lang, setLang } = useT();

    useEffect(() => {
        if (!isRegistering) {
            setUsernameStatus('idle');
            return;
        }
        const handle = normalizeUsername(username);
        if (!handle) {
            setUsernameStatus('idle');
            return;
        }
        if (!isValidUsername(handle)) {
            setUsernameStatus('invalid');
            return;
        }

        const gen = ++usernameCheckGen.current;
        setUsernameStatus('checking');
        const timer = setTimeout(() => {
            void (async () => {
                try {
                    const taken = await isUsernameTaken(handle);
                    if (usernameCheckGen.current !== gen) return;
                    setUsernameStatus(taken ? 'taken' : 'available');
                } catch {
                    if (usernameCheckGen.current !== gen) return;
                    setUsernameStatus('idle');
                }
            })();
        }, 400);

        return () => clearTimeout(timer);
    }, [username, isRegistering]);

    const validatePassword = (pass: string) => {
        const hasNumber = /\d/.test(pass);
        const isLongEnough = pass.length >= 6;
        return hasNumber && isLongEnough;
    };

    const validateEmail = (mail: string) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(mail.trim());
    };

    const createSessionFromUrl = async (url: string) => {
        const params = parseAuthParams(url);
        if (params.error_description) throw new Error(params.error_description);
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
        return false;
    };

    const handleOAuth = async (provider: 'google' | 'apple') => {
        try {
            setLoading(true);
            const redirectTo = Linking.createURL('auth-callback');
            const { data, error } = await supabase.auth.signInWithOAuth({
                provider,
                options: { redirectTo, skipBrowserRedirect: true },
            });
            if (error) throw error;
            if (!data?.url) throw new Error('No se pudo abrir el proveedor de acceso.');

            const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
            if (result.type === 'success' && result.url) {
                const ok = await createSessionFromUrl(result.url);
                if (ok) {
                    const { data: { session } } = await supabase.auth.getSession();
                    if (session?.user) await ensureProfile(session.user);
                }
            }
        } catch (e: any) {
            Alert.alert(
                t('login.oauthUnavailable'),
                e?.message || t('login.oauthHint')
            );
        } finally {
            setLoading(false);
        }
    };

    const handleForgotPassword = async () => {
        if (!email.trim()) {
            return Alert.alert(t('login.notice'), t('login.resetNeedEmail'));
        }

        setLoading(true);
        try {
            let loginEmail = email.trim().toLowerCase();
            if (!loginEmail.includes('@')) {
                const resolved = await getLoginEmailByUsername(loginEmail.replace(/^@/, ''));
                if (!resolved) {
                    Alert.alert(t('login.notice'), t('login.userNotFound'));
                    return;
                }
                loginEmail = resolved;
            } else if (!validateEmail(loginEmail)) {
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
        if (!email || !password || (isRegistering && (!nombre.trim() || !username.trim()))) {
            return Alert.alert(t('login.notice'), t('login.fillAll'));
        }

        if (isRegistering && !validateEmail(email)) {
            return Alert.alert(t('login.invalidEmail'), t('login.invalidEmailMsg'));
        }

        if (isRegistering && !validatePassword(password)) {
            return Alert.alert(t('login.weakPassword'), t('login.weakPasswordMsg'));
        }

        const displayName = normalizeDisplayName(nombre);
        const handle = normalizeUsername(username);
        if (isRegistering) {
            if (!isValidDisplayName(displayName)) {
                return Alert.alert(t('login.notice'), t('login.displayNameHint'));
            }
            if (!isValidUsername(handle) || usernameStatus === 'invalid') {
                setUsernameStatus('invalid');
                return Alert.alert(t('login.notice'), t('login.usernameInvalid'));
            }
            if (usernameStatus === 'taken') {
                return Alert.alert(t('login.notice'), t('login.usernameTaken'));
            }
        }

        setLoading(true);
        try {
            if (isRegistering) {
                try {
                    const taken = await isUsernameTaken(handle);
                    if (taken) {
                        setUsernameStatus('taken');
                        return Alert.alert(t('login.notice'), t('login.usernameTaken'));
                    }
                } catch (e) {
                    if (e instanceof UsernameCheckError) {
                        return Alert.alert(t('login.notice'), t('login.usernameCheckFailed'));
                    }
                    return Alert.alert(t('login.notice'), t('login.usernameCheckFailed'));
                }

                try {
                    const emailTaken = await isEmailTaken(email);
                    if (emailTaken) {
                        return Alert.alert(t('login.notice'), t('login.emailTaken'));
                    }
                } catch (e) {
                    if (e instanceof EmailCheckError) {
                        return Alert.alert(t('login.notice'), t('login.emailCheckFailed'));
                    }
                    return Alert.alert(t('login.notice'), t('login.emailCheckFailed'));
                }

                const registerEmail = email.trim().toLowerCase();
                const redirectTo = Linking.createURL('verify-email');
                const { data, error } = await supabase.auth.signUp({
                    email: registerEmail,
                    password,
                    options: {
                        emailRedirectTo: redirectTo,
                        data: {
                            nombre: displayName,
                            nombre_usuario: handle,
                            registro_completado: false,
                        },
                    },
                });
                if (error) throw error;

                // Supabase a veces no errora: user sin identities = email ya registrado
                if ((data.user?.identities?.length ?? 0) === 0) {
                    Alert.alert(t('login.notice'), t('login.emailTaken'));
                    return;
                }

                await clearPendingSignup();
                await setPendingVerifyEmail(registerEmail);

                if (data.session?.user && isEmailVerified(data.session.user)) {
                    const { error: profileError } = await ensureProfile(data.session.user, {
                        nombre: displayName,
                        nombreUsuario: handle,
                    });
                    if (profileError) {
                        await supabase.auth.signOut({ scope: 'local' });
                        Alert.alert(
                            t('login.authError'),
                            profileError === 'username_taken' || /unique|duplicate/i.test(profileError)
                                ? t('login.usernameTaken')
                                : profileError === 'db_error'
                                  ? t('login.dbSignupError')
                                  : profileError,
                        );
                        return;
                    }
                    scheduleOnboardingPrefetch();
                    router.replace('/onboarding');
                    return;
                }

                // Confirmación requerida (o sesión aún sin verificar)
                if (data.session?.user) {
                    await ensureProfile(data.session.user, {
                        nombre: displayName,
                        nombreUsuario: handle,
                    }).catch(() => {});
                }
                scheduleOnboardingPrefetch();
                router.replace('/verify-email');
                return;
            }

            let loginEmail = email.trim();
            if (loginEmail.includes('@')) {
                loginEmail = loginEmail.toLowerCase();
                if (!validateEmail(loginEmail)) {
                    Alert.alert(t('login.invalidEmail'), t('login.invalidEmailMsg'));
                    return;
                }
            } else {
                const resolved = await getLoginEmailByUsername(loginEmail.replace(/^@/, ''));
                if (!resolved) {
                    Alert.alert(t('login.authError'), t('login.userNotFound'));
                    return;
                }
                loginEmail = resolved;
            }

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
            } else if (msg === 'Invalid login credentials') {
                errorMessage = 'El correo o la contraseña son incorrectos.';
            } else if (msg.toLowerCase().includes('database error saving new user')) {
                errorMessage = t('login.dbSignupError');
            }

            Alert.alert(t('login.authError'), errorMessage);
        } finally {
            setLoading(false);
        }
    }

    const switchMode = (registering: boolean) => {
        if (registering === isRegistering) return;
        setIsRegistering(registering);
        setPassword('');
        setShowPassword(false);
        setUsernameStatus('idle');
    };

    const fieldStyle = (name: FieldName) => [
        styles.fieldWrapper,
        focusedField === name && styles.fieldWrapperFocused,
        name === 'username' &&
            (usernameStatus === 'taken' || (usernameStatus === 'invalid' && username.length > 0)) &&
            styles.fieldWrapperError,
    ];

    return (
        <View style={styles.container}>
            <LinearGradient
                colors={[PRIMARY_DARK, '#3B82F6', PRIMARY]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.heroGradient}
            />
            <View style={[styles.decorCircle, styles.decorCircleA]} />
            <View style={[styles.decorCircle, styles.decorCircleB]} />

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={styles.flex}
            >
                <ScrollView
                    contentContainerStyle={styles.scrollContainer}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="on-drag"
                    showsVerticalScrollIndicator={false}
                    bounces
                >
                    {/* ---------- Hero ---------- */}
                    <View style={styles.hero}>
                        <Image
                            source={require('../assets/images/nexo-logo.png')}
                            style={styles.logoImage}
                            accessibilityLabel="Nexo"
                            fadeDuration={0}
                        />
                        <Text style={styles.brandTitle}>NEXO</Text>
                    </View>

                    {/* ---------- Tarjeta ---------- */}
                    <View style={styles.card}>
                        <View style={styles.segmented}>
                            <TouchableOpacity
                                style={[styles.segmentBtn, !isRegistering && styles.segmentBtnActive]}
                                onPress={() => switchMode(false)}
                                activeOpacity={0.8}
                            >
                                <Text style={[styles.segmentText, !isRegistering && styles.segmentTextActive]}>
                                    {t('login.tabLogin')}
                                </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.segmentBtn, isRegistering && styles.segmentBtnActive]}
                                onPress={() => switchMode(true)}
                                activeOpacity={0.8}
                            >
                                <Text style={[styles.segmentText, isRegistering && styles.segmentTextActive]}>
                                    {t('login.tabRegister')}
                                </Text>
                            </TouchableOpacity>
                        </View>

                        <View style={styles.langBlock}>
                            <Text style={styles.langLabel}>{t('login.language')}</Text>
                            <LangPicker lang={lang} onChange={setLang} compact />
                        </View>

                        {isRegistering && (
                            <>
                                <View style={styles.fieldBlock}>
                                    <Text style={styles.label}>{t('login.displayName')}</Text>
                                    <View style={fieldStyle('nombre')}>
                                        <Ionicons name="person-outline" size={20} color={focusedField === 'nombre' ? PRIMARY_DARK : PLACEHOLDER} />
                                        <TextInput
                                            placeholder={t('login.displayNamePlaceholder')}
                                            placeholderTextColor={PLACEHOLDER}
                                            style={styles.fieldInput}
                                            value={nombre}
                                            onChangeText={(text) => setNombre(text.slice(0, DISPLAY_NAME_MAX_LENGTH))}
                                            onFocus={() => setFocusedField('nombre')}
                                            onBlur={() => setFocusedField(null)}
                                            autoCapitalize="words"
                                            maxLength={DISPLAY_NAME_MAX_LENGTH}
                                            returnKeyType="next"
                                        />
                                    </View>
                                </View>
                                <View style={styles.fieldBlock}>
                                    <Text style={styles.label}>{t('login.username')}</Text>
                                    <View style={fieldStyle('username')}>
                                        <Text
                                            style={[
                                                styles.atPrefix,
                                                (usernameStatus === 'taken' ||
                                                    (usernameStatus === 'invalid' && username.length > 0)) &&
                                                    styles.atPrefixError,
                                            ]}
                                        >
                                            @
                                        </Text>
                                        <TextInput
                                            placeholder={t('login.usernamePlaceholder')}
                                            placeholderTextColor={PLACEHOLDER}
                                            style={[
                                                styles.fieldInput,
                                                (usernameStatus === 'taken' ||
                                                    (usernameStatus === 'invalid' && username.length > 0)) &&
                                                    styles.fieldInputError,
                                            ]}
                                            value={username}
                                            onChangeText={(text) => setUsername(formatUsernameInput(text))}
                                            onFocus={() => setFocusedField('username')}
                                            onBlur={() => setFocusedField(null)}
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            spellCheck={false}
                                            maxLength={USERNAME_MAX_LENGTH}
                                            returnKeyType="next"
                                        />
                                        {usernameStatus === 'checking' ? (
                                            <ActivityIndicator size="small" color={PRIMARY_DARK} />
                                        ) : usernameStatus === 'available' ? (
                                            <Ionicons name="checkmark-circle" size={22} color="#16A34A" />
                                        ) : null}
                                    </View>
                                    {usernameStatus === 'taken' ? (
                                        <Text style={styles.fieldErrorText}>{t('login.usernameTaken')}</Text>
                                    ) : null}
                                    {usernameStatus === 'invalid' && username.length > 0 ? (
                                        <Text style={styles.fieldErrorText}>{t('login.usernameInvalid')}</Text>
                                    ) : null}
                                </View>
                            </>
                        )}

                        <View style={styles.fieldBlock}>
                            <Text style={styles.label}>
                                {isRegistering ? t('login.email') : t('login.emailOrUsername')}
                            </Text>
                            <View style={fieldStyle('email')}>
                                <Ionicons name="mail-outline" size={20} color={focusedField === 'email' ? PRIMARY_DARK : PLACEHOLDER} />
                                <TextInput
                                    placeholder={
                                        isRegistering
                                            ? t('login.emailPlaceholder')
                                            : t('login.emailOrUsernamePlaceholder')
                                    }
                                    placeholderTextColor={PLACEHOLDER}
                                    style={styles.fieldInput}
                                    value={email}
                                    onChangeText={setEmail}
                                    onFocus={() => setFocusedField('email')}
                                    onBlur={() => setFocusedField(null)}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    keyboardType={isRegistering ? 'email-address' : 'default'}
                                    returnKeyType="next"
                                    autoComplete="off"
                                    textContentType={Platform.OS === 'ios' ? 'none' : 'emailAddress'}
                                    importantForAutofill="no"
                                />
                            </View>
                        </View>

                        <View style={styles.fieldBlock}>
                            <Text style={styles.label}>{t('login.password')}</Text>
                            <View style={fieldStyle('password')}>
                                <Ionicons name="lock-closed-outline" size={20} color={focusedField === 'password' ? PRIMARY_DARK : PLACEHOLDER} />
                                <TextInput
                                    placeholder="••••••••"
                                    placeholderTextColor={PLACEHOLDER}
                                    style={styles.fieldInput}
                                    value={password}
                                    onChangeText={setPassword}
                                    onFocus={() => setFocusedField('password')}
                                    onBlur={() => setFocusedField(null)}
                                    secureTextEntry={!showPassword}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    autoComplete="off"
                                    textContentType={Platform.OS === 'ios' ? 'oneTimeCode' : 'password'}
                                    importantForAutofill="no"
                                    returnKeyType="done"
                                    onSubmitEditing={handleAuth}
                                />
                                <TouchableOpacity
                                    style={styles.eyeButton}
                                    onPress={() => setShowPassword(!showPassword)}
                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                >
                                    <Ionicons
                                        name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                                        size={21}
                                        color={PLACEHOLDER}
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
                            onPress={handleAuth}
                            disabled={loading}
                            activeOpacity={0.9}
                            style={styles.btnPrimaryWrapper}
                        >
                            <LinearGradient
                                colors={[PRIMARY, PRIMARY_DARK]}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 0 }}
                                style={styles.btnPrimary}
                            >
                                {loading ? (
                                    <ActivityIndicator color="#FFF" />
                                ) : (
                                    <>
                                        <Text style={styles.btnText}>
                                            {isRegistering ? t('login.createAccount') : t('login.enter')}
                                        </Text>
                                        <Ionicons name="arrow-forward" size={19} color="#FFF" />
                                    </>
                                )}
                            </LinearGradient>
                        </TouchableOpacity>

                        <View style={styles.dividerRow}>
                            <View style={styles.dividerLine} />
                            <Text style={styles.dividerText}>{t('login.orContinueWith')}</Text>
                            <View style={styles.dividerLine} />
                        </View>

                        <View style={styles.socialRow}>
                            <TouchableOpacity
                                style={styles.socialBtn}
                                onPress={() => handleOAuth('google')}
                                disabled={loading}
                                activeOpacity={0.85}
                            >
                                <Ionicons name="logo-google" size={20} color="#EA4335" />
                                <Text style={styles.socialText}>{t('login.google')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.socialBtn}
                                onPress={() => handleOAuth('apple')}
                                disabled={loading}
                                activeOpacity={0.85}
                            >
                                <Ionicons name="logo-apple" size={22} color={INK} />
                                <Text style={styles.socialText}>{t('login.apple')}</Text>
                            </TouchableOpacity>
                        </View>
                    </View>

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

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F2F7FF' },
    flex: { flex: 1 },
    heroGradient: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 380,
        borderBottomLeftRadius: 42,
        borderBottomRightRadius: 42,
    },
    decorCircle: {
        position: 'absolute',
        borderRadius: 999,
        backgroundColor: 'rgba(255,255,255,0.08)',
    },
    decorCircleA: { width: 220, height: 220, top: -70, right: -60 },
    decorCircleB: { width: 150, height: 150, top: 180, left: -50 },
    scrollContainer: {
        flexGrow: 1,
        paddingHorizontal: 22,
        paddingBottom: 36,
    },
    hero: {
        alignItems: 'center',
        paddingTop: Platform.OS === 'ios' ? 118 : 96,
        paddingBottom: 36,
    },
    logoImage: {
        width: 76,
        height: 76,
        borderRadius: 20,
        marginBottom: 12,
    },
    brandTitle: {
        fontSize: 40,
        fontWeight: '900',
        color: '#FFF',
        letterSpacing: 12,
        marginLeft: 12,
    },
    card: {
        backgroundColor: '#FFF',
        borderRadius: 28,
        padding: 22,
        shadowColor: '#1E3A8A',
        shadowOpacity: 0.14,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 12 },
        elevation: 10,
    },
    segmented: {
        flexDirection: 'row',
        backgroundColor: FIELD_BG,
        borderRadius: 16,
        padding: 4,
        marginBottom: 22,
        borderWidth: 1,
        borderColor: FIELD_BORDER,
    },
    segmentBtn: {
        flex: 1,
        paddingVertical: 11,
        borderRadius: 12,
        alignItems: 'center',
    },
    segmentBtnActive: {
        backgroundColor: '#FFF',
        shadowColor: '#1E3A8A',
        shadowOpacity: 0.1,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: 3,
    },
    segmentText: { fontSize: 14, fontWeight: '700', color: MUTED },
    segmentTextActive: { color: PRIMARY_DARK },
    langBlock: { marginBottom: 18 },
    langLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: MUTED,
        marginBottom: 8,
        marginLeft: 4,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
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
        backgroundColor: FIELD_BG,
        borderRadius: 15,
        borderWidth: 1.5,
        borderColor: FIELD_BORDER,
        paddingHorizontal: 14,
    },
    fieldWrapperFocused: {
        borderColor: PRIMARY,
        backgroundColor: '#FFF',
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
        color: INK,
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
        color: PLACEHOLDER,
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
    dividerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: 18,
    },
    dividerLine: { flex: 1, height: 1, backgroundColor: FIELD_BORDER },
    dividerText: {
        marginHorizontal: 12,
        fontSize: 12.5,
        color: PLACEHOLDER,
        fontWeight: '600',
    },
    socialRow: { flexDirection: 'row', gap: 12 },
    socialBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: '#FFF',
        borderWidth: 1.5,
        borderColor: FIELD_BORDER,
        borderRadius: 15,
        paddingVertical: 13,
    },
    socialText: { fontSize: 15, fontWeight: '700', color: INK },
    switchLink: { marginTop: 22, alignItems: 'center', paddingVertical: 6 },
    switchLinkText: { color: MUTED, fontWeight: '600', fontSize: 14 },
});

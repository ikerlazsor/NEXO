/*
inicio de sesión / registro
*/
import {
    Ionicons } from '@expo/vector-icons';
import { Asset } from 'expo-asset';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import React,
    { useEffect,
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
import { LangPicker } from '../components/LangPicker';
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
    isUsernameTaken,
    isValidUsername,
    normalizeDisplayName,
    formatUsernameInput,
    normalizeUsername,
    UsernameCheckError,
    USERNAME_MAX_LENGTH,
} from '../lib/profile';
import { resolveOnboardingDone } from '../lib/onboarding';
import { supabase } from '../lib/supabase';
import { signOutAndClearLocalData } from '../lib/session';

const LOGO = require('../assets/images/nexo-logo-ui.png');
void Asset.fromModule(LOGO).downloadAsync().catch(() => {});

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
/** Mismo color que el splash / alrededor de la figura del logo */
const BRAND_SURFACE = '#E2EBF2';
const INK = '#0F2A4A';
const MUTED = '#64748B';
const PLACEHOLDER = '#94A3B8';
const FIELD_BG = '#F5F9FF';
const FIELD_BORDER = '#E3ECFB';
const DANGER = '#DC2626';

type FieldName = 'nombre' | 'username' | 'email' | 'password' | null;
type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

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
    const [username, setUsername] = useState('');
    const [loading, setLoading] = useState(false);
    const [isRegistering, setIsRegistering] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [focusedField, setFocusedField] = useState<FieldName>(null);
    const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
    const [keyboardHeight, setKeyboardHeight] = useState(0);
    const usernameCheckGen = useRef(0);
    const scrollRef = useRef<ScrollView>(null);
    const scrollYRef = useRef(0);
    const fieldRefs = useRef<Partial<Record<Exclude<FieldName, null>, View | null>>>({});
    const inputRefs = useRef<Partial<Record<Exclude<FieldName, null>, TextInput | null>>>({});
    const router = useRouter();
    const { t, lang, setLang } = useT();

    const email = isRegistering ? registerEmail : loginEmail;
    const password = isRegistering ? registerPassword : loginPassword;
    const setEmail = isRegistering ? setRegisterEmail : setLoginEmail;
    const setPassword = isRegistering ? setRegisterPassword : setLoginPassword;

    const fieldOrder: Exclude<FieldName, null>[] = isRegistering
        ? ['nombre', 'username', 'email', 'password']
        : ['email', 'password'];

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
    const ensureFieldVisible = (name: Exclude<FieldName, null>, kbH: number) => {
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
    };

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
    }, [keyboardHeight, focusedField, isRegistering]);

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
        if (!email || !password || (isRegistering && (!nombre.trim() || !username.trim()))) {
            return Alert.alert(t('login.notice'), t('login.fillAll'));
        }

        if (!validateEmail(email)) {
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

                const registerEmail = email.trim().toLowerCase();
                const redirectTo = Linking.createURL('verify-email');
                const signUpOptions = {
                    emailRedirectTo: redirectTo,
                    data: {
                        nombre: displayName,
                        nombre_usuario: handle,
                        registro_completado: false,
                    },
                };
                let { data, error } = await supabase.auth.signUp({
                    email: registerEmail,
                    password,
                    options: signUpOptions,
                });
                if (error) throw error;

                // Supabase a veces no errora: user sin identities = email ya registrado
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
                    nombreUsuario: handle,
                });
                await setPendingVerifyEmail(registerEmail);

                if (data.session?.user && isEmailVerified(data.session.user)) {
                    const { error: profileError } = await ensureProfile(data.session.user, {
                        nombre: displayName,
                        nombreUsuario: handle,
                    });
                    if (profileError) {
                        await signOutAndClearLocalData({ scope: 'local' });
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
            } else if (isPasswordPolicyError(msg)) {
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

    const switchMode = (registering: boolean) => {
        if (registering === isRegistering) return;
        setIsRegistering(registering);
        setShowPassword(false);
        setFocusedField(null);
        setUsernameStatus('idle');
        Keyboard.dismiss();
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
            <View style={styles.heroGradient} />

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
                            accessibilityLabel="Nexo"
                            contentFit="contain"
                            cachePolicy="memory-disk"
                            priority="high"
                            transition={0}
                        />
                        <Text style={styles.brandTitle}>NEXO</Text>
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

                        <View style={styles.langBlock}>
                            <Text style={styles.langLabel}>{t('login.language')}</Text>
                            <View style={styles.langPickerWrap}>
                                <LangPicker lang={lang} onChange={setLang} compact />
                            </View>
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
                                        <Ionicons name="person-outline" size={20} color={focusedField === 'nombre' ? PRIMARY_DARK : PLACEHOLDER} />
                                        <TextInput
                                            testID="auth-display-name"
                                            placeholder={t('login.displayNamePlaceholder')}
                                            placeholderTextColor={PLACEHOLDER}
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
                                <View
                                    style={styles.fieldBlock}
                                    ref={(r) => {
                                        fieldRefs.current.username = r;
                                    }}
                                >
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
                                            testID="auth-username"
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
                                            onFocus={() => onFieldFocus('username')}
                                            onBlur={() => setFocusedField(null)}
                                            autoCapitalize="none"
                                            autoCorrect={false}
                                            spellCheck={false}
                                            maxLength={USERNAME_MAX_LENGTH}
                                            returnKeyType="next"
                                            blurOnSubmit={false}
                                            onSubmitEditing={() => focusNextField('username')}
                                            autoComplete="off"
                                            textContentType="none"
                                            importantForAutofill="no"
                                            key="reg-username"
                                            ref={(r) => {
                                                inputRefs.current.username = r;
                                            }}
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
                                    <Ionicons name="mail-outline" size={20} color={focusedField === 'email' ? PRIMARY_DARK : PLACEHOLDER} />
                                ) : null}
                                <TextInput
                                    testID="auth-email"
                                    key={isRegistering ? 'reg-email' : 'login-email'}
                                    placeholder={
                                        isRegistering
                                            ? t('login.emailPlaceholder')
                                            : t('login.emailPlaceholder')
                                    }
                                    placeholderTextColor={PLACEHOLDER}
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
                                    autoComplete="off"
                                    textContentType="oneTimeCode"
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
                                <Ionicons name="lock-closed-outline" size={20} color={focusedField === 'password' ? PRIMARY_DARK : PLACEHOLDER} />
                                <TextInput
                                    testID="auth-password"
                                    key={isRegistering ? 'reg-password' : 'login-password'}
                                    placeholder="••••••••"
                                    placeholderTextColor={PLACEHOLDER}
                                    style={styles.fieldInput}
                                    value={password}
                                    onChangeText={setPassword}
                                    onFocus={() => onFieldFocus('password')}
                                    onBlur={() => setFocusedField(null)}
                                    secureTextEntry={!showPassword}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    autoComplete="off"
                                    textContentType="oneTimeCode"
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
                            testID="auth-submit"
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
    container: { flex: 1, backgroundColor: BRAND_SURFACE },
    flex: { flex: 1 },
    heroGradient: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 380,
        backgroundColor: BRAND_SURFACE,
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
        marginBottom: 10,
    },
    brandTitle: {
        fontSize: 40,
        fontWeight: '900',
        color: INK,
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
    langBlock: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        marginBottom: 10,
        marginTop: -4,
    },
    langLabel: {
        fontSize: 11,
        fontWeight: '700',
        color: MUTED,
        textTransform: 'uppercase',
        letterSpacing: 0.3,
        flexShrink: 0,
    },
    langPickerWrap: { flex: 1, alignItems: 'flex-end' },
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
    switchLink: { marginTop: 22, alignItems: 'center', paddingVertical: 6 },
    switchLinkText: { color: MUTED, fontWeight: '600', fontSize: 14 },
});

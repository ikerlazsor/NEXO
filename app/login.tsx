/*
inicio de sesión / registro
*/
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { LangPicker } from '../components/LangPicker';
import { useT } from '../lib/i18n';
import { ensureProfile, isUsernameTaken, isValidUsername, normalizeUsername, USERNAME_MAX_LENGTH } from '../lib/profile';
import { supabase } from '../lib/supabase';

WebBrowser.maybeCompleteAuthSession();

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';
const MUTED = '#64748B';
const PLACEHOLDER = '#94A3B8';
const FIELD_BG = '#F5F9FF';
const FIELD_BORDER = '#E3ECFB';

type FieldName = 'nombre' | 'email' | 'password' | null;

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

const COMMUNITY_AVATARS = [
    'https://i.pravatar.cc/150?img=32',
    'https://i.pravatar.cc/150?img=11',
    'https://i.pravatar.cc/150?img=18',
    'https://i.pravatar.cc/150?img=21',
    'https://i.pravatar.cc/150?img=20',
    'https://i.pravatar.cc/150?img=12',
];

export default function LoginScreen() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [nombre, setNombre] = useState('');
    const [loading, setLoading] = useState(false);
    const [isRegistering, setIsRegistering] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [focusedField, setFocusedField] = useState<FieldName>(null);
    const router = useRouter();
    const { t, lang, setLang } = useT();

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

    async function handleAuth() {
        if (!email || !password || (isRegistering && !nombre)) {
            return Alert.alert(t('login.notice'), t('login.fillAll'));
        }

        if (!validateEmail(email)) {
            return Alert.alert(t('login.invalidEmail'), t('login.invalidEmailMsg'));
        }

        if (isRegistering && !validatePassword(password)) {
            return Alert.alert(t('login.weakPassword'), t('login.weakPasswordMsg'));
        }

        const trimmedName = normalizeUsername(nombre);
        if (isRegistering) {
            if (!isValidUsername(trimmedName)) {
                return Alert.alert(t('login.notice'), t('login.usernameMaxHint'));
            }
            const taken = await isUsernameTaken(trimmedName);
            if (taken) {
                return Alert.alert(t('login.notice'), t('login.usernameTaken'));
            }
        }

        setLoading(true);
        try {
            if (isRegistering) {
                const { data, error } = await supabase.auth.signUp({
                    email: email.trim(),
                    password,
                    options: { data: { nombre: trimmedName, registro_completado: false } }
                });

                if (error) throw error;

                if (data.user) {
                    const { error: profileError } = await ensureProfile(
                        {
                            ...data.user,
                            user_metadata: { ...data.user.user_metadata, nombre: trimmedName, registro_completado: false },
                        },
                        trimmedName
                    );
                    if (profileError) {
                        console.error('Error al crear perfil:', profileError);
                    }
                }

                if (data.session) {
                    router.replace('/onboarding');
                } else {
                    Alert.alert(t('login.success'), t('login.successMsg'));
                    setIsRegistering(false);
                }
            } else {
                const { data, error } = await supabase.auth.signInWithPassword({
                    email: email.trim(),
                    password
                });
                if (error) throw error;

                if (data.user) {
                    const { error: profileError } = await ensureProfile(data.user);
                    if (profileError) {
                        console.error('Error al crear perfil:', profileError);
                    }
                }
            }
        } catch (error: any) {
            let errorMessage = error.message;
            if (error.message === 'User already registered') {
                errorMessage = 'Este correo electrónico ya está registrado. Intenta iniciar sesión.';
            } else if (error.message === 'Invalid login credentials') {
                errorMessage = 'El correo o la contraseña son incorrectos.';
            } else if (
                typeof error.message === 'string' &&
                error.message.toLowerCase().includes('database error saving new user')
            ) {
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
    };

    const fieldStyle = (name: FieldName) => [
        styles.fieldWrapper,
        focusedField === name && styles.fieldWrapperFocused,
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
                        <View style={styles.logoBadge}>
                            <Ionicons name="people" size={26} color="#FFF" />
                        </View>
                        <Text style={styles.brandTitle}>NEXO</Text>
                        <Text style={styles.brandSubtitle}>
                            {isRegistering ? t('login.subtitleRegister') : t('login.subtitleLogin')}
                        </Text>

                        <View style={styles.communityRow}>
                            <View style={styles.avatarsOverlap}>
                                {COMMUNITY_AVATARS.map((url, index) => (
                                    <Image
                                        key={index}
                                        source={{ uri: url }}
                                        style={[
                                            styles.communityAvatar,
                                            {
                                                marginLeft: index === 0 ? 0 : -10,
                                                zIndex: COMMUNITY_AVATARS.length - index,
                                            },
                                        ]}
                                    />
                                ))}
                            </View>
                            <Text style={styles.communityText}>{t('login.welcomeSub')}</Text>
                        </View>
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
                            <View style={styles.fieldBlock}>
                                <Text style={styles.label}>{t('login.username')}</Text>
                                <View style={fieldStyle('nombre')}>
                                    <Ionicons name="person-outline" size={20} color={focusedField === 'nombre' ? PRIMARY_DARK : PLACEHOLDER} />
                                    <TextInput
                                        placeholder={t('login.usernamePlaceholder')}
                                        placeholderTextColor={PLACEHOLDER}
                                        style={styles.fieldInput}
                                        value={nombre}
                                        onChangeText={(text) => setNombre(text.slice(0, USERNAME_MAX_LENGTH))}
                                        onFocus={() => setFocusedField('nombre')}
                                        onBlur={() => setFocusedField(null)}
                                        autoCapitalize="words"
                                        maxLength={USERNAME_MAX_LENGTH}
                                        returnKeyType="next"
                                    />
                                </View>
                                <Text style={styles.inputHint}>{t('login.usernameMaxHint')}</Text>
                            </View>
                        )}

                        <View style={styles.fieldBlock}>
                            <Text style={styles.label}>{t('login.email')}</Text>
                            <View style={fieldStyle('email')}>
                                <Ionicons name="mail-outline" size={20} color={focusedField === 'email' ? PRIMARY_DARK : PLACEHOLDER} />
                                <TextInput
                                    placeholder={t('login.emailPlaceholder')}
                                    placeholderTextColor={PLACEHOLDER}
                                    style={styles.fieldInput}
                                    value={email}
                                    onChangeText={setEmail}
                                    onFocus={() => setFocusedField('email')}
                                    onBlur={() => setFocusedField(null)}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    keyboardType="email-address"
                                    returnKeyType="next"
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
        paddingTop: Platform.OS === 'ios' ? 76 : 56,
        paddingBottom: 26,
    },
    logoBadge: {
        width: 56,
        height: 56,
        borderRadius: 18,
        backgroundColor: 'rgba(255,255,255,0.18)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.35)',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 14,
    },
    brandTitle: {
        fontSize: 40,
        fontWeight: '900',
        color: '#FFF',
        letterSpacing: 12,
        marginLeft: 12, // compensa el letterSpacing del último carácter
    },
    brandSubtitle: {
        fontSize: 14,
        fontWeight: '600',
        color: 'rgba(255,255,255,0.9)',
        marginTop: 6,
        textAlign: 'center',
        paddingHorizontal: 30,
    },
    communityRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginTop: 18,
        backgroundColor: 'rgba(255,255,255,0.14)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.25)',
        borderRadius: 999,
        paddingVertical: 8,
        paddingHorizontal: 14,
        maxWidth: '96%',
    },
    avatarsOverlap: { flexDirection: 'row', alignItems: 'center' },
    communityAvatar: {
        width: 26,
        height: 26,
        borderRadius: 13,
        borderWidth: 2,
        borderColor: '#FFF',
    },
    communityText: {
        flexShrink: 1,
        fontSize: 12,
        fontWeight: '600',
        color: '#FFF',
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
    fieldInput: {
        flex: 1,
        paddingVertical: 15,
        fontSize: 15.5,
        color: INK,
    },
    eyeButton: { padding: 2 },
    inputHint: {
        fontSize: 12,
        color: PLACEHOLDER,
        fontWeight: '500',
        marginTop: 6,
        marginLeft: 4,
    },
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

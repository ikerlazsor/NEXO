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
import { useT } from '../lib/i18n';
import { ensureProfile, isUsernameTaken, normalizeUsername, USERNAME_MAX_LENGTH } from '../lib/profile';
import { supabase } from '../lib/supabase';

WebBrowser.maybeCompleteAuthSession();

const PRIMARY = '#4DA6FF';
const PRIMARY_DARK = '#2563EB';
const INK = '#0F2A4A';

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
    const [loading, setLoading] = useState(false);
    const [isRegistering, setIsRegistering] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const router = useRouter();
    const { t } = useT();

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
            if (trimmedName.length > USERNAME_MAX_LENGTH) {
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
                    options: { data: { nombre: trimmedName, onboarding_completed: false } }
                });
                
                if (error) throw error;

                if (data.user) {
                    const { error: profileError } = await ensureProfile(
                        {
                            ...data.user,
                            user_metadata: { ...data.user.user_metadata, nombre: trimmedName, onboarding_completed: false },
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

    const communityAvatars = [
        'https://i.pravatar.cc/150?img=32',
        'https://i.pravatar.cc/150?img=11',
        'https://i.pravatar.cc/150?img=18',
        'https://i.pravatar.cc/150?img=21',
        'https://i.pravatar.cc/150?img=20',
        'https://i.pravatar.cc/150?img=12',
        'https://i.pravatar.cc/150?img=8',
    ];

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.container}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
            <LinearGradient colors={['#DCEBFF', '#F2F7FF', '#FFFFFF']} style={StyleSheet.absoluteFill} />
            <ScrollView
                contentContainerStyle={[
                    styles.scrollContainer,
                    isRegistering && styles.scrollContainerRegister,
                ]}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                showsVerticalScrollIndicator={false}
                bounces
                nestedScrollEnabled
            >
                <View style={styles.inner}>
                    <Text style={styles.brandTitle}>NEXO</Text>

                    <View style={styles.welcomeRow}>
                        <View style={styles.avatarsOverlap}>
                            {communityAvatars.map((url, index) => (
                                <Image
                                    key={index}
                                    source={{ uri: url }}
                                    style={[
                                        styles.welcomeAvatar,
                                        {
                                            marginLeft: index === 0 ? 0 : -12,
                                            zIndex: communityAvatars.length - index,
                                        },
                                    ]}
                                />
                            ))}
                        </View>
                            <Text style={styles.welcomeText}>{t('login.welcome')}</Text>
                            <Text style={styles.welcomeSub}>{t('login.welcomeSub')}</Text>
                        </View>

                        <View style={styles.form}>
                            <View style={styles.socialRow}>
                                <TouchableOpacity style={styles.socialBtn} onPress={() => handleOAuth('google')} disabled={loading} activeOpacity={0.85}>
                                    <Ionicons name="logo-google" size={20} color="#EA4335" />
                                    <Text style={styles.socialText}>{t('login.google')}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.socialBtn} onPress={() => handleOAuth('apple')} disabled={loading} activeOpacity={0.85}>
                                    <Ionicons name="logo-apple" size={22} color={INK} />
                                    <Text style={styles.socialText}>{t('login.apple')}</Text>
                                </TouchableOpacity>
                            </View>

                            <View style={styles.dividerRow}>
                                <View style={styles.dividerLine} />
                                <Text style={styles.dividerText}>{t('login.orEmail')}</Text>
                                <View style={styles.dividerLine} />
                            </View>

                            {isRegistering && (
                                <>
                                    <Text style={styles.label}>{t('login.username')}</Text>
                                    <TextInput
                                        placeholder={t('login.usernamePlaceholder')}
                                        placeholderTextColor="#94A3B8"
                                        style={styles.input}
                                        value={nombre}
                                        onChangeText={(text) => setNombre(text.slice(0, USERNAME_MAX_LENGTH))}
                                        autoCapitalize={'words'}
                                        maxLength={USERNAME_MAX_LENGTH}
                                    />
                                    <Text style={styles.inputHint}>{t('login.usernameMaxHint')}</Text>
                                </>
                            )}

                            <Text style={styles.label}>{t('login.email')}</Text>
                            <TextInput
                                placeholder={t('login.emailPlaceholder')}
                                placeholderTextColor="#94A3B8"
                                style={styles.input}
                                value={email}
                                onChangeText={setEmail}
                                autoCapitalize={'none'}
                                keyboardType="email-address"
                            />

                            <Text style={styles.label}>{t('login.password')}</Text>
                            <View style={styles.passwordWrapper}>
                                <TextInput
                                    placeholder="••••••••"
                                    placeholderTextColor="#94A3B8"
                                    style={styles.passwordInput}
                                    value={password}
                                    onChangeText={setPassword}
                                    secureTextEntry={!showPassword}
                                    autoCapitalize={'none'}
                                />
                                <TouchableOpacity 
                                    style={styles.eyeButton} 
                                    onPress={() => setShowPassword(!showPassword)}
                                    activeOpacity={1}
                                >
                                    <Ionicons 
                                        name={showPassword ? "eye-off" : "eye"} 
                                        size={22} 
                                        color="#94A3B8" 
                                    />
                                </TouchableOpacity>
                            </View>

                            <TouchableOpacity 
                                style={styles.btnPrimary} 
                                onPress={handleAuth} 
                                disabled={loading}
                            >
                                {loading ? (
                                    <ActivityIndicator color="#fff" />
                                ) : (
                                    <Text style={styles.btnText}>
                                        {isRegistering ? t('login.createAccount') : t('login.enter')}
                                    </Text>
                                )}
                            </TouchableOpacity>

                            <TouchableOpacity 
                                style={styles.btnSecondary} 
                                onPress={() => {
                                    setIsRegistering(!isRegistering);
                                    setPassword('');
                                }}
                            >
                                <Text style={styles.btnTextSecondary}>
                                    {isRegistering 
                                        ? t('login.haveAccount') 
                                        : t('login.noAccount')}
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F2F7FF' },
    scrollContainer: { flexGrow: 1, justifyContent: 'center', paddingBottom: 40 },
    scrollContainerRegister: { justifyContent: 'flex-start', paddingTop: Platform.OS === 'ios' ? 40 : 24 },
    inner: { padding: 30, paddingBottom: 10 },
    brandTitle: {
        fontSize: 56,
        fontWeight: '900',
        color: INK,
        textAlign: 'center',
        letterSpacing: 10,
        marginTop: 16,
        marginBottom: 28,
    },
    welcomeRow: {
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 28,
        paddingVertical: 10,
    },
    avatarsOverlap: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12
    },
    welcomeAvatar: {
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 2.5,
        borderColor: '#FFF',
    },
    welcomeText: {
        fontSize: 18,
        fontWeight: '800',
        color: INK,
    },
    welcomeSub: { fontSize: 13, fontWeight: '500', color: '#64748B', textAlign: 'center', marginTop: 4, paddingHorizontal: 20 },
    form: { width: '100%', backgroundColor: '#FFF', borderRadius: 26, padding: 22, elevation: 8, shadowColor: '#1E3A8A', shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 10 } },
    socialRow: { flexDirection: 'row', gap: 12, marginBottom: 18 },
    socialBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#FFF', borderWidth: 1.5, borderColor: '#E3ECFB', borderRadius: 16, paddingVertical: 14 },
    socialText: { fontSize: 15, fontWeight: '700', color: INK },
    dividerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
    dividerLine: { flex: 1, height: 1, backgroundColor: '#E3ECFB' },
    dividerText: { marginHorizontal: 12, fontSize: 13, color: '#94A3B8', fontWeight: '600' },
    label: { fontSize: 14, fontWeight: '700', color: INK, marginBottom: 8, marginLeft: 4 },
    inputHint: { fontSize: 12, color: '#94A3B8', marginTop: -14, marginBottom: 16, marginLeft: 4, fontWeight: '500' },
    input: { 
        backgroundColor: '#F2F7FF', 
        padding: 18, 
        borderRadius: 16, 
        marginBottom: 20, 
        fontSize: 16, 
        color: INK,
        borderWidth: 1,
        borderColor: '#E3ECFB'
    },
    passwordWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F2F7FF',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#E3ECFB',
        marginBottom: 20,
    },
    passwordInput: {
        flex: 1,
        padding: 18, 
        fontSize: 16,
        color: '#1E293B',
    },
    eyeButton: {
        paddingRight: 18,
        paddingLeft: 10,
        justifyContent: 'center',
        alignItems: 'center',
    },
    btnPrimary: { 
        backgroundColor: PRIMARY_DARK, 
        padding: 18, 
        borderRadius: 16, 
        alignItems: 'center', 
        marginTop: 10,
        elevation: 4,
        shadowColor: PRIMARY_DARK,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.4,
        shadowRadius: 10
    },
    btnText: { color: '#FFF', fontWeight: '800', fontSize: 16 },
    btnSecondary: { marginTop: 25, alignItems: 'center' },
    btnTextSecondary: { color: '#64748B', fontWeight: '600', fontSize: 14 }
});
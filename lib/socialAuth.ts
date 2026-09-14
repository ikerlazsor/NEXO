import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { GoogleSignin, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin';
import { supabase } from './supabase';
import {
    DISPLAY_NAME_MAX_LENGTH,
    ensureProfile,
    isValidDisplayName,
    normalizeDisplayName,
} from './profile';
import type { User } from '@supabase/supabase-js';

export type SocialProvider = 'google' | 'apple';

export class SocialAuthCancelledError extends Error {
    constructor() {
        super('cancelled');
        this.name = 'SocialAuthCancelledError';
    }
}

export class SocialAuthConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SocialAuthConfigError';
    }
}

let googleConfigured = false;

function googleWebClientId(): string {
    return (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '').trim();
}

function googleIosClientId(): string {
    return (process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '').trim();
}

export function isGoogleAuthConfigured(): boolean {
    return googleWebClientId().length > 0;
}

export function isAppleAuthSupported(): boolean {
    return Platform.OS === 'ios';
}

function clipDisplayName(value: string): string {
    const normalized = normalizeDisplayName(value).slice(0, DISPLAY_NAME_MAX_LENGTH);
    return isValidDisplayName(normalized) ? normalized : normalized;
}

function nameFromUser(user: User, fallback: string): string {
    const meta = user.user_metadata ?? {};
    const candidates = [fallback, meta.nombre, meta.full_name, meta.name, user.email?.split('@')[0]];
    for (const value of candidates) {
        if (typeof value === 'string' && clipDisplayName(value)) {
            return clipDisplayName(value);
        }
    }
    return 'Usuario';
}

function ensureGoogleConfigured() {
    const webClientId = googleWebClientId();
    if (!webClientId) {
        throw new SocialAuthConfigError('missing_google_web_client');
    }
    if (googleConfigured) return;
    GoogleSignin.configure({
        webClientId,
        iosClientId: googleIosClientId() || undefined,
        offlineAccess: false,
    });
    googleConfigured = true;
}

export async function finishSocialSession(user: User, displayName: string): Promise<{ error: string | null }> {
    const nombre = nameFromUser(user, displayName);
    if (!user.user_metadata?.nombre && nombre && nombre !== 'Usuario') {
        await supabase.auth.updateUser({
            data: { nombre, registro_completado: false },
        }).catch(() => {});
    }
    return ensureProfile(user, { nombre });
}

async function randomNonce(): Promise<string> {
    const bytes = await Crypto.getRandomBytesAsync(16);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
    try {
        const payload = token.split('.')[1];
        if (!payload) return null;
        const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
        const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
        // RN/Hermes incluye atob; no usar Buffer.
        const json = globalThis.atob(normalized + pad);
        return JSON.parse(json) as Record<string, unknown>;
    } catch {
        return null;
    }
}

export async function signInWithGoogle(): Promise<User> {
    ensureGoogleConfigured();
    try {
        if (Platform.OS === 'android') {
            await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
        }
        const response = await GoogleSignin.signIn();
        if (response.type === 'cancelled') {
            throw new SocialAuthCancelledError();
        }
        const profileName = response.data?.user?.name ?? '';
        let idToken = response.data?.idToken ?? null;
        if (!idToken) {
            const tokens = await GoogleSignin.getTokens().catch(() => null);
            idToken = tokens?.idToken ?? null;
        }
        if (!idToken) {
            throw new Error('Google no devolvió un token.');
        }

        /**
         * El SDK nativo (sobre todo iOS/AppAuth) mete `nonce` en el id_token pero la
         * versión gratis de google-signin no nos da el raw nonce para Supabase.
         * Si el token trae nonce y no podemos emparejarlo, Supabase exige
         * "Skip nonce check" en Authentication → Providers → Google
         * (recomendado oficialmente para Expo + Google Sign-In nativo).
         * No pasamos `nonce` aquí a propósito: o no hay claim, o el dashboard lo salta.
         */
        const claims = decodeJwtPayload(idToken);
        const tokenHasNonce = typeof claims?.nonce === 'string' && claims.nonce.length > 0;

        const { data, error } = await supabase.auth.signInWithIdToken({
            provider: 'google',
            token: idToken,
        });
        if (error) {
            const msg = String(error.message || error);
            if (tokenHasNonce && /nonce/i.test(msg)) {
                throw new Error(
                    'Google auth: activa “Skip nonce check” en Supabase (Authentication → Providers → Google). El login nativo no puede enviar el nonce emparejado.',
                );
            }
            throw error;
        }
        if (!data.user) throw new Error('No se pudo iniciar sesión con Google.');
        const { error: profileError } = await finishSocialSession(data.user, profileName);
        if (profileError) throw new Error(profileError);
        return data.user;
    } catch (error) {
        if (error instanceof SocialAuthCancelledError) throw error;
        if (isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED) {
            throw new SocialAuthCancelledError();
        }
        throw error;
    }
}

export async function signInWithApple(): Promise<User> {
    if (Platform.OS !== 'ios') {
        throw new SocialAuthConfigError('apple_ios_only');
    }
    const available = await AppleAuthentication.isAvailableAsync();
    if (!available) {
        throw new SocialAuthConfigError('apple_unavailable');
    }

    // Apple: hashed → Apple, raw → Supabase (ambos deben existir y coincidir).
    const rawNonce = await randomNonce();
    const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce,
    );

    let credential: AppleAuthentication.AppleAuthenticationCredential;
    try {
        credential = await AppleAuthentication.signInAsync({
            requestedScopes: [
                AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
                AppleAuthentication.AppleAuthenticationScope.EMAIL,
            ],
            nonce: hashedNonce,
        });
    } catch (error) {
        const code = (error as { code?: string })?.code;
        if (code === 'ERR_REQUEST_CANCELED' || code === 'ERR_CANCELED') {
            throw new SocialAuthCancelledError();
        }
        throw error;
    }

    if (!credential.identityToken) {
        throw new Error('Apple no devolvió un token.');
    }

    const appleName = [credential.fullName?.givenName, credential.fullName?.familyName]
        .filter(Boolean)
        .join(' ');

    const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
        nonce: rawNonce,
    });
    if (error) throw error;
    if (!data.user) throw new Error('No se pudo iniciar sesión con Apple.');
    const { error: profileError } = await finishSocialSession(data.user, appleName);
    if (profileError) throw new Error(profileError);
    return data.user;
}


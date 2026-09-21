import * as Linking from 'expo-linking';
import { setPasswordRecoveryPending } from './passwordRecovery';
import { supabase } from './supabase';

/** URL de retorno estable para emails de auth (prod → nexo://…). */
export function authRedirectPath(path: string): string {
    const clean = path.replace(/^\//, '');
    if (__DEV__) return Linking.createURL(clean);
    return `nexo://${clean}`;
}

export function parseAuthParams(url: string): Record<string, string> {
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

function isAuthCallbackUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return (
        lower.includes('reset-password') ||
        lower.includes('verify-email') ||
        lower.includes('access_token=') ||
        lower.includes('refresh_token=') ||
        lower.includes('token_hash=') ||
        /[?&#]code=/.test(lower)
    );
}

let ingestInflight: Promise<boolean> | null = null;

/**
 * Intercambia tokens/código del enlace de email (una sola vez).
 * Devuelve true si estableció sesión o activó recuperación de contraseña.
 */
export async function ingestAuthDeepLink(url: string | null | undefined): Promise<boolean> {
    if (!url || !isAuthCallbackUrl(url)) return false;
    if (ingestInflight) return ingestInflight;

    ingestInflight = (async () => {
        const params = parseAuthParams(url);
        const isRecovery =
            params.type === 'recovery' ||
            url.toLowerCase().includes('reset-password');

        if (params.access_token && params.refresh_token) {
            if (isRecovery) await setPasswordRecoveryPending(true);
            const { error } = await supabase.auth.setSession({
                access_token: params.access_token,
                refresh_token: params.refresh_token,
            });
            if (error) throw error;
            return true;
        }

        if (params.code) {
            if (isRecovery) await setPasswordRecoveryPending(true);
            const { error } = await supabase.auth.exchangeCodeForSession(params.code);
            if (error) throw error;
            return true;
        }

        if (params.token_hash) {
            const otpType =
                params.type === 'recovery'
                    ? 'recovery'
                    : params.type === 'signup' || params.type === 'email'
                      ? 'signup'
                      : null;
            if (!otpType) return false;
            if (otpType === 'recovery') await setPasswordRecoveryPending(true);
            const { error } = await supabase.auth.verifyOtp({
                type: otpType,
                token_hash: params.token_hash,
            });
            if (error) throw error;
            return true;
        }

        return false;
    })();

    try {
        return await ingestInflight;
    } finally {
        ingestInflight = null;
    }
}

/** Espera breve a que la sesión exista tras abrir un deep link (arranque en frío). */
export async function waitForAuthSession(maxMs = 3500): Promise<boolean> {
    const started = Date.now();
    while (Date.now() - started < maxMs) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) return true;
        await new Promise((r) => setTimeout(r, 120));
    }
    return false;
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from '@supabase/supabase-js';

const KEY = '@nexo_pending_verify_email';

export function isEmailVerified(user: User | null | undefined): boolean {
    if (!user) return false;
    // Confirmado, o proveedor OAuth (Google/Apple) sin confirmar email suelto
    if (user.email_confirmed_at) return true;
    const providers = user.app_metadata?.providers;
    if (Array.isArray(providers) && providers.some((p) => p === 'google' || p === 'apple')) {
        return true;
    }
    return false;
}

/**
 * Un código pedido y no usado deja de atar la app pasado este tiempo (los
 * códigos caducan antes). Sin caducidad, quien abandonaba el registro tras
 * escribir su correo quedaba sin sesión y obligado a «Confirma tu email» en
 * cada arranque, sin poder explorar como invitado.
 */
export const PENDING_VERIFY_TTL_MS = 30 * 60 * 1000;

export async function setPendingVerifyEmail(email: string): Promise<void> {
    await AsyncStorage.setItem(KEY, JSON.stringify({ email: email.trim().toLowerCase(), at: Date.now() }));
}

/** Correo pendiente si sigue vigente. Formato antiguo (texto plano, sin fecha): caducado. */
export function parsePendingVerifyEmail(raw: string | null, now = Date.now()): string | null {
    if (!raw) return null;
    try {
        const value = JSON.parse(raw) as { email?: unknown; at?: unknown };
        const email = typeof value?.email === 'string' ? value.email.trim().toLowerCase() : '';
        const at = typeof value?.at === 'number' ? value.at : NaN;
        if (!email.includes('@') || !Number.isFinite(at)) return null;
        return now - at <= PENDING_VERIFY_TTL_MS ? email : null;
    } catch {
        return null;
    }
}

export async function getPendingVerifyEmail(): Promise<string | null> {
    try {
        const raw = await AsyncStorage.getItem(KEY);
        const email = parsePendingVerifyEmail(raw);
        if (raw && !email) await AsyncStorage.removeItem(KEY);
        return email;
    } catch {
        return null;
    }
}

export async function clearPendingVerifyEmail(): Promise<void> {
    await AsyncStorage.removeItem(KEY);
}

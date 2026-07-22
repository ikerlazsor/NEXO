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

export async function setPendingVerifyEmail(email: string): Promise<void> {
    await AsyncStorage.setItem(KEY, email.trim().toLowerCase());
}

export async function getPendingVerifyEmail(): Promise<string | null> {
    try {
        const raw = await AsyncStorage.getItem(KEY);
        const email = raw?.trim().toLowerCase() ?? '';
        return email.includes('@') ? email : null;
    } catch {
        return null;
    }
}

export async function clearPendingVerifyEmail(): Promise<void> {
    await AsyncStorage.removeItem(KEY);
}

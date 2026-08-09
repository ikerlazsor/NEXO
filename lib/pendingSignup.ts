import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@nexo_pending_signup';

export type PendingSignup = {
    email: string;
    nombre: string;
    nombreUsuario: string;
};

export async function setPendingSignup(data: PendingSignup): Promise<void> {
    await AsyncStorage.setItem(KEY, JSON.stringify(data));
}

export async function getPendingSignup(): Promise<PendingSignup | null> {
    try {
        const raw = await AsyncStorage.getItem(KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as PendingSignup;
        if (
            !parsed?.email ||
            !parsed?.nombre ||
            !parsed?.nombreUsuario
        ) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

export async function clearPendingSignup(): Promise<void> {
    await AsyncStorage.removeItem(KEY);
}

export async function hasPendingSignup(): Promise<boolean> {
    return (await getPendingSignup()) != null;
}

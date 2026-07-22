import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@nexo_password_recovery';

let memoryPending = false;

/** Marca que el usuario abrió el enlace de recuperar contraseña (sesión temporal). */
export async function setPasswordRecoveryPending(pending: boolean): Promise<void> {
    memoryPending = pending;
    if (pending) {
        await AsyncStorage.setItem(KEY, '1');
    } else {
        await AsyncStorage.removeItem(KEY);
    }
}

export async function isPasswordRecoveryPending(): Promise<boolean> {
    if (memoryPending) return true;
    try {
        const stored = (await AsyncStorage.getItem(KEY)) === '1';
        memoryPending = stored;
        return stored;
    } catch {
        return false;
    }
}

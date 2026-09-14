import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = '@nexo_disk:';
const MAX_PERSISTED_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Persiste JSON para sobrevivir a un cold start (p. ej. feed offline). */
export async function diskSet(key: string, value: unknown): Promise<void> {
    try {
        await AsyncStorage.setItem(PREFIX + key, JSON.stringify({ v: value, t: Date.now() }));
    } catch {
        /* quota / private mode */
    }
}

export async function diskGet<T>(key: string, maxAgeMs?: number): Promise<T | null> {
    try {
        const raw = await AsyncStorage.getItem(PREFIX + key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { v: T; t: number };
        const allowedAge = Math.min(maxAgeMs ?? MAX_PERSISTED_AGE_MS, MAX_PERSISTED_AGE_MS);
        if (!Number.isFinite(parsed.t) || Date.now() - parsed.t > allowedAge) {
            await AsyncStorage.removeItem(PREFIX + key);
            return null;
        }
        return parsed.v ?? null;
    } catch {
        return null;
    }
}

export async function diskRemove(key: string): Promise<void> {
    try {
        await AsyncStorage.removeItem(PREFIX + key);
    } catch {
        /* ignore */
    }
}

import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Serialize storage read/modify/write operations, never the network request.
 * A flush acknowledges IDs against the latest queue so new items survive.
 */
export function createPersistentQueue<T>(key: string) {
    let pending: Promise<void> = Promise.resolve();

    async function readStorage(): Promise<T[]> {
        const raw = await AsyncStorage.getItem(key);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('Invalid persisted queue');
        return parsed as T[];
    }

    function update(change: (items: T[]) => T[]): Promise<void> {
        const operation = pending.then(async () => {
            const next = change(await readStorage());
            await AsyncStorage.setItem(key, JSON.stringify(next));
        });
        pending = operation.catch(() => {});
        return operation;
    }

    return {
        update,
        async read(): Promise<T[]> {
            await pending;
            return readStorage();
        },
        clear(): Promise<void> {
            const operation = pending.then(() => AsyncStorage.removeItem(key));
            pending = operation.catch(() => {});
            return operation;
        },
    };
}

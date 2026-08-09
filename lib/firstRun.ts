import AsyncStorage from '@react-native-async-storage/async-storage';

const FIRST_RUN_KEY = '@nexo_first_run_v1';
const NORMS_SEEN_KEY = '@nexo_norms_seen_v1';

export async function markFirstRunPending(): Promise<void> {
    await AsyncStorage.setItem(FIRST_RUN_KEY, '1');
}

export async function consumeFirstRunPending(): Promise<boolean> {
    try {
        const v = await AsyncStorage.getItem(FIRST_RUN_KEY);
        if (v !== '1') return false;
        await AsyncStorage.setItem(FIRST_RUN_KEY, '0');
        return true;
    } catch {
        return false;
    }
}

export async function hasSeenCommunityNorms(): Promise<boolean> {
    try {
        return (await AsyncStorage.getItem(NORMS_SEEN_KEY)) === '1';
    } catch {
        return false;
    }
}

export async function markCommunityNormsSeen(): Promise<void> {
    await AsyncStorage.setItem(NORMS_SEEN_KEY, '1');
}

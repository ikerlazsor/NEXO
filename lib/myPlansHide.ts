import AsyncStorage from '@react-native-async-storage/async-storage';

const HIDE_PREFIX = '@nexo_myplan_hide:';

function hideKey(userId: string, planId: string) {
    return `${HIDE_PREFIX}${userId}:${planId}`;
}

/** Oculta un plan pasado de «Mis planes» sin borrar historial ni valoraciones. */
export async function hidePlanFromMyList(userId: string, planId: string): Promise<void> {
    await AsyncStorage.setItem(hideKey(userId, planId), '1');
}

export async function isPlanHiddenFromMyList(userId: string, planId: string): Promise<boolean> {
    const v = await AsyncStorage.getItem(hideKey(userId, planId));
    return !!v;
}

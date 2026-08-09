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

/** Lote: evita N getItem al filtrar planes pasados. */
export async function getHiddenPlanIdSet(userId: string, planIds: string[]): Promise<Set<string>> {
    if (planIds.length === 0) return new Set();
    const pairs = await AsyncStorage.multiGet(planIds.map((id) => hideKey(userId, id)));
    const hidden = new Set<string>();
    for (let i = 0; i < planIds.length; i++) {
        if (pairs[i]?.[1]) hidden.add(planIds[i]);
    }
    return hidden;
}

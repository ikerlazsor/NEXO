import AsyncStorage from '@react-native-async-storage/async-storage';

const HIDE_PREFIX = '@nexo_plan_chat_hide:';

function hideKey(userId: string, planId: string) {
    return `${HIDE_PREFIX}${userId}:${planId}`;
}

/** Oculta el chat de un plan de la lista sin salir del plan (p. ej. tras el evento). */
export async function hidePlanChat(userId: string, planId: string): Promise<void> {
    await AsyncStorage.setItem(hideKey(userId, planId), '1');
}

export async function isPlanChatHidden(userId: string, planId: string): Promise<boolean> {
    const v = await AsyncStorage.getItem(hideKey(userId, planId));
    return !!v;
}

export async function filterHiddenPlanChats<T extends { id: string }>(
    userId: string,
    rows: T[],
): Promise<T[]> {
    if (rows.length === 0) return rows;
    const flags = await Promise.all(rows.map((r) => isPlanChatHidden(userId, r.id)));
    return rows.filter((_, i) => !flags[i]);
}

import AsyncStorage from '@react-native-async-storage/async-storage';

const HIDE_PREFIX = '@nexo_plan_chat_hide:';

function hideKey(userId: string, planId: string) {
    return `${HIDE_PREFIX}${userId}:${planId}`;
}

/** Oculta el chat de un plan de la lista sin salir del plan (solo para ti). */
export async function hidePlanChat(userId: string, planId: string): Promise<void> {
    await AsyncStorage.setItem(hideKey(userId, planId), new Date().toISOString());
}

export async function unhidePlanChat(userId: string, planId: string): Promise<void> {
    await AsyncStorage.removeItem(hideKey(userId, planId));
}

export async function isPlanChatHidden(
    userId: string,
    planId: string,
    lastMessageAt?: string | null,
): Promise<boolean> {
    const raw = await AsyncStorage.getItem(hideKey(userId, planId));
    if (!raw) return false;
    if (raw === '1') return true;
    if (!lastMessageAt) return true;
    return new Date(lastMessageAt).getTime() <= new Date(raw).getTime();
}

export async function filterHiddenPlanChats<T extends { id: string; lastAt?: string }>(
    userId: string,
    rows: T[],
): Promise<T[]> {
    if (rows.length === 0) return rows;
    const flags = await Promise.all(
        rows.map((row) => isPlanChatHidden(userId, row.id, row.lastAt || null)),
    );
    return rows.filter((_, i) => !flags[i]);
}

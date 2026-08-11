import AsyncStorage from '@react-native-async-storage/async-storage';
import { getChatSummaries, invalidateChatSummaries } from './chatSummaries';
import { cacheGetOrFetch, cacheGetStale, cacheInvalidate } from './ttlCache';

const PREFIX = '@nexo_chat_read:';
const UNREAD_TTL_MS = 25_000;
const listeners = new Set<() => void>();

function planKey(userId: string, planId: string) {
    return `${PREFIX}plan:${userId}:${planId}`;
}

function directKey(userId: string, peerId: string) {
    const sorted = [userId, peerId].sort().join(':');
    return `${PREFIX}direct:${sorted}`;
}

function unreadMapKey(userId: string) {
    return `chatUnread:${userId}`;
}

export function subscribeChatUnread(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function notifyChatUnreadChanged() {
    listeners.forEach((listener) => listener());
}

function invalidateUnread(userId: string) {
    invalidateChatSummaries(userId);
    cacheInvalidate(unreadMapKey(userId));
}

export async function markPlanChatRead(userId: string, planId: string): Promise<void> {
    await AsyncStorage.setItem(planKey(userId, planId), new Date().toISOString());
    invalidateUnread(userId);
    notifyChatUnreadChanged();
}

export async function markDirectChatRead(userId: string, peerId: string): Promise<void> {
    await AsyncStorage.setItem(directKey(userId, peerId), new Date().toISOString());
    invalidateUnread(userId);
    notifyChatUnreadChanged();
}

export type ChatUnreadMap = {
    plans: Record<string, number>;
    directs: Record<string, number>;
    total: number;
};

/**
 * Los pendientes se calculan en Supabase dentro de get_chat_summaries.
 * El teléfono recibe una fila por conversación, nunca lotes globales de mensajes.
 */
async function fetchChatUnreadMap(userId: string): Promise<ChatUnreadMap> {
    try {
        const summaries = await getChatSummaries(userId);
        const plans: Record<string, number> = {};
        const directs: Record<string, number> = {};
        let total = 0;

        for (const row of summaries) {
            const unread = Math.max(0, row.unread_count);
            if (row.conversation_kind === 'direct') {
                if (unread > 0) directs[row.conversation_id] = unread;
            } else if (unread > 0) {
                plans[row.conversation_id] = unread;
            }
            total += unread;
        }

        return { plans, directs, total };
    } catch {
        return { plans: {}, directs: {}, total: 0 };
    }
}

export function peekChatUnreadMap(userId: string): ChatUnreadMap | null {
    return cacheGetStale<ChatUnreadMap>(unreadMapKey(userId));
}

export async function getChatUnreadMap(
    userId: string,
    opts?: { force?: boolean },
): Promise<ChatUnreadMap> {
    if (opts?.force) invalidateChatSummaries(userId);
    return cacheGetOrFetch(
        unreadMapKey(userId),
        UNREAD_TTL_MS,
        () => fetchChatUnreadMap(userId),
        opts,
    );
}

export async function getUnreadChatCount(userId: string, opts?: { force?: boolean }): Promise<number> {
    const map = await getChatUnreadMap(userId, opts);
    return map.total;
}

export async function getPlanChatUnread(userId: string, planId: string): Promise<number> {
    const map = await getChatUnreadMap(userId);
    return map.plans[planId] ?? 0;
}

export async function getDirectChatUnread(userId: string, peerId: string): Promise<number> {
    const map = await getChatUnreadMap(userId);
    return map.directs[peerId] ?? 0;
}

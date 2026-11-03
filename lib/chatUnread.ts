import AsyncStorage from '@react-native-async-storage/async-storage';
import { getChatSummaries, invalidateChatSummaries, rememberChatReadCursor } from './chatSummaries';
import { isPlanChatAlive } from './planLifecycle';
import { cacheGetStale, cacheInvalidate, cacheSet } from './ttlCache';

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
    const cached = peekChatUnreadMap(userId);
    if (cached) {
        const removed = cached.plans[planId] ?? 0;
        if (removed > 0 || planId in cached.plans) {
            const plans = { ...cached.plans };
            delete plans[planId];
            cacheSet(
                unreadMapKey(userId),
                {
                    plans,
                    directs: cached.directs,
                    total: Math.max(0, cached.total - removed),
                },
                UNREAD_TTL_MS,
            );
            notifyChatUnreadChanged();
        }
    }
    const at = new Date().toISOString();
    await AsyncStorage.setItem(planKey(userId, planId), at);
    void rememberChatReadCursor(userId, 'plan', planId, at);
    invalidateUnread(userId);
    notifyChatUnreadChanged();
}

export async function markDirectChatRead(userId: string, peerId: string): Promise<void> {
    const cached = peekChatUnreadMap(userId);
    if (cached) {
        const removed = cached.directs[peerId] ?? 0;
        if (removed > 0 || peerId in cached.directs) {
            const directs = { ...cached.directs };
            delete directs[peerId];
            cacheSet(
                unreadMapKey(userId),
                {
                    plans: cached.plans,
                    directs,
                    total: Math.max(0, cached.total - removed),
                },
                UNREAD_TTL_MS,
            );
            notifyChatUnreadChanged();
        }
    }
    const at = new Date().toISOString();
    await AsyncStorage.setItem(directKey(userId, peerId), at);
    void rememberChatReadCursor(userId, 'direct', peerId, at);
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
            if (unread <= 0) continue;
            if (row.conversation_kind === 'direct') {
                directs[row.conversation_id] = unread;
                total += unread;
                continue;
            }
            // Misma regla que la lista de chats: no contar chats de plan ya muertos.
            if (
                !isPlanChatAlive({
                    fecha_evento: row.event_at,
                    categoria: row.category,
                    chat_eliminado_en: row.chat_deleted_at,
                })
            ) {
                continue;
            }
            plans[row.conversation_id] = unread;
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
    // getChatSummaries ya deduplica y cachea la consulta costosa. Derivar el mapa
    // en memoria evita mantener una segunda caché que pueda quedar desfasada.
    const map = await fetchChatUnreadMap(userId);
    cacheSet(unreadMapKey(userId), map, UNREAD_TTL_MS);
    return map;
}

export async function getUnreadChatCount(userId: string, opts?: { force?: boolean }): Promise<number> {
    const map = await getChatUnreadMap(userId, opts);
    return map.total;
}

/** Fuerza recálculo y avisa a MainChrome / badge del sistema. */
export async function refreshChatUnreadBadge(userId: string): Promise<number> {
    const map = await getChatUnreadMap(userId, { force: true });
    notifyChatUnreadChanged();
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

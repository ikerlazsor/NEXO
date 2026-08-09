import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { isAcceptedParticipant } from './participants';
import { cacheGetOrFetch, cacheGetStale, cacheInvalidate } from './ttlCache';

const PREFIX = '@nexo_chat_read:';
const UNREAD_TTL_MS = 25_000;
const EPOCH = '1970-01-01T00:00:00.000Z';

/** Marca de lectura optimista (ISO). No es un “clear permanente”. */
const optimisticReadAtPlans = new Map<string, string>();
const optimisticReadAtDirects = new Map<string, string>();
const listeners = new Set<() => void>();

function planKey(userId: string, planId: string) {
    return `${PREFIX}plan:${userId}:${planId}`;
}

function directKey(userId: string, peerId: string) {
    const sorted = [userId, peerId].sort().join(':');
    return `${PREFIX}direct:${sorted}`;
}

function planReadKey(userId: string, planId: string) {
    return `${userId}|plan|${planId}`;
}

function directReadKey(userId: string, peerId: string) {
    return `${userId}|direct|${peerId}`;
}

function unreadMapKey(userId: string) {
    return `chatUnread:${userId}`;
}

function laterIso(a: string | null | undefined, b: string | null | undefined): string {
    const left = a && a.length > 0 ? a : EPOCH;
    const right = b && b.length > 0 ? b : EPOCH;
    return left > right ? left : right;
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

export async function markPlanChatRead(userId: string, planId: string): Promise<void> {
    const now = new Date().toISOString();
    const key = planReadKey(userId, planId);
    optimisticReadAtPlans.set(key, now);
    cacheInvalidate(unreadMapKey(userId));
    notifyChatUnreadChanged();
    try {
        await AsyncStorage.setItem(planKey(userId, planId), now);
    } finally {
        // Tras persistir, la fuente de verdad es AsyncStorage; limpiamos el mapa.
        optimisticReadAtPlans.delete(key);
        cacheInvalidate(unreadMapKey(userId));
        notifyChatUnreadChanged();
    }
}

export async function markDirectChatRead(userId: string, peerId: string): Promise<void> {
    const now = new Date().toISOString();
    const key = directReadKey(userId, peerId);
    optimisticReadAtDirects.set(key, now);
    cacheInvalidate(unreadMapKey(userId));
    notifyChatUnreadChanged();
    try {
        await AsyncStorage.setItem(directKey(userId, peerId), now);
    } finally {
        optimisticReadAtDirects.delete(key);
        cacheInvalidate(unreadMapKey(userId));
        notifyChatUnreadChanged();
    }
}

async function multiGetMap(keys: string[]): Promise<Map<string, string | null>> {
    const map = new Map<string, string | null>();
    if (keys.length === 0) return map;
    const pairs = await AsyncStorage.multiGet(keys);
    for (const [k, v] of pairs) map.set(k, v);
    return map;
}

function lastReadPlan(userId: string, planId: string, stored: string | null | undefined): string {
    return laterIso(stored, optimisticReadAtPlans.get(planReadKey(userId, planId)));
}

function lastReadDirect(userId: string, peerId: string, stored: string | null | undefined): string {
    return laterIso(stored, optimisticReadAtDirects.get(directReadKey(userId, peerId)));
}

async function countPlanUnread(userId: string, planId: string): Promise<number> {
    const stored = await AsyncStorage.getItem(planKey(userId, planId));
    const lastRead = lastReadPlan(userId, planId, stored);
    const { count } = await supabase
        .from('mensajes')
        .select('id', { count: 'exact', head: true })
        .eq('plan_id', planId)
        .neq('emisor_id', userId)
        .gt('creado_en', lastRead);
    return count ?? 0;
}

async function countDirectUnread(userId: string, peerId: string): Promise<number> {
    const stored = await AsyncStorage.getItem(directKey(userId, peerId));
    const lastRead = lastReadDirect(userId, peerId, stored);
    const { count } = await supabase
        .from('mensajes')
        .select('id', { count: 'exact', head: true })
        .is('plan_id', null)
        .eq('emisor_id', peerId)
        .eq('receptor_id', userId)
        .gt('creado_en', lastRead);
    return count ?? 0;
}

export type ChatUnreadMap = {
    plans: Record<string, number>;
    directs: Record<string, number>;
    total: number;
};

/** Planes/grupos donde el usuario tiene acceso al chat (aceptado o creador). */
async function getAccessiblePlanIds(userId: string): Promise<string[]> {
    const [partsRes, createdRes] = await Promise.all([
        supabase
            .from('participantes')
            .select('plan_id, estado')
            .eq('usuario_id', userId)
            .eq('estado', 'aceptado'),
        supabase.from('planes').select('id').eq('creador_id', userId),
    ]);

    const planIds = new Set<string>();
    (partsRes.data ?? []).forEach((r) => {
        if (isAcceptedParticipant(r.estado)) planIds.add(r.plan_id);
    });
    (createdRes.data ?? []).forEach((r) => planIds.add(r.id));
    return [...planIds];
}

/**
 * Cuenta no leídos en lote: un multiGet + pocas queries de mensajes,
 * en lugar de un COUNT HEAD por cada chat.
 */
async function fetchChatUnreadMap(userId: string): Promise<ChatUnreadMap> {
    try {
        const planIds = await getAccessiblePlanIds(userId);
        const plans: Record<string, number> = {};
        let total = 0;

        const planStorageKeys = planIds.map((id) => planKey(userId, id));
        const lastReadByKey = await multiGetMap(planStorageKeys);

        if (planIds.length > 0) {
            const msgLimit = Math.min(Math.max(planIds.length * 8, 80), 400);
            const { data: planMsgs } = await supabase
                .from('mensajes')
                .select('plan_id, emisor_id, creado_en')
                .in('plan_id', planIds)
                .neq('emisor_id', userId)
                .order('creado_en', { ascending: false })
                .limit(msgLimit);

            const counts: Record<string, number> = {};
            for (const m of planMsgs ?? []) {
                const pid = m.plan_id as string;
                if (!pid) continue;
                const lastRead = lastReadPlan(
                    userId,
                    pid,
                    lastReadByKey.get(planKey(userId, pid)),
                );
                if (m.creado_en && m.creado_en > lastRead) {
                    counts[pid] = (counts[pid] ?? 0) + 1;
                }
            }
            for (const [planId, n] of Object.entries(counts)) {
                if (n > 0) {
                    plans[planId] = n;
                    total += n;
                }
            }
        }

        const { data: directMsgs } = await supabase
            .from('mensajes')
            .select('emisor_id, receptor_id, creado_en')
            .is('plan_id', null)
            .or(`receptor_id.eq.${userId},emisor_id.eq.${userId}`)
            .order('creado_en', { ascending: false })
            .limit(250);

        const peers = new Set<string>();
        (directMsgs ?? []).forEach((m) => {
            const peer = m.emisor_id === userId ? m.receptor_id : m.emisor_id;
            if (peer) peers.add(peer as string);
        });

        const peerList = [...peers];
        const directStorageKeys = peerList.map((peerId) => directKey(userId, peerId));
        const directLastRead = await multiGetMap(directStorageKeys);

        const directs: Record<string, number> = {};
        for (const m of directMsgs ?? []) {
            if (m.emisor_id !== userId && m.receptor_id === userId) {
                const peerId = m.emisor_id as string;
                if (!peerId) continue;
                const lastRead = lastReadDirect(
                    userId,
                    peerId,
                    directLastRead.get(directKey(userId, peerId)),
                );
                if (m.creado_en && m.creado_en > lastRead) {
                    directs[peerId] = (directs[peerId] ?? 0) + 1;
                }
            }
        }
        for (const n of Object.values(directs)) total += n;

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
    return countPlanUnread(userId, planId);
}

export async function getDirectChatUnread(userId: string, peerId: string): Promise<number> {
    return countDirectUnread(userId, peerId);
}

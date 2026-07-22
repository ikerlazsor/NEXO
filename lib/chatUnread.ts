import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { isAcceptedParticipant } from './participants';
import { cacheGetOrFetch, cacheGetStale, cacheInvalidate } from './ttlCache';

const PREFIX = '@nexo_chat_read:';
const UNREAD_TTL_MS = 25_000;

const optimisticClearedPlans = new Set<string>();
const optimisticClearedDirects = new Set<string>();
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
    optimisticClearedPlans.add(planReadKey(userId, planId));
    cacheInvalidate(unreadMapKey(userId));
    notifyChatUnreadChanged();
    await AsyncStorage.setItem(planKey(userId, planId), new Date().toISOString());
}

export async function markDirectChatRead(userId: string, peerId: string): Promise<void> {
    optimisticClearedDirects.add(directReadKey(userId, peerId));
    cacheInvalidate(unreadMapKey(userId));
    notifyChatUnreadChanged();
    await AsyncStorage.setItem(directKey(userId, peerId), new Date().toISOString());
}

async function getLastRead(key: string): Promise<string | null> {
    return AsyncStorage.getItem(key);
}

async function countPlanUnread(userId: string, planId: string): Promise<number> {
    if (optimisticClearedPlans.has(planReadKey(userId, planId))) return 0;

    const lastRead = (await getLastRead(planKey(userId, planId))) ?? '1970-01-01T00:00:00Z';
    const { count } = await supabase
        .from('mensajes')
        .select('id', { count: 'exact', head: true })
        .eq('plan_id', planId)
        .neq('emisor_id', userId)
        .gt('creado_en', lastRead);
    return count ?? 0;
}

async function countDirectUnread(userId: string, peerId: string): Promise<number> {
    if (optimisticClearedDirects.has(directReadKey(userId, peerId))) return 0;

    const lastRead = (await getLastRead(directKey(userId, peerId))) ?? '1970-01-01T00:00:00Z';
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

async function fetchChatUnreadMap(userId: string): Promise<ChatUnreadMap> {
    try {
        const planIds = await getAccessiblePlanIds(userId);
        const plans: Record<string, number> = {};
        let total = 0;

        const planCounts = await Promise.all(
            planIds.map(async (planId) => [planId, await countPlanUnread(userId, planId)] as const),
        );
        for (const [planId, n] of planCounts) {
            if (n > 0) plans[planId] = n;
            total += n;
        }

        const { data: directMsgs } = await supabase
            .from('mensajes')
            .select('emisor_id, receptor_id')
            .is('plan_id', null)
            .or(`receptor_id.eq.${userId},emisor_id.eq.${userId}`)
            .order('creado_en', { ascending: false })
            .limit(200);

        const peers = new Set<string>();
        (directMsgs ?? []).forEach((m) => {
            const peer = m.emisor_id === userId ? m.receptor_id : m.emisor_id;
            if (peer) peers.add(peer);
        });

        const directs: Record<string, number> = {};
        const directCounts = await Promise.all(
            [...peers].map(async (peerId) => [peerId, await countDirectUnread(userId, peerId)] as const),
        );
        for (const [peerId, n] of directCounts) {
            if (n > 0) directs[peerId] = n;
            total += n;
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

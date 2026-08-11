import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { cacheGetOrFetch, cacheInvalidate } from './ttlCache';

const READ_PREFIX = '@nexo_chat_read:';
const SUMMARY_TTL_MS = 25_000;

export type ChatSummary = {
    conversation_kind: 'plan' | 'direct';
    conversation_id: string;
    title: string;
    image_url: string | null;
    category: string | null;
    creator_id: string | null;
    event_at: string | null;
    created_at: string | null;
    chat_deleted_at: string | null;
    last_content: string | null;
    last_type: string | null;
    last_at: string | null;
    last_sender_id: string | null;
    last_sender_name: string | null;
    unread_count: number;
};

function summaryKey(userId: string) {
    return `chatSummaries:${userId}`;
}

async function readStoredCursors(userId: string): Promise<{
    planReads: Record<string, string>;
    directReads: Record<string, string>;
}> {
    const keys = await AsyncStorage.getAllKeys();
    const relevant = keys.filter((key) => key.startsWith(READ_PREFIX));
    const pairs = relevant.length > 0 ? await AsyncStorage.multiGet(relevant) : [];

    const planReads: Record<string, string> = {};
    const directReads: Record<string, string> = {};
    const planPrefix = `${READ_PREFIX}plan:${userId}:`;
    const directPrefix = `${READ_PREFIX}direct:`;

    for (const [key, value] of pairs) {
        if (!value) continue;

        if (key.startsWith(planPrefix)) {
            const planId = key.slice(planPrefix.length);
            if (planId) planReads[planId] = value;
            continue;
        }

        if (!key.startsWith(directPrefix)) continue;
        const participants = key.slice(directPrefix.length).split(':');
        if (participants.length !== 2 || !participants.includes(userId)) continue;
        const peerId = participants[0] === userId ? participants[1] : participants[0];
        if (peerId) directReads[peerId] = value;
    }

    return { planReads, directReads };
}

async function fetchChatSummaries(userId: string): Promise<ChatSummary[]> {
    const { planReads, directReads } = await readStoredCursors(userId);
    const { data, error } = await supabase.rpc('get_chat_summaries', {
        p_plan_read_at: planReads,
        p_direct_read_at: directReads,
    });
    if (error) throw error;

    return (data ?? []).map((row: Record<string, unknown>) => ({
        conversation_kind: row.conversation_kind === 'direct' ? 'direct' : 'plan',
        conversation_id: String(row.conversation_id),
        title: typeof row.title === 'string' ? row.title : 'Usuario',
        image_url: typeof row.image_url === 'string' ? row.image_url : null,
        category: typeof row.category === 'string' ? row.category : null,
        creator_id: typeof row.creator_id === 'string' ? row.creator_id : null,
        event_at: typeof row.event_at === 'string' ? row.event_at : null,
        created_at: typeof row.created_at === 'string' ? row.created_at : null,
        chat_deleted_at: typeof row.chat_deleted_at === 'string' ? row.chat_deleted_at : null,
        last_content: typeof row.last_content === 'string' ? row.last_content : null,
        last_type: typeof row.last_type === 'string' ? row.last_type : null,
        last_at: typeof row.last_at === 'string' ? row.last_at : null,
        last_sender_id: typeof row.last_sender_id === 'string' ? row.last_sender_id : null,
        last_sender_name: typeof row.last_sender_name === 'string' ? row.last_sender_name : null,
        unread_count: Number(row.unread_count) || 0,
    }));
}

export function invalidateChatSummaries(userId: string): void {
    cacheInvalidate(summaryKey(userId));
}

export async function getChatSummaries(
    userId: string,
    opts?: { force?: boolean },
): Promise<ChatSummary[]> {
    return cacheGetOrFetch(
        summaryKey(userId),
        SUMMARY_TTL_MS,
        () => fetchChatSummaries(userId),
        opts,
    );
}

import { supabase } from './supabase';

export const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '🙏', '👍'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export type MessageReaction = {
    mensaje_id: string;
    usuario_id: string;
    emoji: string;
};

export async function fetchReactionsForMessages(
    messageIds: string[],
): Promise<MessageReaction[]> {
    if (!messageIds.length) return [];
    const { data, error } = await supabase
        .from('mensaje_reacciones')
        .select('mensaje_id, usuario_id, emoji')
        .in('mensaje_id', messageIds);
    if (error) {
        console.warn('reactions fetch', error.message);
        return [];
    }
    return (data ?? []) as MessageReaction[];
}

/** Una reacción por usuario/mensaje: si elige el mismo emoji, la quita; si otro, la cambia. */
export async function toggleReaction(opts: {
    messageId: string;
    userId: string;
    emoji: string;
}): Promise<void> {
    const { data: existing } = await supabase
        .from('mensaje_reacciones')
        .select('id, emoji')
        .eq('mensaje_id', opts.messageId)
        .eq('usuario_id', opts.userId)
        .maybeSingle();

    if (existing?.emoji === opts.emoji) {
        await supabase.from('mensaje_reacciones').delete().eq('id', existing.id);
        return;
    }

    if (existing) {
        await supabase
            .from('mensaje_reacciones')
            .update({ emoji: opts.emoji })
            .eq('id', existing.id);
        return;
    }

    await supabase.from('mensaje_reacciones').insert({
        mensaje_id: opts.messageId,
        usuario_id: opts.userId,
        emoji: opts.emoji,
    });
}

export type ReactionSummary = {
    emoji: string;
    count: number;
    reactedByMe: boolean;
};

export function summarizeReactions(
    rows: MessageReaction[],
    messageId: string,
    myUserId: string | null,
): ReactionSummary[] {
    const map = new Map<string, ReactionSummary>();
    for (const row of rows) {
        if (row.mensaje_id !== messageId) continue;
        const cur = map.get(row.emoji) ?? { emoji: row.emoji, count: 0, reactedByMe: false };
        cur.count += 1;
        if (myUserId && row.usuario_id === myUserId) cur.reactedByMe = true;
        map.set(row.emoji, cur);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
}

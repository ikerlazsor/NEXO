import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCoincidedUserIds } from './coincidences';
import {
    getFriends,
    getIncomingRequests,
    getOutgoingRequests,
    type FriendProfile,
} from './friends';
import { supabase } from './supabase';
import { cacheGetOrFetch, cacheInvalidate } from './ttlCache';

export type FriendSuggestion = FriendProfile & {
    reason: 'coincided';
};

const SUGGEST_TTL_MS = 90_000;
const DISMISS_PREFIX = '@nexo_friend_suggest_hide:';

function dismissKey(userId: string, peerId: string) {
    return `${DISMISS_PREFIX}${userId}:${peerId}`;
}

/** Oculta un sugerido de la lista (persistente en el dispositivo). */
export async function dismissFriendSuggestion(userId: string, peerId: string): Promise<void> {
    if (!userId || !peerId) return;
    await AsyncStorage.setItem(dismissKey(userId, peerId), '1');
    cacheInvalidate(`friendSuggestions:${userId}`);
}

async function getDismissedSuggestionIds(userId: string, peerIds: string[]): Promise<Set<string>> {
    if (peerIds.length === 0) return new Set();
    const pairs = await AsyncStorage.multiGet(peerIds.map((id) => dismissKey(userId, id)));
    const hidden = new Set<string>();
    for (let i = 0; i < peerIds.length; i++) {
        if (pairs[i]?.[1]) hidden.add(peerIds[i]);
    }
    return hidden;
}

/**
 * Personas con las que ya coincidiste en planes y aún no son amigas
 * (ni hay solicitud pendiente).
 */
export async function getFriendSuggestions(
    userId: string,
    limit = 12,
): Promise<FriendSuggestion[]> {
    if (!userId) return [];
    return cacheGetOrFetch(`friendSuggestions:${userId}`, SUGGEST_TTL_MS, async () => {
        const [coincided, friends, outgoing, incoming] = await Promise.all([
            getCoincidedUserIds(userId),
            getFriends(userId),
            getOutgoingRequests(userId),
            getIncomingRequests(userId),
        ]);

        const exclude = new Set<string>([
            userId,
            ...friends.map((f) => f.id),
            ...outgoing.map((r) => r.perfil.id),
            ...incoming.map((r) => r.perfil.id),
        ]);

        const ids = [...coincided].filter((id) => !exclude.has(id)).slice(0, Math.max(limit, 20));
        if (ids.length === 0) return [];

        const dismissed = await getDismissedSuggestionIds(userId, ids);
        const visibleIds = ids.filter((id) => !dismissed.has(id));
        if (visibleIds.length === 0) return [];

        const { data, error } = await supabase
            .from('perfiles')
            .select('id, nombre, nombre_usuario, avatar_url')
            .in('id', visibleIds)
            .limit(limit);

        if (error || !data?.length) return [];

        const order = new Map(visibleIds.map((id, i) => [id, i]));
        return data
            .map((row) => ({
                id: row.id as string,
                nombre: (row.nombre as string) || 'Usuario',
                nombre_usuario: (row.nombre_usuario as string | null) ?? null,
                avatar_url: (row.avatar_url as string | null) ?? null,
                reason: 'coincided' as const,
            }))
            .sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99))
            .slice(0, limit);
    });
}

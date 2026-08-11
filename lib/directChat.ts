import AsyncStorage from '@react-native-async-storage/async-storage';
import { getChatSummaries, type ChatSummary } from './chatSummaries';
import { getAvatarUri } from './friends';
import { supabase } from './supabase';

export interface DirectMessagePreview {
    contenido: string;
    tipo: string;
    creado_en: string;
    emisor_id: string;
}

export interface DirectConversation {
    peerId: string;
    nombre: string;
    avatar_url: string | null;
    avatarUri: string;
    lastMessage: DirectMessagePreview | null;
    /** Para ordenar hilos abiertos sin mensajes. */
    openedAt?: string;
    unread: number;
}

const OPEN_PREFIX = '@nexo_direct_open:';

type OpenedEntry = { id: string; at: string };

function openThreadsKey(userId: string) {
    return `${OPEN_PREFIX}${userId}`;
}

async function readOpenedEntries(userId: string): Promise<OpenedEntry[]> {
    try {
        const raw = await AsyncStorage.getItem(openThreadsKey(userId));
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map((item) => {
                if (typeof item === 'string' && item) {
                    return { id: item, at: new Date(0).toISOString() };
                }
                if (item && typeof item === 'object' && typeof (item as OpenedEntry).id === 'string') {
                    const row = item as OpenedEntry;
                    return {
                        id: row.id,
                        at: typeof row.at === 'string' ? row.at : new Date(0).toISOString(),
                    };
                }
                return null;
            })
            .filter((entry): entry is OpenedEntry => !!entry?.id);
    } catch {
        return [];
    }
}

async function writeOpenedEntries(userId: string, entries: OpenedEntry[]): Promise<void> {
    const byId = new Map<string, OpenedEntry>();
    for (const entry of entries) {
        if (entry?.id) byId.set(entry.id, entry);
    }
    await AsyncStorage.setItem(openThreadsKey(userId), JSON.stringify([...byId.values()]));
}

/**
 * Marca un chat 1:1 como abierto aunque aún no haya mensajes,
 * para que aparezca en Mis chats al volver atrás.
 */
export async function ensureDirectConversation(userId: string, peerId: string): Promise<void> {
    if (!userId || !peerId || userId === peerId) return;
    const opened = await readOpenedEntries(userId);
    const rest = opened.filter((entry) => entry.id !== peerId);
    await writeOpenedEntries(userId, [{ id: peerId, at: new Date().toISOString() }, ...rest]);
    await supabase
        .from('chats_directos_ocultos')
        .delete()
        .eq('usuario_id', userId)
        .eq('peer_id', peerId);
}

async function removeOpenedPeer(userId: string, peerId: string): Promise<void> {
    const opened = await readOpenedEntries(userId);
    if (!opened.some((entry) => entry.id === peerId)) return;
    await writeOpenedEntries(
        userId,
        opened.filter((entry) => entry.id !== peerId),
    );
}

/**
 * Conversaciones directas ya resumidas por Supabase. Solo se combinan aquí
 * los hilos abiertos localmente que todavía no tienen ningún mensaje.
 */
export async function getDirectConversations(
    userId: string,
    providedSummaries?: ChatSummary[],
): Promise<DirectConversation[]> {
    const [summaries, openedEntries, hiddenResult] = await Promise.all([
        providedSummaries ? Promise.resolve(providedSummaries) : getChatSummaries(userId),
        readOpenedEntries(userId),
        supabase
            .from('chats_directos_ocultos')
            .select('peer_id')
            .eq('usuario_id', userId),
    ]);

    const hiddenPeers = new Set((hiddenResult.data ?? []).map((row) => row.peer_id as string));
    const directRows = summaries.filter((row) => row.conversation_kind === 'direct');
    const conversations = new Map<string, DirectConversation>();

    for (const row of directRows) {
        const peerId = row.conversation_id;
        const nombre = row.title || 'Usuario';
        conversations.set(peerId, {
            peerId,
            nombre,
            avatar_url: row.image_url,
            avatarUri: getAvatarUri({ nombre, avatar_url: row.image_url }),
            lastMessage: row.last_at
                ? {
                      contenido: row.last_content ?? '',
                      tipo: row.last_type ?? 'texto',
                      creado_en: row.last_at,
                      emisor_id: row.last_sender_id ?? peerId,
                  }
                : null,
            unread: row.unread_count,
        });
    }

    const missingOpened = openedEntries.filter(
        (entry) => !conversations.has(entry.id) && !hiddenPeers.has(entry.id),
    );
    if (missingOpened.length > 0) {
        const { data: profiles } = await supabase
            .from('perfiles')
            .select('id, nombre, avatar_url')
            .in('id', missingOpened.map((entry) => entry.id));
        const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

        for (const entry of missingOpened) {
            const profile = profileById.get(entry.id);
            const nombre = profile?.nombre || 'Usuario';
            const avatarUrl = profile?.avatar_url ?? null;
            conversations.set(entry.id, {
                peerId: entry.id,
                nombre,
                avatar_url: avatarUrl,
                avatarUri: getAvatarUri({ nombre, avatar_url: avatarUrl }),
                lastMessage: null,
                openedAt: entry.at,
                unread: 0,
            });
        }
    }

    return [...conversations.values()];
}

/** Quita el chat directo de tu lista (reaparece si el otro te escribe de nuevo). */
export async function hideDirectChat(
    userId: string,
    peerId: string,
): Promise<{ error: string | null }> {
    if (!userId || !peerId || userId === peerId) return { error: 'invalid_target' };

    const { error } = await supabase.from('chats_directos_ocultos').upsert(
        {
            usuario_id: userId,
            peer_id: peerId,
            oculto_en: new Date().toISOString(),
        },
        { onConflict: 'usuario_id,peer_id' },
    );

    if (error) return { error: error.message };

    await removeOpenedPeer(userId, peerId);
    return { error: null };
}

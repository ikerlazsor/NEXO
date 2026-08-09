import AsyncStorage from '@react-native-async-storage/async-storage';
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
            .filter((x): x is OpenedEntry => !!x?.id);
    } catch {
        return [];
    }
}

async function writeOpenedEntries(userId: string, entries: OpenedEntry[]): Promise<void> {
    const byId = new Map<string, OpenedEntry>();
    for (const e of entries) {
        if (!e?.id) continue;
        byId.set(e.id, e);
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
    const now = new Date().toISOString();
    const rest = opened.filter((e) => e.id !== peerId);
    await writeOpenedEntries(userId, [{ id: peerId, at: now }, ...rest]);
    // Si lo habías ocultado, al “crearlo” de nuevo debe reaparecer.
    await supabase
        .from('chats_directos_ocultos')
        .delete()
        .eq('usuario_id', userId)
        .eq('peer_id', peerId);
}

async function removeOpenedPeer(userId: string, peerId: string): Promise<void> {
    const opened = await readOpenedEntries(userId);
    if (!opened.some((e) => e.id === peerId)) return;
    await writeOpenedEntries(
        userId,
        opened.filter((e) => e.id !== peerId),
    );
}

/**
 * Conversaciones 1:1 del usuario, derivadas de los mensajes directos
 * (mensajes con receptor_id y sin plan_id), ordenadas por actividad reciente.
 * Incluye hilos abiertos sin mensajes (creados desde «Crear chat»).
 * Respeta chats ocultos: reaparecen si hay un mensaje nuevo después de ocultar.
 */
export async function getDirectConversations(userId: string): Promise<DirectConversation[]> {
    const messagesPromise = supabase
        .from('mensajes')
        .select('emisor_id, receptor_id, contenido, tipo, creado_en')
        .is('plan_id', null)
        .or(`emisor_id.eq.${userId},receptor_id.eq.${userId}`)
        .order('creado_en', { ascending: false })
        .limit(500);

    const hiddenPromise = supabase
        .from('chats_directos_ocultos')
        .select('peer_id, oculto_en')
        .eq('usuario_id', userId);

    const openedPromise = readOpenedEntries(userId);

    const [{ data: messages, error }, hiddenResult, openedEntries] = await Promise.all([
        messagesPromise,
        hiddenPromise,
        openedPromise,
    ]);

    if (error) throw error;

    const hiddenAt = new Map<string, string>();
    if (!hiddenResult.error) {
        (hiddenResult.data ?? []).forEach((row) => {
            if (row.peer_id) hiddenAt.set(row.peer_id, row.oculto_en);
        });
    }
    const lastByPeer = new Map<string, DirectMessagePreview>();
    (messages ?? []).forEach((m) => {
        const peerId = m.emisor_id === userId ? m.receptor_id : m.emisor_id;
        if (!peerId || lastByPeer.has(peerId)) return;
        lastByPeer.set(peerId, {
            contenido: m.contenido ?? '',
            tipo: m.tipo ?? 'texto',
            creado_en: m.creado_en,
            emisor_id: m.emisor_id,
        });
    });

    for (const [peerId, last] of [...lastByPeer.entries()]) {
        const hidden = hiddenAt.get(peerId);
        if (hidden && new Date(last.creado_en).getTime() <= new Date(hidden).getTime()) {
            lastByPeer.delete(peerId);
        }
    }

    const openedAtByPeer = new Map(openedEntries.map((e) => [e.id, e.at]));

    // Hilos abiertos sin mensajes (y no ocultos).
    for (const entry of openedEntries) {
        if (lastByPeer.has(entry.id)) continue;
        if (hiddenAt.has(entry.id)) continue;
        lastByPeer.set(entry.id, {
            contenido: '',
            tipo: 'texto',
            creado_en: '',
            emisor_id: userId,
        });
    }

    if (lastByPeer.size === 0) return [];

    const peerIds = Array.from(lastByPeer.keys());
    const { data: profiles } = await supabase
        .from('perfiles')
        .select('id, nombre, avatar_url')
        .in('id', peerIds);

    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

    return peerIds.map((peerId) => {
        const profile = profileById.get(peerId);
        const nombre = profile?.nombre || 'Usuario';
        const avatar_url = profile?.avatar_url ?? null;
        const last = lastByPeer.get(peerId) ?? null;
        const lastMessage = last && last.creado_en ? last : null;
        return {
            peerId,
            nombre,
            avatar_url,
            avatarUri: getAvatarUri({ nombre, avatar_url }),
            lastMessage,
            openedAt: openedAtByPeer.get(peerId),
        };
    });
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

    if (error) {
        // Ocultar una conversación nunca debe borrar mensajes como alternativa.
        // Se conserva todo y se muestra el error para poder corregir la migración.
        return { error: error.message };
    }

    await removeOpenedPeer(userId, peerId);
    return { error: null };
}

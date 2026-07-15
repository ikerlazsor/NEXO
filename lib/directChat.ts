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
}

/**
 * Conversaciones 1:1 del usuario, derivadas de los mensajes directos
 * (mensajes con receptor_id y sin plan_id), ordenadas por actividad reciente.
 */
export async function getDirectConversations(userId: string): Promise<DirectConversation[]> {
    const { data: messages, error } = await supabase
        .from('mensajes')
        .select('emisor_id, receptor_id, contenido, tipo, creado_en')
        .is('plan_id', null)
        .or(`emisor_id.eq.${userId},receptor_id.eq.${userId}`)
        .order('creado_en', { ascending: false })
        .limit(500);

    if (error) throw error;

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
        return {
            peerId,
            nombre,
            avatar_url,
            avatarUri: getAvatarUri({ nombre, avatar_url }),
            lastMessage: lastByPeer.get(peerId) ?? null,
        };
    });
}

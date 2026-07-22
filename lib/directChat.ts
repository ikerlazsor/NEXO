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

    const [{ data: messages, error }, hiddenResult] = await Promise.all([
        messagesPromise,
        hiddenPromise,
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

    if (lastByPeer.size === 0) return [];

    for (const [peerId, last] of [...lastByPeer.entries()]) {
        const hidden = hiddenAt.get(peerId);
        if (hidden && new Date(last.creado_en).getTime() <= new Date(hidden).getTime()) {
            lastByPeer.delete(peerId);
        }
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
        return {
            peerId,
            nombre,
            avatar_url,
            avatarUri: getAvatarUri({ nombre, avatar_url }),
            lastMessage: lastByPeer.get(peerId) ?? null,
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
        // Tabla aún no migrada: fallback borrar mensajes propios (best effort)
        if (/chats_directos_ocultos|relation|does not exist/i.test(error.message)) {
            const { error: delErr } = await supabase
                .from('mensajes')
                .delete()
                .is('plan_id', null)
                .or(
                    `and(emisor_id.eq.${userId},receptor_id.eq.${peerId}),and(emisor_id.eq.${peerId},receptor_id.eq.${userId})`,
                );
            return { error: delErr?.message ?? null };
        }
        return { error: error.message };
    }
    return { error: null };
}

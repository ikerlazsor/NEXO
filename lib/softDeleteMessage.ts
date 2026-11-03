import { supabase } from './supabase';

/** Marcador en `contenido` tras soft-delete (lista de chats + UI). */
export const DELETED_MESSAGE_MARK = '@@nexo_deleted@@';

export function isDeletedMessage(msg: {
    eliminado_en?: string | null;
    contenido?: string | null;
}): boolean {
    if (msg.eliminado_en) return true;
    return (msg.contenido ?? '').trim() === DELETED_MESSAGE_MARK;
}

/** Soft-delete tipo WhatsApp: vacía el contenido y deja el hueco con «mensaje eliminado». */
export async function softDeleteMensaje(messageId: string): Promise<{ error: string | null }> {
    if (!messageId || messageId.startsWith('local-')) {
        return { error: 'invalid_message' };
    }
    const { error } = await supabase.rpc('soft_delete_mensaje', {
        p_mensaje_id: messageId,
    });
    return { error: error?.message ?? null };
}

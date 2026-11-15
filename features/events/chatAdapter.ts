import type { EventMessage } from './types';
import type { Message } from '../chat/chatModel';

/** Transport details stay at the edge; both rooms render the same Message model. */
export function eventChatMessage(row: EventMessage, profiles: Record<string, { nombre: string; avatar_url: string | null }>): Message {
  return { id: row.id, contenido: row.body, emisor_id: row.sender_id,
    creado_en: row.created_at, tipo: row.message_type || 'texto', archivo_url: row.archivo_url || null,
    eliminado_en: row.eliminado_en, perfiles: profiles[row.sender_id] || null,
    clientKey: row.client_id || row.id };
}

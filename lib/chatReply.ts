export type ReplyQuote = {
    id: string;
    name: string;
    preview: string;
};

const MARK = '@@nexo_reply:';

/** Empaqueta cita + texto para guardar en `contenido` (sin migración SQL). */
export function encodeReplyContent(text: string, reply: ReplyQuote): string {
    const payload = JSON.stringify({
        id: reply.id,
        name: reply.name.slice(0, 40),
        preview: reply.preview.slice(0, 120),
    });
    return `${MARK}${payload}@@\n${text}`;
}

export function parseReplyContent(contenido: string): { reply: ReplyQuote | null; text: string } {
    if (!contenido?.startsWith(MARK)) return { reply: null, text: contenido || '' };
    const end = contenido.indexOf('@@\n', MARK.length);
    if (end < 0) return { reply: null, text: contenido };
    try {
        const raw = contenido.slice(MARK.length, end);
        const reply = JSON.parse(raw) as ReplyQuote;
        const text = contenido.slice(end + 3);
        if (!reply?.id) return { reply: null, text: contenido };
        return { reply, text };
    } catch {
        return { reply: null, text: contenido };
    }
}

export function previewForReply(contenido: string, tipo: string): string {
    if (tipo === 'imagen') return '📷 Foto';
    if (tipo === 'video') return '🎬 Vídeo';
    if (tipo === 'audio') return '🎤 Audio';
    const { text } = parseReplyContent(contenido);
    return text.trim().slice(0, 100) || 'Mensaje';
}

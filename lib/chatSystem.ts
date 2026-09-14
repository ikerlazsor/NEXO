/** Avisos de sistema en chat de plan/grupo (guardados en `contenido`). */

export const SYSTEM_MARK = '@@nexo_system:';

export type ChatSystemKind = 'join_plan' | 'join_group';

export function encodeSystemContent(kind: ChatSystemKind): string {
    return `${SYSTEM_MARK}${kind}`;
}

export function parseSystemContent(contenido: string | null | undefined): ChatSystemKind | null {
    if (!contenido) return null;
    const trimmed = contenido.trim();
    if (!trimmed.startsWith(SYSTEM_MARK)) return null;
    const kind = trimmed.slice(SYSTEM_MARK.length).trim();
    if (kind === 'join_plan' || kind === 'join_group') return kind;
    return null;
}

export function isSystemMessageContent(contenido: string | null | undefined): boolean {
    return parseSystemContent(contenido) != null;
}

/** Preview de lista de chats (evita enseñar `@@nexo_system:…` crudo). */
export function formatChatListPreview(
    msg: { tipo: string; contenido: string; emisor_id: string },
    opts: {
        names: Record<string, string>;
        currentUserId?: string | null;
        youLabel: string;
        userFallback: string;
        labels: {
            joinedPlanSelf: string;
            joinedGroupSelf: string;
            joinedPlan: (name: string) => string;
            joinedGroup: (name: string) => string;
            image: string;
            video: string;
            voice: string;
        };
    },
): string {
    const nombre = opts.names[msg.emisor_id] || opts.userFallback;
    const isSelf =
        (!!opts.currentUserId && msg.emisor_id === opts.currentUserId)
        || nombre === opts.youLabel;
    const systemKind = msg.tipo === 'texto' ? parseSystemContent(msg.contenido) : null;
    if (systemKind === 'join_group') {
        return isSelf ? opts.labels.joinedGroupSelf : opts.labels.joinedGroup(nombre);
    }
    if (systemKind === 'join_plan') {
        return isSelf ? opts.labels.joinedPlanSelf : opts.labels.joinedPlan(nombre);
    }
    if (msg.tipo === 'imagen') return `${nombre}: ${opts.labels.image}`;
    if (msg.tipo === 'video') return `${nombre}: ${opts.labels.video}`;
    if (msg.tipo === 'audio') {
        const sec = parseInt(msg.contenido, 10);
        const dur = Number.isFinite(sec) && sec > 0
            ? `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, '0')}`
            : null;
        return dur ? `${nombre}: ${opts.labels.voice} ${dur}` : `${nombre}: ${opts.labels.voice}`;
    }
    // Por si llega un system mark con tipo raro: nunca mostrar el código crudo.
    const fallbackKind = parseSystemContent(msg.contenido);
    if (fallbackKind === 'join_group') {
        return isSelf ? opts.labels.joinedGroupSelf : opts.labels.joinedGroup(nombre);
    }
    if (fallbackKind === 'join_plan') {
        return isSelf ? opts.labels.joinedPlanSelf : opts.labels.joinedPlan(nombre);
    }
    return `${nombre}: ${msg.contenido}`;
}

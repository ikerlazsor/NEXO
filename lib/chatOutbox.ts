import { createPersistentQueue } from './persistentQueue';
import { getAuthUser } from './auth';
import { randomUUID } from 'expo-crypto';
import { getIsOnline, subscribeNetwork } from './network';
import { withRetry } from './retry';
import { supabase } from './supabase';
import { unhideDirectChat } from './directChat';
import { unhidePlanChat } from './planChatHide';

const OUTBOX_KEY = '@nexo_chat_outbox_v1';

export type OutboxKind = 'plan' | 'direct';

export type OutboxItem = {
    tempId: string;
    /** Stable server identity, persisted before the first network attempt. */
    serverMessageId?: string;
    kind: OutboxKind;
    planId?: string | null;
    receptorId?: string | null;
    emisorId: string;
    contenido: string;
    tipo: 'texto' | 'imagen' | 'video' | 'audio';
    archivoUrl: string | null;
    createdAt: string;
};

type FlushListener = (event: {
    tempId: string;
    serverId: string;
    creadoEn: string;
    kind: OutboxKind;
    planId?: string | null;
    receptorId?: string | null;
}) => void;

let flushInflight: Promise<void> | null = null;
let outboxGeneration = 0;
const listeners = new Set<FlushListener>();
let networkHooked = false;

const queue = createPersistentQueue<OutboxItem>(OUTBOX_KEY);

export function subscribeOutboxFlush(listener: FlushListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function ensureNetworkHook() {
    if (networkHooked) return;
    networkHooked = true;
    subscribeNetwork((online) => {
        if (online) void flushChatOutbox().catch(() => {});
    });
}

export async function enqueueChatOutbox(item: OutboxItem): Promise<void> {
    ensureNetworkHook();
    await queue.update((items) => items.some((x) => x.tempId === item.tempId) ? items : [...items, {
        ...item,
        serverMessageId: item.serverMessageId ?? randomUUID(),
    }]);
}

export async function removeFromChatOutbox(tempId: string): Promise<void> {
    await queue.update((items) => items.filter((x) => x.tempId !== tempId));
}

export async function getChatOutbox(): Promise<OutboxItem[]> {
    return queue.read();
}

export async function discardChatOutbox(): Promise<void> {
    outboxGeneration += 1;
    await queue.clear();
}

/** Busca el mensaje que un intento anterior pudo dejar ya enviado. */
async function findSentMessage(
    item: OutboxItem,
): Promise<{ id: string; creado_en: string } | null> {
    if (item.serverMessageId) {
        const { data, error } = await supabase.from('mensajes').select('id, creado_en')
            .eq('id', item.serverMessageId).eq('emisor_id', item.emisorId).maybeSingle();
        if (error) throw error;
        return data?.id ? { id: data.id as string, creado_en: data.creado_en as string } : null;
    }
    // Legacy entries from before UUID-based sends retain their compatibility
    // lookup once. Every newly queued send uses its own UUID instead of content.
    const since = new Date(new Date(item.createdAt).getTime() - 60_000).toISOString();
    let query = supabase
        .from('mensajes')
        .select('id, creado_en')
        .eq('emisor_id', item.emisorId)
        .eq('tipo', item.tipo)
        .eq('contenido', item.contenido)
        .gte('creado_en', since)
        .limit(1);

    query = item.kind === 'plan'
        ? query.eq('plan_id', item.planId ?? '')
        : query.is('plan_id', null).eq('receptor_id', item.receptorId ?? '');

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data?.id ? { id: data.id as string, creado_en: data.creado_en as string } : null;
}

export async function flushChatOutbox(): Promise<void> {
    ensureNetworkHook();
    if (!getIsOnline()) return;
    if (flushInflight) return flushInflight;

    flushInflight = (async () => {
        const generation = outboxGeneration;
        const q = await queue.read();
        if (!q.length) return;

        const remaining: OutboxItem[] = [];
        for (const [index, item] of q.entries()) {
            if (generation !== outboxGeneration) return;
            if (!getIsOnline()) {
                remaining.push(...q.slice(index));
                break;
            }
            let user;
            try {
                user = await getAuthUser();
            } catch {
                remaining.push(...q.slice(index));
                break;
            }
            if (generation !== outboxGeneration) return;
            if (!user || user.id !== item.emisorId) {
                remaining.push(item);
                continue;
            }
            // Media sin archivo no se puede enviar offline
            if (item.tipo !== 'texto' && !item.archivoUrl) {
                remaining.push(item);
                continue;
            }
            try {
                const row =
                    item.kind === 'plan'
                        ? {
                              ...(item.serverMessageId ? { id: item.serverMessageId } : {}),
                              plan_id: item.planId,
                              contenido: item.contenido,
                              emisor_id: item.emisorId,
                              tipo: item.tipo,
                              archivo_url: item.archivoUrl,
                          }
                        : {
                              ...(item.serverMessageId ? { id: item.serverMessageId } : {}),
                              plan_id: null,
                              receptor_id: item.receptorId,
                              contenido: item.contenido,
                              emisor_id: item.emisorId,
                              tipo: item.tipo,
                              archivo_url: item.archivoUrl,
                          };

                // Un intento anterior pudo llegar al servidor y perderse la respuesta:
                // sin esto el reintento crearía un mensaje repetido.
                let data = await findSentMessage(item);

                if (!data?.id) {
                    // Sin reintentos: el insert no es idempotente, ya se reintenta en el flush.
                    data = await withRetry(async () => {
                        const res = await supabase
                            .from('mensajes')
                            .insert(row)
                            .select('id, creado_en')
                            .maybeSingle();
                        if (res.error) throw res.error;
                        return res.data;
                    }, { retries: 0, baseMs: 500 });
                }

                if (!data?.id) {
                    remaining.push(item);
                    continue;
                }

                if (generation !== outboxGeneration) return;
                if (item.kind === 'direct' && item.emisorId && item.receptorId) {
                    void unhideDirectChat(item.emisorId, item.receptorId);
                } else if (item.kind === 'plan' && item.emisorId && item.planId) {
                    void unhidePlanChat(item.emisorId, item.planId);
                }

                listeners.forEach((fn) => {
                    try {
                        fn({
                            tempId: item.tempId,
                            serverId: data.id as string,
                            creadoEn: (data.creado_en as string) || item.createdAt,
                            kind: item.kind,
                            planId: item.planId,
                            receptorId: item.receptorId,
                        });
                    } catch {
                        /* ignore */
                    }
                });

                try {
                    const { notifyPlanMessage, notifyDirectMessage } = await import('./push');
                    if (generation !== outboxGeneration) return;
                    const messageId = String(data.id);
                    if (item.kind === 'plan' && item.planId) {
                        notifyPlanMessage(item.planId, messageId);
                    } else if (item.kind === 'direct' && item.receptorId) {
                        notifyDirectMessage(item.receptorId, messageId);
                    }
                } catch {
                    /* ignore */
                }
            } catch {
                remaining.push(item);
            }
        }
        const completed = new Set(q.filter((item) => !remaining.includes(item)).map((item) => item.tempId));
        await queue.update((latest) => generation === outboxGeneration ? latest.filter((item) => !completed.has(item.tempId)) : latest);
    })().catch(() => {
        // Preserve the queue for the next online/focus attempt.
    }).finally(() => {
        flushInflight = null;
    });

    return flushInflight;
}

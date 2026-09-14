import AsyncStorage from '@react-native-async-storage/async-storage';
import { getIsOnline, subscribeNetwork } from './network';
import { withRetry } from './retry';
import { supabase } from './supabase';
import { unhideDirectChat } from './directChat';
import { unhidePlanChat } from './planChatHide';

const OUTBOX_KEY = '@nexo_chat_outbox_v1';

export type OutboxKind = 'plan' | 'direct';

export type OutboxItem = {
    tempId: string;
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

async function readQueue(): Promise<OutboxItem[]> {
    try {
        const raw = await AsyncStorage.getItem(OUTBOX_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as OutboxItem[];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

async function writeQueue(items: OutboxItem[]): Promise<void> {
    await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
}

export function subscribeOutboxFlush(listener: FlushListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function ensureNetworkHook() {
    if (networkHooked) return;
    networkHooked = true;
    subscribeNetwork((online) => {
        if (online) void flushChatOutbox();
    });
}

export async function enqueueChatOutbox(item: OutboxItem): Promise<void> {
    ensureNetworkHook();
    const q = await readQueue();
    if (q.some((x) => x.tempId === item.tempId)) return;
    q.push(item);
    await writeQueue(q);
}

export async function removeFromChatOutbox(tempId: string): Promise<void> {
    const q = await readQueue();
    await writeQueue(q.filter((x) => x.tempId !== tempId));
}

export async function getChatOutbox(): Promise<OutboxItem[]> {
    return readQueue();
}

export async function discardChatOutbox(): Promise<void> {
    outboxGeneration += 1;
    await AsyncStorage.removeItem(OUTBOX_KEY);
}

export async function flushChatOutbox(): Promise<void> {
    ensureNetworkHook();
    if (!getIsOnline()) return;
    if (flushInflight) return flushInflight;

    flushInflight = (async () => {
        const generation = outboxGeneration;
        let q = await readQueue();
        if (!q.length) return;

        const remaining: OutboxItem[] = [];
        for (const item of q) {
            if (generation !== outboxGeneration) return;
            // Media sin archivo no se puede enviar offline
            if (item.tipo !== 'texto' && !item.archivoUrl) {
                remaining.push(item);
                continue;
            }
            try {
                const row =
                    item.kind === 'plan'
                        ? {
                              plan_id: item.planId,
                              contenido: item.contenido,
                              emisor_id: item.emisorId,
                              tipo: item.tipo,
                              archivo_url: item.archivoUrl,
                          }
                        : {
                              plan_id: null,
                              receptor_id: item.receptorId,
                              contenido: item.contenido,
                              emisor_id: item.emisorId,
                              tipo: item.tipo,
                              archivo_url: item.archivoUrl,
                          };

                const data = await withRetry(async () => {
                    const res = await supabase
                        .from('mensajes')
                        .insert(row)
                        .select('id, creado_en')
                        .maybeSingle();
                    if (res.error) throw res.error;
                    return res.data;
                }, { retries: 2, baseMs: 500 });

                if (!data?.id) {
                    remaining.push(item);
                    continue;
                }

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
        if (generation === outboxGeneration) await writeQueue(remaining);
    })().finally(() => {
        flushInflight = null;
    });

    return flushInflight;
}

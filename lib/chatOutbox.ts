import AsyncStorage from '@react-native-async-storage/async-storage';
import { getIsOnline, subscribeNetwork } from './network';
import { withRetry } from './retry';
import { supabase } from './supabase';

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

export async function flushChatOutbox(): Promise<void> {
    ensureNetworkHook();
    if (!getIsOnline()) return;
    if (flushInflight) return flushInflight;

    flushInflight = (async () => {
        let q = await readQueue();
        if (!q.length) return;

        const remaining: OutboxItem[] = [];
        for (const item of q) {
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

                const preview =
                    item.tipo === 'texto'
                        ? item.contenido
                        : item.tipo === 'imagen'
                          ? '📷'
                          : item.tipo === 'video'
                            ? '🎬'
                            : '🎤';
                try {
                    const { notifyPlanMessage, notifyDirectMessage } = await import('./push');
                    if (item.kind === 'plan' && item.planId) {
                        notifyPlanMessage(item.planId, preview);
                    } else if (item.kind === 'direct' && item.receptorId) {
                        notifyDirectMessage(item.receptorId, preview);
                    }
                } catch {
                    /* ignore */
                }
            } catch {
                remaining.push(item);
            }
        }
        await writeQueue(remaining);
    })().finally(() => {
        flushInflight = null;
    });

    return flushInflight;
}

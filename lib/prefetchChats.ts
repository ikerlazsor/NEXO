import { InteractionManager } from 'react-native';
import {
    DIRECT_CHAT_TTL_MS,
    PAGE_SIZE,
    PLAN_CHAT_TTL_MS,
    directChatKey,
    mapMessageRow,
    planChatKey,
    type DirectChatSnapshot,
    type PlanChatSnapshot,
} from '../features/chat/chatModel';
import { resolveChatFileUrls } from './chatUpload';
import { cacheGetStale, cacheSet } from './ttlCache';
import { supabase } from './supabase';

type PrefetchChatRow = {
    id: string;
    title: string;
    image_url: string | null;
    kind: 'plan' | 'group' | 'direct';
    peerId?: string;
    creadorId?: string;
    fechaEvento?: string | null;
    unread?: number;
    lastAt?: string;
};

const MESSAGE_SELECT = `
    id,
    contenido,
    emisor_id,
    creado_en,
    tipo,
    archivo_url,
    perfiles:perfiles!mensajes_emisor_fkey (
        nombre,
        avatar_url
    )
`;

async function fetchLatestMessages(filter: {
    planId?: string;
    userId?: string;
    otherUserId?: string;
}) {
    let query = supabase
        .from('mensajes')
        .select(MESSAGE_SELECT)
        .order('creado_en', { ascending: false })
        .limit(PAGE_SIZE);

    if (filter.planId) {
        query = query.eq('plan_id', filter.planId);
    } else if (filter.userId && filter.otherUserId) {
        query = query
            .is('plan_id', null)
            .or(
                `and(emisor_id.eq.${filter.userId},receptor_id.eq.${filter.otherUserId}),and(emisor_id.eq.${filter.otherUserId},receptor_id.eq.${filter.userId})`,
            );
    } else {
        return [];
    }

    const { data, error } = await query;
    if (error || !data) return [];
    const rows = data.map((row) => mapMessageRow(row as Record<string, unknown>));
    return resolveChatFileUrls(rows);
}

/**
 * Precarga los chats más recientes / con no leídos para que al abrirlos
 * la conversación salga al instante.
 */
export function prefetchRecentChatThreads(userId: string, rows: PrefetchChatRow[]): void {
    if (!userId || rows.length === 0) return;

    const ranked = [...rows].sort((a, b) => {
        const ua = a.unread ?? 0;
        const ub = b.unread ?? 0;
        if (ub !== ua) return ub - ua;
        return new Date(b.lastAt || 0).getTime() - new Date(a.lastAt || 0).getTime();
    });

    InteractionManager.runAfterInteractions(() => {
        void (async () => {
            for (const row of ranked.slice(0, 10)) {
                try {
                    if (row.kind === 'direct') {
                        const peerId = row.peerId;
                        if (!peerId) continue;
                        const key = directChatKey(userId, peerId);
                        const stale = cacheGetStale<DirectChatSnapshot>(key);
                        if (stale?.messages?.length) continue;
                        const messages = await fetchLatestMessages({
                            userId,
                            otherUserId: peerId,
                        });
                        if (!messages.length) continue;
                        cacheSet(
                            key,
                            {
                                messages,
                                otherUserName: row.title,
                                otherUserAvatar: row.image_url,
                                hasMore: messages.length >= PAGE_SIZE,
                            } satisfies DirectChatSnapshot,
                            DIRECT_CHAT_TTL_MS,
                        );
                        continue;
                    }

                    const key = planChatKey(row.id);
                    const stale = cacheGetStale<PlanChatSnapshot>(key);
                    if (stale?.messages?.length) continue;
                    const messages = await fetchLatestMessages({ planId: row.id });
                    if (!messages.length) continue;
                    cacheSet(
                        key,
                        {
                            messages,
                            planName: row.title,
                            planImage: row.image_url,
                            participantNames: '',
                            isGroupChat: row.kind === 'group',
                            planCategory: row.kind === 'group' ? 'Grupo' : null,
                            planOwnerId: row.creadorId ?? null,
                            members: [],
                            creatorId: row.creadorId ?? null,
                            planFechaEvento: row.fechaEvento ?? null,
                            modoPrivado: false,
                            accessDenied: false,
                            hasMore: messages.length >= PAGE_SIZE,
                        } satisfies PlanChatSnapshot,
                        PLAN_CHAT_TTL_MS,
                    );
                } catch {
                    // best effort
                }
            }
        })();
    });
}

/** Semilla inmediata al tocar un chat: header al instante aunque aún no haya mensajes. */
export function seedChatThreadPeek(
    userId: string | null | undefined,
    row: PrefetchChatRow,
): void {
    if (!row?.id) return;
    if (row.kind === 'direct') {
        const peerId = row.peerId;
        if (!peerId || !userId) return;
        const key = directChatKey(userId, peerId);
        const existing = cacheGetStale<DirectChatSnapshot>(key);
        if (existing?.messages?.length) {
            cacheSet(
                key,
                {
                    ...existing,
                    otherUserName: row.title || existing.otherUserName,
                    otherUserAvatar: row.image_url ?? existing.otherUserAvatar,
                },
                DIRECT_CHAT_TTL_MS,
            );
            return;
        }
        cacheSet(
            key,
            {
                messages: existing?.messages ?? [],
                otherUserName: row.title,
                otherUserAvatar: row.image_url,
                hasMore: true,
            } satisfies DirectChatSnapshot,
            DIRECT_CHAT_TTL_MS,
        );
        // Precarga mensajes en background al tocar.
        void fetchLatestMessages({ userId, otherUserId: peerId }).then((messages) => {
            if (!messages.length) return;
            cacheSet(
                key,
                {
                    messages,
                    otherUserName: row.title,
                    otherUserAvatar: row.image_url,
                    hasMore: messages.length >= PAGE_SIZE,
                } satisfies DirectChatSnapshot,
                DIRECT_CHAT_TTL_MS,
            );
        });
        return;
    }

    const key = planChatKey(row.id);
    const existing = cacheGetStale<PlanChatSnapshot>(key);
    if (existing?.messages?.length) {
        cacheSet(
            key,
            {
                ...existing,
                planName: row.title || existing.planName,
                planImage: row.image_url ?? existing.planImage,
            },
            PLAN_CHAT_TTL_MS,
        );
        return;
    }
    cacheSet(
        key,
        {
            messages: existing?.messages ?? [],
            planName: row.title,
            planImage: row.image_url,
            participantNames: existing?.participantNames ?? '',
            isGroupChat: row.kind === 'group',
            planCategory: existing?.planCategory ?? (row.kind === 'group' ? 'Grupo' : null),
            planOwnerId: row.creadorId ?? existing?.planOwnerId ?? null,
            members: existing?.members ?? [],
            creatorId: row.creadorId ?? existing?.creatorId ?? null,
            planFechaEvento: row.fechaEvento ?? existing?.planFechaEvento ?? null,
            modoPrivado: existing?.modoPrivado ?? false,
            accessDenied: false,
            hasMore: true,
        } satisfies PlanChatSnapshot,
        PLAN_CHAT_TTL_MS,
    );
    void fetchLatestMessages({ planId: row.id }).then((messages) => {
        if (!messages.length) return;
        const prev = cacheGetStale<PlanChatSnapshot>(key);
        if (!prev) return;
        cacheSet(
            key,
            {
                ...prev,
                messages,
                hasMore: messages.length >= PAGE_SIZE,
            },
            PLAN_CHAT_TTL_MS,
        );
    });
}

/** Precarga un chat de plan y espera (con tope) a tener mensajes en caché. */
export async function warmPlanChat(planId: string, opts?: { title?: string; imageUrl?: string | null }): Promise<void> {
    if (!planId) return;
    const key = planChatKey(planId);
    const existing = cacheGetStale<PlanChatSnapshot>(key);
    if (existing?.messages?.length) return;

    seedChatThreadPeek(null, {
        id: planId,
        title: opts?.title || 'Plan',
        image_url: opts?.imageUrl ?? null,
        kind: 'plan',
    });

    try {
        const messages = await fetchLatestMessages({ planId });
        const prev = cacheGetStale<PlanChatSnapshot>(key);
        cacheSet(
            key,
            {
                messages,
                planName: opts?.title || prev?.planName || 'Plan',
                planImage: opts?.imageUrl ?? prev?.planImage ?? null,
                participantNames: prev?.participantNames ?? '',
                isGroupChat: prev?.isGroupChat ?? false,
                planCategory: prev?.planCategory ?? null,
                planOwnerId: prev?.planOwnerId ?? null,
                members: prev?.members ?? [],
                creatorId: prev?.creatorId ?? null,
                planFechaEvento: prev?.planFechaEvento ?? null,
                modoPrivado: prev?.modoPrivado ?? false,
                accessDenied: false,
                hasMore: messages.length >= PAGE_SIZE,
            } satisfies PlanChatSnapshot,
            PLAN_CHAT_TTL_MS,
        );
    } catch {
        /* best effort */
    }
}

/** Precarga chat directo y espera (con tope) a tener mensajes. */
export async function warmDirectChat(
    userId: string,
    otherUserId: string,
    opts?: { title?: string; avatarUrl?: string | null },
): Promise<void> {
    if (!userId || !otherUserId) return;
    const key = directChatKey(userId, otherUserId);
    const existing = cacheGetStale<DirectChatSnapshot>(key);
    if (existing?.messages?.length) return;

    seedChatThreadPeek(userId, {
        id: otherUserId,
        title: opts?.title || 'Chat',
        image_url: opts?.avatarUrl ?? null,
        kind: 'direct',
        peerId: otherUserId,
    });

    try {
        const messages = await fetchLatestMessages({ userId, otherUserId });
        cacheSet(
            key,
            {
                messages,
                otherUserName: opts?.title || 'Chat',
                otherUserAvatar: opts?.avatarUrl ?? null,
                hasMore: messages.length >= PAGE_SIZE,
            } satisfies DirectChatSnapshot,
            DIRECT_CHAT_TTL_MS,
        );
    } catch {
        /* best effort */
    }
}

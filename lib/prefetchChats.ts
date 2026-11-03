import { InteractionManager } from 'react-native';
import {
    DIRECT_CHAT_TTL_MS,
    PAGE_SIZE,
    PLAN_CHAT_TTL_MS,
    directChatKey,
    mapMessageRow,
    mergeMessages,
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

function newestMessageAt(messages?: { creado_en: string }[]): string | undefined {
    return messages?.[0]?.creado_en;
}

/** true si el preview de la lista es más nuevo que lo que hay en caché. */
function cacheBehindLatest(cachedNewestAt: string | undefined, listLastAt: string | undefined): boolean {
    if (!cachedNewestAt) return true;
    if (!listLastAt) return false;
    const cached = new Date(cachedNewestAt).getTime();
    const listed = new Date(listLastAt).getTime();
    if (!Number.isFinite(cached) || !Number.isFinite(listed)) return true;
    return listed - cached > 400;
}

function persistMergedPlanThread(
    key: string,
    messages: PlanChatSnapshot['messages'],
    seed: Partial<PlanChatSnapshot> & Pick<PlanChatSnapshot, 'planName' | 'planImage'>,
) {
    const prev = cacheGetStale<PlanChatSnapshot>(key);
    cacheSet(
        key,
        {
            messages: mergeMessages(messages, prev?.messages ?? []),
            planName: seed.planName || prev?.planName || 'Plan',
            planImage: seed.planImage ?? prev?.planImage ?? null,
            participantNames: seed.participantNames ?? prev?.participantNames ?? '',
            isGroupChat: seed.isGroupChat ?? prev?.isGroupChat ?? false,
            planCategory: seed.planCategory ?? prev?.planCategory ?? null,
            planOwnerId: seed.planOwnerId ?? prev?.planOwnerId ?? null,
            members: seed.members ?? prev?.members ?? [],
            creatorId: seed.creatorId ?? prev?.creatorId ?? null,
            planFechaEvento: seed.planFechaEvento ?? prev?.planFechaEvento ?? null,
            modoPrivado: seed.modoPrivado ?? prev?.modoPrivado ?? false,
            accessDenied: false,
            hasMore: messages.length >= PAGE_SIZE || (prev?.hasMore ?? false),
        } satisfies PlanChatSnapshot,
        PLAN_CHAT_TTL_MS,
    );
}

function persistMergedDirectThread(
    key: string,
    messages: DirectChatSnapshot['messages'],
    seed: { otherUserName: string; otherUserAvatar: string | null },
) {
    const prev = cacheGetStale<DirectChatSnapshot>(key);
    cacheSet(
        key,
        {
            messages: mergeMessages(messages, prev?.messages ?? []),
            otherUserName: seed.otherUserName || prev?.otherUserName || 'Chat',
            otherUserAvatar: seed.otherUserAvatar ?? prev?.otherUserAvatar ?? null,
            hasMore: messages.length >= PAGE_SIZE || (prev?.hasMore ?? false),
        } satisfies DirectChatSnapshot,
        DIRECT_CHAT_TTL_MS,
    );
}

/** Cuando llega un DM en la bandeja, el hilo ya tiene el mensaje al abrirlo. */
export function ingestInboxDirectMessage(userId: string, row: Record<string, unknown>): void {
    if (!userId || !row?.id || row.plan_id) return;
    const emisor = String(row.emisor_id ?? '');
    const receptor = String(row.receptor_id ?? '');
    const peerId = emisor === userId ? receptor : emisor;
    if (!peerId) return;
    const key = directChatKey(userId, peerId);
    const prev = cacheGetStale<DirectChatSnapshot>(key);
    const msg = mapMessageRow(row);
    persistMergedDirectThread(key, [msg], {
        otherUserName: prev?.otherUserName || '',
        otherUserAvatar: prev?.otherUserAvatar ?? null,
    });
    if (msg.archivo_url) {
        void resolveChatFileUrls([msg]).then((resolved) => {
            persistMergedDirectThread(key, resolved, {
                otherUserName: prev?.otherUserName || '',
                otherUserAvatar: prev?.otherUserAvatar ?? null,
            });
        });
    }
}

/** Precarga un hilo en cuanto el dedo toca la fila, sin esperar al lote de fondo. */
export function prefetchChatRow(userId: string | null | undefined, row: PrefetchChatRow): void {
    if (!userId || !row?.id) return;
    void warmChatRow(userId, row);
}

async function warmChatRow(userId: string, row: PrefetchChatRow): Promise<void> {
    if (row.kind === 'direct') {
        const peerId = row.peerId;
        if (!peerId) return;
        const key = directChatKey(userId, peerId);
        const stale = cacheGetStale<DirectChatSnapshot>(key);
        if (stale?.messages?.length && !cacheBehindLatest(newestMessageAt(stale.messages), row.lastAt)) return;
        const messages = await fetchLatestMessages({ userId, otherUserId: peerId });
        if (!messages.length) return;
        persistMergedDirectThread(key, messages, {
            otherUserName: row.title,
            otherUserAvatar: row.image_url,
        });
        return;
    }
    const key = planChatKey(row.id);
    const stale = cacheGetStale<PlanChatSnapshot>(key);
    if (stale?.messages?.length && !cacheBehindLatest(newestMessageAt(stale.messages), row.lastAt)) return;
    const messages = await fetchLatestMessages({ planId: row.id });
    if (!messages.length) return;
    persistMergedPlanThread(key, messages, {
        planName: row.title,
        planImage: row.image_url,
        isGroupChat: row.kind === 'group',
        planCategory: row.kind === 'group' ? 'Grupo' : null,
        planOwnerId: row.creadorId ?? null,
        creatorId: row.creadorId ?? null,
        planFechaEvento: row.fechaEvento ?? null,
    });
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
                    await warmChatRow(userId, row);
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
        persistMergedDirectThread(key, existing?.messages ?? [], {
            otherUserName: row.title || existing?.otherUserName || 'Chat',
            otherUserAvatar: row.image_url ?? existing?.otherUserAvatar ?? null,
        });
        void fetchLatestMessages({ userId, otherUserId: peerId }).then((messages) => {
            if (!messages.length) return;
            persistMergedDirectThread(key, messages, {
                otherUserName: row.title,
                otherUserAvatar: row.image_url,
            });
        });
        return;
    }

    const key = planChatKey(row.id);
    const existing = cacheGetStale<PlanChatSnapshot>(key);
    persistMergedPlanThread(key, existing?.messages ?? [], {
        planName: row.title || existing?.planName || 'Plan',
        planImage: row.image_url ?? existing?.planImage ?? null,
        participantNames: existing?.participantNames ?? '',
        isGroupChat: row.kind === 'group' || existing?.isGroupChat,
        planCategory: existing?.planCategory ?? (row.kind === 'group' ? 'Grupo' : null),
        planOwnerId: row.creadorId ?? existing?.planOwnerId ?? null,
        members: existing?.members ?? [],
        creatorId: row.creadorId ?? existing?.creatorId ?? null,
        planFechaEvento: row.fechaEvento ?? existing?.planFechaEvento ?? null,
        modoPrivado: existing?.modoPrivado ?? false,
    });
    void fetchLatestMessages({ planId: row.id }).then((messages) => {
        if (!messages.length) return;
        persistMergedPlanThread(key, messages, {
            planName: row.title,
            planImage: row.image_url,
        });
    });
}

/** Precarga un chat de plan y espera (con tope) a tener mensajes en caché. */
export async function warmPlanChat(planId: string, opts?: { title?: string; imageUrl?: string | null }): Promise<void> {
    if (!planId) return;
    const key = planChatKey(planId);
    seedChatThreadPeek(null, {
        id: planId,
        title: opts?.title || 'Plan',
        image_url: opts?.imageUrl ?? null,
        kind: 'plan',
    });

    try {
        const messages = await fetchLatestMessages({ planId });
        persistMergedPlanThread(key, messages, {
            planName: opts?.title || 'Plan',
            planImage: opts?.imageUrl ?? null,
        });
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
    seedChatThreadPeek(userId, {
        id: otherUserId,
        title: opts?.title || 'Chat',
        image_url: opts?.avatarUrl ?? null,
        kind: 'direct',
        peerId: otherUserId,
    });

    try {
        const messages = await fetchLatestMessages({ userId, otherUserId });
        persistMergedDirectThread(key, messages, {
            otherUserName: opts?.title || 'Chat',
            otherUserAvatar: opts?.avatarUrl ?? null,
        });
    } catch {
        /* best effort */
    }
}

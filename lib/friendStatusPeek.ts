import type { FriendStatus } from './friends';
import { screenCacheKey } from './screenCaches';
import { cacheGetStale } from './ttlCache';
import { FEED_CACHE_KEY, type FeedSnapshot } from './feedCache';

type PeekEntry = { status: FriendStatus; requestId: string | null; at: number };

const peekMap = new Map<string, PeekEntry>();
const PEEK_TTL_MS = 10 * 60 * 1000;

/** Recuerda el estado de amistad visto (feed, amigos, red) para pintar el CTA al instante. */
export function rememberFriendStatus(
    otherUserId: string | null | undefined,
    status: FriendStatus,
    requestId: string | null = null,
): void {
    if (!otherUserId || status === 'self') return;
    peekMap.set(otherUserId, { status, requestId, at: Date.now() });
}

export function rememberFriendsSet(friendIds: Iterable<string>): void {
    const now = Date.now();
    for (const id of friendIds) {
        if (!id) continue;
        const prev = peekMap.get(id);
        // No pisar pending_* más reciente.
        if (prev && (prev.status === 'pending_sent' || prev.status === 'pending_received')) {
            if (now - prev.at < PEEK_TTL_MS) continue;
        }
        peekMap.set(id, { status: 'friends', requestId: prev?.requestId ?? null, at: now });
    }
}

export function peekFriendStatus(
    otherUserId: string | null | undefined,
): { status: FriendStatus; requestId: string | null } | null {
    if (!otherUserId) return null;
    const row = peekMap.get(otherUserId);
    if (row && Date.now() - row.at <= PEEK_TTL_MS) {
        return { status: row.status, requestId: row.requestId };
    }

    // Feed snapshot
    const feed = cacheGetStale<FeedSnapshot>(FEED_CACHE_KEY);
    if (feed?.friendIds?.includes(otherUserId)) {
        return { status: 'friends', requestId: null };
    }

    // Pantalla de amigos (si ya se precargó)
    // Buscamos en cualquier friendsScreen:* reciente no es trivial sin userId;
    // el caller suele pasar friendHint / seed.
    return row ? { status: row.status, requestId: row.requestId } : null;
}

/** Mira la lista de amigos del viewer en caché. */
export function peekFriendStatusFromFriendsScreen(
    viewerId: string | null | undefined,
    otherUserId: string | null | undefined,
): { status: FriendStatus; requestId: string | null } | null {
    if (!viewerId || !otherUserId) return null;
    const snap = cacheGetStale<{
        friends?: Array<{ id?: string; friendshipId?: string }>;
        incoming?: Array<{ id?: string; usuario_origen_id?: string }>;
        outgoing?: Array<{ id?: string; usuario_destino_id?: string }>;
    }>(screenCacheKey.friends(viewerId));
    if (!snap) return null;

    const friend = (snap.friends ?? []).find((f) => f.id === otherUserId);
    if (friend) {
        return { status: 'friends', requestId: friend.friendshipId ?? null };
    }
    const incoming = (snap.incoming ?? []).find(
        (r) => r.usuario_origen_id === otherUserId || (r as { perfil?: { id?: string } }).perfil?.id === otherUserId,
    );
    if (incoming) {
        return { status: 'pending_received', requestId: incoming.id ?? null };
    }
    const outgoing = (snap.outgoing ?? []).find(
        (r) =>
            r.usuario_destino_id === otherUserId ||
            (r as { perfil?: { id?: string } }).perfil?.id === otherUserId,
    );
    if (outgoing) {
        return { status: 'pending_sent', requestId: outgoing.id ?? null };
    }
    return null;
}

export function resolveKnownFriendStatus(opts: {
    viewerId?: string | null;
    otherUserId?: string | null;
    cachedStatus?: FriendStatus | null;
    friendHint?: boolean;
}): FriendStatus | null {
    const { viewerId, otherUserId, cachedStatus, friendHint } = opts;
    if (!otherUserId) return null;
    if (viewerId && viewerId === otherUserId) return 'self';
    if (cachedStatus && cachedStatus !== null) return cachedStatus;
    if (friendHint) return 'friends';

    const peeked = peekFriendStatus(otherUserId);
    if (peeked) return peeked.status;

    const fromFriends = peekFriendStatusFromFriendsScreen(viewerId, otherUserId);
    if (fromFriends) return fromFriends.status;

    return null;
}

import { parsePlanInviteCard } from './chatPlanInviteCard';
import {
    getAnyInviteForPlan,
    getPlanCapacity,
    reopenPlanInvite,
    type PlanInvite,
} from './planInvites';
import { planCoverList } from './planCovers';
import { supabase } from './supabase';
import { cacheInvalidate } from './ttlCache';
import { screenCacheKey } from './screenCaches';
import { invalidateChatSummaries } from './chatSummaries';

export type InviteCardUiStatus =
    | 'loading'
    | 'pending'
    | 'accepted'
    | 'rejected'
    | 'full'
    | 'waitlist'
    | 'none'
    | 'self'
    | 'gone';

export type InviteCardStatusSnap = {
    status: InviteCardUiStatus;
    invite: PlanInvite | null;
    coverUrl: string | null;
    resolvedAt: number;
    /** Plazas para el contador x/y de la tarjeta. */
    joinedCount?: number | null;
    maxCount?: number | null;
};

const snaps = new Map<string, InviteCardStatusSnap>();
const listeners = new Set<(planId: string) => void>();

function snapKey(planId: string, userId: string | null) {
    return `${planId}:${userId ?? 'anon'}`;
}

export function peekInviteCardStatus(
    planId: string,
    userId: string | null,
): InviteCardStatusSnap | null {
    return snaps.get(snapKey(planId, userId)) ?? null;
}

export function setInviteCardStatus(
    planId: string,
    userId: string | null,
    patch: Partial<InviteCardStatusSnap> & { status: InviteCardUiStatus },
): void {
    const key = snapKey(planId, userId);
    const prev = snaps.get(key);
    const next: InviteCardStatusSnap = {
        status: patch.status,
        invite: patch.invite !== undefined ? patch.invite : (prev?.invite ?? null),
        coverUrl: patch.coverUrl !== undefined ? patch.coverUrl : (prev?.coverUrl ?? null),
        resolvedAt: Date.now(),
        joinedCount:
            patch.joinedCount !== undefined ? patch.joinedCount : (prev?.joinedCount ?? null),
        maxCount: patch.maxCount !== undefined ? patch.maxCount : (prev?.maxCount ?? null),
    };
    snaps.set(key, next);
    // Si el snapshot no cambia no se avisa: evita cadenas de reentrada entre tarjetas.
    if (
        prev
        && prev.status === next.status
        && (prev.invite?.id ?? null) === (next.invite?.id ?? null)
        && prev.coverUrl === next.coverUrl
        && (prev.joinedCount ?? null) === (next.joinedCount ?? null)
        && (prev.maxCount ?? null) === (next.maxCount ?? null)
    ) {
        return;
    }
    listeners.forEach((l) => {
        try {
            l(planId);
        } catch {
            /* ignore */
        }
    });
}

export function subscribeInviteCardStatus(listener: (planId: string) => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Resuelve estado + portada; pensado para precarga en chats y para la tarjeta. */
export async function resolveInviteCardStatus(opts: {
    planId: string;
    inviterId: string;
    currentUserId: string | null;
    imagenUrlHint?: string | null;
}): Promise<InviteCardStatusSnap> {
    const { planId, inviterId, currentUserId, imagenUrlHint } = opts;
    let coverUrl = imagenUrlHint ?? null;

    const { data: planRow, error: planErr } = await supabase
        .from('planes')
        .select('id, imagen_url, imagenes_url')
        .eq('id', planId)
        .maybeSingle();

    if (planErr || !planRow?.id) {
        const gone: InviteCardStatusSnap = {
            status: 'gone',
            invite: null,
            coverUrl: null,
            resolvedAt: Date.now(),
        };
        setInviteCardStatus(planId, currentUserId, gone);
        return gone;
    }

    if (!coverUrl) {
        coverUrl =
            planCoverList({
                imagen_url: planRow.imagen_url,
                imagenes_url: planRow.imagenes_url,
            })[0] ?? planRow.imagen_url ?? null;
    }

    if (!currentUserId) {
        const snap: InviteCardStatusSnap = {
            status: 'none',
            invite: null,
            coverUrl,
            resolvedAt: Date.now(),
        };
        setInviteCardStatus(planId, currentUserId, snap);
        return snap;
    }

    if (currentUserId === inviterId) {
        const snap: InviteCardStatusSnap = {
            status: 'self',
            invite: null,
            coverUrl,
            resolvedAt: Date.now(),
        };
        setInviteCardStatus(planId, currentUserId, snap);
        return snap;
    }

    const [{ data: member }, capacity] = await Promise.all([
        supabase
            .from('participantes')
            .select('id, estado')
            .eq('plan_id', planId)
            .eq('usuario_id', currentUserId)
            .maybeSingle(),
        getPlanCapacity(planId),
    ]);

    const commit = (
        snap: Omit<InviteCardStatusSnap, 'resolvedAt' | 'coverUrl' | 'joinedCount' | 'maxCount'>,
    ): InviteCardStatusSnap => {
        const resolved: InviteCardStatusSnap = {
            ...snap,
            coverUrl,
            joinedCount: capacity.joined,
            maxCount: capacity.max,
            resolvedAt: Date.now(),
        };
        setInviteCardStatus(planId, currentUserId, resolved);
        return resolved;
    };

    if (member?.estado === 'lista_espera') {
        return commit({ status: 'waitlist', invite: null });
    }
    if (member?.estado === 'aceptado' || member?.estado === 'pendiente') {
        return commit({ status: 'accepted', invite: null });
    }

    const invite = await getAnyInviteForPlan(planId, currentUserId);
    if (!invite) return commit({ status: 'none', invite: null });

    // Se conserva la invitación para poder deshacer el rechazo.
    if (invite.estado === 'rechazado') return commit({ status: 'rejected', invite });

    if (invite.estado !== 'pendiente') {
        // A quien expulsaron no se le reabre la invitación sola.
        const { data: kicked } = await supabase
            .from('expulsiones_plan')
            .select('usuario_id')
            .eq('plan_id', planId)
            .eq('usuario_id', currentUserId)
            .maybeSingle();
        if (kicked) return commit({ status: 'none', invite: null });

        // Aceptada pero fuera de participantes: se desunió y puede volver a entrar.
        const { error } = await reopenPlanInvite(invite.id);
        if (error) return commit({ status: 'none', invite: null });
        invite.estado = 'pendiente';
    }

    const noSeats = capacity.max != null && capacity.joined >= capacity.max;
    return commit({ status: noSeats ? 'full' : 'pending', invite });
}

/** Precarga estados de tarjetas vistas en previews de chats. */
export function warmInviteCardsFromContents(
    contents: Array<string | null | undefined>,
    currentUserId: string | null,
): void {
    const seen = new Set<string>();
    for (const content of contents) {
        const card = parsePlanInviteCard(content);
        if (!card || seen.has(card.planId)) continue;
        seen.add(card.planId);
        const peek = peekInviteCardStatus(card.planId, currentUserId);
        if (peek && Date.now() - peek.resolvedAt < 20_000) continue;
        void resolveInviteCardStatus({
            planId: card.planId,
            inviterId: card.inviterId,
            currentUserId,
            imagenUrlHint: card.imagenUrl,
        });
    }
}

/** Borra mensaje huérfano + invalida listas de chats. */
export async function purgeInviteCardMessage(opts: {
    messageId: string;
    planId: string;
    currentUserId: string | null;
}): Promise<void> {
    const { messageId, planId, currentUserId } = opts;
    setInviteCardStatus(planId, currentUserId, { status: 'gone', invite: null, coverUrl: null });
    try {
        await supabase.from('mensajes').delete().eq('id', messageId);
    } catch {
        /* best-effort */
    }
    if (currentUserId) {
        invalidateChatSummaries(currentUserId);
        cacheInvalidate(screenCacheKey.chatsList(currentUserId));
    }
}

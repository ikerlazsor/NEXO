import {
    parsePlanInviteCard,
    type PlanInviteCardMember,
} from './chatPlanInviteCard';
import { supabase } from './supabase';

const peopleByPlan = new Map<string, PlanInviteCardMember[]>();
const listeners = new Set<(planId: string) => void>();
const inflight = new Map<string, Promise<PlanInviteCardMember[]>>();
const channelRefCounts = new Map<string, number>();
const channels = new Map<string, ReturnType<typeof supabase.channel>>();

function notify(planId: string) {
    for (const listener of listeners) listener(planId);
}

export function peekInviteCardPeople(planId: string): PlanInviteCardMember[] | null {
    if (!planId) return null;
    return peopleByPlan.get(planId) ?? null;
}

export function subscribeInviteCardPeople(listener: (planId: string) => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export async function fetchInviteCardMembers(planId: string): Promise<PlanInviteCardMember[]> {
    const { data } = await supabase
        .from('participantes')
        .select('usuario_id, perfiles:usuario_id ( id, nombre, avatar_url )')
        .eq('plan_id', planId)
        .eq('estado', 'aceptado')
        .limit(12);
    if (!data?.length) return [];
    return data
        .map((row) => {
            const perfil = Array.isArray(row.perfiles) ? row.perfiles[0] : row.perfiles;
            if (!perfil || typeof perfil !== 'object') return null;
            const id =
                String((perfil as { id?: string }).id || row.usuario_id || '').trim();
            if (!id) return null;
            return {
                id,
                nombre: String((perfil as { nombre?: string | null }).nombre || 'Nexo'),
                avatarUrl: ((perfil as { avatar_url?: string | null }).avatar_url as string | null) ?? null,
            } satisfies PlanInviteCardMember;
        })
        .filter(Boolean) as PlanInviteCardMember[];
}

export function refreshInviteCardPeople(planId: string): Promise<PlanInviteCardMember[]> {
    if (!planId) return Promise.resolve([]);
    const existing = inflight.get(planId);
    if (existing) return existing;
    const job = fetchInviteCardMembers(planId)
        .then((members) => {
            const prev = peopleByPlan.get(planId);
            const prevKey = (prev ?? []).map((m) => m.id).join(',');
            const nextKey = members.map((m) => m.id).join(',');
            peopleByPlan.set(planId, members);
            if (prevKey !== nextKey) notify(planId);
            return members;
        })
        .finally(() => {
            inflight.delete(planId);
        });
    inflight.set(planId, job);
    return job;
}

/** Suscripción realtime por plan (ref-counted) para viewers del chat de grupo. */
export function retainInviteCardPeopleChannel(planId: string): () => void {
    if (!planId) return () => {};
    const n = (channelRefCounts.get(planId) ?? 0) + 1;
    channelRefCounts.set(planId, n);
    if (n === 1) {
        const channel = supabase
            .channel(`invite-people:${planId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'participantes',
                    filter: `plan_id=eq.${planId}`,
                },
                () => {
                    void refreshInviteCardPeople(planId);
                },
            )
            .subscribe();
        channels.set(planId, channel);
        void refreshInviteCardPeople(planId);
    }
    return () => {
        const left = (channelRefCounts.get(planId) ?? 1) - 1;
        if (left <= 0) {
            channelRefCounts.delete(planId);
            const ch = channels.get(planId);
            channels.delete(planId);
            if (ch) void supabase.removeChannel(ch);
        } else {
            channelRefCounts.set(planId, left);
        }
    };
}

export function warmInviteCardPeopleFromContents(
    contents: Array<string | null | undefined>,
): void {
    const seen = new Set<string>();
    for (const content of contents) {
        const card = parsePlanInviteCard(content);
        if (!card?.planId || seen.has(card.planId)) continue;
        seen.add(card.planId);
        if (card.members?.length && !peopleByPlan.has(card.planId)) {
            peopleByPlan.set(card.planId, card.members);
        }
        void refreshInviteCardPeople(card.planId);
    }
}

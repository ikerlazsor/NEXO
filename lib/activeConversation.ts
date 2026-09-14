import { dismissPushForDirectChat, dismissPushForPlanChat } from './presentedPush';

/** Conversación abierta en primer plano (para silenciar banners push de ese hilo). */

export type ActiveConversation =
    | { kind: 'plan'; id: string }
    | { kind: 'direct'; id: string }
    | null;

let active: ActiveConversation = null;

export function setActiveConversation(next: ActiveConversation): void {
    active = next;
    if (next?.kind === 'plan') dismissPushForPlanChat(next.id);
    if (next?.kind === 'direct') dismissPushForDirectChat(next.id);
}

export function getActiveConversation(): ActiveConversation {
    return active;
}

export function isActivePlanChat(planId: string): boolean {
    return active?.kind === 'plan' && active.id === planId;
}

export function isActiveDirectChat(otherUserId: string): boolean {
    return active?.kind === 'direct' && active.id === otherUserId;
}

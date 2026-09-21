/** Marca chats abiertos desde el detalle del plan para no re-apilar otro plan/[id] (crash/expulsión). */
let openedFromPlanId: string | null = null;

export function markChatOpenedFromPlan(planId: string | null | undefined): void {
    const id = typeof planId === 'string' ? planId.trim() : '';
    openedFromPlanId = id || null;
}

export function clearChatOpenedFromPlan(planId?: string | null): void {
    if (!planId || openedFromPlanId === planId) openedFromPlanId = null;
}

export function wasChatOpenedFromPlan(planId: string | null | undefined): boolean {
    const id = typeof planId === 'string' ? planId.trim() : '';
    return !!id && openedFromPlanId === id;
}

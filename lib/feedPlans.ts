/** Planes visibles en el feed (no chats directos ni grupos). */
export function isFeedPlan(plan: {
    is_direct_chat?: boolean | null;
    is_group_chat?: boolean | null;
    category?: string | null;
}): boolean {
    if (plan.is_direct_chat === true) return false;
    if (plan.is_group_chat === true) return false;
    const cat = plan.category ?? '';
    if (cat === 'Chat' || cat === 'Grupo') return false;
    return true;
}

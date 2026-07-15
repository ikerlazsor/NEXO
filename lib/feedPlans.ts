/** Categorías internas que no deben aparecer en el feed (grupos de chat). */
const NON_FEED_CATEGORIES = new Set(['Grupo', 'Chat']);

/** Planes visibles en el feed (excluye grupos de chat creados por usuarios). */
export function isFeedPlan(plan: { categoria?: string | null }): boolean {
    return !NON_FEED_CATEGORIES.has(plan.categoria ?? '');
}

/** Grupo de chat creado desde la pantalla de chats (no es un plan del feed). */
export function isGroupChatPlan(plan: { categoria?: string | null }): boolean {
    return plan.categoria === 'Grupo';
}

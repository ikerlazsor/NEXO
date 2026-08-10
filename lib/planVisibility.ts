/**
 * Visibilidad de planes en el feed:
 * - modo_privado: solo creador, participantes e invitados
 * - solo_amigos: solo amigos del creador (+ creador / ya dentro / invitados)
 * - owner: ve todos los planes de meetup (moderación)
 */

export type PlanVisibilityFlags = {
    creador_id?: string | null;
    solo_amigos?: boolean | null;
    modo_privado?: boolean | null;
};

export type FeedVisibilityContext = {
    userId: string | null;
    friendIds: Set<string>;
    /** Planes donde el user tiene membresía (joined/requested) */
    membershipPlanIds: Set<string>;
    /** Planes con invitación pendiente al user */
    invitedPlanIds: Set<string>;
    /** Owner: ve privados / solo amigos / solo chicas en el feed */
    isOwner?: boolean;
};

export function canSeePlanInFeed(
    plan: PlanVisibilityFlags & { id?: string },
    ctx: FeedVisibilityContext,
): boolean {
    if (ctx.isOwner) return true;

    const uid = ctx.userId;
    if (!uid) {
        // Sin sesión: ocultar restringidos
        return !plan.modo_privado && !plan.solo_amigos;
    }

    const planId = plan.id ? String(plan.id) : '';
    const isCreator = String(plan.creador_id) === String(uid);
    if (isCreator) return true;

    const alreadyIn =
        (planId && ctx.membershipPlanIds.has(planId)) ||
        (planId && ctx.invitedPlanIds.has(planId));

    if (plan.modo_privado) {
        return Boolean(alreadyIn);
    }

    if (plan.solo_amigos) {
        return alreadyIn || (plan.creador_id != null && ctx.friendIds.has(String(plan.creador_id)));
    }

    return true;
}

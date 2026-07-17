import type { Genero } from './profileFields';

export const SOLO_CHICAS_CATEGORY = 'Solo chicas';

export type SoloChicasPlanFields = {
    categoria?: string | null;
    solo_chicas?: boolean | null;
};

export function isSoloChicasPlan(plan: SoloChicasPlanFields | string | null | undefined): boolean {
    if (plan == null) return false;
    if (typeof plan === 'string') return plan === SOLO_CHICAS_CATEGORY;
    return plan.solo_chicas === true || plan.categoria === SOLO_CHICAS_CATEGORY;
}

/** Solo planes en modo solo chicas: únicamente género femenino puede participar. */
export function canJoinPlanByGender(
    plan: SoloChicasPlanFields | string | null | undefined,
    userGenero: Genero | null | undefined,
): boolean {
    if (!isSoloChicasPlan(plan)) return true;
    return userGenero === 'femenino';
}

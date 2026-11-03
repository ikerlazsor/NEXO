import { supabase } from './supabase';

/**
 * A quien el anfitrión saca de un plan no se le deja volver a entrar por su
 * cuenta. La expulsión se levanta solo si el anfitrión vuelve a invitarle.
 */
export async function wasKickedFromPlan(planId: string, userId: string): Promise<boolean> {
    if (!planId || !userId) return false;
    const { data } = await supabase
        .from('expulsiones_plan')
        .select('usuario_id')
        .eq('plan_id', planId)
        .eq('usuario_id', userId)
        .maybeSingle();
    return !!data;
}

/** Best-effort: si el invitador es el anfitrión, deja de contar la expulsión. */
export async function clearPlanKickIfHost(
    planId: string,
    invitadorId: string,
    invitadoId: string,
): Promise<void> {
    if (!planId || !invitadorId || !invitadoId) return;
    const { data: plan } = await supabase
        .from('planes')
        .select('creador_id')
        .eq('id', planId)
        .maybeSingle();
    if (plan?.creador_id !== invitadorId) return;
    await supabase
        .from('expulsiones_plan')
        .delete()
        .eq('plan_id', planId)
        .eq('usuario_id', invitadoId);
}

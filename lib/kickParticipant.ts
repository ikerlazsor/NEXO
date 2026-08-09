import { promoteWaitlist } from './participants';
import { invalidateUserStatsCache } from './stats';
import { supabase } from './supabase';

export async function kickParticipant(
    planId: string,
    targetUserId: string,
    requesterId: string,
): Promise<{ error: string | null }> {
    const { data: plan, error: planError } = await supabase
        .from('planes')
        .select('creador_id')
        .eq('id', planId)
        .maybeSingle();

    if (planError || !plan) {
        return { error: planError?.message ?? 'Plan no encontrado' };
    }

    if (plan.creador_id !== requesterId) {
        return { error: 'Solo el creador puede eliminar integrantes' };
    }

    if (targetUserId === plan.creador_id) {
        return { error: 'No puedes eliminar al creador del plan' };
    }

    // Registrar expulsión (best effort; no bloquear si la tabla/RLS falla)
    void supabase.from('expulsiones_plan').upsert(
        {
            plan_id: planId,
            usuario_id: targetUserId,
            expulsado_por: requesterId,
        },
        { onConflict: 'plan_id,usuario_id', ignoreDuplicates: true },
    );

    const { error } = await supabase
        .from('participantes')
        .delete()
        .eq('plan_id', planId)
        .eq('usuario_id', targetUserId);

    if (error) {
        return { error: error.message };
    }

    invalidateUserStatsCache(targetUserId);
    void promoteWaitlist(planId);
    return { error: null };
}

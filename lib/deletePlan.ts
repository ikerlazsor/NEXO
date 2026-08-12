import { supabase } from './supabase';

/** Elimina primero los archivos físicos y después el plan completo en servidor. */
export async function deletePlanCompletely(planId: string): Promise<{ error: string | null }> {
    if (!planId) return { error: 'invalid_target' };
    try {
        const { data, error } = await supabase.functions.invoke('delete-plan', {
            body: { planId },
        });
        if (error) return { error: error.message };
        const payload = data as { error?: string } | null;
        return { error: payload?.error ?? null };
    } catch (error) {
        return {
            error: error instanceof Error ? error.message : 'delete_plan_failed',
        };
    }
}

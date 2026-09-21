import { noteFeedPlanDeleted } from './feedReload';
import { screenCacheKey } from './screenCaches';
import { supabase } from './supabase';
import { cacheInvalidate, cacheInvalidatePrefix } from './ttlCache';

/** Elimina primero los archivos físicos y después el plan completo en servidor. */
export async function deletePlanCompletely(planId: string): Promise<{ error: string | null }> {
    if (!planId) return { error: 'invalid_target' };

    // Optimistic: marcar como eliminado en feed antes de la red
    noteFeedPlanDeleted(planId);

    // Invalidar caches locales inmediatamente
    cacheInvalidatePrefix('planDetail:');
    cacheInvalidate(screenCacheKey.feedSnapshot);

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

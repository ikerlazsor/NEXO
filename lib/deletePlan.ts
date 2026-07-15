import { supabase } from './supabase';

/**
 * Elimina un plan y sus datos relacionados (chat, participantes, invitaciones,
 * guardados, historial y valoraciones). Los pasos auxiliares son "best effort":
 * si RLS impide borrar filas de otros usuarios, seguimos e intentamos borrar el plan.
 */
export async function deletePlanCompletely(planId: string): Promise<{ error: string | null }> {
    const steps: { table: string; column: string }[] = [
        { table: 'mensajes', column: 'plan_id' },
        { table: 'invitaciones_planes', column: 'plan_id' },
        { table: 'participantes', column: 'plan_id' },
        { table: 'planes_guardados', column: 'plan_id' },
        { table: 'historial_planes', column: 'plan_id' },
        { table: 'valoraciones', column: 'plan_id' },
    ];

    for (const { table, column } of steps) {
        const { error } = await supabase.from(table).delete().eq(column, planId);
        if (error) console.warn(`deletePlanCompletely (${table}):`, error.message);
    }

    const { error } = await supabase.from('planes').delete().eq('id', planId);
    return { error: error?.message ?? null };
}

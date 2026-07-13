import { supabase } from './supabase';

/** Elimina un plan y datos relacionados (chat, participantes, guardados, etc.). */
export async function deletePlanCompletely(planId: string): Promise<{ error: string | null }> {
    const steps: { table: string; column: string }[] = [
        { table: 'mensajes', column: 'plan_id' },
        { table: 'alineaciones', column: 'plan_id' },
        { table: 'plan_invitaciones', column: 'plan_id' },
        { table: 'participantes', column: 'plan_id' },
        { table: 'planes_guardados', column: 'plan_id' },
    ];

    for (const { table, column } of steps) {
        const { error } = await supabase.from(table).delete().eq(column, planId);
        if (error) return { error: error.message };
    }

    const { error } = await supabase.from('planes').delete().eq('id', planId);
    return { error: error?.message ?? null };
}

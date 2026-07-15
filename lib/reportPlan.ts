import { supabase } from './supabase';

export type ReportMotivo = 'spam' | 'inapropiado' | 'informacion_falsa' | 'otro';

/** Denuncia un plan (idempotente: un reporte por usuario y plan). */
export async function reportPlan(
    planId: string,
    reportadorId: string,
    motivo: ReportMotivo = 'otro'
): Promise<{ error: string | null }> {
    const { error } = await supabase.from('reportes_planes').insert({
        plan_id: planId,
        reportador_id: reportadorId,
        motivo,
    });

    if (error) {
        if (error.code === '23505') return { error: 'already_reported' };
        return { error: error.message };
    }
    return { error: null };
}

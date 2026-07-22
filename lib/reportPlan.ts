import { supabase } from './supabase';

export const PLAN_REPORT_REASONS = [
    'spam',
    'contenido_inapropiado',
    'informacion_enganosa',
    'seguridad',
    'categoria_incorrecta',
    'otro',
] as const;

export type PlanReportReason = (typeof PLAN_REPORT_REASONS)[number];

/** Denuncia un plan (idempotente: un reporte por usuario y plan). */
export async function reportPlan(
    planId: string,
    reportadorId: string,
    motivo: PlanReportReason | string = 'otro',
    mensaje?: string,
): Promise<{ error: string | null }> {
    const payload: Record<string, unknown> = {
        plan_id: planId,
        reportador_id: reportadorId,
        motivo,
    };
    if (mensaje?.trim()) payload.mensaje = mensaje.trim().slice(0, 1000);

    const { error } = await supabase.from('reportes_planes').insert(payload);

    if (error) {
        if (error.code === '23505') return { error: 'already_reported' };
        if (/plan_report_daily_limit/i.test(error.message)) {
            return { error: 'plan_report_daily_limit' };
        }
        // Columna mensaje aún no migrada: reintentar sin ella
        if (mensaje?.trim() && /mensaje|column/i.test(error.message)) {
            const { error: retry } = await supabase.from('reportes_planes').insert({
                plan_id: planId,
                reportador_id: reportadorId,
                motivo,
            });
            if (retry?.code === '23505') return { error: 'already_reported' };
            if (retry && /plan_report_daily_limit/i.test(retry.message)) {
                return { error: 'plan_report_daily_limit' };
            }
            return { error: retry?.message ?? null };
        }
        return { error: error.message };
    }
    return { error: null };
}

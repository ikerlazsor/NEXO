import { supabase } from './supabase';

export const USER_REPORT_REASONS = [
    'acoso',
    'perfil_falso',
    'comportamiento_inapropiado',
    'spam',
    'menor_de_edad',
    'otro',
] as const;

export type UserReportReason = (typeof USER_REPORT_REASONS)[number];

export async function reportUser(
    denunciadoId: string,
    reportadorId: string,
    motivo: UserReportReason | string,
    mensaje?: string,
): Promise<{ error: string | null }> {
    if (denunciadoId === reportadorId) return { error: 'self' };

    const payload: Record<string, unknown> = {
        denunciado_id: denunciadoId,
        reportador_id: reportadorId,
        motivo,
    };
    if (mensaje?.trim()) payload.mensaje = mensaje.trim().slice(0, 1000);

    const { error } = await supabase.from('reportes_usuarios').insert(payload);

    if (error) {
        if (error.code === '23505') return { error: 'already_reported' };
        if (/user_report_daily_limit/i.test(error.message)) {
            return { error: 'user_report_daily_limit' };
        }
        return { error: error.message };
    }
    return { error: null };
}

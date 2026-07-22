import { getAuthUser } from './auth';
import { supabase } from './supabase';
import type { SupportTipo } from './moderation';

export const SUPPORT_TIPOS: SupportTipo[] = ['contacto', 'problema', 'idea', 'denuncia_general'];

/** Envía un mensaje de contacto / idea / problema al inbox de moderación. */
export async function submitSupportMessage(params: {
    tipo: SupportTipo;
    mensaje: string;
    asunto?: string;
}): Promise<{ error: string | null }> {
    const user = await getAuthUser();
    if (!user) return { error: 'not_authenticated' };

    const mensaje = params.mensaje.trim().slice(0, 4000);
    if (!mensaje) return { error: 'empty_message' };

    const { error } = await supabase.from('mensajes_soporte').insert({
        usuario_id: user.id,
        tipo: params.tipo,
        asunto: params.asunto?.trim().slice(0, 120) || null,
        mensaje,
    });

    if (error) {
        if (/account_banned/i.test(error.message)) return { error: 'account_banned' };
        return { error: error.message };
    }
    return { error: null };
}

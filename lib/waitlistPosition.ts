import { supabase } from './supabase';

/** Posición 1-based en lista de espera (null si no está en espera). */
export async function getWaitlistPosition(
    planId: string,
    userId: string,
): Promise<number | null> {
    const { data, error } = await supabase
        .from('participantes')
        .select('usuario_id, creado_en')
        .eq('plan_id', planId)
        .eq('estado', 'lista_espera')
        .order('creado_en', { ascending: true });

    if (error || !data?.length) return null;
    const idx = data.findIndex((r) => r.usuario_id === userId);
    return idx >= 0 ? idx + 1 : null;
}

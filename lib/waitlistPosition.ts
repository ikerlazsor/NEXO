import { supabase } from './supabase';

/** Posición 1-based en lista de espera (null si no está en espera). */
export async function getWaitlistPosition(
    planId: string,
    userId: string,
): Promise<number | null> {
    const { data: mine, error: mineError } = await supabase
        .from('participantes')
        .select('creado_en')
        .eq('plan_id', planId)
        .eq('usuario_id', userId)
        .eq('estado', 'lista_espera')
        .maybeSingle();
    if (mineError || !mine?.creado_en) return null;

    const { count, error } = await supabase
        .from('participantes')
        .select('id', { count: 'exact', head: true })
        .eq('plan_id', planId)
        .eq('estado', 'lista_espera')
        .lte('creado_en', mine.creado_en);
    if (error || count == null) return null;
    return count;
}

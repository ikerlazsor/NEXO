import { supabase } from './supabase';

export interface UserStats {
    valoracionMedia: number;
    porcentajeRepetiria: number;
    numeroValoraciones: number;
    numeroPlanesRealizados: number;
    numeroAmistades: number;
}

export const EMPTY_STATS: UserStats = {
    valoracionMedia: 0,
    porcentajeRepetiria: 0,
    numeroValoraciones: 0,
    numeroPlanesRealizados: 0,
    numeroAmistades: 0,
};

/** Estadísticas públicas del usuario desde estadisticas_usuario. */
export async function getUserStats(userId: string): Promise<UserStats> {
    const { data, error } = await supabase
        .from('estadisticas_usuario')
        .select('valoracion_media, porcentaje_repetiria, numero_valoraciones, numero_planes_realizados, numero_amistades')
        .eq('usuario_id', userId)
        .maybeSingle();

    if (error || !data) return EMPTY_STATS;

    return {
        valoracionMedia: Number(data.valoracion_media) || 0,
        porcentajeRepetiria: Number(data.porcentaje_repetiria) || 0,
        numeroValoraciones: data.numero_valoraciones ?? 0,
        numeroPlanesRealizados: data.numero_planes_realizados ?? 0,
        numeroAmistades: data.numero_amistades ?? 0,
    };
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    invalidatePlanMembershipCaches,
    invalidateProfilePresentationCaches,
} from './screenCaches';
import { invalidateUserStatsCache } from './stats';
import { supabase } from './supabase';

const HIDE_PREFIX = '@nexo_myplan_hide:';

function hideKey(userId: string, planId: string) {
    return `${HIDE_PREFIX}${userId}:${planId}`;
}

/** Oculta un plan pasado de «Mis planes» sin borrar historial ni valoraciones. */
export async function hidePlanFromMyList(userId: string, planId: string): Promise<void> {
    await AsyncStorage.setItem(hideKey(userId, planId), '1');
}

export async function isPlanHiddenFromMyList(userId: string, planId: string): Promise<boolean> {
    const v = await AsyncStorage.getItem(hideKey(userId, planId));
    return !!v;
}

/** Lote: evita N getItem al filtrar planes pasados. */
export async function getHiddenPlanIdSet(userId: string, planIds: string[]): Promise<Set<string>> {
    if (planIds.length === 0) return new Set();
    const pairs = await AsyncStorage.multiGet(planIds.map((id) => hideKey(userId, id)));
    const hidden = new Set<string>();
    for (let i = 0; i < planIds.length; i++) {
        if (pairs[i]?.[1]) hidden.add(planIds[i]);
    }
    return hidden;
}

/**
 * Quitar solo de «A los que he ido» (perfil público).
 * Sigue en Mis planes y no baja el contador de planes realizados.
 */
export async function hidePlanFromAttendedProfile(
    userId: string,
    planId: string,
): Promise<{ error: string | null }> {
    const { error } = await supabase
        .from('historial_planes')
        .update({ oculto_perfil: true })
        .eq('usuario_id', userId)
        .eq('plan_id', planId)
        .eq('oculto_perfil', false);
    if (error) return { error: error.message };
    invalidateProfilePresentationCaches(userId);
    return { error: null };
}

/**
 * Quitar de Mis planes + de «A los que he ido» y bajar el contador (borra historial).
 */
export async function removePlanFromMyPlansAndHistory(
    userId: string,
    planId: string,
): Promise<{ error: string | null }> {
    await hidePlanFromMyList(userId, planId);
    const { error } = await supabase
        .from('historial_planes')
        .delete()
        .eq('usuario_id', userId)
        .eq('plan_id', planId);
    if (error) return { error: error.message };
    invalidatePlanMembershipCaches(userId);
    invalidateProfilePresentationCaches(userId);
    invalidateUserStatsCache(userId);
    return { error: null };
}

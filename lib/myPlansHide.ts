import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    invalidatePlanMembershipCaches,
    invalidateProfilePresentationCaches,
    screenCacheKey,
    ScreenCacheTTL,
} from './screenCaches';
import { invalidateUserStatsCache } from './stats';
import { supabase } from './supabase';
import { cacheGetStale, cacheSet } from './ttlCache';

const HIDE_PREFIX = '@nexo_myplan_hide:';

/** Memoria inmediata: el AsyncStorage puede ir un tick detrás al filtrar Mis planes. */
const hiddenMemory = new Set<string>();

export type MyPlanHideEvent =
    | { type: 'my-list'; userId: string; planId: string }
    | { type: 'attended'; userId: string; planId: string };

const hideListeners = new Set<(evt: MyPlanHideEvent) => void>();

export function subscribeMyPlanHide(listener: (evt: MyPlanHideEvent) => void): () => void {
    hideListeners.add(listener);
    return () => {
        hideListeners.delete(listener);
    };
}

function emitMyPlanHide(evt: MyPlanHideEvent): void {
    hideListeners.forEach((listener) => {
        try {
            listener(evt);
        } catch {
            /* ignore */
        }
    });
}

function hideKey(userId: string, planId: string) {
    return `${HIDE_PREFIX}${userId}:${planId}`;
}

function memoryKey(userId: string, planId: string) {
    return `${userId}:${planId}`;
}

function patchMyPlansCacheRemove(userId: string, planId: string): void {
    const key = screenCacheKey.myPlans(userId);
    const snap = cacheGetStale<{
        plans?: { id?: string }[];
        pendingCount?: number;
        ratingByPlan?: Record<string, unknown>;
    }>(key);
    if (!snap?.plans) return;
    const ratingByPlan = { ...(snap.ratingByPlan ?? {}) };
    delete ratingByPlan[planId];
    cacheSet(
        key,
        {
            ...snap,
            plans: snap.plans.filter((p) => String(p.id) !== planId),
            ratingByPlan,
        },
        ScreenCacheTTL.myPlans,
    );
}

function patchProfileAttendedRemove(userId: string, planId: string): void {
    const key = screenCacheKey.profileUI(userId);
    const snap = cacheGetStale<Record<string, unknown>>(key);
    if (!snap) return;
    cacheSet(key, { ...snap }, ScreenCacheTTL.profileUI);
}

/** Oculta un plan pasado de «Mis planes» sin borrar historial ni valoraciones. */
export async function hidePlanFromMyList(userId: string, planId: string): Promise<void> {
    hiddenMemory.add(memoryKey(userId, planId));
    await AsyncStorage.setItem(hideKey(userId, planId), '1');
}

export async function isPlanHiddenFromMyList(userId: string, planId: string): Promise<boolean> {
    if (hiddenMemory.has(memoryKey(userId, planId))) return true;
    const v = await AsyncStorage.getItem(hideKey(userId, planId));
    return !!v;
}

/** Lote: evita N getItem al filtrar planes pasados. */
export async function getHiddenPlanIdSet(userId: string, planIds: string[]): Promise<Set<string>> {
    if (planIds.length === 0) return new Set();
    const pairs = await AsyncStorage.multiGet(planIds.map((id) => hideKey(userId, id)));
    const hidden = new Set<string>();
    for (let i = 0; i < planIds.length; i++) {
        const id = planIds[i];
        if (pairs[i]?.[1] || hiddenMemory.has(memoryKey(userId, id))) hidden.add(id);
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
    // UI al instante
    patchProfileAttendedRemove(userId, planId);
    emitMyPlanHide({ type: 'attended', userId, planId });

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
    // UI al instante (memoria + AsyncStorage + caches + bus)
    hiddenMemory.add(memoryKey(userId, planId));
    void hidePlanFromMyList(userId, planId);
    patchMyPlansCacheRemove(userId, planId);
    patchProfileAttendedRemove(userId, planId);
    emitMyPlanHide({ type: 'my-list', userId, planId });

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

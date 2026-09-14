import { isFeedPlan } from './feedPlans';
import { materializeOrganizerRecurrence } from './recurrence';
import { supabase } from './supabase';

/** Chat de plan se elimina 48h después de fecha_evento. */
export const CHAT_TTL_MS = 48 * 60 * 60 * 1000;
/** El countdown del chat solo se muestra en esta ventana final. */
export const CHAT_EXPIRY_WARN_MS = 12 * 60 * 60 * 1000;
/** Cierre del plan se desbloquea 1h después de fecha_evento. */
export const RATINGS_DELAY_MS = 60 * 60 * 1000;
/** Ventana para valorar tras el plan (20 días). */
export const RATINGS_WINDOW_MS = 20 * 24 * 60 * 60 * 1000;

export function isGroupOrChatPlan(plan: { categoria?: string | null }): boolean {
    const cat = plan.categoria ?? '';
    return cat === 'Grupo' || cat === 'Chat';
}

export function getPlanEndMs(fechaEvento?: string | null): number | null {
    if (!fechaEvento) return null;
    const t = new Date(fechaEvento).getTime();
    return Number.isFinite(t) ? t : null;
}

/** Plan aún visible en feed: fecha futura (o sin fecha). */
export function isPlanActiveForFeed(plan: { fecha_evento?: string | null; categoria?: string | null }): boolean {
    if (!isFeedPlan(plan)) return false;
    const end = getPlanEndMs(plan.fecha_evento);
    if (end == null) return true;
    return end > Date.now();
}

/** Chat de plan sigue disponible: no grupo y dentro de fecha + 48h. */
export function isPlanChatAlive(plan: {
    fecha_evento?: string | null;
    categoria?: string | null;
    chat_eliminado_en?: string | null;
}): boolean {
    if (isGroupOrChatPlan(plan)) return true;
    if (plan.chat_eliminado_en) return false;
    const end = getPlanEndMs(plan.fecha_evento);
    if (end == null) return true;
    return Date.now() < end + CHAT_TTL_MS;
}

export function getChatExpiryMs(fechaEvento?: string | null): number | null {
    const end = getPlanEndMs(fechaEvento);
    if (end == null) return null;
    return end + CHAT_TTL_MS;
}

export function getRatingsUnlockMs(fechaEvento?: string | null): number | null {
    const end = getPlanEndMs(fechaEvento);
    if (end == null) return null;
    return end + RATINGS_DELAY_MS;
}

export function getRatingsDeadlineMs(fechaEvento?: string | null): number | null {
    const end = getPlanEndMs(fechaEvento);
    if (end == null) return null;
    return end + RATINGS_WINDOW_MS;
}

export type RatingPhase = 'upcoming' | 'waiting' | 'open' | 'closed';

export function getRatingPhase(fechaEvento?: string | null): RatingPhase {
    const end = getPlanEndMs(fechaEvento);
    if (end == null) return 'closed';
    const now = Date.now();
    if (now < end) return 'upcoming';
    if (now < end + RATINGS_DELAY_MS) return 'waiting';
    if (now < end + RATINGS_WINDOW_MS) return 'open';
    return 'closed';
}

/** Fase efectiva en UI (el countdown local puede pasar de waiting → open sin refetch). */
export function resolveRatingUiPhase(
    plan: { phase: 'waiting' | 'open'; unlockAt: number },
    now = Date.now(),
): 'waiting' | 'open' {
    if (plan.phase === 'open' || plan.unlockAt <= now) return 'open';
    return 'waiting';
}

export function formatCountdown(msRemaining: number): string {
    const ms = Math.max(0, msRemaining);
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) {
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
}

/** Plan aún guardable / visible en guardados: fecha futura (o sin fecha). */
export function isPlanActiveForSaved(plan: { fecha_evento?: string | null }): boolean {
    const end = getPlanEndMs(plan.fecha_evento);
    if (end == null) return true;
    return end > Date.now();
}

let lastPurgeAt = 0;

/** Purga chats caducados, archiva historial y limpia guardados pasados (máx. 1 vez / 60s). */
export async function runPlanLifecycleMaintenance(): Promise<void> {
    const now = Date.now();
    if (now - lastPurgeAt < 60_000) return;
    lastPurgeAt = now;
    try {
        await Promise.all([
            supabase.rpc('archive_all_ended_plans'),
            supabase.rpc('purge_expired_plan_chats'),
            supabase.rpc('purge_past_saved_plans'),
            materializeOrganizerRecurrence(),
        ]);
    } catch {
        // RPC puede no existir hasta ejecutar plan-lifecycle.sql
    }
}

/** Quita de planes_guardados los que ya han llegado a su fecha (best effort). */
export async function purgePastSavedPlansForUser(userId: string): Promise<string[]> {
    const { data } = await supabase
        .from('planes_guardados')
        .select('plan_id, planes:plan_id(id, fecha_evento)')
        .eq('usuario_id', userId);

    const pastIds = (data ?? [])
        .map((row: any) => {
            const plan = Array.isArray(row.planes) ? row.planes[0] : row.planes;
            if (!plan?.fecha_evento) return null;
            if (new Date(plan.fecha_evento).getTime() > Date.now()) return null;
            return (row.plan_id as string) || (plan.id as string) || null;
        })
        .filter(Boolean) as string[];

    if (pastIds.length === 0) return [];

    await supabase
        .from('planes_guardados')
        .delete()
        .eq('usuario_id', userId)
        .in('plan_id', pastIds);

    return pastIds;
}

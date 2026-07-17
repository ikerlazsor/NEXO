import { isFeedPlan } from './feedPlans';
import { supabase } from './supabase';

/** Chat de plan se elimina 24h después de fecha_evento. */
export const CHAT_TTL_MS = 24 * 60 * 60 * 1000;
/** Valoraciones se desbloquean 3h después de fecha_evento. */
export const RATINGS_DELAY_MS = 3 * 60 * 60 * 1000;
/** Ventana para valorar tras el plan (7 días). */
export const RATINGS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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

/** Chat de plan sigue disponible: no grupo y dentro de fecha + 24h. */
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

let lastPurgeAt = 0;

/** Purga chats caducados + archiva historial (máx. 1 vez / 60s en cliente). */
export async function runPlanLifecycleMaintenance(): Promise<void> {
    const now = Date.now();
    if (now - lastPurgeAt < 60_000) return;
    lastPurgeAt = now;
    try {
        await Promise.all([
            supabase.rpc('archive_all_ended_plans'),
            supabase.rpc('purge_expired_plan_chats'),
        ]);
    } catch {
        // RPC puede no existir hasta ejecutar plan-lifecycle.sql
    }
}

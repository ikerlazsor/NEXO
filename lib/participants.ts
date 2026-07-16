import { supabase } from './supabase';

export type ParticipantMembership = 'joined' | 'requested' | 'waitlist';
export type ParticipantEstado = 'pendiente' | 'aceptado' | 'lista_espera';
export type Membership = 'none' | ParticipantMembership;

export function isAcceptedParticipant(estado?: string | null): boolean {
    return estado === 'aceptado';
}

export function isWaitlistParticipant(estado?: string | null): boolean {
    return estado === 'lista_espera';
}

export function mapEstadoToMembership(estado?: string | null): ParticipantMembership | null {
    if (estado === 'pendiente') return 'requested';
    if (estado === 'aceptado') return 'joined';
    if (estado === 'lista_espera') return 'waitlist';
    return null;
}

export function resolveJoinEstado(plan: {
    requiere_aprobacion?: boolean | null;
    maximo_participantes?: number | null;
    joinedCount?: number;
}): ParticipantEstado {
    const max = plan.maximo_participantes ?? 0;
    const joined = plan.joinedCount ?? 0;
    const isFull = max > 0 && joined >= max;

    if (isFull) return 'lista_espera';
    return plan.requiere_aprobacion ? 'pendiente' : 'aceptado';
}

export function membershipFromJoinEstado(estado: ParticipantEstado): ParticipantMembership {
    if (estado === 'pendiente') return 'requested';
    if (estado === 'lista_espera') return 'waitlist';
    return 'joined';
}

/** True si aún se puede unir a la lista de espera (más de 2h antes del evento). */
export function canJoinWaitlist(fechaEvento: string | null | undefined): boolean {
    if (!fechaEvento) return true;
    const eventMs = new Date(fechaEvento).getTime();
    if (!Number.isFinite(eventMs)) return true;
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
    return eventMs - Date.now() > TWO_HOURS_MS;
}

/** Promueve al primero en lista de espera si hay hueco libre. */
export async function promoteWaitlist(planId: string): Promise<void> {
    const { error } = await supabase.rpc('promote_waitlist', { p_plan_id: planId });
    if (error) console.warn('promote_waitlist:', error.message);
}

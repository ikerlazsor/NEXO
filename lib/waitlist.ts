import { supabase } from './supabase';

export type ParticipantMembership = 'joined' | 'requested' | 'waitlist';

export function isAcceptedParticipant(estado?: string | null): boolean {
    return (estado ?? 'aceptado') === 'aceptado';
}

export function isWaitlistParticipant(estado?: string | null): boolean {
    return estado === 'lista_espera';
}

export function mapEstadoToMembership(estado?: string | null): ParticipantMembership | null {
    if (estado === 'pendiente') return 'requested';
    if (estado === 'lista_espera') return 'waitlist';
    if (estado === 'aceptado' || estado == null) return 'joined';
    return null;
}

export function resolveJoinEstado(plan: {
    joinedCount: number;
    max_people: number;
    requiere_aprobacion?: boolean | null;
}): 'aceptado' | 'pendiente' | 'lista_espera' {
    if (plan.joinedCount >= plan.max_people) return 'lista_espera';
    if (plan.requiere_aprobacion) return 'pendiente';
    return 'aceptado';
}

export function membershipFromJoinEstado(estado: 'aceptado' | 'pendiente' | 'lista_espera'): ParticipantMembership {
    if (estado === 'pendiente') return 'requested';
    if (estado === 'lista_espera') return 'waitlist';
    return 'joined';
}

export async function promoteWaitlist(planId: string): Promise<void> {
    const { error } = await supabase.rpc('promote_waitlist', { p_plan_id: planId });
    if (error) {
        console.warn('promote_waitlist:', error.message);
    }
}

export type ParticipantMembership = 'joined' | 'requested';
export type ParticipantEstado = 'pendiente' | 'aceptado' | 'rechazado';

export function isAcceptedParticipant(estado?: string | null): boolean {
    return estado === 'aceptado';
}

export function mapEstadoToMembership(estado?: string | null): ParticipantMembership | null {
    if (estado === 'pendiente') return 'requested';
    if (estado === 'aceptado') return 'joined';
    return null;
}

export function resolveJoinEstado(plan: {
    requiere_aprobacion?: boolean | null;
}): 'aceptado' | 'pendiente' {
    return plan.requiere_aprobacion ? 'pendiente' : 'aceptado';
}

export function membershipFromJoinEstado(
    estado: 'aceptado' | 'pendiente'
): ParticipantMembership {
    return estado === 'pendiente' ? 'requested' : 'joined';
}

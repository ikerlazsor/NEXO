/**
 * Acciones extra de la cuenta owner (eliminar planes/usuarios, analytics, inbox).
 * Solo visible si el perfil tiene rol owner/admin (p.ej. Iker Lázaro).
 */
export const OWNER_SECRET_ACTIONS_ENABLED = true;

export function ownerActionsVisible(isOwner: boolean): boolean {
    return OWNER_SECRET_ACTIONS_ENABLED && isOwner;
}

export function staffActionsVisible(isStaff: boolean): boolean {
    return OWNER_SECRET_ACTIONS_ENABLED && isStaff;
}

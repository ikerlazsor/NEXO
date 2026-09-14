/**
 * Acciones extra de la cuenta owner (eliminar planes/usuarios, analytics, inbox).
 * Desactivado para demos: la cuenta main se ve como una cuenta normal.
 */
export const OWNER_SECRET_ACTIONS_ENABLED = false;

export function ownerActionsVisible(isOwner: boolean): boolean {
    return OWNER_SECRET_ACTIONS_ENABLED && isOwner;
}

export function staffActionsVisible(isStaff: boolean): boolean {
    return OWNER_SECRET_ACTIONS_ENABLED && isStaff;
}

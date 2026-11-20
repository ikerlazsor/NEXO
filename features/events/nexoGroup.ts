type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * Cómo se nombra al grupo de Nexo dentro de un evento. Se suma a los asistentes
 * del evento original («+80 asistentes · 1 de Nexo va»), nunca los sustituye:
 * un «Ya vamos 1» a secas se leía como ir solo.
 */
export function nexoGroupLabel(t: T, count: number, joined: boolean): string | null {
    if (count <= 0) return t('events.openGroup');
    if (joined) {
        // Solo tú: no se dice nada (ya lo indica el botón «Te has unido»).
        return count === 1 ? null : t('events.nexoYouAnd', { n: count - 1 });
    }
    return count === 1 ? t('events.nexoOne') : t('events.nexoMany', { n: count });
}

/** Línea de ánimo bajo los avatares del grupo de Nexo en el detalle. */
export function nexoGroupHint(t: T, count: number, joined: boolean): string | null {
    if (joined && count === 1) return t('events.nexoFirstJoined');
    if (!joined && count === 1) return t('events.nexoBeSecond');
    return null;
}

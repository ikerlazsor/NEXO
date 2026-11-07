/** Evita que un refetch de perfil pise un edit optimista aún en vuelo. */
let optimisticUntil = 0;
let editRevision = 0;

export function noteProfileOptimisticWrite(ttlMs = 5_000): void {
    editRevision += 1;
    optimisticUntil = Math.max(optimisticUntil, Date.now() + ttlMs);
}

export function shouldPreferProfileCache(): boolean {
    return Date.now() < optimisticUntil;
}

/** No caduca: también invalida lecturas que tardan más que la ventana optimista. */
export function getProfileEditRevision(): number {
    return editRevision;
}

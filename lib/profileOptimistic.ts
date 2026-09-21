/** Evita que un refetch de perfil pise un edit optimista aún en vuelo. */
let optimisticUntil = 0;

export function noteProfileOptimisticWrite(ttlMs = 5_000): void {
    optimisticUntil = Math.max(optimisticUntil, Date.now() + ttlMs);
}

export function shouldPreferProfileCache(): boolean {
    return Date.now() < optimisticUntil;
}

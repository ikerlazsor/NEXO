type Listener = () => void;

const homeRetapListeners = new Set<Listener>();
let feedNeedsRefresh = false;

/** Casita en el feed: scroll al inicio + recarga manual. */
export function subscribeFeedHomeRetap(listener: Listener): () => void {
    homeRetapListeners.add(listener);
    return () => {
        homeRetapListeners.delete(listener);
    };
}

export function emitFeedHomeRetap(): void {
    homeRetapListeners.forEach((listener) => {
        try {
            listener();
        } catch {
            // ignore listener errors
        }
    });
}

/**
 * Tras crear/editar plan: marca el feed para recargar al volver a enfocarse.
 * No dispara recarga inmediata (evita freeze al cerrar el modal de crear).
 */
export function markFeedNeedsRefresh(): void {
    feedNeedsRefresh = true;
}

export function consumeFeedNeedsRefresh(): boolean {
    if (!feedNeedsRefresh) return false;
    feedNeedsRefresh = false;
    return true;
}

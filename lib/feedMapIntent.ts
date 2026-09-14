type Listener = () => void;

const listeners = new Set<Listener>();
let pendingOpen = false;

/** Abre el mapa del feed (misma modal que el botón del feed). */
export function requestOpenFeedMap(): void {
    pendingOpen = true;
    listeners.forEach((listener) => listener());
}

/** Si se pidió abrir el mapa antes de montar/enfocar el feed. */
export function consumePendingOpenFeedMap(): boolean {
    if (!pendingOpen) return false;
    pendingOpen = false;
    return true;
}

export function peekPendingOpenFeedMap(): boolean {
    return pendingOpen;
}

export function subscribeOpenFeedMap(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

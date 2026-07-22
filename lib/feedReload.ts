type Listener = () => void;

const homeRetapListeners = new Set<Listener>();

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

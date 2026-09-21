type HeartBurstEvent = {
    x: number;
    y: number;
    at: number;
};

type Listener = (evt: HeartBurstEvent) => void;

const listeners = new Set<Listener>();

/** Dispara una explosión de corazones en coordenadas de pantalla. */
export function emitHeartBurst(x: number, y: number): void {
    const evt = { x, y, at: Date.now() };
    listeners.forEach((listener) => {
        try {
            listener(evt);
        } catch {
            /* ignore */
        }
    });
}

export function subscribeHeartBurst(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export type GenteLayer = 'find' | 'ranking';

type AdvanceTo = 'ranking';
type Listener = (to: AdvanceTo) => void;

let layer: GenteLayer = 'find';
const listeners = new Set<Listener>();

export function setGenteLayer(next: GenteLayer): void {
    layer = next;
}

export function peekGenteLayer(): GenteLayer {
    return layer;
}

/** Buscar → ranking. */
export function requestGenteAdvance(): void {
    if (layer !== 'find') return;
    listeners.forEach((listener) => listener('ranking'));
}

export function subscribeGenteAdvance(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

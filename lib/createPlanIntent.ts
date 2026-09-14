type Listener = () => void;

const listeners = new Set<Listener>();

/** Abre crear plan (modal desde abajo), p. ej. al deslizar más allá de Gente. */
export function requestCreatePlan(): void {
    listeners.forEach((listener) => listener());
}

export function subscribeCreatePlan(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

const closedListeners = new Set<Listener>();

/** El pager vuelve a aceptar toques cuando se cierra crear plan. */
export function notifyCreatePlanClosed(): void {
    closedListeners.forEach((listener) => listener());
}

export function subscribeCreatePlanClosed(listener: Listener): () => void {
    closedListeners.add(listener);
    return () => {
        closedListeners.delete(listener);
    };
}

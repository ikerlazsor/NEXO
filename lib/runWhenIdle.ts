/**
 * Diferir trabajo no crítico sin InteractionManager (puede no resolverse y congelar).
 * Usa rAF + timeout de seguridad.
 */
export function runWhenIdle(fn: () => void, delayMs = 0): () => void {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const frame = requestAnimationFrame(() => {
        if (cancelled) return;
        if (delayMs <= 0) {
            try {
                fn();
            } catch {
                /* ignore */
            }
            return;
        }
        timeoutId = setTimeout(() => {
            if (cancelled) return;
            try {
                fn();
            } catch {
                /* ignore */
            }
        }, delayMs);
    });
    return () => {
        cancelled = true;
        cancelAnimationFrame(frame);
        if (timeoutId) clearTimeout(timeoutId);
    };
}

/** Promise que se resuelve en el siguiente frame o como máximo en `maxMs` (nunca cuelga). */
export function waitBriefly(maxMs = 48): Promise<void> {
    return new Promise((resolve) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            resolve();
        };
        requestAnimationFrame(() => finish());
        setTimeout(finish, maxMs);
    });
}

/** Cola de escritura de perfil_gustos: evita que dos updates concurrentes se pisen. */

type Writer = (gustos: Record<string, unknown>) => Promise<void>;

const queues = new Map<string, { pending: Record<string, unknown> | null; running: boolean; write: Writer }>();

export function configurePerfilGustosWriter(userId: string, write: Writer): void {
    const existing = queues.get(userId);
    if (existing) {
        existing.write = write;
        return;
    }
    queues.set(userId, { pending: null, running: false, write });
}

export function enqueuePerfilGustosWrite(userId: string, gustos: Record<string, unknown>): void {
    let q = queues.get(userId);
    if (!q) {
        q = {
            pending: null,
            running: false,
            write: async () => {
                /* configured by screen */
            },
        };
        queues.set(userId, q);
    }
    q.pending = gustos;
    if (q.running) return;
    q.running = true;
    void (async () => {
        while (q!.pending) {
            const next = q!.pending;
            q!.pending = null;
            try {
                await q!.write(next);
            } catch {
                /* caller handles errors inside write */
            }
        }
        q!.running = false;
    })();
}

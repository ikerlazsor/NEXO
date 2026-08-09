const marks = new Map<string, number>();

export function perfStart(label: string): void {
    if (!__DEV__) return;
    marks.set(label, Date.now());
}

export function perfEnd(label: string, extra?: string): number {
    if (!__DEV__) return 0;
    const start = marks.get(label);
    const elapsed = start != null ? Date.now() - start : 0;
    marks.delete(label);
    const suffix = extra ? ` ${extra}` : '';
    console.log(`[perf] ${label}: ${elapsed}ms${suffix}`);
    return elapsed;
}

export async function perfTimed<T>(label: string, fn: () => Promise<T>): Promise<T> {
    if (!__DEV__) return fn();
    perfStart(label);
    try {
        return await fn();
    } finally {
        perfEnd(label);
    }
}

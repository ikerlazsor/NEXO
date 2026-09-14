export type InAppToast = {
    id: string;
    title: string;
    body: string;
    avatarUrl?: string | null;
    data?: Record<string, unknown>;
};

type Presenter = (toast: InAppToast) => void;
type DismissMatching = (predicate: (toast: InAppToast) => boolean) => void;

let presentToast: Presenter | null = null;
let dismissMatching: DismissMatching | null = null;
const pending: InAppToast[] = [];
const recentIds = new Map<string, number>();

export function registerInAppToastPresenter(fn: Presenter | null) {
    presentToast = fn;
    if (fn) {
        while (pending.length > 0) {
            const next = pending.shift();
            if (next) fn(next);
        }
    }
}

export function registerInAppToastDismiss(fn: DismissMatching | null) {
    dismissMatching = fn;
}

export function dismissInAppToasts(predicate: (toast: InAppToast) => boolean): void {
    for (let i = pending.length - 1; i >= 0; i -= 1) {
        if (predicate(pending[i])) pending.splice(i, 1);
    }
    dismissMatching?.(predicate);
}

export function presentInAppToast(toast: Omit<InAppToast, 'id'> & { id?: string }): void {
    const id = toast.id || `${Date.now()}:${toast.title}`;
    const last = recentIds.get(id) ?? 0;
    if (Date.now() - last < 2500) return;
    recentIds.set(id, Date.now());
    if (recentIds.size > 40) {
        const cutoff = Date.now() - 60_000;
        for (const [key, at] of recentIds) {
            if (at < cutoff) recentIds.delete(key);
        }
    }
    const payload: InAppToast = {
        id,
        title: toast.title,
        body: toast.body,
        avatarUrl: toast.avatarUrl,
        data: toast.data,
    };
    if (presentToast) {
        presentToast(payload);
        return;
    }
    pending.push(payload);
    if (pending.length > 4) pending.shift();
}

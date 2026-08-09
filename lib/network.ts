import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

type Listener = (online: boolean) => void;

let online = true;
let ready = false;
const listeners = new Set<Listener>();

function deriveOnline(state: NetInfoState): boolean {
    if (state.isConnected == null) return true;
    if (state.isConnected === false) return false;
    if (state.isInternetReachable === false) return false;
    return true;
}

function apply(state: NetInfoState) {
    const next = deriveOnline(state);
    ready = true;
    if (next === online) return;
    online = next;
    listeners.forEach((fn) => {
        try {
            fn(online);
        } catch {
            /* ignore */
        }
    });
}

let unsub: (() => void) | null = null;

function ensureStarted() {
    if (unsub) return;
    unsub = NetInfo.addEventListener(apply);
    void NetInfo.fetch().then(apply).catch(() => {
        ready = true;
    });
}

/** true si hay conexión usable (optimistic hasta el primer fetch). */
export function getIsOnline(): boolean {
    ensureStarted();
    return online;
}

export function subscribeNetwork(listener: Listener): () => void {
    ensureStarted();
    listeners.add(listener);
    listener(online);
    return () => {
        listeners.delete(listener);
    };
}

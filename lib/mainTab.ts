type MainTabRoute = 'chats' | 'my-plans' | 'index';

type Listener = (route: MainTabRoute) => void;

const listeners = new Set<Listener>();

/** Cambia la tab de debajo sin cerrar pantallas del stack (perfil, etc.). */
export function requestMainTab(route: MainTabRoute): void {
    listeners.forEach((listener) => listener(route));
}

export function subscribeMainTab(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

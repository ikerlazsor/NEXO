/** Dirección de entrada al cambiar entre chats / mis planes / feed / buscar. */
export type MainTabEnterDir = -1 | 0 | 1;

let pendingEnterDir: MainTabEnterDir = 0;

export function setMainTabEnterDir(dir: MainTabEnterDir) {
    pendingEnterDir = dir;
}

/** Lee la dirección pendiente sin consumirla (para el frame inicial). */
export function peekMainTabEnterDir(): MainTabEnterDir {
    return pendingEnterDir;
}

export function consumeMainTabEnterDir(): MainTabEnterDir {
    const dir = pendingEnterDir;
    pendingEnterDir = 0;
    return dir;
}

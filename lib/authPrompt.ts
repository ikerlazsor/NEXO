import { getAuthUser } from './auth';
import { type AuthIntent } from './authIntent';

type Presenter = (intent: AuthIntent) => void;

let presentAuthPrompt: Presenter | null = null;

export function registerAuthPromptPresenter(fn: Presenter | null) {
    presentAuthPrompt = fn;
}

export function showAuthPrompt(intent: AuthIntent) {
    presentAuthPrompt?.(intent);
}

/** True si el usuario es invitado y se ha abierto el prompt. */
export async function requireAccount(intent: AuthIntent): Promise<boolean> {
    const user = await getAuthUser();
    if (user) return false;
    showAuthPrompt(intent);
    return true;
}

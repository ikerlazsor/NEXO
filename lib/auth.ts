import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';

/** Solo sesión local — nunca llama a getUser() remoto (puede colgar la app). */
export async function getAuthUser(): Promise<User | null> {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user ?? null;
}

export async function getAuthSession(): Promise<Session | null> {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
}

export async function runWithTimeout<T>(
    fn: () => PromiseLike<T>,
    timeoutMs: number,
    message = 'La operación tardó demasiado'
): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    try {
        return await Promise.race([Promise.resolve(fn()), timeout]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

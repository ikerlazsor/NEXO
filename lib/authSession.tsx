import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { type AuthIntent } from './authIntent';
import { showAuthPrompt } from './authPrompt';

type AuthSessionValue = {
    session: Session | null;
    userId: string | null;
    isGuest: boolean;
    requireAccount: (intent: AuthIntent) => boolean;
};

const AuthSessionContext = createContext<AuthSessionValue>({
    session: null,
    userId: null,
    isGuest: true,
    requireAccount: (intent) => {
        showAuthPrompt(intent);
        return true;
    },
});

export function AuthSessionProvider({
    session,
    children,
}: {
    session: Session | null;
    children: ReactNode;
}) {
    const isGuest = !session;
    const requireAccount = useCallback(
        (intent: AuthIntent) => {
            if (!isGuest) return false;
            showAuthPrompt(intent);
            return true;
        },
        [isGuest],
    );

    const value = useMemo<AuthSessionValue>(
        () => ({
            session,
            userId: session?.user.id ?? null,
            isGuest,
            requireAccount,
        }),
        [session, isGuest, requireAccount],
    );

    return (
        <AuthSessionContext.Provider value={value}>
            {children}
        </AuthSessionContext.Provider>
    );
}

export function useAuthSession() {
    return useContext(AuthSessionContext);
}

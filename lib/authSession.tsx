import { createContext, useCallback, useContext, type ReactNode } from 'react';
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

    return (
        <AuthSessionContext.Provider
            value={{
                session,
                userId: session?.user.id ?? null,
                isGuest,
                requireAccount,
            }}
        >
            {children}
        </AuthSessionContext.Provider>
    );
}

export function useAuthSession() {
    return useContext(AuthSessionContext);
}

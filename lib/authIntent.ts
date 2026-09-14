import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Href } from 'expo-router';

const STORAGE_KEY = '@nexo_pending_auth_intent';

export type AuthIntent =
    | { type: 'join'; planId: string }
    | { type: 'save-plan'; planId: string }
    | { type: 'view-profile'; userId: string }
    | { type: 'create-plan' }
    | { type: 'chats' }
    | { type: 'my-plans' }
    | { type: 'search' }
    | { type: 'generic' };

export async function setPendingAuthIntent(intent: AuthIntent): Promise<void> {
    try {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(intent));
    } catch {
        /* ignore */
    }
}

export async function peekPendingAuthIntent(): Promise<AuthIntent | null> {
    try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as AuthIntent;
        if (!parsed || typeof parsed !== 'object' || !parsed.type) return null;
        return parsed;
    } catch {
        return null;
    }
}

export async function clearPendingAuthIntent(): Promise<void> {
    try {
        await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {
        /* ignore */
    }
}

export function hrefForAuthIntent(intent: AuthIntent | null): Href {
    if (!intent) return '/(tabs)';
    if (intent.type === 'join' || intent.type === 'save-plan') {
        return { pathname: '/plan/[id]', params: { id: intent.planId } };
    }
    if (intent.type === 'view-profile') {
        return { pathname: '/user-profile/[id]', params: { id: intent.userId } };
    }
    if (intent.type === 'create-plan') return '/create-plan';
    if (intent.type === 'chats') return '/chats';
    if (intent.type === 'my-plans') return '/my-plans';
    if (intent.type === 'search') return '/search-profiles';
    return '/(tabs)';
}

/** Navega tras login/onboarding. Join/save se consumen en la ficha del plan. */
export async function takePendingAuthRoute(): Promise<Href> {
    const intent = await peekPendingAuthIntent();
    if (!intent) return '/(tabs)';
    if (intent.type !== 'join' && intent.type !== 'save-plan') {
        await clearPendingAuthIntent();
    }
    return hrefForAuthIntent(intent);
}

export function guestCopyKeys(intent: AuthIntent): { title: string; body: string } {
    switch (intent.type) {
        case 'join':
            return { title: 'guest.joinTitle', body: 'guest.joinBody' };
        case 'save-plan':
            return { title: 'guest.saveTitle', body: 'guest.saveBody' };
        case 'view-profile':
            return { title: 'guest.profileTitle', body: 'guest.profileBody' };
        case 'create-plan':
            return { title: 'guest.createTitle', body: 'guest.createBody' };
        case 'chats':
            return { title: 'guest.chatsTitle', body: 'guest.chatsBody' };
        case 'my-plans':
            return { title: 'guest.myPlansTitle', body: 'guest.myPlansBody' };
        case 'search':
            return { title: 'guest.searchTitle', body: 'guest.searchBody' };
        default:
            return { title: 'guest.genericTitle', body: 'guest.genericBody' };
    }
}

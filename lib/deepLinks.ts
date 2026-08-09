import * as Linking from 'expo-linking';

export type DeepLinkTarget = { href: string } | null;

/**
 * Resuelve URLs nexo://… y https://nexo.app/… (App / Universal Links) a rutas de la app.
 */
export function resolveDeepLinkUrl(url: string | null | undefined): DeepLinkTarget {
    if (!url) return null;
    let parsed: Linking.ParsedURL;
    try {
        parsed = Linking.parse(url);
    } catch {
        return null;
    }

    // https://nexo.app/plan/id → hostname=nexo.app, path=plan/id
    // nexo://plan/id → hostname=plan, path=id
    const path = (parsed.path || '').replace(/^\/+/, '');
    const host = (parsed.hostname || '').replace(/^\/+/, '');
    const isWebHost = host.includes('.') || host === 'nexo.app' || host === 'www.nexo.app';
    const parts = (isWebHost ? path.split('/') : [host, ...path.split('/')]).filter(Boolean);
    if (parts.length === 0) return null;

    const [head, id] = parts;
    switch (head) {
        case 'plan':
            return id ? { href: `/plan/${id}` } : null;
        case 'chat':
            return id ? { href: `/chat/${id}` } : null;
        case 'direct-chat':
        case 'dm':
            return id ? { href: `/direct-chat/${id}` } : null;
        case 'friends':
            return { href: '/friends' };
        case 'my-plans':
            return { href: '/(tabs)/my-plans' };
        case 'rate-plan':
        case 'rate': {
            const planId = id || (typeof parsed.queryParams?.planId === 'string' ? parsed.queryParams.planId : '');
            return planId ? { href: `/rate-plan?planId=${planId}` } : null;
        }
        case 'profile':
        case 'user':
            return id ? { href: `/user-profile/${id}` } : { href: '/profile' };
        case 'feed':
        case 'home':
            return { href: '/(tabs)' };
        default:
            return null;
    }
}

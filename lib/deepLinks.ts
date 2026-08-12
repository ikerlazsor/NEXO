import * as Linking from 'expo-linking';
import { SHARE_WEB_HOST } from './shareLinks';

export type DeepLinkTarget = { href: string } | null;

/**
 * Resuelve el scheme propio y, si se configura, el único dominio web verificado.
 */
export function resolveDeepLinkUrl(url: string | null | undefined): DeepLinkTarget {
    if (!url) return null;
    let parsed: Linking.ParsedURL;
    try {
        parsed = Linking.parse(url);
    } catch {
        return null;
    }

    // https://dominio-verificado.example/plan/id → hostname=..., path=plan/id
    // nexo://plan/id → hostname=plan, path=id
    const scheme = (parsed.scheme || '').toLowerCase();
    const path = (parsed.path || '').replace(/^\/+/, '');
    const host = (parsed.hostname || '').replace(/^\/+/, '');
    const isOwnScheme = scheme === 'nexo';
    const isWebHost =
        (scheme === 'https' || scheme === 'http')
        && !!SHARE_WEB_HOST
        && host.toLowerCase() === SHARE_WEB_HOST.toLowerCase();
    if (!isOwnScheme && !isWebHost) return null;
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

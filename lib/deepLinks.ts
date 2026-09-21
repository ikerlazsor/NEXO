import * as Linking from 'expo-linking';
import { SHARE_WEB_HOST } from './shareLinks';
import { normalizePushData, resolvePushNavigation } from './push';

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
    // https://*.supabase.co/functions/v1/share-plan/id → landing de share
    const scheme = (parsed.scheme || '').toLowerCase();
    const path = (parsed.path || '').replace(/^\/+/, '');
    const host = (parsed.hostname || '').replace(/^\/+/, '');
    const isOwnScheme = scheme === 'nexo';
    const hostLower = host.toLowerCase();
    const shareHosts = new Set(
        [SHARE_WEB_HOST, 'appnexo.es', 'www.appnexo.es']
            .filter(Boolean)
            .map((h) => String(h).toLowerCase().replace(/^www\./, '')),
    );
    const isWebHost =
        (scheme === 'https' || scheme === 'http')
        && shareHosts.has(hostLower.replace(/^www\./, ''));
    const isShareFn =
        (scheme === 'https' || scheme === 'http')
        && host.toLowerCase().endsWith('.supabase.co')
        && /(^|\/)functions\/v1\/share-plan\//i.test(path);
    if (!isOwnScheme && !isWebHost && !isShareFn) return null;
    if (isShareFn) {
        const m = path.match(/share-plan\/([0-9a-f-]{36})/i);
        return m?.[1] ? { href: `/plan/${m[1]}` } : null;
    }
    const parts = (isWebHost ? path.split('/') : [host, ...path.split('/')]).filter(Boolean);
    if (parts.length === 0) return null;

    const [head, id] = parts;
    const query = parsed.queryParams ?? {};
    const q = (key: string) => {
        const v = query[key];
        return typeof v === 'string' ? v : Array.isArray(v) ? String(v[0] ?? '') : '';
    };

    // Push deep links a veces llegan como nexo://open?type=...&planId=...
    if (head === 'open' || head === 'push' || head === 'n') {
        const fromQuery = normalizePushData({
            type: q('type'),
            screen: q('screen'),
            planId: q('planId') || id,
            otherUserId: q('otherUserId') || q('userId'),
            inviteId: q('inviteId'),
            senderName: q('senderName'),
            avatarUrl: q('avatarUrl'),
        });
        return resolvePushNavigation(fromQuery);
    }

    switch (head) {
        case 'plan': {
            const inviteId = q('inviteId');
            if (id && inviteId) {
                return resolvePushNavigation({
                    type: 'plan_invite',
                    planId: id,
                    inviteId,
                    otherUserId: q('inviterId') || q('otherUserId'),
                    senderName: q('inviterName') || q('senderName'),
                    avatarUrl: q('inviterAvatar') || q('avatarUrl'),
                    inviteTipo: q('inviteTipo'),
                });
            }
            return id ? { href: `/plan/${id}` } : null;
        }
        case 'chat':
            return id ? { href: `/chat/${id}` } : null;
        case 'direct-chat':
        case 'dm':
            return id ? { href: `/direct-chat/${id}` } : null;
        case 'friends':
            return { href: q('tab') === 'requests' ? '/friends?tab=requests' : '/friends' };
        case 'my-plans':
            return { href: '/my-plans' };
        case 'rate-plan':
        case 'rate': {
            const planId = id || q('planId');
            return planId ? { href: `/rate-plan?planId=${encodeURIComponent(planId)}` } : null;
        }
        case 'profile':
        case 'user':
            return id ? { href: `/user-profile/${id}` } : { href: '/profile' };
        case 'feed':
        case 'home':
            return { href: '/(tabs)' };
        case 'chats':
            return { href: '/(tabs)/chats' };
        default:
            return null;
    }
}

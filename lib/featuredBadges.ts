import { BADGE_FAMILIES, getUserBadges, type UserBadge } from './badges';
import type { BadgeStats } from './badgeStats';

export const WELCOME_BADGE_ID = 'primeros_pasos';

export function parseFeaturedBadgeId(perfilGustos: unknown): string | null {
    if (!perfilGustos || typeof perfilGustos !== 'object') return null;
    const id = (perfilGustos as Record<string, unknown>).featured_badge_id;
    return typeof id === 'string' && id.length > 0 ? id : null;
}

export function mergeFeaturedBadge(
    existing: unknown,
    badgeId: string | null,
): Record<string, unknown> {
    const base =
        existing && typeof existing === 'object' ? { ...(existing as Record<string, unknown>) } : {};
    if (badgeId) {
        base.featured_badge_id = badgeId;
    } else {
        delete base.featured_badge_id;
    }
    return base;
}

export function resolveFeaturedBadge(
    perfilGustos: unknown,
    badgeStats: BadgeStats,
): UserBadge {
    const all = getUserBadges(badgeStats);
    const welcome =
        all.find((b) => b.family.id === WELCOME_BADGE_ID)
        ?? all[0];
    const featuredId = parseFeaturedBadgeId(perfilGustos);
    const picked = featuredId
        ? all.find((b) => b.family.id === featuredId && b.unlocked) ?? null
        : null;
    return picked ?? welcome;
}

export function badgeFamilyExists(id: string): boolean {
    return BADGE_FAMILIES.some((f) => f.id === id);
}

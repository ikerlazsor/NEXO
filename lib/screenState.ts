export type ScreenState = {
    scrollOffset?: number;
    scrollIndex?: number;
    filters?: Record<string, unknown>;
    custom?: Record<string, unknown>;
};

const store = new Map<string, ScreenState>();

export const ScreenKeys = {
    FEED: 'feed',
    SAVED_PLANS: 'saved-plans',
    MY_PLANS: 'my-plans',
    CHATS: 'chats',
    FRIENDS: 'friends',
    SEARCH_PROFILES: 'search-profiles',
    BLOCKED: 'blocked-accounts',
    PROFILE: 'profile',
    PLAN_DETAIL: 'plan-detail',
    USER_PROFILE: 'user-profile',
} as const;

export type ScreenKey = (typeof ScreenKeys)[keyof typeof ScreenKeys] | string;

export function clearScreenState(): void {
    store.clear();
}

export function getScreenState(key: ScreenKey): ScreenState | undefined {
    return store.get(key);
}

export function getScreenScrollOffset(key: ScreenKey): number {
    return store.get(key)?.scrollOffset ?? 0;
}

export function setScreenScrollOffset(key: ScreenKey, offset: number): void {
    const prev = store.get(key) ?? {};
    store.set(key, { ...prev, scrollOffset: offset });
}

export function mergeScreenState(key: ScreenKey, patch: Partial<ScreenState>): void {
    const prev = store.get(key) ?? {};
    store.set(key, { ...prev, ...patch });
}

export function setScreenFilters(key: ScreenKey, filters: Record<string, unknown>): void {
    mergeScreenState(key, { filters });
}

export function getScreenFilters<T extends Record<string, unknown>>(key: ScreenKey): Partial<T> {
    return (store.get(key)?.filters ?? {}) as Partial<T>;
}

export function clearScreenState(key: ScreenKey): void {
    store.delete(key);
}

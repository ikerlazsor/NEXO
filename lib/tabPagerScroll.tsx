import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

type TabPagerScrollApi = {
    scrollEnabled: boolean;
    lockTabPager: () => void;
    unlockTabPager: () => void;
};

type Listener = (scrollEnabled: boolean) => void;

let lockCount = 0;
const listeners = new Set<Listener>();

function emitTabPagerScroll() {
    const enabled = lockCount <= 0;
    listeners.forEach((listener) => listener(enabled));
}

/** Bloquea el swipe entre tabs (mapa, detalle de plan, carruseles). */
export function lockTabPager() {
    lockCount += 1;
    emitTabPagerScroll();
}

export function unlockTabPager() {
    lockCount = Math.max(0, lockCount - 1);
    emitTabPagerScroll();
}

function subscribeTabPagerScroll(listener: Listener): () => void {
    listeners.add(listener);
    listener(lockCount <= 0);
    return () => {
        listeners.delete(listener);
    };
}

const TabPagerScrollContext = createContext<TabPagerScrollApi>({
    scrollEnabled: true,
    lockTabPager,
    unlockTabPager,
});

export function TabPagerScrollProvider({ children }: { children: ReactNode }) {
    const [scrollEnabled, setScrollEnabled] = useState(() => lockCount <= 0);
    const unlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => subscribeTabPagerScroll(setScrollEnabled), []);

    const lock = useCallback(() => {
        if (unlockTimer.current) {
            clearTimeout(unlockTimer.current);
            unlockTimer.current = null;
        }
        lockTabPager();
    }, []);

    const unlock = useCallback(() => {
        if (unlockTimer.current) clearTimeout(unlockTimer.current);
        unlockTimer.current = setTimeout(() => {
            unlockTabPager();
            unlockTimer.current = null;
        }, 120);
    }, []);

    const value = useMemo(
        () => ({ scrollEnabled, lockTabPager: lock, unlockTabPager: unlock }),
        [scrollEnabled, lock, unlock],
    );

    return <TabPagerScrollContext.Provider value={value}>{children}</TabPagerScrollContext.Provider>;
}

export function useTabPagerScroll() {
    return useContext(TabPagerScrollContext);
}

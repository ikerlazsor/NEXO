import { useFocusEffect } from '@react-navigation/native';
import type { FlashListRef } from '@shopify/flash-list';
import { useCallback, useRef } from 'react';
import { InteractionManager, type LayoutChangeEvent } from 'react-native';
import { getScreenScrollOffset, setScreenScrollOffset, type ScreenKey } from '../lib/screenState';

type Options = {
    /** Restore after a native screen transition completes. */
    restoreOnFocus?: boolean;
    waitForContent?: boolean;
    itemKeyAt?: (index: number) => string | undefined;
    indexOfKey?: (key: string) => number;
};

export function useListScrollRestore<T = unknown>(screenKey: ScreenKey, opts?: Options) {
    const restoreOnFocus = opts?.restoreOnFocus ?? true;
    const waitForContent = opts?.waitForContent ?? false;
    const listRef = useRef<FlashListRef<T>>(null);
    const focusedRef = useRef(false);
    const restorePendingRef = useRef(false);
    const savedOffsetRef = useRef(getScreenScrollOffset(screenKey));
    const contentHeightRef = useRef(0);
    const viewportRef = useRef(0);
    const optionsRef = useRef(opts);
    optionsRef.current = opts;
    const anchorRef = useRef<{ key: string; inset: number } | null>(null);
    const leavingRef = useRef(false);

    const rememberAnchor = useCallback((offset: number) => {
        const list = listRef.current;
        const index = list?.getFirstVisibleIndex?.();
        if (index == null || index < 0) return;
        const key = optionsRef.current?.itemKeyAt?.(index);
        const layout = list?.getLayout?.(index);
        if (key && layout) anchorRef.current = { key, inset: offset - layout.y - (list?.getFirstItemOffset?.() ?? 0) };
    }, []);

    const onScroll = useCallback(
        (event: { nativeEvent: { contentOffset: { y: number } } }) => {
            if (!focusedRef.current || restorePendingRef.current || leavingRef.current) return;
            const offset = Math.max(0,event.nativeEvent.contentOffset.y);
            savedOffsetRef.current = offset;
            setScreenScrollOffset(screenKey, offset);
            rememberAnchor(offset);
        },
        [screenKey, rememberAnchor],
    );

    const tryRestoreScroll = useCallback(
        (triesLeft = 10) => {
            if (!focusedRef.current || !restorePendingRef.current) return;

            let offset = savedOffsetRef.current;
            if (offset <= 0) {
                restorePendingRef.current = false;
                return;
            }

            const ref = listRef.current;
            if (!ref) {
                if (triesLeft > 0) {
                    requestAnimationFrame(() => tryRestoreScroll(triesLeft - 1));
                }
                return;
            }
            if (waitForContent && (contentHeightRef.current <= 0 || contentHeightRef.current < offset + viewportRef.current)) return;
            const anchor = anchorRef.current;
            const index = anchor ? optionsRef.current?.indexOfKey?.(anchor.key) : undefined;
            const layout = index != null && index >= 0 ? ref.getLayout?.(index) : undefined;
            if (layout && anchor) offset = Math.max(0, layout.y + (ref.getFirstItemOffset?.() ?? 0) + anchor.inset);
            savedOffsetRef.current = offset;
            setScreenScrollOffset(screenKey, offset);
            restorePendingRef.current = false;
            const current = ref.getAbsoluteLastScrollOffset?.();
            if (current == null || Math.abs(current - offset) > 1) ref.scrollToOffset({ offset, animated: false });
        },
        [waitForContent, screenKey],
    );

    const restoreScroll = useCallback(() => {
        const offset = savedOffsetRef.current;
        if (offset <= 0) return;
        restorePendingRef.current = true;
        tryRestoreScroll();
    }, [tryRestoreScroll]);

    const onListLayout = useCallback((event?: LayoutChangeEvent) => {
        if (event) viewportRef.current = event.nativeEvent.layout.height;
        tryRestoreScroll();
    }, [tryRestoreScroll]);
    const onContentSizeChange = useCallback((_width: number, height: number) => {
        contentHeightRef.current = height;
        tryRestoreScroll();
    }, [tryRestoreScroll]);
    const onScrollBeginDrag = useCallback(() => { restorePendingRef.current = false; leavingRef.current = false; }, []);
    const captureScroll = useCallback(() => {
        const current = listRef.current?.getAbsoluteLastScrollOffset?.();
        if (current != null && Number.isFinite(current)) savedOffsetRef.current = Math.max(0, current);
        rememberAnchor(savedOffsetRef.current);
        setScreenScrollOffset(screenKey, savedOffsetRef.current);
        // Freeze fling momentum before covering the list. A late momentum event
        // must never replace the position at which the card was tapped.
        leavingRef.current = true;
        listRef.current?.scrollToOffset({ offset: savedOffsetRef.current, animated: false });
    }, [rememberAnchor, screenKey]);
    const setScrollOffset = useCallback((offset: number) => {
        savedOffsetRef.current = Math.max(0, offset);
        restorePendingRef.current = false;
        anchorRef.current = null;
        setScreenScrollOffset(screenKey, savedOffsetRef.current);
    }, [screenKey]);

    useFocusEffect(
        useCallback(() => {
            focusedRef.current = true;
            leavingRef.current = false;
            // Native lists can emit y=0 while a covered screen is being laid out.
            // Protect the saved position before scheduling any deferred work.
            restorePendingRef.current = restoreOnFocus && savedOffsetRef.current > 0;

            let task: { cancel: () => void } | null = null;
            if (restoreOnFocus) {
                task = InteractionManager.runAfterInteractions(() => {
                    if (!focusedRef.current) return;
                    tryRestoreScroll();
                });
            }

            return () => {
                focusedRef.current = false;
                restorePendingRef.current = false;
                task?.cancel();
            };
        }, [restoreOnFocus, tryRestoreScroll]),
    );

    return { listRef, onScroll, onScrollBeginDrag, onListLayout, onContentSizeChange, restoreScroll, captureScroll, setScrollOffset, scrollEventThrottle: 16 as const };
}

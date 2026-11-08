import { useFocusEffect } from '@react-navigation/native';
import type { FlashListRef } from '@shopify/flash-list';
import { useCallback, useRef } from 'react';
import { InteractionManager, type LayoutChangeEvent } from 'react-native';
import { getScreenScrollOffset, setScreenScrollOffset, type ScreenKey } from '../lib/screenState';

type Options = {
    /** Restore after a native screen transition completes. */
    restoreOnFocus?: boolean;
    waitForContent?: boolean;
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

    const onScroll = useCallback(
        (event: { nativeEvent: { contentOffset: { y: number } } }) => {
            if (!focusedRef.current || restorePendingRef.current) return;
            const offset = Math.max(0,event.nativeEvent.contentOffset.y);
            savedOffsetRef.current = offset;
            setScreenScrollOffset(screenKey, offset);
        },
        [screenKey],
    );

    const tryRestoreScroll = useCallback(
        (triesLeft = 10) => {
            if (!focusedRef.current || !restorePendingRef.current) return;

            const offset = savedOffsetRef.current;
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

            restorePendingRef.current = false;
            ref.scrollToOffset({ offset, animated: false });
        },
        [waitForContent],
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
    const onScrollBeginDrag = useCallback(() => { restorePendingRef.current = false; }, []);
    const setScrollOffset = useCallback((offset: number) => {
        savedOffsetRef.current = Math.max(0, offset);
        restorePendingRef.current = false;
        setScreenScrollOffset(screenKey, savedOffsetRef.current);
    }, [screenKey]);

    useFocusEffect(
        useCallback(() => {
            focusedRef.current = true;
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

    return { listRef, onScroll, onScrollBeginDrag, onListLayout, onContentSizeChange, restoreScroll, setScrollOffset, scrollEventThrottle: 16 as const };
}

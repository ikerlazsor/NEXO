import { useFocusEffect } from '@react-navigation/native';
import type { FlashListRef } from '@shopify/flash-list';
import { useCallback, useRef } from 'react';
import { InteractionManager } from 'react-native';
import { getScreenScrollOffset, setScreenScrollOffset, type ScreenKey } from '../lib/screenState';

type Options = {
    /** Tabs que siguen montados: no restaurar al volver (evita bloquear el 1er scroll). */
    restoreOnFocus?: boolean;
};

export function useListScrollRestore<T = unknown>(screenKey: ScreenKey, opts?: Options) {
    const restoreOnFocus = opts?.restoreOnFocus ?? true;
    const listRef = useRef<FlashListRef<T>>(null);
    const focusedRef = useRef(false);
    const restorePendingRef = useRef(false);

    const onScroll = useCallback(
        (event: { nativeEvent: { contentOffset: { y: number } } }) => {
            setScreenScrollOffset(screenKey, event.nativeEvent.contentOffset.y);
        },
        [screenKey],
    );

    const tryRestoreScroll = useCallback(
        (triesLeft = 10) => {
            if (!focusedRef.current || !restorePendingRef.current) return;

            const offset = getScreenScrollOffset(screenKey);
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

            restorePendingRef.current = false;
            ref.scrollToOffset({ offset, animated: false });
        },
        [screenKey],
    );

    const restoreScroll = useCallback(() => {
        const offset = getScreenScrollOffset(screenKey);
        if (offset <= 0) return;
        restorePendingRef.current = true;
        tryRestoreScroll();
    }, [screenKey, tryRestoreScroll]);

    const onListLayout = useCallback(() => {
        tryRestoreScroll();
    }, [tryRestoreScroll]);

    useFocusEffect(
        useCallback(() => {
            focusedRef.current = true;

            let task: { cancel: () => void } | null = null;
            if (restoreOnFocus) {
                task = InteractionManager.runAfterInteractions(() => {
                    if (!focusedRef.current) return;
                    restoreScroll();
                });
            }

            return () => {
                focusedRef.current = false;
                restorePendingRef.current = false;
                task?.cancel();
            };
        }, [restoreOnFocus, restoreScroll]),
    );

    return { listRef, onScroll, onListLayout, restoreScroll, scrollEventThrottle: 16 as const };
}

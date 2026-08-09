import { useFocusEffect } from '@react-navigation/native';
import type { FlashListRef } from '@shopify/flash-list';
import { useCallback, useRef } from 'react';
import { InteractionManager } from 'react-native';
import { getScreenScrollOffset, setScreenScrollOffset, type ScreenKey } from '../lib/screenState';

export function useListScrollRestore<T = unknown>(screenKey: ScreenKey) {
    const listRef = useRef<FlashListRef<T>>(null);
    const focusedRef = useRef(false);

    const onScroll = useCallback(
        (event: { nativeEvent: { contentOffset: { y: number } } }) => {
            setScreenScrollOffset(screenKey, event.nativeEvent.contentOffset.y);
        },
        [screenKey],
    );

    const restoreScroll = useCallback(() => {
        const offset = getScreenScrollOffset(screenKey);
        if (offset <= 0) return;

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                listRef.current?.scrollToOffset({ offset, animated: false });
            });
        });
    }, [screenKey]);

    useFocusEffect(
        useCallback(() => {
            focusedRef.current = true;
            restoreScroll();

            const task = InteractionManager.runAfterInteractions(() => {
                if (focusedRef.current) restoreScroll();
            });

            return () => {
                focusedRef.current = false;
                task.cancel();
            };
        }, [restoreScroll]),
    );

    return { listRef, onScroll, restoreScroll, scrollEventThrottle: 16 as const };
}

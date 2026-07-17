import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef } from 'react';
import { InteractionManager, type ScrollView } from 'react-native';
import { getScreenScrollOffset, setScreenScrollOffset, type ScreenKey } from '../lib/screenState';

export function useScrollViewRestore(screenKey: ScreenKey) {
    const scrollRef = useRef<ScrollView>(null);
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
                scrollRef.current?.scrollTo({ y: offset, animated: false });
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

    return { scrollRef, onScroll, restoreScroll, scrollEventThrottle: 16 as const };
}

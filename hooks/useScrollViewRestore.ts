import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef } from 'react';
import { InteractionManager, type ScrollView } from 'react-native';
import { getScreenScrollOffset, setScreenScrollOffset, type ScreenKey } from '../lib/screenState';

export function useScrollViewRestore(
    screenKey: ScreenKey,
    options?: { restore?: boolean },
) {
    const scrollRef = useRef<ScrollView>(null);
    const focusedRef = useRef(false);
    const restoreEnabled = options?.restore !== false;

    const onScroll = useCallback(
        (event: { nativeEvent: { contentOffset: { y: number } } }) => {
            if (!restoreEnabled) return;
            setScreenScrollOffset(screenKey, event.nativeEvent.contentOffset.y);
        },
        [screenKey, restoreEnabled],
    );

    const restoreScroll = useCallback(() => {
        if (!restoreEnabled) return;
        const offset = getScreenScrollOffset(screenKey);
        if (offset <= 0) return;

        requestAnimationFrame(() => {
            scrollRef.current?.scrollTo({ y: offset, animated: false });
        });
    }, [screenKey, restoreEnabled]);

    useFocusEffect(
        useCallback(() => {
            focusedRef.current = true;
            if (!restoreEnabled) {
                setScreenScrollOffset(screenKey, 0);
                scrollRef.current?.scrollTo({ y: 0, animated: false });
                const task = InteractionManager.runAfterInteractions(() => {
                    if (!focusedRef.current) return;
                    scrollRef.current?.scrollTo({ y: 0, animated: false });
                });
                return () => {
                    focusedRef.current = false;
                    task.cancel();
                };
            }

            // Esperar a que el layout asiente; restaurar solo una vez evita el "bote".
            const task = InteractionManager.runAfterInteractions(() => {
                if (!focusedRef.current) return;
                requestAnimationFrame(() => {
                    if (focusedRef.current) restoreScroll();
                });
            });

            return () => {
                focusedRef.current = false;
                task.cancel();
            };
        }, [restoreScroll, restoreEnabled, screenKey]),
    );

    return { scrollRef, onScroll, restoreScroll, scrollEventThrottle: 16 as const };
}

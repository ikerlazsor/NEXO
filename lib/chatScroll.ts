import { useCallback, useRef } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import type { FlashListRef } from '@shopify/flash-list';

/** Con lista inverted, offset ~0 = mensajes más recientes (abajo visual). */
const NEAR_LATEST_PX = 80;

function pinToLatest<T>(list: FlashListRef<T> | null, animated: boolean, lastAnimatedAt: { current: number }) {
    const now = Date.now();
    if (!animated && now - lastAnimatedAt.current < 280) {
        return;
    }
    if (animated) lastAnimatedAt.current = now;
    list?.scrollToOffset({ offset: 0, animated });
}

/**
 * Sticky al final solo si el usuario está mirando lo último.
 * Al enviar → siempre baja. Al recibir → solo si ya estaba abajo.
 * Importante: al tocar/deslizar se cancelan los re-pins para no pelear con el dedo.
 */
export function useInvertedChatStickiness<T = unknown>() {
    const listRef = useRef<FlashListRef<T>>(null);
    const stickToLatestRef = useRef(true);
    const pendingAnimatedRef = useRef(false);
    const userDraggingRef = useRef(false);
    const retryTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
    const lastAnimatedPinAtRef = useRef(0);

    const clearRetryTimers = useCallback(() => {
        for (const timer of retryTimersRef.current) clearTimeout(timer);
        retryTimersRef.current = [];
    }, []);

    const schedulePin = useCallback((animated: boolean) => {
        clearRetryTimers();
        if (userDraggingRef.current) return;
        if (!stickToLatestRef.current) return;
        const list = listRef.current;
        pinToLatest(list, animated, lastAnimatedPinAtRef);
        if (animated) {
            // Sin snap a offset 0 en seco: ese re-pin cortaba la burbuja al mandar.
            return;
        }
        retryTimersRef.current = [
            setTimeout(() => {
                if (userDraggingRef.current || !stickToLatestRef.current) return;
                pinToLatest(listRef.current, false, lastAnimatedPinAtRef);
            }, 72),
        ];
    }, [clearRetryTimers]);

    const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
        stickToLatestRef.current = e.nativeEvent.contentOffset.y <= NEAR_LATEST_PX;
    }, []);

    const onScrollBeginDrag = useCallback(() => {
        userDraggingRef.current = true;
        clearRetryTimers();
    }, [clearRetryTimers]);

    const onScrollEndDrag = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
        userDraggingRef.current = false;
        stickToLatestRef.current = e.nativeEvent.contentOffset.y <= NEAR_LATEST_PX;
    }, []);

    const onMomentumScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
        userDraggingRef.current = false;
        stickToLatestRef.current = e.nativeEvent.contentOffset.y <= NEAR_LATEST_PX;
    }, []);

    const onContentSizeChange = useCallback(() => {
        if (userDraggingRef.current || !stickToLatestRef.current) return;
        const animated = pendingAnimatedRef.current;
        pendingAnimatedRef.current = false;
        pinToLatest(listRef.current, animated, lastAnimatedPinAtRef);
    }, []);

    const scrollToLatest = useCallback((animated = true) => {
        if (userDraggingRef.current) return;
        stickToLatestRef.current = true;
        pendingAnimatedRef.current = animated;
        schedulePin(animated);
    }, [schedulePin]);

    /** Tras un mensaje entrante: no molestar si está leyendo arriba. */
    const maybeStickAfterIncoming = useCallback(() => {
        if (userDraggingRef.current || !stickToLatestRef.current) return;
        pendingAnimatedRef.current = true;
        schedulePin(true);
    }, [schedulePin]);

    return {
        listRef,
        onScroll,
        onScrollBeginDrag,
        onScrollEndDrag,
        onMomentumScrollEnd,
        onContentSizeChange,
        scrollToLatest,
        maybeStickAfterIncoming,
        stickToLatestRef,
    };
}

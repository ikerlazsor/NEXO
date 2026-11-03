import { useEffect, useMemo, useRef } from 'react';
import {
    Keyboard,
    Platform,
    type KeyboardEvent,
    useWindowDimensions,
} from 'react-native';
import Animated, {
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';

/** Curva cercana a la del teclado de iOS (más suave que un corte de layout). */
const IOS_KEYBOARD_EASING = Easing.bezier(0.17, 0.59, 0.4, 0.99);

function closedPad(safeBottom: number) {
    return Math.max(safeBottom, 10) + 10;
}

function liftFromEvent(
    e: KeyboardEvent,
    windowHeight: number,
    fullWindowHeight: number,
): number {
    const coords = e.endCoordinates;
    if (!coords) return 0;
    const reported = Math.max(0, coords.height ?? 0);
    const fromScreenY =
        typeof coords.screenY === 'number'
            ? Math.max(0, fullWindowHeight - coords.screenY)
            : 0;
    const raw = Math.max(reported, fromScreenY);
    if (raw <= 0) return 0;
    const shrink = Math.max(0, fullWindowHeight - windowHeight);
    return Math.max(0, Math.round(raw - shrink));
}

/**
 * Sube el composer + lista al ritmo del teclado (Reanimated), en lugar del
 * KeyboardAvoidingView de RN que reflowa a saltos.
 *
 * paddingBottom animado: cerrado = safe area; abierto = alto del teclado + 6px.
 */
export function useChatKeyboardBottomPad(safeBottom: number) {
    const { height: windowHeight } = useWindowDimensions();
    const fullHeightRef = useRef(windowHeight);
    const windowHeightRef = useRef(windowHeight);
    windowHeightRef.current = windowHeight;

    const restPad = useMemo(() => closedPad(safeBottom), [safeBottom]);
    const pad = useSharedValue(restPad);
    const openRef = useRef(false);

    useEffect(() => {
        if (!openRef.current) {
            pad.value = restPad;
        }
    }, [restPad, pad]);

    useEffect(() => {
        if (windowHeight > fullHeightRef.current) {
            fullHeightRef.current = windowHeight;
        }
    }, [windowHeight]);

    useEffect(() => {
        const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
        const frameEvt = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidChangeFrame';

        const animateTo = (next: number, durationMs: number) => {
            pad.value = withTiming(next, {
                duration: Math.max(160, durationMs || (Platform.OS === 'ios' ? 250 : 220)),
                easing: Platform.OS === 'ios' ? IOS_KEYBOARD_EASING : Easing.out(Easing.cubic),
            });
        };

        const onShow = (e: KeyboardEvent) => {
            openRef.current = true;
            const lift = liftFromEvent(e, windowHeightRef.current, fullHeightRef.current);
            // 6px de aire: el teclado no pisa el recuadro.
            animateTo(Math.max(6, lift + 6), e.duration ?? 0);
        };

        const onHide = (e: KeyboardEvent) => {
            openRef.current = false;
            animateTo(restPad, e.duration ?? 0);
        };

        const onFrame = (e: KeyboardEvent) => {
            if (!openRef.current) return;
            const lift = liftFromEvent(e, windowHeightRef.current, fullHeightRef.current);
            if (lift <= 0) return;
            // iOS a veces manda frames con duration; mantener sync sin saltos.
            const duration = Platform.OS === 'ios' ? Math.min(e.duration || 120, 120) : 80;
            animateTo(Math.max(6, lift + 6), duration);
        };

        const show = Keyboard.addListener(showEvt, onShow);
        const hide = Keyboard.addListener(hideEvt, onHide);
        const frame = Keyboard.addListener(frameEvt, onFrame);

        return () => {
            show.remove();
            hide.remove();
            frame.remove();
        };
    }, [restPad, pad]);

    const animatedStyle = useAnimatedStyle(() => ({
        paddingBottom: pad.value,
    }));

    return animatedStyle;
}

export { Animated as ChatKeyboardAnimated };

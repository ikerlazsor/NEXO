import { Easing } from 'react-native-reanimated';

/** Salida fuerte para UI: entradas, salidas y respuestas. Nunca usar Easing.in en UI. */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
/** Movimiento de algo que ya está en pantalla. */
export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
/** Curva de sheet estilo iOS. */
export const EASE_SHEET = Easing.bezier(0.32, 0.72, 0, 1);

export const DURATION = {
    pressIn: 55,
    pressOut: 110,
    small: 180,
    sheet: 300,
} as const;

/** Muelles estilo Apple (duration + dampingRatio). Pasar `velocity` del gesto al usarlos. */
export const SPRING = {
    settle: { duration: 400, dampingRatio: 1 },
    snapBack: { duration: 400, dampingRatio: 0.8 },
    sheet: { duration: 300, dampingRatio: 0.8 },
} as const;

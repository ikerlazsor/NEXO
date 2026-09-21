import type { ReactNode } from 'react';

export type NexoAlertButtonStyle = 'default' | 'cancel' | 'destructive';

export type NexoAlertButton = {
    text?: string;
    onPress?: () => void | Promise<void>;
    style?: NexoAlertButtonStyle;
};

export type NexoAlertOptions = {
    cancelable?: boolean;
};

export type NexoAlertRequest = {
    title: string;
    message?: string;
    buttons: NexoAlertButton[];
    options?: NexoAlertOptions;
};

type Presenter = (req: NexoAlertRequest) => void;
type ClearFn = () => void;

let presentAlert: Presenter | null = null;
let clearAlerts: ClearFn | null = null;
const pending: NexoAlertRequest[] = [];

export function registerNexoAlertPresenter(fn: Presenter | null) {
    presentAlert = fn;
    if (fn) {
        while (pending.length > 0) {
            const next = pending.shift();
            if (next) fn(next);
        }
    }
}

export function registerNexoAlertClear(fn: ClearFn | null) {
    clearAlerts = fn;
}

/** Cierra cualquier alerta en cola (p. ej. al salir de un modal nativo). */
export function dismissAllNexoAlerts() {
    pending.length = 0;
    clearAlerts?.();
}

function normalizeButtons(buttons?: NexoAlertButton[]): NexoAlertButton[] {
    if (!buttons || buttons.length === 0) {
        return [{ text: 'OK', style: 'default' }];
    }
    return buttons.map((b) => ({
        text: b.text ?? 'OK',
        onPress: b.onPress,
        style: b.style ?? 'default',
    }));
}

/** API compatible con React Native `Alert.alert`. */
export const Alert = {
    alert(
        title: string,
        message?: string,
        buttons?: NexoAlertButton[],
        options?: NexoAlertOptions,
    ) {
        const req: NexoAlertRequest = {
            title: title || '',
            message,
            buttons: normalizeButtons(buttons),
            options,
        };
        if (presentAlert) {
            presentAlert(req);
            return;
        }
        pending.push(req);
    },
};

export type NexoAlertProviderProps = { children: ReactNode };

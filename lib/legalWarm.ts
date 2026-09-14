import { InteractionManager } from 'react-native';
import {
    NEXO_NORMS_URL,
    NEXO_PRIVACY_EN_URL,
    NEXO_PRIVACY_URL,
    NEXO_SUPPORT_URL,
    NEXO_TERMS_URL,
} from './brand';

let started = false;

/** Calienta en red las páginas legales/soporte (WebView / browser abren más rápido). */
export function scheduleLegalPrefetch(): void {
    if (started) return;
    started = true;
    InteractionManager.runAfterInteractions(() => {
        void (async () => {
            const urls = [
                NEXO_PRIVACY_URL,
                NEXO_PRIVACY_EN_URL,
                NEXO_TERMS_URL,
                NEXO_NORMS_URL,
                NEXO_SUPPORT_URL,
            ];
            await Promise.allSettled(
                urls.map(async (url) => {
                    try {
                        await fetch(url, { method: 'GET' });
                    } catch {
                        /* best effort */
                    }
                }),
            );
        })();
    });
}

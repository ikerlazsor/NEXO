import { Platform, Share } from 'react-native';
import { eventShareUrl, planShareUrl } from './shareLinks';
import { withShareTouchGuard } from './shareTouchGuard';

/**
 * Compartir un plan o evento: hoja del sistema con SOLO el enlace.
 * WhatsApp pinta la tarjeta (portada, título, cuándo · dónde y appnexo.es)
 * y no se repite nada debajo.
 */
export type ShareTarget = {
    kind: 'plan' | 'event';
    id: string;
    title: string;
    url: string;
};

function isCancel(e: unknown): boolean {
    const msg = e instanceof Error ? e.message : String(e);
    return /User did not share|canceled|cancelled|dismiss/i.test(msg);
}

export function planShareTarget(planId: string, title?: string | null): ShareTarget {
    return { kind: 'plan', id: planId, title: title?.trim() || 'Nexo', url: planShareUrl(planId) };
}

export function eventShareTarget(eventId: string, title: string, coverKey?: string | null): ShareTarget {
    return { kind: 'event', id: eventId, title: title.trim() || 'Nexo', url: eventShareUrl(eventId, coverKey) };
}

/** Abre la hoja de compartir del sistema con el enlace. */
export async function shareTarget(target: ShareTarget): Promise<void> {
    try {
        await withShareTouchGuard(async () => {
            if (Platform.OS === 'ios') {
                await Share.share({ message: target.url });
                return;
            }
            await Share.share({ message: target.url, title: target.title });
        });
    } catch (e) {
        if (isCancel(e)) return;
        // Nunca propagar: un fallo al compartir no debe echar de la app.
    }
}

import { Platform, Share } from 'react-native';
import { eventShareUrl } from './shareLinks';
import { withShareTouchGuard } from './shareTouchGuard';

/** Comparte un evento: solo el enlace (la vista previa pinta portada, título, cuándo y dónde). */
export async function shareEventLink(opts: {
    eventId: string;
    title: string;
    when?: string;
    venue?: string | null;
    /** Clave `nexo_cover:…` de la portada (ver eventCoverKey) para la vista previa. */
    coverKey?: string | null;
}): Promise<void> {
    // Solo el enlace: la tarjeta de la vista previa ya enseña título, cuándo y dónde.
    const message = eventShareUrl(opts.eventId, opts.coverKey);
    try {
        await withShareTouchGuard(async () => {
            if (Platform.OS === 'ios') {
                await Share.share({ message });
                return;
            }
            await Share.share({ message, title: opts.title.trim() || 'Nexo' });
        });
    } catch {
        /* cancelado o fallo del sistema: nunca echar de la app */
    }
}

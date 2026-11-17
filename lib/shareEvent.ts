import { Platform, Share } from 'react-native';
import { eventShareUrl } from './shareLinks';
import { withShareTouchGuard } from './shareTouchGuard';

/** Comparte un evento: título, cuándo y dónde (la vista previa web es genérica) + enlace. */
export async function shareEventLink(opts: {
    eventId: string;
    title: string;
    when?: string;
    venue?: string | null;
    /** Clave `nexo_cover:…` de la portada (ver eventCoverKey) para la vista previa. */
    coverKey?: string | null;
}): Promise<void> {
    const lines = [opts.title.trim()];
    const detail = [opts.when, opts.venue?.trim()].filter(Boolean).join(' · ');
    if (detail) lines.push(detail);
    lines.push(eventShareUrl(opts.eventId, opts.coverKey));
    const message = lines.join('\n');
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

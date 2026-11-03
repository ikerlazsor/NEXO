import { Platform, Share } from 'react-native';
import { buildPlanShareMessage } from './shareLinks';
import { withShareTouchGuard } from './shareTouchGuard';

/**
 * Comparte el link del plan con la hoja nativa del sistema.
 * Solo texto/URL — sin captura ni Modal (evita crashes nativos en iOS).
 */
export async function sharePlanLink(planId: string, title?: string): Promise<void> {
    const message = buildPlanShareMessage({ planId });
    const safeTitle = title?.trim() || 'Nexo';
    try {
        await withShareTouchGuard(async () => {
            if (Platform.OS === 'ios') {
                // En iOS no pasamos `url` aparte: el link ya va en `message`.
                // Combinar url+message / file URLs ha llegado a tumbar la app.
                await Share.share({ message });
                return;
            }
            await Share.share({ message, title: safeTitle });
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/User did not share|canceled|cancelled|dismiss/i.test(msg)) return;
        // Nunca propagar: un fallo de share no debe echar de la app.
    }
}

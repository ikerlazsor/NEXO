import { Platform, Share } from 'react-native';
import { buildPlanShareMessage, planShareUrl } from './shareLinks';

/**
 * Comparte la URL web del plan (WhatsApp / hoja del sistema).
 * Preferir HTTPS (`EXPO_PUBLIC_SHARE_HOST` / share-plan) para Universal/App Links.
 */
export async function sharePlanLink(planId: string, title?: string): Promise<void> {
    const message = buildPlanShareMessage({ planId });
    const url = planShareUrl(planId);
    if (Platform.OS === 'ios') {
        await Share.share({
            message,
            url,
            title: title?.trim() || 'Nexo!',
        });
        return;
    }
    await Share.share({
        message,
        title: title?.trim() || 'Nexo!',
    });
}

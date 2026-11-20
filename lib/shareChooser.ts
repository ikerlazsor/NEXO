import { Alert, Linking, Platform, Share } from 'react-native';
import { eventShareUrl, planShareUrl } from './shareLinks';
import { withShareTouchGuard } from './shareTouchGuard';

/**
 * Compartir un plan o evento: WhatsApp, Instagram u otras apps.
 *
 * El mensaje es SOLO el enlace: WhatsApp pinta la tarjeta (portada, título,
 * cuándo · dónde y appnexo.es) y no se repite nada debajo.
 * Instagram no muestra tarjetas de enlace en historias: allí se comparte una
 * imagen con esa misma tarjeta (ver ShareStoryHost).
 */
export type ShareTarget = {
    kind: 'plan' | 'event';
    id: string;
    title: string;
    url: string;
};

type Translate = (key: string) => string;

let storyListener: ((target: ShareTarget) => void) | null = null;

/** Lo registra ShareStoryHost (montado una vez en la raíz). */
export function setShareStoryListener(listener: ((target: ShareTarget) => void) | null): void {
    storyListener = listener;
}

function isCancel(e: unknown): boolean {
    const msg = e instanceof Error ? e.message : String(e);
    return /User did not share|canceled|cancelled|dismiss/i.test(msg);
}

/** Hoja del sistema con solo el enlace. */
export async function shareLinkWithSystem(url: string, title?: string): Promise<void> {
    try {
        await withShareTouchGuard(async () => {
            if (Platform.OS === 'ios') {
                await Share.share({ message: url });
                return;
            }
            await Share.share({ message: url, title: title?.trim() || 'Nexo' });
        });
    } catch (e) {
        if (isCancel(e)) return;
        // Nunca propagar: un fallo al compartir no debe echar de la app.
    }
}

/** Abre WhatsApp directamente con el enlace; si no está, la hoja del sistema. */
export async function shareLinkToWhatsApp(url: string, title?: string): Promise<void> {
    try {
        await Linking.openURL(`whatsapp://send?text=${encodeURIComponent(url)}`);
    } catch {
        await shareLinkWithSystem(url, title);
    }
}

export function shareToInstagram(target: ShareTarget): void {
    if (storyListener) storyListener(target);
    else void shareLinkWithSystem(target.url, target.title);
}

export function planShareTarget(planId: string, title?: string | null): ShareTarget {
    return { kind: 'plan', id: planId, title: title?.trim() || 'Nexo', url: planShareUrl(planId) };
}

export function eventShareTarget(eventId: string, title: string, coverKey?: string | null): ShareTarget {
    return { kind: 'event', id: eventId, title: title.trim() || 'Nexo', url: eventShareUrl(eventId, coverKey) };
}

/** Menú: WhatsApp · Instagram · Otras apps. */
export function openShareChooser(target: ShareTarget, t: Translate): void {
    const buttons: Parameters<typeof Alert.alert>[2] = [
        { text: t('card.shareWhats'), onPress: () => void shareLinkToWhatsApp(target.url, target.title) },
        { text: t('card.shareInstagram'), onPress: () => shareToInstagram(target) },
        { text: t('card.shareOther'), onPress: () => void shareLinkWithSystem(target.url, target.title) },
    ];
    // Android solo admite tres botones: allí se cierra tocando fuera.
    if (Platform.OS === 'ios') buttons.push({ text: t('common.cancel'), style: 'cancel' });
    Alert.alert(t('card.share'), undefined, buttons, { cancelable: true });
}

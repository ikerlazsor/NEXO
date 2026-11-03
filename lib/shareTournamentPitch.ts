import { type RefObject } from 'react';
import { Image, NativeModules, Platform, Share, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import { withShareTouchGuard } from './shareTouchGuard';
import { planShareUrl } from './shareLinks';

function hashUri(src: string): string {
    let h = 2166136261;
    for (let i = 0; i < src.length; i += 1) {
        h ^= src.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
}

/** Descarga a file:// estable (reutilizable) para que view-shot pinte la foto. */
export async function cacheRemoteImageForShare(
    url: string | null | undefined,
    prefix = 't-av',
): Promise<string | null> {
    const src = (url || '').trim();
    if (!src) return null;
    if (src.startsWith('file://') || (src.startsWith('/') && !src.startsWith('//'))) return src;
    if (!/^https?:\/\//i.test(src)) return null;
    const dir = FileSystem.cacheDirectory;
    if (!dir) return null;
    const dest = `${dir}${prefix}-${hashUri(src)}.jpg`;
    try {
        const info = await FileSystem.getInfoAsync(dest);
        if (info.exists && (info.size ?? 0) > 32) return dest;
        const res = await FileSystem.downloadAsync(src, dest);
        return res.status === 200 ? res.uri : null;
    } catch {
        return null;
    }
}

function waitForNativeImage(uri: string, ms = 2200): Promise<void> {
    return new Promise((resolve) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            resolve();
        };
        const timer = setTimeout(finish, ms);
        Image.getSize(
            uri,
            () => {
                clearTimeout(timer);
                finish();
            },
            () => {
                clearTimeout(timer);
                finish();
            },
        );
        void Image.prefetch(uri)
            .then(() => {
                clearTimeout(timer);
                finish();
            })
            .catch(() => undefined);
    });
}

/** Espera a que RN Image tenga los file:// en memoria antes de capturar. */
export async function waitForShareAvatars(uris: Array<string | null | undefined>): Promise<void> {
    const unique = [...new Set(uris.filter((u): u is string => !!u && u.trim().length > 0))];
    if (unique.length) {
        await Promise.all(unique.map((uri) => waitForNativeImage(uri)));
    }
    await sleep(64);
}

function hasNativeRnShare(): boolean {
    try {
        return !!(NativeModules as Record<string, unknown>).RNShare;
    } catch {
        return false;
    }
}

function asFileUri(uri: string): string {
    return uri.startsWith('file://') ? uri : `file://${uri}`;
}

function sleep(ms: number) {
    return new Promise<void>((r) => setTimeout(r, ms));
}

async function shareImageAndLink(imageUri: string, link: string) {
    const cardUri = asFileUri(imageUri);

    if (Platform.OS === 'ios') {
        await withShareTouchGuard(() => Share.share({ url: cardUri, message: link }));
        return;
    }

    if (hasNativeRnShare()) {
        try {
            const RNShare = (await import('react-native-share')).default;
            await RNShare.open({
                url: cardUri,
                message: link,
                type: 'image/jpeg',
                failOnCancel: false,
            });
            return;
        } catch {
            /* fallback */
        }
    }

    try {
        if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(cardUri, {
                mimeType: 'image/jpeg',
                dialogTitle: 'Compartir',
                UTI: 'public.jpeg',
            });
            // Una sola hoja: el mensaje/link ya va con la imagen en iOS/RNShare;
            // en este fallback no abrir otra hoja solo con el texto.
            return;
        }
    } catch {
        /* ignore */
    }
    await withShareTouchGuard(() =>
        Share.share({ message: `${link}`, title: 'Nexo', url: cardUri }),
    );
}

export async function captureTournamentPitchImage(
    pitchRef: RefObject<View | null>,
): Promise<string | null> {
    try {
        await sleep(48);
        if (!pitchRef.current) return null;
        return await captureRef(pitchRef, {
            format: 'jpg',
            quality: 1,
            result: 'tmpfile',
        });
    } catch {
        return null;
    }
}

export async function shareCapturedTournamentPitch(opts: {
    planId: string;
    message: string;
    imageUri?: string | null;
    teamUrl?: string;
}): Promise<{ ok: boolean; error?: string }> {
    const link = opts.teamUrl ?? planShareUrl(opts.planId);
    try {
        if (opts.imageUri) {
            await shareImageAndLink(opts.imageUri, `${opts.message}\n${link}`);
        } else {
            await withShareTouchGuard(() =>
                Share.share({ message: `${opts.message}\n${link}`, url: link }),
            );
        }
        return { ok: true };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/User did not share|canceled|cancelled|dismiss/i.test(msg)) {
            return { ok: true };
        }
        try {
            await withShareTouchGuard(() =>
                Share.share({ message: `${opts.message}\n${link}`, url: link }),
            );
            return { ok: true };
        } catch {
            return { ok: false, error: msg };
        }
    }
}

/**
 * Captura el campo con burbujas y lo comparte (WhatsApp / hoja del sistema).
 * Misma precaución iOS que PlanShareModal: captura → breve pausa → share.
 */
export async function shareTournamentPitchImage(opts: {
    pitchRef: RefObject<View | null>;
    planId: string;
    message: string;
    teamUrl?: string;
}): Promise<{ ok: boolean; error?: string }> {
    const uri = await captureTournamentPitchImage(opts.pitchRef);
    return shareCapturedTournamentPitch({
        planId: opts.planId,
        message: opts.message,
        imageUri: uri,
        teamUrl: opts.teamUrl,
    });
}

/** Bridge: share general del torneo (sin team=) desde el detalle del plan. */
let tournamentShareHandler: (() => Promise<void>) | null = null;

export function setTournamentShareHandler(handler: (() => Promise<void>) | null) {
    tournamentShareHandler = handler;
}

export async function tryShareTournamentPitch(): Promise<boolean> {
    if (!tournamentShareHandler) return false;
    await tournamentShareHandler();
    return true;
}

type ExternalShareRequest = { planId: string };

let externalShareRequest: ExternalShareRequest | null = null;
let externalShareListener: ((req: ExternalShareRequest) => void) | null = null;

/** Desde la tarjeta del feed: pide captura de campo (host global). */
export function requestTournamentShare(planId: string): boolean {
    const req = { planId };
    if (externalShareListener) {
        externalShareListener(req);
        return true;
    }
    externalShareRequest = req;
    return true;
}

export function setTournamentShareExternalListener(
    listener: ((req: ExternalShareRequest) => void) | null,
) {
    externalShareListener = listener;
    if (listener && externalShareRequest) {
        const pending = externalShareRequest;
        externalShareRequest = null;
        listener(pending);
    }
}

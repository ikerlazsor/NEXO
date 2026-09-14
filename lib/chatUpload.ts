import { uploadLocalUriToStorage } from './storageUpload';
import { supabase } from './supabase';

export type ChatFileType = 'image' | 'video' | 'audio';

const CONTENT_TYPES: Record<ChatFileType, string> = {
    image: 'image/jpeg',
    video: 'video/mp4',
    audio: 'audio/mp4',
};

const EXTENSIONS: Record<ChatFileType, string> = {
    image: 'jpg',
    video: 'mp4',
    audio: 'm4a',
};

const CHAT_FILE_URL_RE = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/chat-files\/([^?]+)/i;
const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Extracts the private Storage object name from current and legacy URLs. */
export function getChatFileObjectName(value: string | null | undefined): string | null {
    if (!value) return null;
    const match = value.match(CHAT_FILE_URL_RE);
    if (!match?.[1]) return null;
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return match[1];
    }
}

/**
 * Refresh a private chat-file URL for the signed-in conversation member.
 * Legacy getPublicUrl values are repaired transparently on the next load.
 */
export async function resolveChatFileUrl(value: string | null): Promise<string | null> {
    const objectName = getChatFileObjectName(value);
    if (!objectName) return value;

    const { data, error } = await supabase.storage
        .from('chat-files')
        .createSignedUrl(objectName, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
}

export async function resolveChatFileUrls<T extends { archivo_url: string | null }>(
    rows: T[],
): Promise<T[]> {
    const names = Array.from(new Set(
        rows.map((row) => getChatFileObjectName(row.archivo_url)).filter((name): name is string => !!name),
    ));
    if (names.length === 0) return rows;

    const { data, error } = await supabase.storage
        .from('chat-files')
        .createSignedUrls(names, SIGNED_URL_TTL_SECONDS);
    if (error || !data) {
        return rows.map((row) => getChatFileObjectName(row.archivo_url)
            ? { ...row, archivo_url: null }
            : row);
    }

    const signedByName = new Map<string, string>();
    for (const item of data) {
        if (item.path && item.signedUrl && !item.error) {
            signedByName.set(item.path, item.signedUrl);
        }
    }
    return rows.map((row) => {
        const name = getChatFileObjectName(row.archivo_url);
        return name ? { ...row, archivo_url: signedByName.get(name) ?? null } : row;
    });
}

export function isSameChatFile(a: string | null, b: string | null): boolean {
    const aName = getChatFileObjectName(a);
    const bName = getChatFileObjectName(b);
    return aName && bName ? aName === bName : a === b;
}

export async function uploadChatFile(
    uri: string,
    fileType: ChatFileType,
    planId: string
): Promise<string | null> {
    try {
        const fileName = `chat_${planId}_${Date.now()}_${Math.floor(Math.random() * 10000)}.${EXTENSIONS[fileType]}`;
        await uploadLocalUriToStorage({
            bucket: 'chat-files',
            path: fileName,
            uri,
            contentType: CONTENT_TYPES[fileType],
        });

        const { data: urlData, error: signError } = await supabase.storage
            .from('chat-files')
            .createSignedUrl(fileName, SIGNED_URL_TTL_SECONDS);

        if (signError || !urlData?.signedUrl) {
            await supabase.storage.from('chat-files').remove([fileName]);
            throw signError ?? new Error('No se pudo firmar el archivo privado');
        }

        return urlData.signedUrl;
    } catch (e) {
        console.error('Error subiendo archivo de chat:', e);
        return null;
    }
}

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { holdAppUpdateReload } from './appUpdates';
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from './supabase';

function objectUrl(bucket: string, path: string): string {
    const encoded = path
        .split('/')
        .filter(Boolean)
        .map((part) => encodeURIComponent(part))
        .join('/');
    return `${SUPABASE_URL}/storage/v1/object/${bucket}/${encoded}`;
}

async function ensureReadableFileUri(uri: string): Promise<string> {
    if (Platform.OS !== 'android' || !uri.startsWith('content://')) return uri;
    const cache = FileSystem.cacheDirectory;
    if (!cache) return uri;
    const dest = `${cache}nexo-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
        await FileSystem.copyAsync({ from: uri, to: dest });
        return dest;
    } catch (e) {
        console.warn('storage copy content uri:', e);
        return uri;
    }
}

/**
 * Supabase cachea 1 hora por defecto: cada foto se volvía a descargar cada hora
 * en cada móvil (egress disparado). Todas las rutas son únicas o llevan `?t=`,
 * así que el contenido de una URL nunca cambia: se puede cachear un año.
 */
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

async function uploadViaNativeStream(opts: {
    bucket: string;
    path: string;
    uri: string;
    contentType: string;
    upsert: boolean;
    token: string;
}): Promise<boolean> {
    if (Platform.OS === 'web' || typeof FileSystem.uploadAsync !== 'function') {
        return false;
    }
    try {
        const result = await FileSystem.uploadAsync(objectUrl(opts.bucket, opts.path), opts.uri, {
            httpMethod: 'POST',
            uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
            headers: {
                Authorization: `Bearer ${opts.token}`,
                apikey: SUPABASE_ANON_KEY,
                'Content-Type': opts.contentType,
                'Cache-Control': IMMUTABLE_CACHE_CONTROL,
                'x-upsert': opts.upsert ? 'true' : 'false',
            },
        });
        if (result.status >= 200 && result.status < 300) return true;
        console.warn('storage stream upload:', result.status, result.body);
        return false;
    } catch (e) {
        console.warn('storage stream upload failed:', e);
        return false;
    }
}

async function uploadViaBytes(opts: {
    bucket: string;
    path: string;
    uri: string;
    contentType: string;
    upsert: boolean;
}): Promise<void> {
    const res = await fetch(opts.uri);
    if (!res.ok) throw new Error(`read ${res.status}`);
    const bytes = await res.arrayBuffer();
    const { error } = await supabase.storage.from(opts.bucket).upload(opts.path, bytes, {
        contentType: opts.contentType,
        cacheControl: '31536000',
        upsert: opts.upsert,
    });
    if (error) throw error;
}

/**
 * Sube un archivo local a Storage. En nativo usa streaming desde disco
 * (sin Base64 ni cargar el vídeo entero en RAM). Web usa bytes del blob.
 */
export async function uploadLocalUriToStorage(opts: {
    bucket: string;
    path: string;
    uri: string;
    contentType: string;
    upsert?: boolean;
}): Promise<void> {
    const upsert = opts.upsert === true;
    // Una OTA no puede reiniciar la app a mitad de una subida.
    const releaseUpdateHold = holdAppUpdateReload();
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error('not authenticated');

        const uri = await ensureReadableFileUri(opts.uri);

        const streamed = await uploadViaNativeStream({
            bucket: opts.bucket,
            path: opts.path,
            uri,
            contentType: opts.contentType,
            upsert,
            token,
        });
        if (streamed) return;

        await uploadViaBytes({
            bucket: opts.bucket,
            path: opts.path,
            uri,
            contentType: opts.contentType,
            upsert,
        });
    } finally {
        releaseUpdateHold();
    }
}

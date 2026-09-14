import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from './supabase';

function objectUrl(bucket: string, path: string): string {
    const encoded = path
        .split('/')
        .filter(Boolean)
        .map((part) => encodeURIComponent(part))
        .join('/');
    return `${SUPABASE_URL}/storage/v1/object/${bucket}/${encoded}`;
}

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
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error('not authenticated');

    const streamed = await uploadViaNativeStream({
        bucket: opts.bucket,
        path: opts.path,
        uri: opts.uri,
        contentType: opts.contentType,
        upsert,
        token,
    });
    if (streamed) return;

    await uploadViaBytes({
        bucket: opts.bucket,
        path: opts.path,
        uri: opts.uri,
        contentType: opts.contentType,
        upsert,
    });
}

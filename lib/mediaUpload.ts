import { compressImageForUpload } from './imageCompress';
import { uploadLocalUriToStorage } from './storageUpload';
import { supabase } from './supabase';

const BUCKET = 'organizador-media';

function extFor(kind: 'image' | 'video', uri: string, mimeType?: string | null): { ext: string; contentType: string } {
    const mime = (mimeType ?? '').toLowerCase();
    const lower = uri.toLowerCase();
    if (kind === 'video') {
        const mov = mime.includes('quicktime') || lower.includes('.mov');
        return {
            ext: mov ? 'mov' : 'mp4',
            contentType: mov ? 'video/quicktime' : 'video/mp4',
        };
    }
    return { ext: 'jpg', contentType: 'image/jpeg' };
}

export async function uploadLocalFile(opts: {
    userId: string;
    uri: string;
    kind: 'image' | 'video';
    mimeType?: string | null;
    folder?: string;
}): Promise<string | null> {
    try {
        const { ext, contentType } = extFor(opts.kind, opts.uri, opts.mimeType);
        const folder = opts.folder ?? 'moments';
        const fileName = `${opts.userId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const uploadUri =
            opts.kind === 'image'
                ? await compressImageForUpload(opts.uri, 'moment')
                : opts.uri;
        try {
            await uploadLocalUriToStorage({
                bucket: BUCKET,
                path: fileName,
                uri: uploadUri,
                contentType,
            });
            const { data } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
            return data.publicUrl;
        } catch (error) {
            if (opts.kind !== 'image') throw error;
            await uploadLocalUriToStorage({
                bucket: 'imagenes-planes',
                path: fileName,
                uri: uploadUri,
                contentType: 'image/jpeg',
            });
            const { data } = supabase.storage.from('imagenes-planes').getPublicUrl(fileName);
            return data.publicUrl;
        }
    } catch (e) {
        console.warn('uploadLocalFile:', e);
        return null;
    }
}

export async function makeVideoThumb(uri: string): Promise<string | null> {
    try {
        const VideoThumbnails = await import('expo-video-thumbnails');
        const shot = await VideoThumbnails.getThumbnailAsync(uri, { time: 350, quality: 0.55 });
        return shot.uri || null;
    } catch (e) {
        console.warn('makeVideoThumb:', e);
        return null;
    }
}

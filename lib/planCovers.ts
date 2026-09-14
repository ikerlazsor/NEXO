import { compressImageForUpload } from './imageCompress';
import { uploadLocalUriToStorage } from './storageUpload';
import { supabase } from './supabase';

export const MAX_ORGANIZER_COVERS = 5;

function asCoverUrls(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    }
    if (typeof value === 'string') {
        const raw = value.trim();
        if (!raw) return [];
        if (raw.startsWith('[')) {
            try {
                return asCoverUrls(JSON.parse(raw));
            } catch {
                return [];
            }
        }
    }
    return [];
}

export function planCoverList(plan: { imagen_url?: string | null; imagenes_url?: unknown }): string[] {
    const extras = asCoverUrls(plan.imagenes_url);
    const main = typeof plan.imagen_url === 'string' ? plan.imagen_url.trim() : '';
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (url: string) => {
        if (!url || seen.has(url)) return;
        seen.add(url);
        out.push(url);
    };
    push(main);
    for (const url of extras) push(url);
    return out;
}

export async function uploadOrganizerCover(userId: string, uri: string): Promise<string | null> {
    try {
        const localUri = await compressImageForUpload(uri, 'plan');
        const fileName = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
        await uploadLocalUriToStorage({
            bucket: 'imagenes-planes',
            path: fileName,
            uri: localUri,
            contentType: 'image/jpeg',
        });
        const { data } = supabase.storage.from('imagenes-planes').getPublicUrl(fileName);
        return data.publicUrl;
    } catch (e) {
        console.warn('uploadOrganizerCover:', e);
        return null;
    }
}

import { compressImageForUpload } from './imageCompress';
import { uploadLocalUriToStorage } from './storageUpload';
import { supabase } from './supabase';

export async function uploadAvatarFromUri(
    userId: string,
    uri: string,
): Promise<{ url: string | null; error: string | null }> {
    try {
        const localUri = await compressImageForUpload(uri, 'avatar');
        const fileName = `${userId}/avatar.jpg`;
        await uploadLocalUriToStorage({
            bucket: 'avatars',
            path: fileName,
            uri: localUri,
            contentType: 'image/jpeg',
            upsert: true,
        });

        const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(fileName);
        const urlWithTimestamp = `${publicUrl}?t=${Date.now()}`;

        const { error: updateError } = await supabase
            .from('perfiles')
            .update({ avatar_url: urlWithTimestamp })
            .eq('id', userId);

        if (updateError) {
            return { url: null, error: updateError.message };
        }

        void supabase.auth.updateUser({ data: { avatar_url: urlWithTimestamp } });

        return { url: urlWithTimestamp, error: null };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'upload_failed';
        return { url: null, error: msg };
    }
}

import { decode } from 'base64-arraybuffer';
import { supabase } from './supabase';

export async function uploadAvatarFromUri(
    userId: string,
    uri: string,
): Promise<{ url: string | null; error: string | null }> {
    try {
        const fileName = `${userId}/avatar.jpg`;
        const response = await fetch(uri);
        const blob = await response.blob();

        const base64data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const data = reader.result?.toString().split(',')[1];
                if (data) resolve(data);
                else reject(new Error('read_failed'));
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });

        const { error: uploadError } = await supabase.storage
            .from('avatars')
            .upload(fileName, decode(base64data), { contentType: 'image/jpeg', upsert: true });

        if (uploadError) {
            return { url: null, error: uploadError.message };
        }

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

import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';
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

export async function uploadChatFile(
    uri: string,
    fileType: ChatFileType,
    planId: string
): Promise<string | null> {
    try {
        const base64 = await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType.Base64,
        });

        const fileName = `chat_${planId}_${Date.now()}_${Math.floor(Math.random() * 10000)}.${EXTENSIONS[fileType]}`;

        const { error: uploadError } = await supabase.storage
            .from('chat-files')
            .upload(fileName, decode(base64), {
                contentType: CONTENT_TYPES[fileType],
                upsert: false,
            });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
            .from('chat-files')
            .getPublicUrl(fileName);

        return urlData.publicUrl;
    } catch (e) {
        console.error('Error subiendo archivo de chat:', e);
        return null;
    }
}

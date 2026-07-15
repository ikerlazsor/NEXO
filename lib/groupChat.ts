import { decode } from 'base64-arraybuffer';
import { isGroupChatPlan } from './feedPlans';
import { supabase } from './supabase';

/** Grupo creado en Chats (+): plan con categoría interna 'Grupo'. */
export function isUserCreatedGroupChat(plan: { categoria?: string | null }): boolean {
    return isGroupChatPlan(plan);
}

export async function uploadGroupChatPhoto(planId: string, uri: string): Promise<string | null> {
    try {
        const response = await fetch(uri);
        const blob = await response.blob();
        const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const data = reader.result?.toString().split(',')[1];
                if (data) resolve(data);
                else reject(new Error('read_failed'));
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });

        const fileName = `groups/${planId}.jpg`;
        const { error: uploadError } = await supabase.storage
            .from('avatars')
            .upload(fileName, decode(base64), { contentType: 'image/jpeg', upsert: true });

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(fileName);
        return `${publicUrl}?t=${Date.now()}`;
    } catch (e) {
        console.error('uploadGroupChatPhoto:', e);
        return null;
    }
}

export async function updateGroupChatPhoto(planId: string, imageUrl: string): Promise<{ error: string | null }> {
    const { error } = await supabase.from('planes').update({ imagen_url: imageUrl }).eq('id', planId);
    if (error?.message?.includes('policy') || error?.message?.includes('RLS')) {
        return { error: 'rls_planes_update' };
    }
    return { error: error?.message ?? null };
}

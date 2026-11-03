import { decode } from 'base64-arraybuffer';
import { isGroupChatPlan } from './feedPlans';
import { isConvertedPlanChat } from './planLifecycle';
import { supabase } from './supabase';

export const MAX_GROUP_NAME_LENGTH = 40;

/** Grupo creado en Chats (+). Un plan convertido en chat fijo no cuenta. */
export function isUserCreatedGroupChat(plan: {
    categoria?: string | null;
    fecha_evento?: string | null;
}): boolean {
    if (!isGroupChatPlan(plan)) return false;
    if (!plan.fecha_evento) return true;
    return !isConvertedPlanChat(plan);
}

export async function updateGroupChatName(planId: string, name: string): Promise<{ error: string | null }> {
    const titulo = name.trim().slice(0, MAX_GROUP_NAME_LENGTH);
    if (!titulo) return { error: 'empty' };
    const { error } = await supabase.from('planes').update({ titulo }).eq('id', planId);
    return { error: error?.message ?? null };
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

import { supabase } from './supabase';

/** true si el usuario actual tiene bloqueado a otherUserId. */
export async function isUserBlocked(currentUserId: string, otherUserId: string): Promise<boolean> {
    const { data, error } = await supabase
        .from('bloqueos')
        .select('id')
        .eq('bloqueador_id', currentUserId)
        .eq('bloqueado_id', otherUserId)
        .maybeSingle();
    if (error) return false;
    return !!data;
}

export async function blockUser(currentUserId: string, otherUserId: string): Promise<{ error: string | null }> {
    const { error } = await supabase.from('bloqueos').insert({
        bloqueador_id: currentUserId,
        bloqueado_id: otherUserId,
    });
    if (error && error.code !== '23505') return { error: error.message };
    return { error: null };
}

export async function unblockUser(currentUserId: string, otherUserId: string): Promise<{ error: string | null }> {
    const { error } = await supabase
        .from('bloqueos')
        .delete()
        .eq('bloqueador_id', currentUserId)
        .eq('bloqueado_id', otherUserId);
    return { error: error?.message ?? null };
}

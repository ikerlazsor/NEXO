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

/** true si hay bloqueo en cualquier dirección. */
export async function isBlockedEitherWay(userA: string, userB: string): Promise<boolean> {
    const [aBlocksB, bBlocksA] = await Promise.all([
        isUserBlocked(userA, userB),
        isUserBlocked(userB, userA),
    ]);
    return aBlocksB || bBlocksA;
}

async function clearRelationshipOnBlock(userA: string, userB: string): Promise<void> {
    const { data } = await supabase
        .from('amistades')
        .select('id, estado')
        .or(
            `and(usuario_origen_id.eq.${userA},usuario_destino_id.eq.${userB}),and(usuario_origen_id.eq.${userB},usuario_destino_id.eq.${userA})`
        )
        .neq('estado', 'rechazado')
        .maybeSingle();

    if (!data?.id) return;

    if (data.estado === 'aceptado') {
        await supabase.from('amistades').delete().eq('id', data.id);
    } else {
        await supabase
            .from('amistades')
            .update({ estado: 'rechazado', actualizado_en: new Date().toISOString() })
            .eq('id', data.id);
    }
}

export async function blockUser(currentUserId: string, otherUserId: string): Promise<{ error: string | null }> {
    await clearRelationshipOnBlock(currentUserId, otherUserId);

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

export interface BlockedProfile {
    id: string;
    nombre: string;
    avatar_url: string | null;
    nombre_usuario: string | null;
}

export async function getBlockedUsers(userId: string): Promise<BlockedProfile[]> {
    const { data, error } = await supabase
        .from('bloqueos')
        .select('bloqueado_id, perfiles:bloqueado_id ( id, nombre, avatar_url, nombre_usuario )')
        .eq('bloqueador_id', userId)
        .order('creado_en', { ascending: false });

    if (error) throw error;

    return (data ?? []).map((row) => {
        const raw = row.perfiles;
        const profile = Array.isArray(raw) ? raw[0] : raw;
        return {
            id: (profile?.id as string) ?? (row.bloqueado_id as string),
            nombre: (profile?.nombre as string) || 'Usuario',
            avatar_url: (profile?.avatar_url as string | null) ?? null,
            nombre_usuario: (profile?.nombre_usuario as string | null) ?? null,
        };
    });
}

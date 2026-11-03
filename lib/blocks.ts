import { supabase } from './supabase';

type BlockCols = {
    blocker: string;
    blocked: string;
};

let cachedCols: BlockCols | null = null;

async function resolveBlockColumns(): Promise<BlockCols> {
    if (cachedCols) return cachedCols;

    // Prefer origen/destino (esquema real de Nexo); fallback bloqueador/bloqueado
    const probe = await supabase.from('bloqueos').select('*').limit(1);
    const sample = probe.data?.[0] as Record<string, unknown> | undefined;
    if (sample && 'usuario_origen_id' in sample) {
        cachedCols = { blocker: 'usuario_origen_id', blocked: 'usuario_destino_id' };
    } else {
        cachedCols = { blocker: 'bloqueador_id', blocked: 'bloqueado_id' };
    }
    return cachedCols;
}

/** true si el usuario actual tiene bloqueado a otherUserId. */
export async function isUserBlocked(currentUserId: string, otherUserId: string): Promise<boolean> {
    const cols = await resolveBlockColumns();
    const { data, error } = await supabase
        .from('bloqueos')
        .select('id')
        .eq(cols.blocker, currentUserId)
        .eq(cols.blocked, otherUserId)
        .maybeSingle();
    if (error) return false;
    return !!data;
}

/**
 * true si hay bloqueo en cualquier dirección. RLS solo deja ver los bloqueos
 * propios, así que el bloqueo ajeno se consulta con una función del servidor.
 */
export async function isBlockedEitherWay(userA: string, userB: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('users_are_blocked', {
        p_a: userA,
        p_b: userB,
    });
    if (!error) return data === true;
    return isUserBlocked(userA, userB);
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
    const cols = await resolveBlockColumns();

    const { error } = await supabase.from('bloqueos').insert({
        [cols.blocker]: currentUserId,
        [cols.blocked]: otherUserId,
    });
    if (error) {
        if (error.code === '23505') return { error: null };
        if (/block_daily_limit/i.test(error.message)) return { error: 'block_daily_limit' };
        return { error: error.message };
    }
    return { error: null };
}

export async function unblockUser(currentUserId: string, otherUserId: string): Promise<{ error: string | null }> {
    const cols = await resolveBlockColumns();
    const { error } = await supabase
        .from('bloqueos')
        .delete()
        .eq(cols.blocker, currentUserId)
        .eq(cols.blocked, otherUserId);
    return { error: error?.message ?? null };
}

export interface BlockedProfile {
    id: string;
    nombre: string;
    avatar_url: string | null;
    nombre_usuario: string | null;
}

export async function getBlockedUsers(userId: string): Promise<BlockedProfile[]> {
    const cols = await resolveBlockColumns();
    const { data, error } = await supabase
        .from('bloqueos')
        .select(`${cols.blocked}, perfiles:${cols.blocked} ( id, nombre, avatar_url, nombre_usuario )`)
        .eq(cols.blocker, userId);

    if (error) throw error;

    return (data ?? []).map((row: any) => {
        const blockedId = row[cols.blocked] as string;
        const raw = row.perfiles;
        const profile = Array.isArray(raw) ? raw[0] : raw;
        return {
            id: (profile?.id as string) ?? blockedId,
            nombre: (profile?.nombre as string) || 'Usuario',
            avatar_url: (profile?.avatar_url as string | null) ?? null,
            nombre_usuario: (profile?.nombre_usuario as string | null) ?? null,
        };
    });
}

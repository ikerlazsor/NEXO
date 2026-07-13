import { supabase } from './supabase';

export type FriendStatus = 'self' | 'none' | 'friends' | 'pending_sent' | 'pending_received';

export interface FriendProfile {
    id: string;
    nombre: string;
    avatar_url: string | null;
}

export interface FriendshipRow {
    id: string;
    usuario_id: string;
    amigo_id: string;
    estado: 'pendiente' | 'aceptado' | 'rechazado';
    created_at: string;
}

export interface FriendRequest extends FriendshipRow {
    perfil: FriendProfile;
}

function mapProfile(raw: unknown): FriendProfile | null {
    if (!raw) return null;
    const row = Array.isArray(raw) ? raw[0] : raw;
    if (!row || typeof row !== 'object') return null;
    const profile = row as Record<string, unknown>;
    return {
        id: profile.id as string,
        nombre: (profile.nombre as string) || 'Usuario',
        avatar_url: (profile.avatar_url as string | null) ?? null,
    };
}

export function getAvatarUri(profile: Pick<FriendProfile, 'nombre' | 'avatar_url'>): string {
    if (profile.avatar_url) return profile.avatar_url;
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.nombre)}&background=4DA6FF&color=fff`;
}

export async function getFriendStatus(
    currentUserId: string,
    otherUserId: string
): Promise<{ status: FriendStatus; requestId: string | null }> {
    if (currentUserId === otherUserId) {
        return { status: 'self', requestId: null };
    }

    const { data, error } = await supabase
        .from('amistades')
        .select('id, usuario_id, amigo_id, estado')
        .or(
            `and(usuario_id.eq.${currentUserId},amigo_id.eq.${otherUserId}),and(usuario_id.eq.${otherUserId},amigo_id.eq.${currentUserId})`
        )
        .neq('estado', 'rechazado')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw error;
    if (!data) return { status: 'none', requestId: null };

    if (data.estado === 'aceptado') {
        return { status: 'friends', requestId: data.id };
    }

    if (data.estado === 'pendiente') {
        if (data.usuario_id === currentUserId) {
            return { status: 'pending_sent', requestId: data.id };
        }
        return { status: 'pending_received', requestId: data.id };
    }

    return { status: 'none', requestId: null };
}

export async function sendFriendRequest(
    fromUserId: string,
    toUserId: string
): Promise<{ error: string | null }> {
    const existing = await getFriendStatus(fromUserId, toUserId);
    if (existing.status === 'friends') return { error: 'Ya sois amigos' };
    if (existing.status === 'pending_sent') return { error: 'Ya enviaste una solicitud' };
    if (existing.status === 'pending_received' && existing.requestId) {
        const { error } = await acceptFriendRequest(existing.requestId);
        return { error: error?.message ?? null };
    }

    const { data: rejectedRow } = await supabase
        .from('amistades')
        .select('id')
        .eq('usuario_id', fromUserId)
        .eq('amigo_id', toUserId)
        .eq('estado', 'rechazado')
        .maybeSingle();

    if (rejectedRow) {
        const { error } = await supabase
            .from('amistades')
            .update({ estado: 'pendiente', updated_at: new Date().toISOString() })
            .eq('id', rejectedRow.id);

        return { error: error?.message ?? null };
    }

    const { error } = await supabase.from('amistades').insert({
        usuario_id: fromUserId,
        amigo_id: toUserId,
        estado: 'pendiente',
    });

    if (error) {
        if (error.code === '23505') return { error: 'Ya existe una solicitud entre vosotros' };
        return { error: error.message };
    }

    return { error: null };
}

export async function acceptFriendRequest(requestId: string) {
    return supabase
        .from('amistades')
        .update({ estado: 'aceptado', updated_at: new Date().toISOString() })
        .eq('id', requestId)
        .eq('estado', 'pendiente');
}

export async function rejectFriendRequest(requestId: string) {
    return supabase
        .from('amistades')
        .update({ estado: 'rechazado', updated_at: new Date().toISOString() })
        .eq('id', requestId)
        .eq('estado', 'pendiente');
}

export async function cancelFriendRequest(requestId: string) {
    return supabase.from('amistades').delete().eq('id', requestId).eq('estado', 'pendiente');
}

export async function removeFriend(friendshipId: string) {
    return supabase.from('amistades').delete().eq('id', friendshipId);
}

export async function getFriendsCount(userId: string): Promise<number> {
    const { count, error } = await supabase
        .from('amistades')
        .select('id', { count: 'exact', head: true })
        .eq('estado', 'aceptado')
        .or(`usuario_id.eq.${userId},amigo_id.eq.${userId}`);

    if (error) throw error;
    return count ?? 0;
}

export async function getPendingRequestsCount(userId: string): Promise<number> {
    const { count, error } = await supabase
        .from('amistades')
        .select('id', { count: 'exact', head: true })
        .eq('amigo_id', userId)
        .eq('estado', 'pendiente');

    if (error) throw error;
    return count ?? 0;
}

export async function getFriends(userId: string): Promise<(FriendProfile & { friendshipId: string })[]> {
    const { data, error } = await supabase
        .from('amistades')
        .select(`
            id,
            usuario_id,
            amigo_id,
            solicitante:usuario_id ( id, nombre, avatar_url ),
            receptor:amigo_id ( id, nombre, avatar_url )
        `)
        .eq('estado', 'aceptado')
        .or(`usuario_id.eq.${userId},amigo_id.eq.${userId}`)
        .order('updated_at', { ascending: false });

    if (error) throw error;

    return (data ?? []).map((row) => {
        const solicitante = mapProfile(row.solicitante);
        const receptor = mapProfile(row.receptor);
        const friend =
            row.usuario_id === userId ? receptor : solicitante;

        return {
            id: friend?.id ?? '',
            nombre: friend?.nombre ?? 'Usuario',
            avatar_url: friend?.avatar_url ?? null,
            friendshipId: row.id as string,
        };
    }).filter((f) => f.id);
}

export async function getIncomingRequests(userId: string): Promise<FriendRequest[]> {
    const { data, error } = await supabase
        .from('amistades')
        .select(`
            id,
            usuario_id,
            amigo_id,
            estado,
            created_at,
            perfil:usuario_id ( id, nombre, avatar_url )
        `)
        .eq('amigo_id', userId)
        .eq('estado', 'pendiente')
        .order('created_at', { ascending: false });

    if (error) throw error;

    return (data ?? []).map((row) => ({
        id: row.id as string,
        usuario_id: row.usuario_id as string,
        amigo_id: row.amigo_id as string,
        estado: row.estado as FriendshipRow['estado'],
        created_at: row.created_at as string,
        perfil: mapProfile(row.perfil) ?? {
            id: row.usuario_id as string,
            nombre: 'Usuario',
            avatar_url: null,
        },
    }));
}

export async function getOutgoingRequests(userId: string): Promise<FriendRequest[]> {
    const { data, error } = await supabase
        .from('amistades')
        .select(`
            id,
            usuario_id,
            amigo_id,
            estado,
            created_at,
            perfil:amigo_id ( id, nombre, avatar_url )
        `)
        .eq('usuario_id', userId)
        .eq('estado', 'pendiente')
        .order('created_at', { ascending: false });

    if (error) throw error;

    return (data ?? []).map((row) => ({
        id: row.id as string,
        usuario_id: row.usuario_id as string,
        amigo_id: row.amigo_id as string,
        estado: row.estado as FriendshipRow['estado'],
        created_at: row.created_at as string,
        perfil: mapProfile(row.perfil) ?? {
            id: row.amigo_id as string,
            nombre: 'Usuario',
            avatar_url: null,
        },
    }));
}

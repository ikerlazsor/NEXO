import { supabase } from './supabase';
import { isBlockedEitherWay } from './blocks';

export type FriendStatus = 'self' | 'none' | 'friends' | 'pending_sent' | 'pending_received';

export interface FriendProfile {
    id: string;
    nombre: string;
    avatar_url: string | null;
}

export interface FriendshipRow {
    id: string;
    usuario_origen_id: string;
    usuario_destino_id: string;
    estado: 'pendiente' | 'aceptado' | 'rechazado';
    creado_en: string;
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
        .select('id, usuario_origen_id, usuario_destino_id, estado')
        .or(
            `and(usuario_origen_id.eq.${currentUserId},usuario_destino_id.eq.${otherUserId}),and(usuario_origen_id.eq.${otherUserId},usuario_destino_id.eq.${currentUserId})`
        )
        .neq('estado', 'rechazado')
        .order('creado_en', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw error;
    if (!data) return { status: 'none', requestId: null };

    if (data.estado === 'aceptado') {
        return { status: 'friends', requestId: data.id };
    }

    if (data.estado === 'pendiente') {
        if (data.usuario_origen_id === currentUserId) {
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
    if (await isBlockedEitherWay(fromUserId, toUserId)) {
        return { error: 'No puedes enviar solicitudes a este usuario' };
    }

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
        .eq('usuario_origen_id', fromUserId)
        .eq('usuario_destino_id', toUserId)
        .eq('estado', 'rechazado')
        .maybeSingle();

    if (rejectedRow) {
        const { error } = await supabase
            .from('amistades')
            .update({ estado: 'pendiente', actualizado_en: new Date().toISOString() })
            .eq('id', rejectedRow.id);

        if (error) {
            if (/friend_request_daily_limit/i.test(error.message)) {
                return { error: 'friend_request_daily_limit' };
            }
            return { error: error.message };
        }
        return { error: null };
    }

    const { error } = await supabase.from('amistades').insert({
        usuario_origen_id: fromUserId,
        usuario_destino_id: toUserId,
        estado: 'pendiente',
    });

    if (error) {
        if (error.code === '23505') return { error: 'Ya existe una solicitud entre vosotros' };
        if (/friend_request_daily_limit/i.test(error.message)) {
            return { error: 'friend_request_daily_limit' };
        }
        return { error: error.message };
    }

    return { error: null };
}

export async function acceptFriendRequest(requestId: string) {
    const { data: row } = await supabase
        .from('amistades')
        .select('usuario_origen_id, usuario_destino_id')
        .eq('id', requestId)
        .maybeSingle();

    if (row && await isBlockedEitherWay(row.usuario_origen_id, row.usuario_destino_id)) {
        return { data: null, error: { message: 'No puedes aceptar esta solicitud' } as any };
    }

    return supabase
        .from('amistades')
        .update({ estado: 'aceptado', actualizado_en: new Date().toISOString() })
        .eq('id', requestId)
        .eq('estado', 'pendiente');
}

export async function rejectFriendRequest(requestId: string) {
    return supabase
        .from('amistades')
        .update({ estado: 'rechazado', actualizado_en: new Date().toISOString() })
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
        .or(`usuario_origen_id.eq.${userId},usuario_destino_id.eq.${userId}`);

    if (error) throw error;
    return count ?? 0;
}

export async function getPendingRequestsCount(userId: string): Promise<number> {
    const { count, error } = await supabase
        .from('amistades')
        .select('id', { count: 'exact', head: true })
        .eq('usuario_destino_id', userId)
        .eq('estado', 'pendiente');

    if (error) throw error;
    return count ?? 0;
}

export async function getFriends(userId: string): Promise<(FriendProfile & { friendshipId: string })[]> {
    const { data, error } = await supabase
        .from('amistades')
        .select(`
            id,
            usuario_origen_id,
            usuario_destino_id,
            solicitante:perfiles!amistades_origen_fkey ( id, nombre, avatar_url ),
            receptor:perfiles!amistades_destino_fkey ( id, nombre, avatar_url )
        `)
        .eq('estado', 'aceptado')
        .or(`usuario_origen_id.eq.${userId},usuario_destino_id.eq.${userId}`)
        .order('actualizado_en', { ascending: false });

    if (error) throw error;

    return (data ?? []).map((row) => {
        const solicitante = mapProfile(row.solicitante);
        const receptor = mapProfile(row.receptor);
        const friend = row.usuario_origen_id === userId ? receptor : solicitante;

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
            usuario_origen_id,
            usuario_destino_id,
            estado,
            creado_en,
            perfil:perfiles!amistades_origen_fkey ( id, nombre, avatar_url )
        `)
        .eq('usuario_destino_id', userId)
        .eq('estado', 'pendiente')
        .order('creado_en', { ascending: false });

    if (error) throw error;

    return (data ?? []).map((row) => ({
        id: row.id as string,
        usuario_origen_id: row.usuario_origen_id as string,
        usuario_destino_id: row.usuario_destino_id as string,
        estado: row.estado as FriendshipRow['estado'],
        creado_en: row.creado_en as string,
        perfil: mapProfile(row.perfil) ?? {
            id: row.usuario_origen_id as string,
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
            usuario_origen_id,
            usuario_destino_id,
            estado,
            creado_en,
            perfil:perfiles!amistades_destino_fkey ( id, nombre, avatar_url )
        `)
        .eq('usuario_origen_id', userId)
        .eq('estado', 'pendiente')
        .order('creado_en', { ascending: false });

    if (error) throw error;

    return (data ?? []).map((row) => ({
        id: row.id as string,
        usuario_origen_id: row.usuario_origen_id as string,
        usuario_destino_id: row.usuario_destino_id as string,
        estado: row.estado as FriendshipRow['estado'],
        creado_en: row.creado_en as string,
        perfil: mapProfile(row.perfil) ?? {
            id: row.usuario_destino_id as string,
            nombre: 'Usuario',
            avatar_url: null,
        },
    }));
}

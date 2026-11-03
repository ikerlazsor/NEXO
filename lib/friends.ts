import { supabase } from './supabase';
import { isBlockedEitherWay } from './blocks';
import { invalidateProfileNotificationCount } from './profileNotificationBus';
import { getMyProfile, getPublicProfile } from './profileData';

export type FriendStatus = 'self' | 'none' | 'friends' | 'pending_sent' | 'pending_received';

export interface FriendProfile {
    id: string;
    nombre: string;
    avatar_url: string | null;
    nombre_usuario?: string | null;
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
        nombre_usuario: (profile.nombre_usuario as string | null | undefined) ?? null,
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
): Promise<{ error: string | null; requestId?: string | null }> {
    const [me, other] = await Promise.all([getMyProfile(), getPublicProfile(toUserId)]);
    if (me.data?.es_organizador === true || other?.es_organizador === true) {
        return { error: 'organizer_no_friends' };
    }

    if (await isBlockedEitherWay(fromUserId, toUserId)) {
        return { error: 'No puedes enviar solicitudes a este usuario' };
    }

    const existing = await getFriendStatus(fromUserId, toUserId);
    if (existing.status === 'friends') return { error: 'Ya sois amigos' };
    if (existing.status === 'pending_sent') {
        return { error: 'Ya enviaste una solicitud', requestId: existing.requestId };
    }
    if (existing.status === 'pending_received' && existing.requestId) {
        const { error } = await acceptFriendRequest(existing.requestId);
        return { error: error?.message ?? null, requestId: existing.requestId };
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
        const { notifyFriendRequest } = await import('./push');
        notifyFriendRequest(toUserId);
        invalidateProfileNotificationCount(toUserId);
        return { error: null, requestId: rejectedRow.id as string };
    }

    const { data: inserted, error } = await supabase
        .from('amistades')
        .insert({
            usuario_origen_id: fromUserId,
            usuario_destino_id: toUserId,
            estado: 'pendiente',
        })
        .select('id')
        .maybeSingle();

    if (error) {
        if (error.code === '23505') return { error: 'Ya existe una solicitud entre vosotros' };
        if (/friend_request_daily_limit/i.test(error.message)) {
            return { error: 'friend_request_daily_limit' };
        }
        return { error: error.message };
    }

    const { notifyFriendRequest } = await import('./push');
    notifyFriendRequest(toUserId);
    invalidateProfileNotificationCount(toUserId);
    return { error: null, requestId: (inserted?.id as string | undefined) ?? null };
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

    const result = await supabase
        .from('amistades')
        .update({ estado: 'aceptado', actualizado_en: new Date().toISOString() })
        .eq('id', requestId)
        .eq('estado', 'pendiente');

    if (result.error && /only_recipient_can_accept/i.test(result.error.message)) {
        return { data: null, error: { message: 'only_recipient_can_accept' } as any };
    }

    if (!result.error && row?.usuario_origen_id) {
        const { notifyFriendAccepted } = await import('./push');
        notifyFriendAccepted(row.usuario_origen_id);
        if (row.usuario_destino_id) {
            invalidateProfileNotificationCount(row.usuario_destino_id);
            void import('./prefetchHome').then(({ schedulePersonalRewarm }) => {
                schedulePersonalRewarm(row.usuario_destino_id as string);
            });
        }
        void import('./userProfileCache').then(({ prefetchUserProfile }) => {
            prefetchUserProfile(row.usuario_origen_id as string);
        });
    }

    return result;
}

export async function rejectFriendRequest(requestId: string) {
    const { data: row } = await supabase
        .from('amistades')
        .select('usuario_destino_id')
        .eq('id', requestId)
        .maybeSingle();
    const result = await supabase
        .from('amistades')
        .update({ estado: 'rechazado', actualizado_en: new Date().toISOString() })
        .eq('id', requestId)
        .eq('estado', 'pendiente');
    if (!result.error && row?.usuario_destino_id) {
        invalidateProfileNotificationCount(row.usuario_destino_id);
    }
    return result;
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
        .select('id, usuario_origen_id, usuario_destino_id')
        .eq('estado', 'aceptado')
        .or(`usuario_origen_id.eq.${userId},usuario_destino_id.eq.${userId}`)
        .order('actualizado_en', { ascending: false });

    if (error) throw error;

    const rows = data ?? [];
    const peerIds = [
        ...new Set(
            rows
                .map((row) =>
                    row.usuario_origen_id === userId
                        ? (row.usuario_destino_id as string)
                        : (row.usuario_origen_id as string),
                )
                .filter(Boolean),
        ),
    ];
    if (peerIds.length === 0) return [];

    const { data: profiles, error: profilesError } = await supabase
        .from('perfiles')
        .select('id, nombre, nombre_usuario, avatar_url')
        .in('id', peerIds);
    if (profilesError) throw profilesError;

    const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));

    return rows
        .map((row) => {
            const peerId =
                row.usuario_origen_id === userId
                    ? (row.usuario_destino_id as string)
                    : (row.usuario_origen_id as string);
            const profile = profileById.get(peerId);
            return {
                id: peerId,
                nombre: profile?.nombre?.trim() || 'Usuario',
                avatar_url: profile?.avatar_url ?? null,
                nombre_usuario: profile?.nombre_usuario ?? null,
                friendshipId: row.id as string,
            };
        })
        .filter((f) => !!f.id);
}

export async function getFriendIds(userId: string): Promise<Set<string>> {
    const { data, error } = await supabase
        .from('amistades')
        .select('usuario_origen_id, usuario_destino_id')
        .eq('estado', 'aceptado')
        .or(`usuario_origen_id.eq.${userId},usuario_destino_id.eq.${userId}`);
    if (error || !data) return new Set();
    const ids = new Set<string>();
    for (const row of data) {
        const other = row.usuario_origen_id === userId ? row.usuario_destino_id : row.usuario_origen_id;
        if (other) ids.add(other as string);
    }
    return ids;
}

/** Amigos de tus amigos (sin incluirte ni a tus amigos directos). */
export async function getFriendOfFriendIds(userId: string, friendIds: Set<string>): Promise<Set<string>> {
    if (friendIds.size === 0) return new Set();
    const list = [...friendIds];
    const csv = list.join(',');
    const { data, error } = await supabase
        .from('amistades')
        .select('usuario_origen_id, usuario_destino_id')
        .eq('estado', 'aceptado')
        .or(`usuario_origen_id.in.(${csv}),usuario_destino_id.in.(${csv})`);
    if (error || !data) return new Set();
    const out = new Set<string>();
    for (const row of data) {
        const a = row.usuario_origen_id as string;
        const b = row.usuario_destino_id as string;
        const other = friendIds.has(a) ? b : a;
        if (other && other !== userId && !friendIds.has(other)) out.add(other);
    }
    return out;
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

import { supabase } from './supabase';

export type PrivateProfileRow = {
    id: string;
    nombre: string | null;
    nombre_usuario: string | null;
    avatar_url: string | null;
    descripcion: string | null;
    etiquetas: string[] | null;
    fecha_nacimiento: string | null;
    genero: string | null;
    habitos_consumo: Record<string, unknown> | null;
    ambientes_preferidos: string[] | null;
    perfil_gustos: Record<string, unknown> | null;
    registro_completado: boolean;
    nombre_usuario_cambios: string[] | null;
    nombre_usuario_cambiado_en: string | null;
    notificaciones_push: boolean;
    notif_messages: boolean;
    notif_social: boolean;
    notif_reminders: boolean;
};

export type PublicProfileRow = {
    id: string;
    nombre: string | null;
    nombre_usuario: string | null;
    avatar_url: string | null;
    descripcion: string | null;
    etiquetas: string[];
    edad: number | null;
    genero: string | null;
    habitos_consumo: Record<string, unknown>;
    ambientes_preferidos: string[];
    perfil_gustos: Record<string, unknown>;
};

export async function getMyProfile(): Promise<{
    data: PrivateProfileRow | null;
    error: { message: string } | null;
}> {
    const { data, error } = await supabase.rpc('get_my_profile').limit(1).maybeSingle();
    return {
        data: (data as PrivateProfileRow | null) ?? null,
        error: error ? { message: error.message } : null,
    };
}

export async function getPublicProfiles(userIds: string[]): Promise<PublicProfileRow[]> {
    const ids = [...new Set(userIds.filter(Boolean))].slice(0, 200);
    if (!ids.length) return [];
    const { data, error } = await supabase.rpc('get_public_profiles', { p_user_ids: ids });
    if (error) throw error;
    return (data ?? []) as PublicProfileRow[];
}

export async function getPublicProfile(userId: string): Promise<PublicProfileRow | null> {
    const rows = await getPublicProfiles([userId]);
    return rows[0] ?? null;
}

export async function getPublicProfileMap(
    userIds: string[],
): Promise<Map<string, PublicProfileRow>> {
    const rows = await getPublicProfiles(userIds);
    return new Map(rows.map((row) => [row.id, row]));
}

export async function getPublicProfileCards(userIds: string[]): Promise<
    Array<{
        id: string;
        nombre: string | null;
        nombre_usuario: string | null;
        avatar_url: string | null;
        genero: string | null;
        ambientes_preferidos: string[];
        etiquetas: string[];
    }>
> {
    return (await getPublicProfiles(userIds)).map((row) => ({
        id: row.id,
        nombre: row.nombre,
        nombre_usuario: row.nombre_usuario,
        avatar_url: row.avatar_url,
        genero: row.genero,
        ambientes_preferidos: row.ambientes_preferidos,
        etiquetas: row.etiquetas,
    }));
}

export async function getAdminProfileAccess(userId: string): Promise<{
    rol: string;
    baneado: boolean;
    baneado_motivo: string | null;
} | null> {
    const { data, error } = await supabase.rpc('admin_get_profile_access', {
        target_id: userId,
    });
    if (error || !data || typeof data !== 'object') return null;
    const row = data as Record<string, unknown>;
    return {
        rol: typeof row.rol === 'string' ? row.rol : 'user',
        baneado: row.baneado === true,
        baneado_motivo:
            typeof row.baneado_motivo === 'string' ? row.baneado_motivo : null,
    };
}

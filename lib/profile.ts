import { getAuthSession, runWithTimeout } from './auth';
import { supabase } from './supabase';

const DELETE_ACCOUNT_RPC = 'delete_own_account';

// Límites del constraint de perfiles.nombre_usuario (3-20 caracteres).
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

export interface ProfileRow {
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
}

export function normalizeUsername(value: string): string {
    return value.trim();
}

export function isValidUsername(value: string): boolean {
    const normalized = normalizeUsername(value);
    return normalized.length >= USERNAME_MIN_LENGTH && normalized.length <= USERNAME_MAX_LENGTH;
}

export function readNombreFromUser(user: {
    email?: string | null;
    user_metadata?: Record<string, unknown> | null;
}): string {
    const meta = user.user_metadata ?? {};
    const candidates = [meta.nombre, meta.full_name, meta.name, user.email?.split('@')[0]];
    for (const value of candidates) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
}

export function resolveDisplayName(
    user: {
        email?: string | null;
        user_metadata?: Record<string, unknown> | null;
    },
    fallback = 'Usuario'
): string {
    return readNombreFromUser(user) || fallback;
}

export async function isUsernameTaken(
    nombreUsuario: string,
    excludeUserId?: string
): Promise<boolean> {
    const normalized = normalizeUsername(nombreUsuario);
    if (!normalized) return false;

    let query = supabase
        .from('perfiles')
        .select('id')
        .ilike('nombre_usuario', normalized)
        .limit(1);

    if (excludeUserId) {
        query = query.neq('id', excludeUserId);
    }

    try {
        const { data, error } = await runWithTimeout(() => query, 8000);
        if (error) return false;
        return (data?.length ?? 0) > 0;
    } catch {
        return false;
    }
}

export async function deleteAccount(): Promise<{ error: string | null }> {
    const session = await getAuthSession();
    if (!session?.user) {
        return { error: 'No hay sesión activa.' };
    }

    const userId = session.user.id;
    let rpcError: string | null = null;

    try {
        const { error } = await runWithTimeout(
            () => supabase.rpc(DELETE_ACCOUNT_RPC),
            8000,
            'Tiempo de espera agotado'
        );
        if (error) rpcError = error.message;
    } catch (e) {
        rpcError = e instanceof Error ? e.message : 'No se pudo contactar con el servidor';
    }

    if (rpcError) {
        const { error: profileDeleteError } = await supabase.from('perfiles').delete().eq('id', userId);
        if (profileDeleteError) {
            return { error: rpcError };
        }
    }

    await supabase.auth.signOut({ scope: 'local' });
    return { error: null };
}

export async function ensureProfile(
    user: {
        id: string;
        email?: string | null;
        user_metadata?: Record<string, unknown> | null;
    },
    explicitNombre?: string
): Promise<{ error: string | null }> {
    const metaNombre = readNombreFromUser(user);
    const preferred = normalizeUsername(explicitNombre || metaNombre);

    const { data: existing } = await supabase
        .from('perfiles')
        .select('nombre, nombre_usuario, registro_completado')
        .eq('id', user.id)
        .maybeSingle();

    const existingName = existing?.nombre?.trim();
    const isGeneric = !existingName || existingName === 'Usuario';
    const nombre = (isGeneric && preferred) ? preferred : (existingName || preferred || resolveDisplayName(user));

    const payload: Record<string, unknown> = {
        id: user.id,
        nombre,
        avatar_url:
            typeof user.user_metadata?.avatar_url === 'string'
                ? user.user_metadata.avatar_url
                : null,
        registro_completado: existing?.registro_completado === true,
    };

    // nombre_usuario tiene constraint UNIQUE + longitud 3-20: solo lo fijamos si es válido
    // y el perfil aún no tiene uno.
    if (!existing?.nombre_usuario && isValidUsername(nombre)) {
        payload.nombre_usuario = nombre;
    }

    let { error } = await supabase.from('perfiles').upsert(payload, {
        onConflict: 'id',
        ignoreDuplicates: false,
    });

    // Si el nombre de usuario ya está cogido, reintentamos sin él (el perfil no debe fallar por eso).
    if (error && payload.nombre_usuario) {
        delete payload.nombre_usuario;
        ({ error } = await supabase.from('perfiles').upsert(payload, {
            onConflict: 'id',
            ignoreDuplicates: false,
        }));
    }

    if (error) {
        return { error: error.message };
    }

    return { error: null };
}

export async function loadProfileRow(userId: string) {
    const { data, error } = await supabase
        .from('perfiles')
        .select('nombre, nombre_usuario, avatar_url, descripcion, etiquetas, fecha_nacimiento, genero, habitos_consumo, ambientes_preferidos, perfil_gustos')
        .eq('id', userId)
        .maybeSingle();
    return { data: (data as ProfileRow | null) ?? null, error };
}

export async function syncProfileFromAuth(
    user: {
        id: string;
        email?: string | null;
        user_metadata?: Record<string, unknown> | null;
    },
    explicitNombre?: string
): Promise<{
    nombre: string;
    avatar_url: string | null;
    descripcion: string;
    etiquetas: string[];
    fecha_nacimiento: string | null;
    genero: string | null;
    habitos_consumo: Record<string, unknown>;
    ambientes_preferidos: string[];
    perfil_gustos: Record<string, unknown>;
}> {
    await ensureProfile(user, explicitNombre);

    const { data } = await loadProfileRow(user.id);
    const metaNombre = readNombreFromUser(user);
    const preferred = normalizeUsername(explicitNombre || metaNombre);
    const nombre = data?.nombre?.trim() || preferred || resolveDisplayName(user);

    if (data && !data.nombre?.trim() && nombre) {
        await supabase.from('perfiles').update({ nombre }).eq('id', user.id);
    }

    return {
        nombre,
        avatar_url: data?.avatar_url ?? (typeof user.user_metadata?.avatar_url === 'string' ? user.user_metadata.avatar_url : null),
        descripcion: data?.descripcion ?? '',
        etiquetas: Array.isArray(data?.etiquetas) ? data.etiquetas : [],
        fecha_nacimiento: data?.fecha_nacimiento ?? null,
        genero: data?.genero ?? null,
        habitos_consumo: (data?.habitos_consumo as Record<string, unknown>) ?? {},
        ambientes_preferidos: Array.isArray(data?.ambientes_preferidos) ? data.ambientes_preferidos : [],
        perfil_gustos: (data?.perfil_gustos as Record<string, unknown>) ?? {},
    };
}

export async function updateProfileFields(
    userId: string,
    fields: Record<string, unknown>
): Promise<{ error: string | null }> {
    const { error: profileError } = await supabase.from('perfiles').update(fields).eq('id', userId);
    if (profileError) return { error: profileError.message };

    void supabase.auth.updateUser({ data: fields }).catch(() => {});
    return { error: null };
}

/** Actualiza el nombre visible y el nombre de usuario único a la vez. */
export async function updateUsername(
    userId: string,
    nombreUsuario: string
): Promise<{ error: string | null }> {
    const normalized = normalizeUsername(nombreUsuario);
    if (!isValidUsername(normalized)) {
        return { error: 'invalid_length' };
    }
    return updateProfileFields(userId, { nombre: normalized, nombre_usuario: normalized });
}

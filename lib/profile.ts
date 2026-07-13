import { getAuthSession, runWithTimeout } from './auth';
import { supabase } from './supabase';

const DELETE_ACCOUNT_RPC = 'delete_own_account';

export const USERNAME_MAX_LENGTH = 15;

export function normalizeUsername(value: string): string {
    return value.trim();
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
    nombre: string,
    excludeUserId?: string
): Promise<boolean> {
    const normalized = normalizeUsername(nombre);
    if (!normalized) return false;

    try {
        const { data, error } = await runWithTimeout(
            () =>
                supabase.rpc('is_username_taken', {
                    check_name: normalized,
                    exclude_id: excludeUserId ?? null,
                }),
            8000
        );

        if (!error) return data === true;
    } catch {
        // fallback abajo
    }

    const { data: rows } = await supabase
        .from('perfiles')
        .select('id')
        .ilike('nombre', normalized)
        .limit(1);

    if (rows?.length) {
        if (excludeUserId && rows[0].id === excludeUserId) return false;
        return true;
    }
    return false;
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
            return {
                error: `${rpcError}. Ejecuta supabase/delete-account.sql en Supabase para borrado completo.`,
            };
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
        .select('nombre, onboarding_completed')
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
        onboarding_completed: existing?.onboarding_completed === true,
    };

    const { error } = await supabase.from('perfiles').upsert(payload, {
        onConflict: 'id',
        ignoreDuplicates: false,
    });

    if (error) {
        return { error: error.message };
    }

    return { error: null };
}

export async function loadProfileRow(userId: string) {
    const { data, error } = await supabase
        .from('perfiles')
        .select('nombre, avatar_url, about_me, tags')
        .eq('id', userId)
        .maybeSingle();
    return { data, error };
}

export async function syncProfileFromAuth(
    user: {
        id: string;
        email?: string | null;
        user_metadata?: Record<string, unknown> | null;
    },
    explicitNombre?: string
): Promise<{ nombre: string; avatar_url: string | null; about_me: string; tags: string[] }> {
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
        about_me: data?.about_me ?? (typeof user.user_metadata?.about_me === 'string' ? user.user_metadata.about_me : ''),
        tags: (data?.tags as string[] | undefined) ?? (Array.isArray(user.user_metadata?.tags) ? (user.user_metadata.tags as string[]) : []),
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

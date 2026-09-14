import { getAuthSession, runWithTimeout } from './auth';
import { getMyProfile } from './profileData';
import { supabase } from './supabase';
import { signOutAndClearLocalData } from './session';

/** Límites del handle único (`nombre_usuario`), estilo Instagram. */
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

/** Nombre visible en el perfil (puede repetirse). */
export const DISPLAY_NAME_MIN_LENGTH = 2;
export const DISPLAY_NAME_MAX_LENGTH = 18;

export interface ProfileRow {
    nombre: string | null;
    nombre_usuario: string | null;
    avatar_url: string | null;
    cover_url?: string | null;
    descripcion: string | null;
    etiquetas: string[] | null;
    fecha_nacimiento: string | null;
    genero: string | null;
    habitos_consumo: Record<string, unknown> | null;
    ambientes_preferidos: string[] | null;
    perfil_gustos: Record<string, unknown> | null;
    es_organizador?: boolean;
    organizador?: Record<string, unknown> | null;
}

/**
 * Normaliza handle: minúsculas, sin tildes (á→a), solo letras, números, . y _.
 * Al escribir, se aplica en vivo igual que las mayúsculas → minúsculas.
 */
export function normalizeUsername(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9._]/g, '')
        .replace(/\.{2,}/g, '.')
        .replace(/^\.+|\.+$/g, '');
}

/** Para inputs en vivo: fuerza formato válido al instante. */
export function formatUsernameInput(value: string, maxLength = USERNAME_MAX_LENGTH): string {
    return normalizeUsername(value).slice(0, maxLength);
}

export function isValidUsername(value: string): boolean {
    const normalized = normalizeUsername(value);
    if (
        normalized.length < USERNAME_MIN_LENGTH ||
        normalized.length > USERNAME_MAX_LENGTH
    ) {
        return false;
    }
    if (!/^[a-z0-9._]+$/.test(normalized)) return false;
    if (normalized.startsWith('.') || normalized.endsWith('.')) return false;
    if (normalized.includes('..')) return false;
    return true;
}

export function normalizeDisplayName(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
}

export function isValidDisplayName(value: string): boolean {
    const normalized = normalizeDisplayName(value);
    if (normalized.length > DISPLAY_NAME_MAX_LENGTH) return false;
    const letters = normalized.match(/\p{L}/gu);
    return (letters?.length ?? 0) >= DISPLAY_NAME_MIN_LENGTH;
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
    fallback = 'Usuario',
): string {
    return readNombreFromUser(user) || fallback;
}

/** Error si no se pudo comprobar disponibilidad (RPC/red). */
export class UsernameCheckError extends Error {
    constructor(message = 'username_check_failed') {
        super(message);
        this.name = 'UsernameCheckError';
    }
}

export async function isUsernameTaken(
    nombreUsuario: string,
    excludeUserId?: string,
): Promise<boolean> {
    const normalized = normalizeUsername(nombreUsuario);
    if (!normalized) return false;

    if (excludeUserId) {
        const own = await getMyProfile();
        if (normalizeUsername(own.data?.nombre_usuario ?? '') === normalized) return false;
    }

    // RPC SECURITY DEFINER de alcance mínimo: funciona también durante el alta.
    try {
        const { data, error } = await runWithTimeout(
            () =>
                supabase.rpc('is_username_taken_public', {
                    check_name: normalized,
                }),
            8000,
        );
        if (!error) return data === true;
        console.warn('isUsernameTaken rpc:', error.message);
    } catch (e) {
        console.warn('isUsernameTaken rpc failed:', e);
    }

    throw new UsernameCheckError();
}

export async function deleteAccount(): Promise<{ error: string | null }> {
    const session = await getAuthSession();
    if (!session?.user) {
        return { error: 'No hay sesión activa.' };
    }

    let functionError: string | null = null;

    try {
        const { data, error } = await runWithTimeout(
            () => supabase.functions.invoke('delete-account', { body: {} }),
            20000,
            'Tiempo de espera agotado',
        );
        const payload = data as { error?: string } | null;
        if (error) functionError = error.message;
        else if (payload?.error) functionError = payload.error;
    } catch (e) {
        functionError = e instanceof Error ? e.message : 'No se pudo contactar con el servidor';
    }

    if (functionError) {
        // Una caída temporal no debe dejar una cuenta a medias. Conservamos
        // tanto la sesión como el perfil para que el usuario pueda reintentarlo.
        return { error: functionError };
    }

    await signOutAndClearLocalData({ scope: 'local' });
    return { error: null };
}

export async function ensureProfile(
    user: {
        id: string;
        email?: string | null;
        user_metadata?: Record<string, unknown> | null;
    },
    options?: { nombre?: string } | string,
): Promise<{ error: string | null }> {
    const opts = typeof options === 'string' ? { nombre: options } : options ?? {};

    const metaNombre = readNombreFromUser(user);
    const displayName = normalizeDisplayName(opts.nombre || metaNombre) || resolveDisplayName(user);

    const { data: existing } = await getMyProfile();

    const existingName = existing?.nombre?.trim();
    const isGeneric = !existingName || existingName === 'Usuario';
    const nombre = isGeneric && displayName ? displayName : existingName || displayName;

    const payload: Record<string, unknown> = {
        id: user.id,
        nombre,
        avatar_url:
            typeof user.user_metadata?.avatar_url === 'string'
                ? user.user_metadata.avatar_url
                : null,
        registro_completado: existing?.registro_completado === true,
    };

    const persist = async (nextPayload: Record<string, unknown>) => {
        if (existing) {
            const updates = { ...nextPayload };
            delete updates.id;
            return supabase.from('perfiles').update(updates).eq('id', user.id);
        }
        return supabase.from('perfiles').insert(nextPayload);
    };

    const { error } = await persist(payload);

    if (error) {
        return { error: error.message };
    }

    return { error: null };
}

export async function loadProfileRow(userId: string) {
    const session = await getAuthSession();
    if (session?.user.id !== userId) {
        return { data: null, error: { message: 'profile_access_denied' } };
    }
    const { data, error } = await getMyProfile();
    return { data: (data as ProfileRow | null) ?? null, error };
}

export async function syncProfileFromAuth(
    user: {
        id: string;
        email?: string | null;
        user_metadata?: Record<string, unknown> | null;
    },
    explicitNombre?: string,
): Promise<{
    nombre: string;
    nombre_usuario: string | null;
    avatar_url: string | null;
    descripcion: string;
    etiquetas: string[];
    fecha_nacimiento: string | null;
    genero: string | null;
    habitos_consumo: Record<string, unknown>;
    ambientes_preferidos: string[];
    perfil_gustos: Record<string, unknown>;
}> {
    await ensureProfile(user, explicitNombre ? { nombre: explicitNombre } : undefined);

    const { data } = await loadProfileRow(user.id);
    const metaNombre = readNombreFromUser(user);
    const preferred = normalizeDisplayName(explicitNombre || metaNombre);
    const nombre = data?.nombre?.trim() || preferred || resolveDisplayName(user);

    if (data && !data.nombre?.trim() && nombre) {
        await supabase.from('perfiles').update({ nombre }).eq('id', user.id);
    }

    return {
        nombre,
        nombre_usuario: data?.nombre_usuario ?? null,
        avatar_url:
            data?.avatar_url ??
            (typeof user.user_metadata?.avatar_url === 'string' ? user.user_metadata.avatar_url : null),
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
    fields: Record<string, unknown>,
): Promise<{ error: string | null }> {
    const { error: profileError } = await supabase.from('perfiles').update(fields).eq('id', userId);
    if (profileError) return { error: profileError.message };

    void supabase.auth.updateUser({ data: fields }).catch(() => {});
    return { error: null };
}

/** Actualiza solo el nombre visible (puede repetirse). */
export async function updateDisplayName(
    userId: string,
    displayName: string,
): Promise<{ error: string | null }> {
    const normalized = normalizeDisplayName(displayName);
    if (!isValidDisplayName(normalized)) {
        return { error: 'invalid_display_name' };
    }
    return updateProfileFields(userId, { nombre: normalized });
}

/** Actualiza solo el handle único (máx. 2 cambios cada 7 días; el del registro no cuenta). */
export async function updateUsername(
    userId: string,
    nombreUsuario: string,
): Promise<{ error: string | null; daysLeft?: number }> {
    const normalized = normalizeUsername(nombreUsuario);
    if (!isValidUsername(normalized)) {
        return { error: 'invalid_username' };
    }

    try {
        const { data, error } = await runWithTimeout(
            () => supabase.rpc('change_username', { new_name: normalized }),
            8000,
        );
        if (!error) {
            const result = data as { ok?: boolean; nombre_usuario?: string } | null;
            if (result?.nombre_usuario) {
                void supabase.auth
                    .updateUser({ data: { nombre_usuario: result.nombre_usuario } })
                    .catch(() => {});
            }
            return { error: null };
        }

        const msg = error.message || '';
        if (/username_taken/i.test(msg)) return { error: 'username_taken' };
        if (/invalid_username/i.test(msg)) return { error: 'invalid_username' };
        const cooldown = msg.match(/username_cooldown:?(\d+)?/i);
        if (cooldown) {
            return {
                error: 'username_cooldown',
                daysLeft: cooldown[1] ? parseInt(cooldown[1], 10) : undefined,
            };
        }
        // RPC aún no migrada → fallback update directo
        if (/change_username|function|does not exist|PGRST/i.test(msg)) {
            return updateProfileFields(userId, { nombre_usuario: normalized });
        }
        return { error: msg };
    } catch (e) {
        return { error: e instanceof Error ? e.message : 'username_update_failed' };
    }
}

/**
 * Días restantes hasta poder cambiar el @ de nuevo (0 = aún hay cupo o ya se puede).
 * Límite: 2 cambios / 7 días. El @ inicial del registro no cuenta.
 */
export async function getUsernameCooldownDaysLeft(userId: string): Promise<number> {
    const session = await getAuthSession();
    if (session?.user.id !== userId) return 0;
    const { data, error } = await getMyProfile();

    if (error || !data) return 0;

    const raw = (data as { nombre_usuario_cambios?: string[] | null }).nombre_usuario_cambios;
    const windowMs = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let recent: number[] = [];

    if (Array.isArray(raw) && raw.length > 0) {
        recent = raw
            .map((t) => new Date(t).getTime())
            .filter((t) => Number.isFinite(t) && now - t < windowMs)
            .sort((a, b) => a - b);
    } else {
        const lastRaw = (data as { nombre_usuario_cambiado_en?: string | null }).nombre_usuario_cambiado_en;
        if (lastRaw) {
            const last = new Date(lastRaw).getTime();
            if (Number.isFinite(last) && now - last < windowMs) recent = [last];
        }
    }

    if (recent.length < 2) return 0;

    const unlock = recent[0] + windowMs;
    const leftMs = unlock - now;
    if (leftMs <= 0) return 0;
    return Math.ceil(leftMs / (24 * 60 * 60 * 1000));
}

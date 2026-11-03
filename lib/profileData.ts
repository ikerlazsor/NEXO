import { supabase } from './supabase';
import { cacheGetStale, cacheInvalidate, cacheSet } from './ttlCache';

/**
 * Las mismas fichas (nombre, avatar, edad…) se piden una y otra vez: al abrir un
 * plan, su chat, el perfil de alguien… y sin caché cada pantalla esperaba otra
 * vuelta a red para pintar las burbujas. Se guardan por persona, no por consulta.
 */
const PUBLIC_PROFILE_TTL_MS = 300_000;
const publicProfileKey = (id: string) => `publicProfile:${id}`;

function readCachedProfiles(ids: string[]): {
    cached: PublicProfileRow[];
    missing: string[];
} {
    const cached: PublicProfileRow[] = [];
    const missing: string[] = [];
    for (const id of ids) {
        const hit = cacheGetStale<PublicProfileRow>(publicProfileKey(id));
        if (hit) cached.push(hit);
        else missing.push(id);
    }
    return { cached, missing };
}

/** Fichas ya conocidas, sin red. Sirve para pintar antes de que llegue el fetch. */
export function peekPublicProfiles(userIds: string[]): PublicProfileRow[] {
    return readCachedProfiles([...new Set(userIds.filter(Boolean))]).cached;
}

export function rememberPublicProfiles(rows: PublicProfileRow[]): void {
    for (const row of rows) {
        if (row?.id) cacheSet(publicProfileKey(row.id), row, PUBLIC_PROFILE_TTL_MS);
    }
}

export function invalidatePublicProfile(userId: string): void {
    if (userId) cacheInvalidate(publicProfileKey(userId));
}

export type PrivateProfileRow = {
    id: string;
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
    registro_completado: boolean;
    nombre_usuario_cambios: string[] | null;
    nombre_usuario_cambiado_en: string | null;
    notificaciones_push: boolean;
    notif_messages: boolean;
    notif_social: boolean;
    notif_reminders: boolean;
    idioma?: string | null;
    es_organizador?: boolean;
    organizador?: Record<string, unknown> | null;
};

export type PublicProfileRow = {
    id: string;
    nombre: string | null;
    nombre_usuario: string | null;
    avatar_url: string | null;
    cover_url?: string | null;
    descripcion: string | null;
    etiquetas: string[];
    edad: number | null;
    genero: string | null;
    habitos_consumo: Record<string, unknown>;
    ambientes_preferidos: string[];
    perfil_gustos: Record<string, unknown>;
    es_organizador?: boolean;
    organizador?: Record<string, unknown> | null;
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

export async function getPublicProfiles(
    userIds: string[],
    options?: { force?: boolean },
): Promise<PublicProfileRow[]> {
    const ids = [...new Set(userIds.filter(Boolean))].slice(0, 200);
    if (!ids.length) return [];

    const { cached, missing } = options?.force
        ? { cached: [] as PublicProfileRow[], missing: ids }
        : readCachedProfiles(ids);
    if (!missing.length) return cached;

    const { data, error } = await supabase.rpc('get_public_profiles', { p_user_ids: missing });
    if (error) {
        // Con parte en caché, media lista es mejor que un error (burbujas vacías).
        if (cached.length) return cached;
        throw error;
    }
    const rows = (data ?? []) as PublicProfileRow[];
    rememberPublicProfiles(rows);
    return [...cached, ...rows];
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

export type PublicProfileCard = {
    id: string;
    nombre: string | null;
    nombre_usuario: string | null;
    avatar_url: string | null;
    genero: string | null;
    edad: number | null;
    ambientes_preferidos: string[];
    etiquetas: string[];
    es_organizador?: boolean;
};

function toProfileCard(row: PublicProfileRow): PublicProfileCard {
    return {
        id: row.id,
        nombre: row.nombre,
        nombre_usuario: row.nombre_usuario,
        avatar_url: row.avatar_url,
        genero: row.genero,
        edad: row.edad ?? null,
        ambientes_preferidos: row.ambientes_preferidos,
        etiquetas: row.etiquetas,
        es_organizador: row.es_organizador === true,
    };
}

export async function getPublicProfileCards(userIds: string[]): Promise<PublicProfileCard[]> {
    return (await getPublicProfiles(userIds)).map(toProfileCard);
}

/** Fichas ya en caché, sin esperar a red. Para pintar la lista al abrir. */
export function peekPublicProfileCards(userIds: string[]): PublicProfileCard[] {
    return peekPublicProfiles(userIds).map(toProfileCard);
}

/**
 * Fichas a partir de filas crudas que ya vienen con otra consulta
 * (get_plan_detail las trae junto al plan). También las deja en caché.
 */
export function profileCardsFromRows(rows: unknown): PublicProfileCard[] {
    if (!Array.isArray(rows)) return [];
    const valid = rows.filter(
        (row): row is PublicProfileRow =>
            !!row && typeof row === 'object' && typeof (row as { id?: unknown }).id === 'string',
    );
    rememberPublicProfiles(valid);
    return valid.map(toProfileCard);
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

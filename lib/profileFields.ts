import { supabase } from './supabase';

export type Genero = 'masculino' | 'femenino' | 'no_binario' | 'otro' | 'prefiero_no_decir';

export const GENERO_OPTIONS: Genero[] = [
    'masculino',
    'femenino',
    'no_binario',
    'otro',
    'prefiero_no_decir',
];

/** Opciones reducidas solo para el registro inicial */
export const ONBOARDING_GENERO_OPTIONS: Genero[] = ['masculino', 'femenino', 'otro'];

export type HabitoConsumo = 'no' | 'ocasional' | 'si' | 'no_especificado';

export const HABITO_BEBIDA_OPTIONS: HabitoConsumo[] = ['no_especificado', 'no', 'ocasional', 'si'];
export const HABITO_TABACO_OPTIONS: HabitoConsumo[] = ['no_especificado', 'no', 'ocasional', 'si'];

export const AFICIONES_OPTIONS = [
    'Deportista', 'Viajero', 'Aventurero', 'Tranquilo', 'Yoga',
    'Foodie', 'Fiestero', 'Lectura', 'De terraceo', 'Más de noche', 'Más de día',
] as const;

/** Intereses del onboarding (sin Yoga → 2 columnas × 5). */
export const ONBOARDING_AFICIONES_OPTIONS = AFICIONES_OPTIONS.filter((t) => t !== 'Yoga');

export type Aficion = (typeof AFICIONES_OPTIONS)[number];

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

/** Etiqueta de personalidad acorde al género (masculino/femenino). */
export function getPersonalityLabel(
    tag: string,
    genero: string | null | undefined,
    t: TranslateFn,
): string {
    if (genero === 'femenino') {
        const feminine = t(`personality.${tag}.f`);
        if (feminine !== `personality.${tag}.f`) return feminine;
    }
    const label = t(`personality.${tag}`);
    return label !== `personality.${tag}` ? label : tag;
}

/** Todas las personas son femeninas (lista vacía → false). */
export function allFemaleGenero(
    people: Array<{ genero?: string | null } | null | undefined>,
): boolean {
    if (people.length === 0) return false;
    return people.every((p) => p?.genero === 'femenino');
}

export function bothFemaleGenero(
    a: string | null | undefined,
    b: string | null | undefined,
): boolean {
    return a === 'femenino' && b === 'femenino';
}

export interface HabitosConsumo {
    bebida: HabitoConsumo;
    tabaco: HabitoConsumo;
}

export const DEFAULT_HABITOS: HabitosConsumo = {
    bebida: 'no_especificado',
    tabaco: 'no_especificado',
};

export function parseHabitos(raw: unknown): HabitosConsumo {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_HABITOS };
    const o = raw as Record<string, unknown>;
    const bebida = o.bebida as HabitoConsumo;
    const tabaco = o.tabaco as HabitoConsumo;
    return {
        bebida: HABITO_BEBIDA_OPTIONS.includes(bebida) ? bebida : 'no_especificado',
        tabaco: HABITO_TABACO_OPTIONS.includes(tabaco) ? tabaco : 'no_especificado',
    };
}

export function calcAge(fechaNacimiento?: string | null): number | null {
    if (!fechaNacimiento) return null;
    const birth = new Date(fechaNacimiento);
    if (Number.isNaN(birth.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age -= 1;
    return age >= 0 ? age : null;
}

export type MomentsVisibility = 'public' | 'friends' | 'hidden';

export interface ProfilePrivacy {
    mostrar_edad: boolean;
    mostrar_genero: boolean;
    mostrar_bebida: boolean;
    mostrar_tabaco: boolean;
    mostrar_aficiones: boolean;
    mostrar_planes: boolean;
    momentos: MomentsVisibility;
}

export const DEFAULT_PRIVACY: ProfilePrivacy = {
    mostrar_edad: true,
    mostrar_genero: true,
    mostrar_bebida: true,
    mostrar_tabaco: true,
    mostrar_aficiones: true,
    mostrar_planes: true,
    momentos: 'public',
};

export function parsePrivacy(perfilGustos: unknown): ProfilePrivacy {
    if (!perfilGustos || typeof perfilGustos !== 'object') return { ...DEFAULT_PRIVACY };
    const priv = (perfilGustos as Record<string, unknown>).privacidad;
    if (!priv || typeof priv !== 'object') return { ...DEFAULT_PRIVACY };
    const parsed = { ...DEFAULT_PRIVACY, ...(priv as Partial<ProfilePrivacy>) };
    if (parsed.momentos !== 'public' && parsed.momentos !== 'friends' && parsed.momentos !== 'hidden') {
        parsed.momentos = 'public';
    }
    return parsed;
}

export function mergePerfilGustosPrivacy(
    existing: unknown,
    privacy: ProfilePrivacy
): Record<string, unknown> {
    const base =
        existing && typeof existing === 'object' ? { ...(existing as Record<string, unknown>) } : {};
    return { ...base, privacidad: privacy };
}

export function isValidAge(age: number): boolean {
    return Number.isFinite(age) && age >= 18 && age <= 99;
}

export function birthDateFromAge(age: number): string {
    const year = new Date().getFullYear() - age;
    return `${year}-01-01`;
}

type ProfileSearchRow = {
    id: string;
    nombre: string | null;
    nombre_usuario: string | null;
    avatar_url: string | null;
    es_organizador?: boolean | null;
};

const PROFILE_SEARCH_TTL_MS = 60_000;
const PROFILE_SEARCH_CACHE = new Map<string, { at: number; rows: ProfileSearchRow[] }>();

function escapeIlike(value: string): string {
    return value.replace(/[%_,]/g, '');
}

/**
 * Búsqueda rápida por prefijo de nombre visible (usa índices).
 * `deep: true` amplía con contains (más lento; solo si el usuario sigue escribiendo poco).
 */
export async function searchProfilesByName(
    query: string,
    excludeUserId?: string,
    opts?: { deep?: boolean },
) {
    const raw = escapeIlike(query.trim()).slice(0, 40);
    if (raw.length < 2) return [];

    const deep = !!opts?.deep;
    const cacheKey = `${raw.toLowerCase()}|${excludeUserId ?? ''}|${deep ? 'd' : 'f'}`;
    const cached = PROFILE_SEARCH_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.at < PROFILE_SEARCH_TTL_MS) {
        return cached.rows;
    }

    const select = 'id, nombre, nombre_usuario, avatar_url, es_organizador';
    let byName = supabase
        .from('perfiles')
        .select(select)
        .ilike('nombre', `${raw}%`)
        .limit(20);
    if (excludeUserId) byName = byName.neq('id', excludeUserId);

    const settled = [await byName];
    for (const res of settled) {
        if (res.error) throw res.error;
    }

    const byId = new Map<string, ProfileSearchRow>();
    for (const res of settled) {
        for (const row of res.data ?? []) {
            if (row?.id) byId.set(row.id as string, row as ProfileSearchRow);
        }
    }

    if (deep && byId.size < 8 && raw.length >= 3) {
        let contains = supabase
            .from('perfiles')
            .select(select)
            .ilike('nombre', `%${raw}%`)
            .limit(12);
        if (excludeUserId) contains = contains.neq('id', excludeUserId);
        const more = await contains;
        if (!more.error) {
            for (const row of more.data ?? []) {
                if (row?.id) byId.set(row.id as string, row as ProfileSearchRow);
            }
        }
    }

    const needle = raw.toLowerCase();
    const list = [...byId.values()];
    list.sort((a, b) => {
        const an = (a.nombre ?? '').toLowerCase();
        const bn = (b.nombre ?? '').toLowerCase();
        const score = (n: string) => {
            if (n === needle) return 0;
            if (n.startsWith(needle)) return 1;
            return 2;
        };
        const sa = score(an);
        const sb = score(bn);
        if (sa !== sb) return sa - sb;
        return an.localeCompare(bn);
    });
    const rows = list.slice(0, 25);
    PROFILE_SEARCH_CACHE.set(cacheKey, { at: Date.now(), rows });
    if (deep) {
        PROFILE_SEARCH_CACHE.set(
            `${raw.toLowerCase()}|${excludeUserId ?? ''}|f`,
            { at: Date.now(), rows },
        );
    }
    return rows;
}

/** @deprecated Usar searchProfilesByName */
export const searchProfilesByUsername = searchProfilesByName;

const DIRECTORY_PAGE = 80;

/** Directorio público paginado: personas o comunidades, ordenado por nombre. */
export async function listPublicDirectory(opts: {
    organizers: boolean;
    excludeUserId?: string;
    offset?: number;
    limit?: number;
}): Promise<ProfileSearchRow[]> {
    const limit = Math.min(120, Math.max(20, opts.limit ?? DIRECTORY_PAGE));
    const offset = Math.max(0, opts.offset ?? 0);
    let q = supabase
        .from('perfiles')
        .select('id, nombre, nombre_usuario, avatar_url, es_organizador')
        .eq('es_organizador', opts.organizers)
        .not('nombre', 'is', null)
        .order('nombre', { ascending: true })
        .range(offset, offset + limit - 1);
    if (opts.excludeUserId) q = q.neq('id', opts.excludeUserId);
    const { data, error } = await q;
    if (error) throw error;
    return ((data ?? []) as ProfileSearchRow[]).filter((row) => (row.nombre ?? '').trim().length > 0);
}

async function fetchProfilesByOrderedIds(ids: string[]): Promise<ProfileSearchRow[]> {
    if (!ids.length) return [];
    const { data, error } = await supabase
        .from('perfiles')
        .select('id, nombre, nombre_usuario, avatar_url, es_organizador')
        .in('id', ids);
    if (error || !data) return [];
    const byId = new Map((data as ProfileSearchRow[]).map((row) => [row.id, row]));
    return ids
        .map((id) => byId.get(id))
        .filter((row): row is ProfileSearchRow => !!row && (row.nombre ?? '').trim().length > 0);
}

/**
 * Personas + comunidades juntas, priorizando:
 * amigos → amigos de amigos → conocidos → comunidades seguidas → resto (por nombre).
 */
export async function listBrowseDirectory(opts: {
    userId?: string | null;
    excludeUserId?: string;
    offset?: number;
    limit?: number;
}): Promise<ProfileSearchRow[]> {
    const limit = Math.min(120, Math.max(20, opts.limit ?? DIRECTORY_PAGE));
    const offset = Math.max(0, opts.offset ?? 0);
    const excludeUserId = opts.excludeUserId;

    let priority: ProfileSearchRow[] = [];
    if (opts.userId && offset === 0) {
        const { getFriendIds, getFriendOfFriendIds } = await import('./friends');
        const { getCoincidedUserIds } = await import('./coincidences');
        const friendIds = await getFriendIds(opts.userId);
        const [fofIds, coincidedIds, followsRes] = await Promise.all([
            getFriendOfFriendIds(opts.userId, friendIds),
            getCoincidedUserIds(opts.userId),
            supabase.from('seguidores').select('organizador_id').eq('seguidor_id', opts.userId),
        ]);
        const followedOrgIds = ((followsRes.data ?? []) as Array<{ organizador_id: string }>)
            .map((r) => r.organizador_id)
            .filter(Boolean);
        const orderedIds: string[] = [];
        const seen = new Set<string>();
        if (excludeUserId) seen.add(excludeUserId);
        const push = (ids: Iterable<string>) => {
            for (const id of ids) {
                if (!id || seen.has(id)) continue;
                seen.add(id);
                orderedIds.push(id);
            }
        };
        push(friendIds);
        push(fofIds);
        push(coincidedIds);
        push(followedOrgIds);
        priority = await fetchProfilesByOrderedIds(orderedIds.slice(0, 160));
    }

    const half = Math.ceil(limit / 2);
    const [people, orgs] = await Promise.all([
        listPublicDirectory({ organizers: false, excludeUserId, offset, limit: half }),
        listPublicDirectory({ organizers: true, excludeUserId, offset, limit: half }),
    ]);
    const rest = [...people, ...orgs].sort((a, b) =>
        (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }),
    );
    if (offset > 0) return rest.slice(0, limit);

    const seen = new Set(priority.map((p) => p.id));
    const merged = [...priority, ...rest.filter((r) => !seen.has(r.id))];
    return merged.slice(0, Math.max(limit, priority.length));
}

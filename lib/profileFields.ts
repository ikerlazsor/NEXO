import { normalizeUsername } from './profile';
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

export interface ProfilePrivacy {
    mostrar_edad: boolean;
    mostrar_genero: boolean;
    mostrar_bebida: boolean;
    mostrar_tabaco: boolean;
    mostrar_aficiones: boolean;
}

export const DEFAULT_PRIVACY: ProfilePrivacy = {
    mostrar_edad: true,
    mostrar_genero: true,
    mostrar_bebida: true,
    mostrar_tabaco: true,
    mostrar_aficiones: true,
};

export function parsePrivacy(perfilGustos: unknown): ProfilePrivacy {
    if (!perfilGustos || typeof perfilGustos !== 'object') return { ...DEFAULT_PRIVACY };
    const priv = (perfilGustos as Record<string, unknown>).privacidad;
    if (!priv || typeof priv !== 'object') return { ...DEFAULT_PRIVACY };
    return { ...DEFAULT_PRIVACY, ...(priv as Partial<ProfilePrivacy>) };
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
};

const PROFILE_SEARCH_TTL_MS = 60_000;
const PROFILE_SEARCH_CACHE = new Map<string, { at: number; rows: ProfileSearchRow[] }>();

function escapeIlike(value: string): string {
    return value.replace(/[%_,]/g, '');
}

/**
 * Búsqueda rápida por prefijo (usa índices). Evita `%…%` en el camino caliente.
 * `deep: true` amplía con contains (más lento; solo si el usuario sigue escribiendo poco).
 */
export async function searchProfilesByUsername(
    query: string,
    excludeUserId?: string,
    opts?: { deep?: boolean },
) {
    const raw = escapeIlike(query.trim().replace(/^@+/, '')).slice(0, 40);
    if (raw.length < 2) return [];

    const handle = normalizeUsername(raw);
    const deep = !!opts?.deep;
    const cacheKey = `${handle}|${raw.toLowerCase()}|${excludeUserId ?? ''}|${deep ? 'd' : 'f'}`;
    const cached = PROFILE_SEARCH_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.at < PROFILE_SEARCH_TTL_MS) {
        return cached.rows;
    }

    const select = 'id, nombre, nombre_usuario, avatar_url';
    // Prefijos en paralelo (2 queries indexadas) — más fiable que `.or()` con comodines.
    const requests = [];
    if (handle.length >= 2) {
        let byHandle = supabase
            .from('perfiles')
            .select(select)
            .ilike('nombre_usuario', `${handle}%`)
            .limit(20);
        if (excludeUserId) byHandle = byHandle.neq('id', excludeUserId);
        requests.push(byHandle);
    }
    if (raw.length >= 2) {
        let byName = supabase
            .from('perfiles')
            .select(select)
            .ilike('nombre', `${raw}%`)
            .limit(20);
        if (excludeUserId) byName = byName.neq('id', excludeUserId);
        requests.push(byName);
    }
    if (requests.length === 0) return [];

    const settled = await Promise.all(requests);
    for (const res of settled) {
        if (res.error) throw res.error;
    }

    const byId = new Map<string, ProfileSearchRow>();
    for (const res of settled) {
        for (const row of res.data ?? []) {
            if (row?.id) byId.set(row.id as string, row as ProfileSearchRow);
        }
    }

    // Contains solo bajo demanda (muy lento en tablas grandes).
    if (deep && byId.size < 8 && handle.length >= 3) {
        const fallbacks = [
            (() => {
                let q = supabase
                    .from('perfiles')
                    .select(select)
                    .ilike('nombre_usuario', `%${handle}%`)
                    .limit(12);
                if (excludeUserId) q = q.neq('id', excludeUserId);
                return q;
            })(),
            (() => {
                let q = supabase
                    .from('perfiles')
                    .select(select)
                    .ilike('nombre', `%${raw}%`)
                    .limit(12);
                if (excludeUserId) q = q.neq('id', excludeUserId);
                return q;
            })(),
        ];
        const more = await Promise.all(fallbacks);
        for (const res of more) {
            if (res.error) continue;
            for (const row of res.data ?? []) {
                if (row?.id) byId.set(row.id as string, row as ProfileSearchRow);
            }
        }
    }

    const list = [...byId.values()];
    list.sort((a, b) => {
        const ah = (a.nombre_usuario ?? '').toLowerCase();
        const bh = (b.nombre_usuario ?? '').toLowerCase();
        const an = (a.nombre ?? '').toLowerCase();
        const bn = (b.nombre ?? '').toLowerCase();
        const score = (h: string, n: string) => {
            if (h === handle) return 0;
            if (h.startsWith(handle)) return 1;
            if (n.startsWith(raw.toLowerCase())) return 2;
            return 3;
        };
        const sa = score(ah, an);
        const sb = score(bh, bn);
        if (sa !== sb) return sa - sb;
        return ah.localeCompare(bh);
    });
    const rows = list.slice(0, 25);
    PROFILE_SEARCH_CACHE.set(cacheKey, { at: Date.now(), rows });
    // También cachea el resultado fast aunque viniera de deep, para teclear atrás.
    if (deep) {
        PROFILE_SEARCH_CACHE.set(
            `${handle}|${raw.toLowerCase()}|${excludeUserId ?? ''}|f`,
            { at: Date.now(), rows },
        );
    }
    return rows;
}

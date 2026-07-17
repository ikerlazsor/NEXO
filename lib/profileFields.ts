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

export async function searchProfilesByUsername(query: string, excludeUserId?: string) {
    const { supabase } = await import('./supabase');
    const normalized = query.trim();
    if (normalized.length < 2) return [];

    let q = supabase
        .from('perfiles')
        .select('id, nombre, nombre_usuario, avatar_url')
        .or(`nombre_usuario.ilike.%${normalized}%,nombre.ilike.%${normalized}%`)
        .limit(12);

    if (excludeUserId) q = q.neq('id', excludeUserId);

    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
}

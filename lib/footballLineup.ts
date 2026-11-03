import { getAuthUser } from './auth';
import { supabase } from './supabase';

/** Formatos de UI (incluye fútbol sala). */
export type FootballFormat = '5v5' | '6v6' | '7v7' | '8v8' | '9v9' | '10v10' | '11v11' | 'sala';

/** Formatos que entiende el RPC de alineación (sin `sala`). */
export type FootballStoredFormat =
    | '2v2'
    | '5v5'
    | '6v6'
    | '7v7'
    | '8v8'
    | '9v9'
    | '10v10'
    | '11v11';

export type PitchSlot = { x: number; y: number };

export type FootballTeam = {
    nombre: string;
    color: string;
};

export type FootballConfig = {
    /** Siempre un formato NxN válido en backend. Fútbol sala = 5v5 + pista:'sala'. */
    formato: FootballStoredFormat;
    pista?: 'sala';
    equipos: [FootballTeam, FootballTeam];
};

export type FootballOccupant = {
    /** 0|1 en partido; 0..N-1 en torneo. */
    equipo: number;
    posicion: number;
    usuario_id: string;
};

export const FOOTBALL_FORMATS: FootballFormat[] = [
    '5v5',
    'sala',
    '6v6',
    '7v7',
    '8v8',
    '9v9',
    '10v10',
    '11v11',
];

export const TEAM_COLORS = [
    '#FFFFFF',
    '#111111',
    '#DC2626',
    '#2563EB',
    '#16A34A',
    '#F59E0B',
    '#7C3AED',
    '#EC4899',
    '#0EA5E9',
    '#84CC16',
    '#F97316',
    '#14B8A6',
    '#EF4444',
    '#6366F1',
    '#A855F7',
    '#64748B',
];

const LAYOUTS: Record<FootballStoredFormat | 'sala', PitchSlot[]> = {
    /** Pádel 2v2: pareja izquierda / derecha. */
    '2v2': [
        { x: 0.32, y: 0.26 },
        { x: 0.68, y: 0.26 },
    ],
    '5v5': [
        { x: 0.5, y: 0.08 },
        { x: 0.28, y: 0.22 },
        { x: 0.72, y: 0.22 },
        { x: 0.5, y: 0.28 },
        { x: 0.5, y: 0.405 },
    ],
    sala: [
        { x: 0.5, y: 0.12 },
        { x: 0.26, y: 0.24 },
        { x: 0.74, y: 0.24 },
        { x: 0.34, y: 0.38 },
        { x: 0.66, y: 0.38 },
    ],
    '6v6': [
        { x: 0.5, y: 0.07 },
        { x: 0.3, y: 0.2 },
        { x: 0.7, y: 0.2 },
        { x: 0.28, y: 0.33 },
        { x: 0.72, y: 0.33 },
        { x: 0.5, y: 0.39 },
    ],
    '7v7': [
        { x: 0.5, y: 0.07 },
        { x: 0.3, y: 0.19 },
        { x: 0.7, y: 0.19 },
        { x: 0.22, y: 0.32 },
        { x: 0.5, y: 0.3139 },
        { x: 0.78, y: 0.32 },
        { x: 0.5, y: 0.4339 },
    ],
    '8v8': [
        // 1-3-2-2
        { x: 0.5, y: 0.07 },
        { x: 0.22, y: 0.20 },
        { x: 0.5, y: 0.20 },
        { x: 0.78, y: 0.20 },
        { x: 0.32, y: 0.31 },
        { x: 0.68, y: 0.31 },
        { x: 0.34, y: 0.42 },
        { x: 0.66, y: 0.42 },
    ],
    '9v9': [
        { x: 0.5, y: 0.07 },
        { x: 0.22, y: 0.18 },
        { x: 0.5, y: 0.18 },
        { x: 0.78, y: 0.18 },
        { x: 0.22, y: 0.31 },
        { x: 0.5, y: 0.31 },
        { x: 0.78, y: 0.31 },
        { x: 0.34, y: 0.43 },
        { x: 0.66, y: 0.43 },
    ],
    '10v10': [
        { x: 0.5, y: 0.07 },
        { x: 0.16, y: 0.18 },
        { x: 0.38, y: 0.18 },
        { x: 0.62, y: 0.18 },
        { x: 0.84, y: 0.18 },
        { x: 0.22, y: 0.31 },
        { x: 0.5, y: 0.31 },
        { x: 0.78, y: 0.31 },
        { x: 0.34, y: 0.43 },
        { x: 0.66, y: 0.43 },
    ],
    '11v11': [
        { x: 0.5, y: 0.07 },
        { x: 0.16, y: 0.18 },
        { x: 0.38, y: 0.18 },
        { x: 0.62, y: 0.18 },
        { x: 0.84, y: 0.18 },
        { x: 0.22, y: 0.31 },
        { x: 0.5, y: 0.31 },
        { x: 0.78, y: 0.31 },
        { x: 0.22, y: 0.43 },
        { x: 0.5, y: 0.43 },
        { x: 0.78, y: 0.43 },
    ],
};

const STORED_FORMATS: FootballStoredFormat[] = [
    '2v2',
    '5v5',
    '6v6',
    '7v7',
    '8v8',
    '9v9',
    '10v10',
    '11v11',
];

export function isFutsalConfig(config: Pick<FootballConfig, 'formato' | 'pista'>): boolean {
    return config.pista === 'sala';
}

export function uiFormatFromConfig(config: Pick<FootballConfig, 'formato' | 'pista'>): FootballFormat {
    if (isFutsalConfig(config)) return 'sala';
    // 2v2 es pádel; no se muestra en el selector de fútbol
    if (config.formato === '2v2') return '5v5';
    return config.formato;
}

export function formatPlayersPerSide(formato: FootballFormat): number {
    if (formato === 'sala') return 5;
    return parseInt(formato, 10);
}

export function formatDisplayLabel(formato: FootballFormat): string {
    if (formato === 'sala') return 'Fútbol sala';
    return formato;
}

export function minPeopleForFormat(formato: FootballFormat): number {
    return formatPlayersPerSide(formato) * 2;
}

export function formatsForMaxPeople(maxPeople: number): FootballFormat[] {
    return FOOTBALL_FORMATS.filter((formato) => minPeopleForFormat(formato) <= maxPeople);
}

export function defaultPadelConfig(): FootballConfig {
    return {
        formato: '2v2',
        equipos: [
            { nombre: 'Equipo A', color: '#FFFFFF' },
            { nombre: 'Equipo B', color: '#111111' },
        ],
    };
}

export function isPadelConfig(config: Pick<FootballConfig, 'formato'>): boolean {
    return config.formato === '2v2';
}

export function defaultFootballConfig(formato: FootballFormat): FootballConfig {
    const equipos: FootballConfig['equipos'] = [
        { nombre: 'Equipo A', color: '#FFFFFF' },
        { nombre: 'Equipo B', color: '#111111' },
    ];
    if (formato === 'sala') {
        return { formato: '5v5', pista: 'sala', equipos };
    }
    return { formato, equipos };
}

export function configWithUiFormat(
    formato: FootballFormat,
    prev: FootballConfig | null,
): FootballConfig {
    const equipos = prev?.equipos ?? defaultFootballConfig(formato).equipos;
    if (formato === 'sala') {
        return { formato: '5v5', pista: 'sala', equipos };
    }
    return { formato, equipos };
}

export function parseFootballConfig(raw: unknown): FootballConfig | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    // Torneo: lo gestiona footballTournament.ts (no forzar 2 equipos).
    if (o.modo === 'torneo') return null;
    const rawFmt = o.formato;
    if (typeof rawFmt !== 'string') return null;

    let formato: FootballStoredFormat;
    let pista: 'sala' | undefined;
    if (rawFmt === 'sala' || o.pista === 'sala') {
        formato = '5v5';
        pista = 'sala';
    } else if (STORED_FORMATS.includes(rawFmt as FootballStoredFormat)) {
        formato = rawFmt as FootballStoredFormat;
    } else {
        return null;
    }

    const equipos = Array.isArray(o.equipos) ? o.equipos : [];
    const a = equipos[0] && typeof equipos[0] === 'object' ? (equipos[0] as Record<string, unknown>) : {};
    const b = equipos[1] && typeof equipos[1] === 'object' ? (equipos[1] as Record<string, unknown>) : {};
    return {
        formato,
        ...(pista ? { pista } : {}),
        equipos: [
            {
                nombre: typeof a.nombre === 'string' && a.nombre.trim() ? a.nombre.trim() : 'Equipo A',
                color: typeof a.color === 'string' && a.color ? a.color : '#FFFFFF',
            },
            {
                nombre: typeof b.nombre === 'string' && b.nombre.trim() ? b.nombre.trim() : 'Equipo B',
                color: typeof b.color === 'string' && b.color ? b.color : '#111111',
            },
        ],
    };
}

/** Payload seguro para el RPC (nunca envía formato "sala"). */
export function toPersistedAlineacion(config: FootballConfig): FootballConfig {
    if (config.pista === 'sala') {
        return {
            formato: '5v5',
            pista: 'sala',
            equipos: config.equipos,
        };
    }
    return {
        formato: config.formato,
        equipos: config.equipos,
    };
}

export function slotPositions(
    config: Pick<FootballConfig, 'formato' | 'pista'>,
    equipo: 0 | 1,
): PitchSlot[] {
    const futsal = isFutsalConfig(config);
    const key = futsal ? 'sala' : config.formato;
    const base = LAYOUTS[key];
    if (!base?.length) return [];
    if (equipo === 0) {
        // Fútbol sala: portero de arriba un pelín más atrasado (hacia su portería).
        if (futsal) {
            return base.map((slot, i) =>
                i === 0 ? { x: slot.x, y: Math.max(0.04, slot.y - 0.02) } : slot,
            );
        }
        return base;
    }
    return base.map((slot, i) => {
        let y = 1 - slot.y;
        // Resto de formatos de fútbol: portero de abajo un pelín más adelantado.
        if (!futsal && config.formato !== '2v2' && i === 0) {
            y = Math.min(0.96, y - 0.012);
        }
        return { x: slot.x, y };
    });
}

export async function fetchFootballConfig(planId: string): Promise<FootballConfig | null> {
    const { data, error } = await supabase
        .from('planes')
        .select('alineacion')
        .eq('id', planId)
        .maybeSingle();
    if (error || !data) return null;
    return parseFootballConfig((data as { alineacion?: unknown }).alineacion);
}

export async function fetchFootballSlots(planId: string): Promise<FootballOccupant[]> {
    const { data, error } = await supabase
        .from('alineaciones')
        .select('equipo, posicion, usuario_id')
        .eq('plan_id', planId);
    if (error || !data) return [];
    return (data as Array<{ equipo: number; posicion: number; usuario_id: string }>).map((row) => ({
        equipo: Math.max(0, Number(row.equipo) || 0),
        posicion: Number(row.posicion) || 0,
        usuario_id: row.usuario_id,
    }));
}

export async function saveFootballConfig(
    planId: string,
    config: FootballConfig,
): Promise<{ error: string | null }> {
    const payload = toPersistedAlineacion(config);
    const { error } = await supabase.rpc('set_plan_alineacion', {
        p_plan_id: planId,
        p_alineacion: payload,
    });
    if (!error) return { error: null };
    const fallback = await supabase
        .from('planes')
        .update({ alineacion: payload } as never)
        .eq('id', planId);
    return { error: fallback.error?.message ?? error.message };
}

/** Quita la alineación del plan (solo creador). Deja de verse para todo el mundo. */
export async function clearFootballConfig(planId: string): Promise<{ error: string | null }> {
    const { error } = await supabase.rpc('set_plan_alineacion', {
        p_plan_id: planId,
        p_alineacion: null,
    });
    if (!error) return { error: null };
    const cleared = await supabase
        .from('planes')
        .update({ alineacion: null } as never)
        .eq('id', planId);
    if (cleared.error) return { error: cleared.error.message ?? error.message };
    await supabase.from('alineaciones').delete().eq('plan_id', planId);
    return { error: null };
}

export async function claimFootballSlot(
    planId: string,
    equipo: number,
    posicion: number,
): Promise<{ error: string | null }> {
    const { error } = await supabase.rpc('claim_alineacion_slot', {
        p_plan_id: planId,
        p_equipo: Math.max(0, Math.floor(equipo)),
        p_posicion: Math.max(0, Math.floor(posicion)),
    });
    return { error: error?.message ?? null };
}

export async function releaseFootballSlot(planId: string): Promise<{ error: string | null }> {
    const { error } = await supabase.rpc('release_alineacion_slot', {
        p_plan_id: planId,
    });
    if (!error) return { error: null };
    const user = await getAuthUser();
    const uid = user?.id;
    if (!uid) return { error: error.message };
    const fallback = await supabase
        .from('alineaciones')
        .delete()
        .eq('plan_id', planId)
        .eq('usuario_id', uid);
    return { error: fallback.error?.message ?? error.message };
}

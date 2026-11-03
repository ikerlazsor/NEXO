import { getAuthUser } from './auth';
import {
    TEAM_COLORS,
    claimFootballSlot,
    formatPlayersPerSide,
    parseFootballConfig,
    slotPositions,
    toPersistedAlineacion,
    type FootballConfig,
    type FootballFormat,
    type FootballOccupant,
    type FootballStoredFormat,
    type FootballTeam,
    type PitchSlot,
} from './footballLineup';
import { planShareUrl } from './shareLinks';
import { supabase } from './supabase';

export const TOURNAMENT_TEAM_MIN = 3;
export const TOURNAMENT_TEAM_MAX = 16;
export const DEFAULT_TOURNAMENT_BENCH = 5;
export const DEFAULT_TOURNAMENT_TEAMS = 7;
export const DEFAULT_TOURNAMENT_AFICION = 15;
export const DEFAULT_TOURNAMENT_ULTRAS = 4;

export type TournamentTeam = FootballTeam & {
    capitan_id?: string | null;
};

export type BracketMatch = {
    id: string;
    round: number;
    index: number;
    teamA: number | null;
    teamB: number | null;
    scoreA?: number | null;
    scoreB?: number | null;
    winner?: number | null;
    bye?: boolean;
};

/** Fila de clasificación (liguilla). */
export type LeagueStanding = {
    pts: number;
    pj: number;
    gf: number;
    gc: number;
};

export type TournamentConfig = {
    modo: 'torneo';
    formato: FootballStoredFormat;
    pista?: 'sala';
    banquillo: number;
    /** Plazas de afición (equipo virtual = equipos.length). */
    aficion: number;
    /** Plazas ultras (equipo virtual = equipos.length + 1). */
    ultras: number;
    equipos: TournamentTeam[];
    /** Clasificación de liguilla (una fila por equipo). */
    clasificacion: LeagueStanding[];
    /** Legacy knockout (ya no se muestra; se conserva al persistir). */
    bracket: BracketMatch[];
};

/** Índice de “equipo” para afición en alineaciones. */
export function aficionTeamIndex(config: Pick<TournamentConfig, 'equipos'>): number {
    return config.equipos.length;
}

export function ultrasTeamIndex(config: Pick<TournamentConfig, 'equipos'>): number {
    return config.equipos.length + 1;
}

export function isAficionTeam(config: Pick<TournamentConfig, 'equipos'>, equipo: number): boolean {
    return equipo === aficionTeamIndex(config);
}

export function isUltrasTeam(config: Pick<TournamentConfig, 'equipos'>, equipo: number): boolean {
    return equipo === ultrasTeamIndex(config);
}

export function isFansTeam(config: Pick<TournamentConfig, 'equipos'>, equipo: number): boolean {
    return isAficionTeam(config, equipo) || isUltrasTeam(config, equipo);
}

export function defaultStandings(teamCount: number): LeagueStanding[] {
    return Array.from({ length: teamCount }, () => ({ pts: 0, pj: 0, gf: 0, gc: 0 }));
}

function clampStat(n: unknown): number {
    const v = Number(n);
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(999, Math.floor(v)));
}

export function parseStandings(raw: unknown, teamCount: number): LeagueStanding[] {
    const base = defaultStandings(teamCount);
    if (!Array.isArray(raw)) return base;
    return base.map((row, i) => {
        const o = raw[i] && typeof raw[i] === 'object' ? (raw[i] as Record<string, unknown>) : {};
        return {
            pts: clampStat(o.pts),
            pj: clampStat(o.pj),
            gf: clampStat(o.gf),
            gc: clampStat(o.gc),
        };
    });
}

export function updateStanding(
    config: TournamentConfig,
    equipo: number,
    patch: Partial<LeagueStanding>,
): TournamentConfig {
    if (equipo < 0 || equipo >= config.equipos.length) return config;
    const clasificacion = config.clasificacion.map((row, i) =>
        i === equipo
            ? {
                  pts: patch.pts != null ? clampStat(patch.pts) : row.pts,
                  pj: patch.pj != null ? clampStat(patch.pj) : row.pj,
                  gf: patch.gf != null ? clampStat(patch.gf) : row.gf,
                  gc: patch.gc != null ? clampStat(patch.gc) : row.gc,
              }
            : row,
    );
    return { ...config, clasificacion };
}

export function isTournamentConfig(raw: unknown): raw is TournamentConfig {
    if (!raw || typeof raw !== 'object') return false;
    return (raw as { modo?: string }).modo === 'torneo';
}

export function defaultTeamNames(count: number): string[] {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    return Array.from({ length: count }, (_, i) => {
        if (i < letters.length) return `Clase ${letters[i]}`;
        return `Equipo ${i + 1}`;
    });
}

export function tournamentCapacity(
    formato: FootballFormat,
    teams: number,
    bench: number,
    aficion = DEFAULT_TOURNAMENT_AFICION,
    ultras = DEFAULT_TOURNAMENT_ULTRAS,
): number {
    return (
        teams * (formatPlayersPerSide(formato) + Math.max(0, bench)) +
        Math.max(0, aficion) +
        Math.max(0, ultras)
    );
}

export function buildEmptyBracket(teamCount: number): BracketMatch[] {
    const size = Math.max(2, 2 ** Math.ceil(Math.log2(Math.max(2, teamCount))));
    const seeds: Array<number | null> = Array.from({ length: size }, (_, i) =>
        i < teamCount ? i : null,
    );
    // Emparejar 0vsúltimo, 1vspenúltimo… (byes al final).
    const round0: BracketMatch[] = [];
    for (let i = 0; i < size / 2; i += 1) {
        const a = seeds[i] ?? null;
        const b = seeds[size - 1 - i] ?? null;
        const id = `r0-m${i}`;
        if (a != null && b == null) {
            round0.push({
                id,
                round: 0,
                index: i,
                teamA: a,
                teamB: null,
                winner: a,
                bye: true,
            });
        } else if (a == null && b != null) {
            round0.push({
                id,
                round: 0,
                index: i,
                teamA: b,
                teamB: null,
                winner: b,
                bye: true,
            });
        } else {
            round0.push({
                id,
                round: 0,
                index: i,
                teamA: a,
                teamB: b,
                bye: false,
            });
        }
    }

    const matches: BracketMatch[] = [...round0];
    let prevRound = round0;
    let round = 1;
    while (prevRound.length > 1) {
        const next: BracketMatch[] = [];
        for (let i = 0; i < prevRound.length; i += 2) {
            const left = prevRound[i];
            const right = prevRound[i + 1];
            const teamA = left.winner ?? null;
            const teamB = right?.winner ?? null;
            const m: BracketMatch = {
                id: `r${round}-m${i / 2}`,
                round,
                index: i / 2,
                teamA,
                teamB,
                bye: false,
            };
            if (teamA != null && teamB == null) {
                m.winner = teamA;
                m.bye = true;
            } else if (teamB != null && teamA == null) {
                m.winner = teamB;
                m.bye = true;
            }
            next.push(m);
            matches.push(m);
        }
        prevRound = next;
        round += 1;
    }
    return matches;
}

function parseTeam(raw: unknown, fallbackName: string, color: string): TournamentTeam {
    const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    return {
        nombre: typeof o.nombre === 'string' && o.nombre.trim() ? o.nombre.trim() : fallbackName,
        color: typeof o.color === 'string' && o.color ? o.color : color,
        capitan_id: typeof o.capitan_id === 'string' && o.capitan_id ? o.capitan_id : null,
    };
}

function parseBracket(raw: unknown, teamCount: number): BracketMatch[] {
    if (!Array.isArray(raw) || raw.length === 0) return buildEmptyBracket(teamCount);
    const out: BracketMatch[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        if (typeof o.id !== 'string') continue;
        out.push({
            id: o.id,
            round: Number(o.round) || 0,
            index: Number(o.index) || 0,
            teamA: typeof o.teamA === 'number' ? o.teamA : o.teamA == null ? null : Number(o.teamA),
            teamB: typeof o.teamB === 'number' ? o.teamB : o.teamB == null ? null : Number(o.teamB),
            scoreA: typeof o.scoreA === 'number' ? o.scoreA : null,
            scoreB: typeof o.scoreB === 'number' ? o.scoreB : null,
            winner: typeof o.winner === 'number' ? o.winner : o.winner == null ? null : Number(o.winner),
            bye: !!o.bye,
        });
    }
    return out.length ? out : buildEmptyBracket(teamCount);
}

export function parseTournamentConfig(raw: unknown): TournamentConfig | null {
    if (!isTournamentConfig(raw)) return null;
    const o = raw as Record<string, unknown>;
    const base = parseFootballConfig({
        formato: o.formato,
        pista: o.pista,
        equipos: Array.isArray(o.equipos) ? (o.equipos as unknown[]).slice(0, 2) : undefined,
    });
    if (!base) return null;

    const names = defaultTeamNames(TOURNAMENT_TEAM_MAX);
    const rawTeams = Array.isArray(o.equipos) ? o.equipos : [];
    if (rawTeams.length < TOURNAMENT_TEAM_MIN) return null;
    const equipos = rawTeams.slice(0, TOURNAMENT_TEAM_MAX).map((t, i) =>
        parseTeam(t, names[i] ?? `Equipo ${i + 1}`, TEAM_COLORS[i % TEAM_COLORS.length]),
    );
    const banquillo = Math.max(
        0,
        Math.min(12, Number.isFinite(Number(o.banquillo)) ? Number(o.banquillo) : DEFAULT_TOURNAMENT_BENCH),
    );
    const aficion = Math.max(
        0,
        Math.min(40, Number.isFinite(Number(o.aficion)) ? Number(o.aficion) : DEFAULT_TOURNAMENT_AFICION),
    );
    const ultras = Math.max(
        0,
        Math.min(4, Number.isFinite(Number(o.ultras)) ? Number(o.ultras) : DEFAULT_TOURNAMENT_ULTRAS),
    );
    return {
        modo: 'torneo',
        formato: base.formato,
        ...(base.pista ? { pista: base.pista } : {}),
        banquillo,
        aficion,
        ultras,
        equipos,
        clasificacion: parseStandings(o.clasificacion, equipos.length),
        bracket: parseBracket(o.bracket, equipos.length),
    };
}

export function defaultTournamentConfig(opts?: {
    formato?: FootballFormat;
    teamCount?: number;
    teamNames?: string[];
    banquillo?: number;
}): TournamentConfig {
    const formatoUi = opts?.formato ?? '7v7';
    const count = Math.max(
        TOURNAMENT_TEAM_MIN,
        Math.min(TOURNAMENT_TEAM_MAX, opts?.teamCount ?? DEFAULT_TOURNAMENT_TEAMS),
    );
    const names = opts?.teamNames?.length ? opts.teamNames : defaultTeamNames(count);
    const equipos: TournamentTeam[] = Array.from({ length: count }, (_, i) => ({
        nombre: (names[i] ?? defaultTeamNames(count)[i]).trim() || `Equipo ${i + 1}`,
        color: TEAM_COLORS[i % TEAM_COLORS.length],
        capitan_id: null,
    }));
    const stored =
        formatoUi === 'sala'
            ? ({ formato: '5v5' as const, pista: 'sala' as const })
            : ({ formato: formatoUi as FootballStoredFormat });
    return {
        modo: 'torneo',
        ...stored,
        banquillo: opts?.banquillo ?? DEFAULT_TOURNAMENT_BENCH,
        aficion: DEFAULT_TOURNAMENT_AFICION,
        ultras: DEFAULT_TOURNAMENT_ULTRAS,
        equipos,
        clasificacion: defaultStandings(count),
        bracket: buildEmptyBracket(count),
    };
}

export function toPersistedTournament(config: TournamentConfig): TournamentConfig {
    const base = toPersistedAlineacion({
        formato: config.formato,
        pista: config.pista,
        equipos: [
            config.equipos[0] ?? { nombre: 'Equipo A', color: '#FFFFFF' },
            config.equipos[1] ?? { nombre: 'Equipo B', color: '#111111' },
        ],
    });
    return {
        modo: 'torneo',
        formato: base.formato,
        ...(base.pista ? { pista: base.pista } : {}),
        banquillo: config.banquillo,
        aficion: config.aficion ?? DEFAULT_TOURNAMENT_AFICION,
        ultras: config.ultras ?? DEFAULT_TOURNAMENT_ULTRAS,
        equipos: config.equipos,
        clasificacion:
            config.clasificacion?.length === config.equipos.length
                ? config.clasificacion
                : parseStandings(config.clasificacion, config.equipos.length),
        bracket: config.bracket,
    };
}

export async function fetchTournamentConfig(planId: string): Promise<TournamentConfig | null> {
    const { data, error } = await supabase
        .from('planes')
        .select('alineacion')
        .eq('id', planId)
        .maybeSingle();
    if (error || !data) return null;
    return parseTournamentConfig((data as { alineacion?: unknown }).alineacion);
}

export async function saveTournamentConfig(
    planId: string,
    config: TournamentConfig,
): Promise<{ error: string | null }> {
    const payload = toPersistedTournament(config);
    // Miembros (y creador) pueden parchear nombres/colores/cuadro.
    const patch = await supabase.rpc('patch_tournament_alineacion', {
        p_plan_id: planId,
        p_alineacion: payload as never,
    });
    if (!patch.error) {
        const { seedTournamentLineup } = await import('./tournamentLineupCache');
        seedTournamentLineup(planId, config);
        return { error: null };
    }

    // Fallback creador: set completo (creación / cambio de cupo).
    const { error } = await supabase.rpc('set_plan_alineacion', {
        p_plan_id: planId,
        p_alineacion: payload as never,
    });
    if (!error) {
        const { seedTournamentLineup } = await import('./tournamentLineupCache');
        seedTournamentLineup(planId, config);
        return { error: null };
    }
    return { error: error.message ?? patch.error.message };
}

export async function fetchTournamentSlots(planId: string): Promise<FootballOccupant[]> {
    const { data, error } = await supabase
        .from('alineaciones')
        .select('equipo, posicion, usuario_id')
        .eq('plan_id', planId);
    if (error || !data) return [];
    return (data as Array<{ equipo: number; posicion: number; usuario_id: string }>).map((row) => ({
        equipo: Math.max(0, Number(row.equipo) || 0) as 0 | 1,
        posicion: Number(row.posicion) || 0,
        usuario_id: row.usuario_id,
        // keep numeric equipo via cast — FootballOccupant currently 0|1; we extend below
    }));
}

/** Ocupantes con equipo N (no solo 0/1). */
export type TournamentOccupant = {
    equipo: number;
    posicion: number;
    usuario_id: string;
};

export async function fetchAllLineupSlots(planId: string): Promise<TournamentOccupant[]> {
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

export function startersCount(config: Pick<TournamentConfig, 'formato' | 'pista'>): number {
    if (config.pista === 'sala') return 5;
    return parseInt(config.formato, 10) || 7;
}

export function teamStarterSlots(config: TournamentConfig): PitchSlot[] {
    // Una sola mitad (equipo 0 layout) para la vista por equipo.
    return slotPositions(config, 0);
}

export function firstFreeSlot(
    config: TournamentConfig,
    slots: TournamentOccupant[],
    equipo: number,
): number | null {
    if (isAficionTeam(config, equipo)) {
        return firstFreeFanSlot(config, slots, aficionTeamIndex(config), config.aficion ?? DEFAULT_TOURNAMENT_AFICION);
    }
    if (isUltrasTeam(config, equipo)) {
        return firstFreeFanSlot(config, slots, ultrasTeamIndex(config), config.ultras ?? DEFAULT_TOURNAMENT_ULTRAS);
    }
    const starters = startersCount(config);
    const total = starters + config.banquillo;
    const taken = new Set(
        slots.filter((s) => s.equipo === equipo).map((s) => s.posicion),
    );
    for (let p = 0; p < total; p += 1) {
        if (!taken.has(p)) return p;
    }
    return null;
}

export async function claimTournamentSlot(
    planId: string,
    equipo: number,
    posicion: number,
): Promise<{ error: string | null }> {
    return claimFootballSlot(planId, equipo as 0 | 1, posicion);
}

export async function claimFirstFreeTournamentSlot(
    planId: string,
    equipo: number,
): Promise<{ error: string | null; posicion: number | null }> {
    const config = await fetchTournamentConfig(planId);
    if (!config) return { error: 'no_lineup', posicion: null };
    const slots = await fetchAllLineupSlots(planId);
    const posicion = firstFreeSlot(config, slots, equipo);
    if (posicion == null) return { error: 'team_full', posicion: null };
    const { error } = await claimTournamentSlot(planId, equipo, posicion);
    return { error, posicion: error ? null : posicion };
}

export async function kickTournamentSlot(
    planId: string,
    usuarioId: string,
): Promise<{ error: string | null }> {
    const { error } = await supabase.rpc('kick_alineacion_slot', {
        p_plan_id: planId,
        p_usuario_id: usuarioId,
    });
    if (!error) return { error: null };
    // Fallback: solo puedes borrarte a ti.
    const user = await getAuthUser();
    if (user?.id === usuarioId) {
        const fallback = await supabase
            .from('alineaciones')
            .delete()
            .eq('plan_id', planId)
            .eq('usuario_id', usuarioId);
        return { error: fallback.error?.message ?? null };
    }
    return { error: error.message };
}

function propagateBracket(bracket: BracketMatch[]): BracketMatch[] {
    const byRound = new Map<number, BracketMatch[]>();
    for (const m of bracket) {
        const list = byRound.get(m.round) ?? [];
        list.push(m);
        byRound.set(m.round, list);
    }
    const rounds = [...byRound.keys()].sort((a, b) => a - b);
    for (const r of rounds) {
        const cur = (byRound.get(r) ?? []).sort((a, b) => a.index - b.index);
        const next = (byRound.get(r + 1) ?? []).sort((a, b) => a.index - b.index);
        for (let i = 0; i < cur.length; i += 2) {
            const left = cur[i];
            const right = cur[i + 1];
            const parent = next[Math.floor(i / 2)];
            if (!parent) continue;
            // Ronda 0 se edita a mano; el resto hereda ganadores.
            if (parent.round > 0) {
                parent.teamA = left?.winner ?? null;
                parent.teamB = right?.winner ?? null;
            }
            if (parent.winner != null) {
                if (parent.winner !== parent.teamA && parent.winner !== parent.teamB) {
                    parent.winner = null;
                    parent.scoreA = null;
                    parent.scoreB = null;
                }
            }
            if (parent.teamA != null && parent.teamB == null && parent.round > 0) {
                parent.winner = parent.teamA;
                parent.bye = true;
            } else if (parent.teamB != null && parent.teamA == null && parent.round > 0) {
                parent.winner = parent.teamB;
                parent.bye = true;
            }
        }
    }
    return bracket;
}

/** Cambia emparejamiento de un partido (sobre todo ronda 0). */
export function setMatchPairing(
    config: TournamentConfig,
    matchId: string,
    teamA: number | null,
    teamB: number | null,
): TournamentConfig {
    const bracket = config.bracket.map((m) => {
        if (m.id !== matchId) return { ...m };
        const next: BracketMatch = {
            ...m,
            teamA,
            teamB,
            bye: false,
            winner: null,
            scoreA: null,
            scoreB: null,
        };
        if (teamA != null && teamB == null) {
            next.winner = teamA;
            next.bye = true;
        } else if (teamB != null && teamA == null) {
            next.winner = teamB;
            next.bye = true;
        }
        return next;
    });
    return { ...config, bracket: propagateBracket(bracket) };
}

export function setMatchWinner(
    config: TournamentConfig,
    matchId: string,
    winnerTeam: number,
    scoreA?: number | null,
    scoreB?: number | null,
): TournamentConfig {
    const bracket = config.bracket.map((m) =>
        m.id === matchId
            ? {
                  ...m,
                  winner: winnerTeam,
                  scoreA: scoreA ?? m.scoreA ?? null,
                  scoreB: scoreB ?? m.scoreB ?? null,
                  bye: false,
              }
            : { ...m },
    );
    return { ...config, bracket: propagateBracket(bracket) };
}

/** Guarda marcador; si hay ganador claro por goles, avanza solo. */
export function setMatchScore(
    config: TournamentConfig,
    matchId: string,
    scoreA: number | null,
    scoreB: number | null,
): TournamentConfig {
    const match = config.bracket.find((m) => m.id === matchId);
    if (!match) return config;
    let winner: number | null = match.winner ?? null;
    if (
        scoreA != null &&
        scoreB != null &&
        match.teamA != null &&
        match.teamB != null &&
        scoreA !== scoreB
    ) {
        winner = scoreA > scoreB ? match.teamA : match.teamB;
    }
    if (winner == null) {
        const bracket = config.bracket.map((m) =>
            m.id === matchId
                ? { ...m, scoreA, scoreB, winner: null, bye: false }
                : { ...m },
        );
        return { ...config, bracket: propagateBracket(bracket) };
    }
    return setMatchWinner(config, matchId, winner, scoreA, scoreB);
}

export function teamRegistrationStats(
    config: TournamentConfig,
    slots: TournamentOccupant[],
): Array<{
    equipo: number;
    filled: number;
    capacity: number;
    complete: boolean;
    aficion?: boolean;
    ultras?: boolean;
}> {
    const starters = startersCount(config);
    const capacity = starters + config.banquillo;
    const teams = config.equipos.map((_, equipo) => {
        const filled = slots.filter((s) => s.equipo === equipo).length;
        return {
            equipo,
            filled,
            capacity,
            complete: filled >= starters,
        };
    });
    const afIdx = aficionTeamIndex(config);
    const ulIdx = ultrasTeamIndex(config);
    const afCap = Math.max(0, config.aficion ?? DEFAULT_TOURNAMENT_AFICION);
    const ulCap = Math.max(0, config.ultras ?? DEFAULT_TOURNAMENT_ULTRAS);
    return [
        ...teams,
        {
            equipo: afIdx,
            filled: slots.filter((s) => s.equipo === afIdx).length,
            capacity: afCap,
            complete: false,
            aficion: true,
        },
        {
            equipo: ulIdx,
            filled: slots.filter((s) => s.equipo === ulIdx).length,
            capacity: ulCap,
            complete: false,
            ultras: true,
        },
    ];
}

function firstFreeFanSlot(
    config: TournamentConfig,
    slots: TournamentOccupant[],
    equipo: number,
    capRaw: number,
): number | null {
    const cap = Math.max(0, capRaw);
    const taken = new Set(slots.filter((s) => s.equipo === equipo).map((s) => s.posicion));
    for (let p = 0; p < cap; p += 1) {
        if (!taken.has(p)) return p;
    }
    return null;
}

export function firstFreeAficionSlot(
    config: TournamentConfig,
    slots: TournamentOccupant[],
): number | null {
    return firstFreeFanSlot(
        config,
        slots,
        aficionTeamIndex(config),
        config.aficion ?? DEFAULT_TOURNAMENT_AFICION,
    );
}

/**
 * Hueco de afición: primero ultras (los primeros en unirse), luego afición general.
 */
export function firstFreeFansSlot(
    config: TournamentConfig,
    slots: TournamentOccupant[],
): { equipo: number; posicion: number } | null {
    const ulIdx = ultrasTeamIndex(config);
    const afIdx = aficionTeamIndex(config);
    const ulPos = firstFreeFanSlot(
        config,
        slots,
        ulIdx,
        config.ultras ?? DEFAULT_TOURNAMENT_ULTRAS,
    );
    if (ulPos != null) return { equipo: ulIdx, posicion: ulPos };
    const afPos = firstFreeFanSlot(
        config,
        slots,
        afIdx,
        config.aficion ?? DEFAULT_TOURNAMENT_AFICION,
    );
    if (afPos != null) return { equipo: afIdx, posicion: afPos };
    return null;
}

export function fansFilledCount(config: TournamentConfig, slots: TournamentOccupant[]): number {
    const afIdx = aficionTeamIndex(config);
    const ulIdx = ultrasTeamIndex(config);
    return slots.filter((s) => s.equipo === afIdx || s.equipo === ulIdx).length;
}

export function fansCapacity(config: TournamentConfig): number {
    return (
        Math.max(0, config.aficion ?? DEFAULT_TOURNAMENT_AFICION) +
        Math.max(0, config.ultras ?? DEFAULT_TOURNAMENT_ULTRAS)
    );
}

export function tournamentTeamShareUrl(planId: string, teamIndex: number): string {
    return planShareUrl(planId, { team: teamIndex });
}

/** Equipo con más burbujas ocupadas (para imagen de share general). */
export function fullestTeamIndex(
    config: Pick<TournamentConfig, 'equipos'>,
    slots: TournamentOccupant[],
): number {
    let best = 0;
    let bestCount = -1;
    for (let i = 0; i < config.equipos.length; i += 1) {
        const n = slots.filter((s) => s.equipo === i).length;
        if (n > bestCount) {
            bestCount = n;
            best = i;
        }
    }
    return best;
}

/** Compat: FootballConfig | TournamentConfig desde alineacion cruda. */
export function parseAnyFootballAlineacion(
    raw: unknown,
): { kind: 'torneo'; config: TournamentConfig } | { kind: 'partido'; config: FootballConfig } | null {
    const torneo = parseTournamentConfig(raw);
    if (torneo) return { kind: 'torneo', config: torneo };
    const partido = parseFootballConfig(raw);
    if (partido) return { kind: 'partido', config: partido };
    return null;
}

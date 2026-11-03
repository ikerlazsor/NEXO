import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

type IonName = ComponentProps<typeof Ionicons>['name'];

export type TeamVibe = { text: string; icon: IonName };

/** 0 fichajes */
const VIBES_EMPTY: TeamVibe[] = [
    { text: 'Equipo en construcción', icon: 'construct-outline' },
    { text: 'Silencio en el vestuario', icon: 'volume-mute-outline' },
];

/** Exactamente 1 */
const VIBES_ONE: TeamVibe[] = [
    { text: 'Un héroe busca aliados', icon: 'people-outline' },
    { text: 'Uno y pidiendo equipo', icon: 'hand-left-outline' },
];

/** Exactamente 2 */
const VIBES_TWO: TeamVibe[] = [
    { text: '¡Dos fichajes nuevos!', icon: 'flame' },
    { text: 'Empieza la peña', icon: 'sparkles' },
];

/** Casi lleno (≥85% o 1 plaza libre) */
const VIBES_ALMOST: TeamVibe[] = [
    { text: 'Plazas casi llenas', icon: 'alert-circle-outline' },
    { text: 'Queda poquito…', icon: 'time-outline' },
];

/** 3+ con hueco */
const VIBES_MANY: TeamVibe[] = [
    { text: 'La afición ya grita', icon: 'megaphone-outline' },
    { text: 'Vienen a comerse la liga', icon: 'flash' },
    { text: 'Llegan con hambre', icon: 'restaurant-outline' },
    { text: 'Primer aviso: cuidado', icon: 'warning-outline' },
    { text: 'Fútbol y buena onda', icon: 'happy-outline' },
    { text: 'Este equipo promete', icon: 'rocket-outline' },
];

function hashSeed(planId: string): number {
    let h = 2166136261;
    for (let i = 0; i < planId.length; i += 1) {
        h ^= planId.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function pickFromPool(pool: TeamVibe[], planId: string, teamIndex: number): TeamVibe {
    if (pool.length === 0) return VIBES_MANY[0]!;
    if (pool.length === 1) return pool[0]!;
    const seed = hashSeed(`${planId}:${teamIndex}`);
    const idx = (seed + teamIndex * 7) % pool.length;
    return pool[idx] ?? pool[0]!;
}

/**
 * Frase según plazas ocupadas:
 * 0 vacío · 1 solo · 2 exactamente dos · casi lleno · 3+ con hueco.
 */
export function teamVibeFor(
    planId: string,
    teamIndex: number,
    _teamCount: number,
    filledCount = 0,
    capacity = 0,
): TeamVibe {
    const filled = Math.max(0, Math.floor(filledCount));
    const cap = Math.max(0, Math.floor(capacity));
    if (filled <= 0) return pickFromPool(VIBES_EMPTY, planId, teamIndex);
    if (filled === 1) return pickFromPool(VIBES_ONE, planId, teamIndex);
    if (filled === 2) return pickFromPool(VIBES_TWO, planId, teamIndex);
    const almost =
        cap > 0 && (filled >= cap || filled >= Math.ceil(cap * 0.85) || filled >= cap - 1);
    if (almost) return pickFromPool(VIBES_ALMOST, planId, teamIndex);
    return pickFromPool(VIBES_MANY, planId, teamIndex);
}

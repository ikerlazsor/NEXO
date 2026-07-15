export type DeporteFormato = '5v5' | '7v7' | '11v11' | '4v4' | '1v1' | '2v2';
export type DeporteTipo = 'futbol' | 'basket' | 'padel' | 'tenis' | 'running';

/** Jugadores por equipo según el formato ("7v7" → 7). */
export function formatPlayersPerTeam(formato: DeporteFormato): number {
    const parsed = parseInt(formato, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

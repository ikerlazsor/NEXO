export type DeporteFormato = '5v5' | '7v7' | '11v11' | '4v4' | '1v1' | '2v2';
export type DeporteTipo = 'futbol' | 'basket' | 'padel' | 'tenis' | 'running';

export type Slot = { x: number; y: number; label: string };

/** @deprecated use DeporteFormato */
export type FutbolFormato = '5v5' | '7v7' | '11v11';

const FUTBOL: Record<'5v5' | '7v7' | '11v11', Slot[]> = {
    '5v5': [
        { x: 0.5, y: 0.84, label: 'POR' },
        { x: 0.25, y: 0.6, label: 'DEF' },
        { x: 0.75, y: 0.6, label: 'DEF' },
        { x: 0.5, y: 0.44, label: 'MED' },
        { x: 0.5, y: 0.16, label: 'DEL' },
    ],
    '7v7': [
        { x: 0.5, y: 0.84, label: 'POR' },
        { x: 0.28, y: 0.68, label: 'DEF' },
        { x: 0.72, y: 0.68, label: 'DEF' },
        { x: 0.28, y: 0.42, label: 'MED' },
        { x: 0.72, y: 0.42, label: 'MED' },
        { x: 0.35, y: 0.18, label: 'DEL' },
        { x: 0.65, y: 0.18, label: 'DEL' },
    ],
    '11v11': [
        { x: 0.5, y: 0.85, label: 'POR' },
        { x: 0.14, y: 0.68, label: 'LI' },
        { x: 0.34, y: 0.72, label: 'DFC' },
        { x: 0.66, y: 0.72, label: 'DFC' },
        { x: 0.86, y: 0.68, label: 'LD' },
        { x: 0.28, y: 0.45, label: 'MC' },
        { x: 0.5, y: 0.49, label: 'MCD' },
        { x: 0.72, y: 0.45, label: 'MC' },
        { x: 0.18, y: 0.22, label: 'EI' },
        { x: 0.5, y: 0.16, label: 'DC' },
        { x: 0.82, y: 0.22, label: 'ED' },
    ],
};

const BASKET: Record<'4v4' | '5v5', Slot[]> = {
    '4v4': [
        { x: 0.5, y: 0.86, label: 'BASE' },
        { x: 0.22, y: 0.58, label: 'EXT' },
        { x: 0.78, y: 0.58, label: 'EXT' },
        { x: 0.5, y: 0.28, label: 'PIVOT' },
    ],
    '5v5': [
        { x: 0.5, y: 0.88, label: 'BASE' },
        { x: 0.22, y: 0.62, label: 'ESC' },
        { x: 0.78, y: 0.62, label: 'ESC' },
        { x: 0.32, y: 0.32, label: 'ALA' },
        { x: 0.68, y: 0.32, label: 'ALA' },
    ],
};

const DOUBLES: Record<'1v1' | '2v2', Slot[]> = {
    '1v1': [{ x: 0.5, y: 0.55, label: 'J1' }],
    '2v2': [
        { x: 0.38, y: 0.78, label: 'J1' },
        { x: 0.62, y: 0.38, label: 'J2' },
    ],
};

export const SPORT_FORMATIONS: Record<string, Slot[]> = {
    'futbol:5v5': FUTBOL['5v5'],
    'futbol:7v7': FUTBOL['7v7'],
    'futbol:11v11': FUTBOL['11v11'],
    'basket:4v4': BASKET['4v4'],
    'basket:5v5': BASKET['5v5'],
    'padel:1v1': DOUBLES['1v1'],
    'padel:2v2': DOUBLES['2v2'],
    'tenis:1v1': DOUBLES['1v1'],
    'tenis:2v2': DOUBLES['2v2'],
};

export const FORMATIONS = FUTBOL;

export function getFormation(tipo: DeporteTipo, formato: DeporteFormato): Slot[] {
    const key = `${tipo}:${formato}`;
    return SPORT_FORMATIONS[key] ?? FUTBOL['5v5'];
}

export function formatPlayersPerTeam(tipo: DeporteTipo, formato: DeporteFormato): number {
    return getFormation(tipo, formato).length;
}

export type CourtStyle = {
    backgroundColor: string;
    borderColor: string;
    lineColor: string;
    aspectRatio: number;
    courtType: 'football' | 'court' | 'basketball';
};

export function getCourtStyle(tipo: DeporteTipo): CourtStyle {
    switch (tipo) {
        case 'basket':
            return {
                backgroundColor: '#C8622A',
                borderColor: '#FFFFFF',
                lineColor: 'rgba(255,255,255,0.6)',
                aspectRatio: 1.55,
                courtType: 'basketball',
            };
        case 'padel':
            return {
                backgroundColor: '#3D8EB9',
                borderColor: '#FFFFFF',
                lineColor: 'rgba(255,255,255,0.65)',
                aspectRatio: 1.55,
                courtType: 'court',
            };
        case 'tenis':
            return {
                backgroundColor: '#5B8F4E',
                borderColor: '#FFFFFF',
                lineColor: 'rgba(255,255,255,0.6)',
                aspectRatio: 1.55,
                courtType: 'court',
            };
        default:
            return {
                backgroundColor: '#2E9E5B',
                borderColor: '#FFFFFF',
                lineColor: 'rgba(255,255,255,0.6)',
                aspectRatio: 1.55,
                courtType: 'football',
            };
    }
}

export const TEAM_CRESTS = [
    require('../assets/football/barca.png'),
    require('../assets/football/madrid.png'),
] as const;

export const TEAM_BORDER_COLORS = ['#af0000', '#584af8'] as const;

export const GENERIC_TEAM_COLORS = ['#2563EB', '#EA580C'] as const;

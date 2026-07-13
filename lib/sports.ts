import type { DeporteFormato, DeporteTipo } from './sportFormations';
import { formatPlayersPerTeam } from './sportFormations';

export type MainCategory = 'Deporte' | 'Fiesta' | 'Solo chicas' | 'Estudio' | 'Tapas';

export const MAIN_CATEGORIES: MainCategory[] = [
    'Tapas',
    'Fiesta',
    'Deporte',
    'Estudio',
    'Solo chicas',
];

export const DEPORTE_TIPOS: DeporteTipo[] = ['futbol', 'basket', 'padel', 'tenis', 'running'];

export const FORMATS_BY_SPORT: Record<DeporteTipo, DeporteFormato[] | null> = {
    futbol: ['5v5', '7v7', '11v11'],
    basket: ['4v4', '5v5'],
    padel: ['1v1', '2v2'],
    tenis: ['1v1', '2v2'],
    running: null,
};

export const DEFAULT_FORMAT: Record<Exclude<DeporteTipo, 'running'>, DeporteFormato> = {
    futbol: '7v7',
    basket: '5v5',
    padel: '2v2',
    tenis: '2v2',
};

export const CATEGORY_IMAGES: Record<MainCategory, unknown[]> = {
    Fiesta: [
        require('../assets/images/OCIO1.png'),
        require('../assets/images/OCIO2.png'),
        require('../assets/images/OCIO3.png'),
    ],
    Tapas: [
        require('../assets/images/tapa1.jpg'),
        require('../assets/images/tapa2.jpg'),
        require('../assets/images/tapa3.jpg'),
    ],
    'Solo chicas': [
        require('../assets/images/SOLOCHICAS1.png'),
        require('../assets/images/SOLOCHICAS2.png'),
        require('../assets/images/SOLOCHICAS3.png'),
    ],
    Estudio: [
        require('../assets/images/ESTUDIO1.png'),
        require('../assets/images/ESTUDIO2.png'),
        require('../assets/images/ESTUDIO3.png'),
    ],
    Deporte: [],
};

export const SPORT_IMAGES: Record<DeporteTipo, unknown[]> = {
    futbol: [
        require('../assets/images/futbol1.jpg'),
        require('../assets/images/futbol2.jpg'),
        require('../assets/images/futbol3.jpg'),
    ],
    basket: [
        require('../assets/images/basket1.jpg'),
        require('../assets/images/basket2.jpg'),
        require('../assets/images/basket3.jpg'),
    ],
    padel: [
        require('../assets/images/padel1.jpg'),
        require('../assets/images/padel2.jpg'),
        require('../assets/images/padel3.jpg'),
    ],
    tenis: [
        require('../assets/images/tenis1.jpg'),
        require('../assets/images/tenis2.jpg'),
        require('../assets/images/tenis3.jpg'),
    ],
    running: [
        require('../assets/images/run1.jpg'),
        require('../assets/images/run2.jpg'),
        require('../assets/images/run3.jpg'),
    ],
};

const MIN_PEOPLE_DEFAULT = 3;

export function sportHasLineup(tipo: DeporteTipo): boolean {
    return tipo !== 'running';
}

export function sportHasFormats(tipo: DeporteTipo): boolean {
    return FORMATS_BY_SPORT[tipo] != null;
}

export function getMinPeopleForSport(tipo: DeporteTipo, formato: DeporteFormato | null): number {
    if (tipo === 'running') return MIN_PEOPLE_DEFAULT;
    if (!formato) return MIN_PEOPLE_DEFAULT;
    return formatPlayersPerTeam(tipo, formato) * 2;
}

export function getCoverImages(category: MainCategory, deporteTipo: DeporteTipo = 'futbol'): unknown[] {
    if (category === 'Deporte') {
        return SPORT_IMAGES[deporteTipo];
    }
    return CATEGORY_IMAGES[category];
}

/** Guarda tipo+formato en futbol_formato (compatible sin columna deporte_tipo). */
export function encodeSportFormat(tipo: DeporteTipo, formato: DeporteFormato | null): string | null {
    if (tipo === 'running') return null;
    if (!formato) return null;
    if (tipo === 'futbol') return formato;
    return `${tipo}:${formato}`;
}

export function decodeSportFormat(
    futbolFormato: string | null | undefined,
    deporteTipo?: string | null,
    category?: string | null
): { tipo: DeporteTipo; formato: DeporteFormato | null } {
    if (deporteTipo && DEPORTE_TIPOS.includes(deporteTipo as DeporteTipo)) {
        const tipo = deporteTipo as DeporteTipo;
        if (tipo === 'running') return { tipo, formato: null };
        const formats = FORMATS_BY_SPORT[tipo];
        const fallback = formats?.[0] ?? DEFAULT_FORMAT[tipo as Exclude<DeporteTipo, 'running'>];
        if (futbolFormato?.includes(':')) {
            const parts = futbolFormato.split(':');
            return { tipo, formato: (parts[1] || fallback) as DeporteFormato };
        }
        return { tipo, formato: (futbolFormato as DeporteFormato) || fallback };
    }

    if (futbolFormato?.includes(':')) {
        const [rawTipo, rawFmt] = futbolFormato.split(':') as [DeporteTipo, DeporteFormato];
        if (DEPORTE_TIPOS.includes(rawTipo)) {
            return { tipo: rawTipo, formato: rawFmt };
        }
    }

    if (category === 'Fútbol' || category === 'Deporte') {
        return {
            tipo: 'futbol',
            formato: (futbolFormato as DeporteFormato) || '7v7',
        };
    }

    return { tipo: 'futbol', formato: '7v7' };
}

export function resolvePlanSport(plan: {
    category?: string | null;
    deporte_tipo?: string | null;
    futbol_formato?: string | null;
}): { tipo: DeporteTipo; formato: DeporteFormato | null; hasLineup: boolean } | null {
    if (plan.category !== 'Deporte' && plan.category !== 'Fútbol') return null;

    const { tipo, formato } = decodeSportFormat(plan.futbol_formato, plan.deporte_tipo, plan.category);
    if (tipo === 'running') return { tipo, formato: null, hasLineup: false };
    return { tipo, formato, hasLineup: true };
}

export function isFeedDeporteCategory(category?: string | null): boolean {
    return category === 'Deporte' || category === 'Fútbol';
}

export const FEED_PLAN_CATEGORIES = new Set<string>([
    ...MAIN_CATEGORIES,
    'Fútbol',
]);

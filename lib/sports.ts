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

export function sportHasFormats(tipo: DeporteTipo): boolean {
    return FORMATS_BY_SPORT[tipo] != null;
}

export function getMinPeopleForSport(tipo: DeporteTipo, formato: DeporteFormato | null): number {
    if (tipo === 'running') return MIN_PEOPLE_DEFAULT;
    if (!formato) return MIN_PEOPLE_DEFAULT;
    return formatPlayersPerTeam(formato) * 2;
}

export function getCoverImages(category: MainCategory, deporteTipo: DeporteTipo = 'futbol'): unknown[] {
    if (category === 'Deporte') {
        return SPORT_IMAGES[deporteTipo];
    }
    return CATEGORY_IMAGES[category];
}

export function isDeporteTipo(value?: string | null): value is DeporteTipo {
    return !!value && DEPORTE_TIPOS.includes(value as DeporteTipo);
}

/**
 * El formato del partido ya no se persiste en la BD: se deriva del aforo del plan.
 * Devuelve el formato más grande cuyo mínimo de jugadores cabe en el aforo.
 */
export function deriveFormatoFromCapacity(
    tipo: DeporteTipo,
    maxParticipantes?: number | null
): DeporteFormato | null {
    const formats = FORMATS_BY_SPORT[tipo];
    if (!formats?.length) return null;
    if (!maxParticipantes || maxParticipantes <= 0) return formats[0];

    let best = formats[0];
    for (const formato of formats) {
        if (getMinPeopleForSport(tipo, formato) <= maxParticipantes) {
            best = formato;
        }
    }
    return best;
}

export function resolvePlanSport(plan: {
    categoria?: string | null;
    tipo_deporte?: string | null;
    maximo_participantes?: number | null;
}): { tipo: DeporteTipo; formato: DeporteFormato | null } | null {
    if (plan.categoria !== 'Deporte') return null;
    const tipo = isDeporteTipo(plan.tipo_deporte) ? plan.tipo_deporte : 'futbol';
    if (tipo === 'running') return { tipo, formato: null };
    return { tipo, formato: deriveFormatoFromCapacity(tipo, plan.maximo_participantes) };
}

export function isFeedDeporteCategory(categoria?: string | null): boolean {
    return categoria === 'Deporte';
}

export const FEED_PLAN_CATEGORIES = new Set<string>([...MAIN_CATEGORIES]);

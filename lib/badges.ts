import type { BadgeStats } from './badgeStats';

export type TrophyMetal = 'locked' | 'bronze' | 'silver' | 'gold' | 'elite' | 'legendary' | 'welcome';

export type BadgeShape =
    | 'welcome'
    | 'gourmet'
    | 'sport'
    | 'party'
    | 'scholar'
    | 'grace'
    | 'pillar'
    | 'laurel'
    | 'heart'
    | 'network'
    | 'compass'
    | 'crown';

export type BadgeKind = 'welcome' | 'tiered' | 'elite' | 'legendary';

export interface TierLabels {
    bronze: string;
    silver: string;
    gold: string;
}

export interface BadgeFamily {
    id: string;
    nombre: string;
    shape: BadgeShape;
    kind: BadgeKind;
    /** Umbrales bronce / plata / oro para insignias por niveles */
    thresholds?: [number, number, number];
    getCount?: (stats: BadgeStats) => number;
    eliteCheck?: (stats: BadgeStats) => boolean;
    welcomeText?: string;
    eliteText?: string;
    legendaryText?: string;
    tierLabels?: TierLabels;
    categoryLabel?: string;
}

export interface UserBadge {
    family: BadgeFamily;
    metal: TrophyMetal;
    level: 0 | 1 | 2 | 3;
    unlocked: boolean;
    currentCount: number;
    progressText: string;
}

export const BADGE_FAMILIES: BadgeFamily[] = [
    {
        id: 'primeros_pasos',
        nombre: 'Primeros pasos',
        shape: 'welcome',
        kind: 'welcome',
        welcomeText: 'Bienvenido a la comunidad Nexo',
    },
    {
        id: 'foodie',
        nombre: 'Foodie',
        shape: 'gourmet',
        kind: 'tiered',
        thresholds: [5, 20, 50],
        getCount: (s) => s.planesTapas,
        categoryLabel: 'planes gastronómicos',
        tierLabels: {
            bronze: '5 planes gastronómicos',
            silver: '20 planes gastronómicos',
            gold: '50 planes gastronómicos',
        },
    },
    {
        id: 'mvp',
        nombre: 'MVP',
        shape: 'sport',
        kind: 'tiered',
        thresholds: [5, 20, 50],
        getCount: (s) => s.planesDeporte,
        categoryLabel: 'planes deportivos',
        tierLabels: {
            bronze: '5 planes deportivos',
            silver: '20 planes deportivos',
            gold: '50 planes deportivos',
        },
    },
    {
        id: 'mr_mrs_aura',
        nombre: 'Mr/Mrs Aura',
        shape: 'party',
        kind: 'tiered',
        thresholds: [5, 20, 50],
        getCount: (s) => s.planesFiesta,
        categoryLabel: 'planes de fiesta',
        tierLabels: {
            bronze: '5 planes de fiesta',
            silver: '20 planes de fiesta',
            gold: '50 planes de fiesta',
        },
    },
    {
        id: 'genio',
        nombre: 'Genio',
        shape: 'scholar',
        kind: 'tiered',
        thresholds: [5, 20, 50],
        getCount: (s) => s.planesEstudio,
        categoryLabel: 'planes de estudio',
        tierLabels: {
            bronze: '5 planes de estudio',
            silver: '20 planes de estudio',
            gold: '50 planes de estudio',
        },
    },
    {
        id: 'superwoman',
        nombre: 'Superwoman',
        shape: 'grace',
        kind: 'tiered',
        thresholds: [5, 20, 50],
        getCount: (s) => s.planesSoloChicas,
        categoryLabel: 'planes solo chicas',
        tierLabels: {
            bronze: '5 planes solo chicas',
            silver: '20 planes solo chicas',
            gold: '50 planes solo chicas',
        },
    },
    {
        id: 'arquitecto',
        nombre: 'Arquitecto',
        shape: 'pillar',
        kind: 'elite',
        eliteCheck: (s) => s.planesCreados >= 25,
        eliteText: 'Crea 25 planes',
    },
    {
        id: 'veterano',
        nombre: 'Veterano',
        shape: 'laurel',
        kind: 'elite',
        eliteCheck: (s) => s.cuentaAntiguedadDias >= 365,
        eliteText: 'Lleva más de 1 año en la app',
    },
    {
        id: 'inolvidable',
        nombre: 'Inolvidable',
        shape: 'heart',
        kind: 'elite',
        eliteCheck: (s) => s.numeroValoraciones >= 50 && s.porcentajeRepetiria >= 95,
        eliteText: '95% quieren repetir contigo (mín. 50 valoraciones)',
    },
    {
        id: 'maestro_conexiones',
        nombre: 'Maestro de Conexiones',
        shape: 'network',
        kind: 'elite',
        eliteCheck: (s) => s.numeroAmistades >= 100,
        eliteText: 'Crea 100 amistades',
    },
    {
        id: 'sin_limites',
        nombre: 'Sin límites',
        shape: 'compass',
        kind: 'elite',
        eliteCheck: (s) => s.categoriasProbadas >= 5,
        eliteText: 'Prueba todas las categorías de planes',
    },
    {
        id: 'embajador_nexo',
        nombre: 'Embajador Nexo',
        shape: 'crown',
        kind: 'legendary',
        legendaryText:
            '1000 personas distintas · valoración ≥4,5 · 500+ valoraciones · 90%+ repetirían',
        eliteCheck: (s) =>
            s.personasDistintas >= 1000
            && s.valoracionMedia >= 4.5
            && s.numeroValoraciones >= 500
            && s.porcentajeRepetiria >= 90,
    },
];

export function getTierLevel(count: number, thresholds: [number, number, number]): 0 | 1 | 2 | 3 {
    if (count >= thresholds[2]) return 3;
    if (count >= thresholds[1]) return 2;
    if (count >= thresholds[0]) return 1;
    return 0;
}

export function levelToMetal(level: 0 | 1 | 2 | 3, kind: BadgeKind): TrophyMetal {
    if (kind === 'welcome') return 'welcome';
    if (kind === 'elite') return 'elite';
    if (kind === 'legendary') return 'legendary';
    if (level === 0) return 'locked';
    if (level === 1) return 'bronze';
    if (level === 2) return 'silver';
    return 'gold';
}

export function metalForPreview(level: 1 | 2 | 3): TrophyMetal {
    if (level === 1) return 'bronze';
    if (level === 2) return 'silver';
    return 'gold';
}

export function resolveUserBadge(family: BadgeFamily, stats: BadgeStats): UserBadge {
    if (family.kind === 'welcome') {
        return {
            family,
            metal: 'welcome',
            level: 3,
            unlocked: true,
            currentCount: 1,
            progressText: family.welcomeText ?? '',
        };
    }

    if (family.kind === 'tiered' && family.thresholds && family.getCount) {
        const count = family.getCount(stats);
        const level = getTierLevel(count, family.thresholds);
        const metal = levelToMetal(level, 'tiered');
        let progressText = `0 / ${family.thresholds[0]} ${family.categoryLabel ?? ''}`;
        if (level === 0) progressText = `${count} / ${family.thresholds[0]}`;
        else if (level === 1) progressText = `${count} / ${family.thresholds[1]}`;
        else if (level === 2) progressText = `${count} / ${family.thresholds[2]}`;
        else progressText = `${count} · máximo nivel`;

        return {
            family,
            metal,
            level,
            unlocked: level >= 1,
            currentCount: count,
            progressText: progressText.trim(),
        };
    }

    const unlocked = family.eliteCheck?.(stats) ?? false;
    const metal: TrophyMetal =
        family.kind === 'legendary'
            ? unlocked
                ? 'legendary'
                : 'locked'
            : unlocked
              ? 'elite'
              : 'locked';

    return {
        family,
        metal,
        level: unlocked ? 3 : 0,
        unlocked,
        currentCount: 0,
        progressText: family.legendaryText ?? family.eliteText ?? '',
    };
}

export function getUserBadges(stats: BadgeStats): UserBadge[] {
    return BADGE_FAMILIES.map((family) => resolveUserBadge(family, stats));
}

export function countUnlockedBadges(stats: BadgeStats): number {
    return getUserBadges(stats).filter((b) => b.unlocked).length;
}

/** Compatibilidad con código que esperaba BADGE_DEFINITIONS */
export const BADGE_DEFINITIONS = BADGE_FAMILIES;

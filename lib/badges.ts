import type { BadgeStats } from './badgeStats';

export type BadgeTier = 1 | 2 | 3 | 'special';

export interface BadgeDefinition {
    id: string;
    nombre: string;
    descripcion: string;
    icon: string;
    gradient: [string, string];
    accent: string;
    tier: BadgeTier;
    group?: string;
    check: (stats: BadgeStats) => boolean;
}

export const BADGE_DEFINITIONS: BadgeDefinition[] = [
    {
        id: 'primeros_pasos',
        nombre: 'Primeros pasos',
        descripcion: 'Bienvenida a la comunidad Nexo',
        icon: 'sparkles',
        gradient: ['#60A5FA', '#2563EB'],
        accent: '#2563EB',
        tier: 'special',
        check: () => true,
    },
    {
        id: 'foodie',
        nombre: 'Foodie',
        descripcion: 'Completa 5 planes gastronómicos',
        icon: 'restaurant',
        gradient: ['#FCD34D', '#F59E0B'],
        accent: '#D97706',
        tier: 1,
        group: 'gastro',
        check: (s) => s.planesTapas >= 5,
    },
    {
        id: 'paladar',
        nombre: 'Paladar',
        descripcion: 'Completa 20 planes gastronómicos',
        icon: 'wine',
        gradient: ['#FB923C', '#EA580C'],
        accent: '#C2410C',
        tier: 2,
        group: 'gastro',
        check: (s) => s.planesTapas >= 20,
    },
    {
        id: 'maestro_gourmet',
        nombre: 'Maestro Gourmet',
        descripcion: 'Completa 50 planes gastronómicos',
        icon: 'trophy',
        gradient: ['#FBBF24', '#B45309'],
        accent: '#92400E',
        tier: 3,
        group: 'gastro',
        check: (s) => s.planesTapas >= 50,
    },
    {
        id: 'pisando_fuerte',
        nombre: 'Pisando fuerte',
        descripcion: 'Completa 5 planes deportivos',
        icon: 'fitness',
        gradient: ['#4ADE80', '#16A34A'],
        accent: '#15803D',
        tier: 1,
        group: 'deporte',
        check: (s) => s.planesDeporte >= 5,
    },
    {
        id: 'vikingo',
        nombre: 'Vikingo',
        descripcion: 'Completa 20 planes deportivos',
        icon: 'barbell',
        gradient: ['#34D399', '#059669'],
        accent: '#047857',
        tier: 2,
        group: 'deporte',
        check: (s) => s.planesDeporte >= 20,
    },
    {
        id: 'mvp',
        nombre: 'MVP',
        descripcion: 'Completa 50 planes deportivos',
        icon: 'medal',
        gradient: ['#10B981', '#065F46'],
        accent: '#064E3B',
        tier: 3,
        group: 'deporte',
        check: (s) => s.planesDeporte >= 50,
    },
    {
        id: 'rompehielos',
        nombre: 'Rompehielos',
        descripcion: 'Completa 5 planes de fiesta',
        icon: 'musical-notes',
        gradient: ['#C084FC', '#9333EA'],
        accent: '#7E22CE',
        tier: 1,
        group: 'fiesta',
        check: (s) => s.planesFiesta >= 5,
    },
    {
        id: 'alma_fiesta',
        nombre: 'Alma de la fiesta',
        descripcion: 'Completa 20 planes de fiesta',
        icon: 'sparkles',
        gradient: ['#A855F7', '#7C3AED'],
        accent: '#6D28D9',
        tier: 2,
        group: 'fiesta',
        check: (s) => s.planesFiesta >= 20,
    },
    {
        id: 'mr_mrs_aura',
        nombre: 'Mr/Mrs Aura',
        descripcion: 'Completa 50 planes de fiesta',
        icon: 'star',
        gradient: ['#E879F9', '#C026D3'],
        accent: '#A21CAF',
        tier: 3,
        group: 'fiesta',
        check: (s) => s.planesFiesta >= 50,
    },
    {
        id: 'mente_curiosa',
        nombre: 'Mente curiosa',
        descripcion: 'Completa 5 planes de estudio',
        icon: 'book',
        gradient: ['#93C5FD', '#3B82F6'],
        accent: '#2563EB',
        tier: 1,
        group: 'estudio',
        check: (s) => s.planesEstudio >= 5,
    },
    {
        id: 'sabio',
        nombre: 'Sabio',
        descripcion: 'Completa 20 planes de estudio',
        icon: 'school',
        gradient: ['#60A5FA', '#2563EB'],
        accent: '#1D4ED8',
        tier: 2,
        group: 'estudio',
        check: (s) => s.planesEstudio >= 20,
    },
    {
        id: 'genio',
        nombre: 'Genio',
        descripcion: 'Completa 50 planes de estudio',
        icon: 'bulb',
        gradient: ['#38BDF8', '#0284C7'],
        accent: '#0369A1',
        tier: 3,
        group: 'estudio',
        check: (s) => s.planesEstudio >= 50,
    },
    {
        id: 'nueva_companera',
        nombre: 'Nueva compañera',
        descripcion: 'Completa 5 planes de solo chicas',
        icon: 'heart',
        gradient: ['#F9A8D4', '#EC4899'],
        accent: '#DB2777',
        tier: 1,
        group: 'chicas',
        check: (s) => s.planesSoloChicas >= 5,
    },
    {
        id: 'conectora',
        nombre: 'Conectora',
        descripcion: 'Completa 20 planes de solo chicas',
        icon: 'people',
        gradient: ['#F472B6', '#DB2777'],
        accent: '#BE185D',
        tier: 2,
        group: 'chicas',
        check: (s) => s.planesSoloChicas >= 20,
    },
    {
        id: 'superwoman',
        nombre: 'Superwoman',
        descripcion: 'Completa 50 planes de solo chicas',
        icon: 'ribbon',
        gradient: ['#EC4899', '#9D174D'],
        accent: '#831843',
        tier: 3,
        group: 'chicas',
        check: (s) => s.planesSoloChicas >= 50,
    },
    {
        id: 'arquitecto',
        nombre: 'Arquitecto',
        descripcion: 'Crea 25 planes',
        icon: 'construct',
        gradient: ['#818CF8', '#4F46E5'],
        accent: '#4338CA',
        tier: 'special',
        check: (s) => s.planesCreados >= 25,
    },
    {
        id: 'veterano',
        nombre: 'Veterano',
        descripcion: 'Lleva más de 1 año en la app',
        icon: 'time',
        gradient: ['#94A3B8', '#475569'],
        accent: '#334155',
        tier: 'special',
        check: (s) => s.cuentaAntiguedadDias >= 365,
    },
    {
        id: 'inolvidable',
        nombre: 'Inolvidable',
        descripcion: '95% de personas quieren repetir plan contigo (a partir de 20 valoraciones)',
        icon: 'heart-circle',
        gradient: ['#FB7185', '#E11D48'],
        accent: '#BE123C',
        tier: 'special',
        check: (s) => s.numeroValoraciones >= 20 && s.porcentajeRepetiria >= 95,
    },
    {
        id: 'maestro_conexiones',
        nombre: 'Maestro de Conexiones',
        descripcion: 'Crea 100 amistades',
        icon: 'git-network',
        gradient: ['#2DD4BF', '#0D9488'],
        accent: '#0F766E',
        tier: 'special',
        check: (s) => s.numeroAmistades >= 100,
    },
    {
        id: 'sin_limites',
        nombre: 'Sin límites',
        descripcion: 'Probar todas las categorías de planes',
        icon: 'compass',
        gradient: ['#A78BFA', '#7C3AED'],
        accent: '#6D28D9',
        tier: 'special',
        check: (s) => s.categoriasProbadas >= 5,
    },
    {
        id: 'embajador_nexo',
        nombre: 'Embajador Nexo',
        descripcion: 'Valoración ≥4,5 · 500+ valoraciones · 90%+ repetirían · 1000 personas distintas',
        icon: 'diamond',
        gradient: ['#FDE68A', '#F59E0B'],
        accent: '#B45309',
        tier: 'special',
        check: (s) =>
            s.valoracionMedia >= 4.5
            && s.numeroValoraciones >= 500
            && s.porcentajeRepetiria >= 90
            && s.personasDistintas >= 1000,
    },
];

export function isBadgeUnlocked(badge: BadgeDefinition, stats: BadgeStats): boolean {
    return badge.check(stats);
}

export function getUserBadges(stats: BadgeStats) {
    return BADGE_DEFINITIONS.map((badge) => ({
        ...badge,
        unlocked: isBadgeUnlocked(badge, stats),
    }));
}

export function countUnlockedBadges(stats: BadgeStats): number {
    return getUserBadges(stats).filter((b) => b.unlocked).length;
}

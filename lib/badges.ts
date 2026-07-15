import type { UserStats } from './stats';

export interface BadgeDefinition {
    id: string;
    nombre: string;
    descripcion: string;
    icon: string;
    color: string;
    /** Campo de estadisticas_usuario o lógica especial */
    field: keyof UserStats | 'numero_amistades';
    required: number;
}

export const BADGE_DEFINITIONS: BadgeDefinition[] = [
    { id: 'social_1', nombre: 'Social I', descripcion: 'Consigue 5 amigos', icon: 'people', color: '#3B82F6', field: 'numero_amistades', required: 5 },
    { id: 'social_2', nombre: 'Social II', descripcion: 'Consigue 15 amigos', icon: 'people-circle', color: '#2563EB', field: 'numero_amistades', required: 15 },
    { id: 'plan_1', nombre: 'Organizador', descripcion: 'Crea tu primer plan', icon: 'calendar', color: '#8B5CF6', field: 'numeroPlanesRealizados', required: 1 },
    { id: 'plan_2', nombre: 'Veterano', descripcion: 'Completa 10 planes', icon: 'trophy', color: '#D97706', field: 'numeroPlanesRealizados', required: 10 },
    { id: 'rated', nombre: 'Valorado', descripcion: 'Recibe 5 valoraciones', icon: 'star', color: '#F59E0B', field: 'numeroValoraciones', required: 5 },
    { id: 'star', nombre: 'Estrella', descripcion: 'Mantén 4.0+ de media', icon: 'star-half', color: '#EAB308', field: 'valoracionMedia', required: 4 },
    { id: 'repeat', nombre: 'Repetible', descripcion: '70%+ volvería contigo', icon: 'heart', color: '#EC4899', field: 'porcentajeRepetiria', required: 70 },
    { id: 'social_3', nombre: 'Conector', descripcion: 'Consigue 30 amigos', icon: 'git-network', color: '#0EA5E9', field: 'numero_amistades', required: 30 },
    { id: 'rated_2', nombre: 'Referente', descripcion: 'Recibe 20 valoraciones', icon: 'medal', color: '#F97316', field: 'numeroValoraciones', required: 20 },
    { id: 'legend', nombre: 'Leyenda', descripcion: 'Completa 25 planes', icon: 'ribbon', color: '#7C3AED', field: 'numeroPlanesRealizados', required: 25 },
];

export function isBadgeUnlocked(badge: BadgeDefinition, stats: UserStats): boolean {
    const value = badge.field === 'numero_amistades'
        ? stats.numeroAmistades
        : stats[badge.field as keyof UserStats];
    if (typeof value !== 'number') return false;
    return value >= badge.required;
}

/** Insignias del usuario según estadísticas actuales. */
export function getUserBadges(stats: UserStats) {
    return BADGE_DEFINITIONS.map((badge) => ({
        ...badge,
        unlocked: isBadgeUnlocked(badge, stats),
    }));
}

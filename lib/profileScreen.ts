import type { BadgeStats } from './badgeStats';
import { EMPTY_BADGE_STATS } from './badgeStats';
import { getUserBadges } from './badges';
import { diskGet, diskSet } from './diskCache';
import { parseOrganizerMeta } from './organizer';
import { calcAge, parseHabitos, parsePrivacy, type Genero } from './profileFields';
import type { ProfileUiSnapshot } from '../features/profile/types';
import { screenCacheKey, ScreenCacheTTL } from './screenCaches';
import type { PublicAttendedPlan } from './profileSocial';
import { EMPTY_STATS, type UserStats } from './stats';
import { supabase } from './supabase';
import { cacheGetStale, cacheSet } from './ttlCache';

export type ProfileScreenProfile = {
    id: string;
    nombre: string | null;
    nombre_usuario: string | null;
    avatar_url: string | null;
    cover_url: string | null;
    descripcion: string | null;
    etiquetas: string[];
    fecha_nacimiento: string | null;
    genero: string | null;
    habitos_consumo: Record<string, unknown>;
    ambientes_preferidos: string[];
    perfil_gustos: Record<string, unknown>;
    es_organizador: boolean;
    organizador: Record<string, unknown> | null;
};

export type ProfileScreenBundle = {
    profile: ProfileScreenProfile;
    stats: UserStats;
    badges: BadgeStats;
    attended: PublicAttendedPlan[];
};

function num(v: unknown): number {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
}

function asRecord(v: unknown): Record<string, unknown> {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asStringList(v: unknown): string[] {
    return Array.isArray(v) ? v.filter((item): item is string => typeof item === 'string') : [];
}

function mapStats(raw: Record<string, unknown>): UserStats {
    return {
        ...EMPTY_STATS,
        valoracionMedia: num(raw.valoracion_media),
        porcentajeRepetiria: num(raw.porcentaje_repetiria),
        porcentajeAsistencia: num(raw.porcentaje_asistencia),
        numeroValoraciones: num(raw.numero_valoraciones),
        numeroEvaluadoresDistintos: num(raw.numero_evaluadores_distintos),
        numeroPlanesRealizados: num(raw.numero_planes_realizados),
        numeroAmistades: num(raw.numero_amistades),
        aspectoPositivoMasVotado: typeof raw.aspecto_positivo_mas_votado === 'string' ? raw.aspecto_positivo_mas_votado : null,
        aspectoNegativoMasVotado: typeof raw.aspecto_negativo_mas_votado === 'string' ? raw.aspecto_negativo_mas_votado : null,
    };
}

function mapBadges(stats: UserStats, raw: Record<string, unknown>): BadgeStats {
    return {
        ...EMPTY_BADGE_STATS,
        ...stats,
        planesTapas: num(raw.planes_tapas),
        planesDeporte: num(raw.planes_deporte),
        planesFiesta: num(raw.planes_fiesta),
        planesEstudio: num(raw.planes_estudio),
        planesSoloChicas: num(raw.planes_solo_chicas),
        categoriasProbadas: num(raw.categorias_probadas),
        planesCreados: num(raw.planes_creados),
        personasDistintas: num(raw.personas_distintas),
    };
}

function mapAttended(raw: unknown): PublicAttendedPlan[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((row) => {
            const o = asRecord(row);
            if (typeof o.id !== 'string' || typeof o.titulo !== 'string') return null;
            return {
                id: o.id,
                titulo: o.titulo,
                imagen_url: typeof o.imagen_url === 'string' ? o.imagen_url : null,
                fecha_evento: typeof o.fecha_evento === 'string' ? o.fecha_evento : null,
                nombre_ubicacion: typeof o.nombre_ubicacion === 'string' ? o.nombre_ubicacion : null,
                categoria: typeof o.categoria === 'string' ? o.categoria : null,
            } satisfies PublicAttendedPlan;
        })
        .filter((item): item is PublicAttendedPlan => !!item);
}

/** Perfil + cifras + planes vistos en un solo viaje. */
export async function loadProfileScreen(userId: string): Promise<ProfileScreenBundle | null> {
    const { data, error } = await supabase.rpc('get_profile_screen', { p_user_id: userId });
    if (error || data == null) return null;
    const root = asRecord(typeof data === 'string' ? JSON.parse(data) : data);
    const profileRaw = asRecord(root.profile);
    if (typeof profileRaw.id !== 'string') return null;
    const statsRaw = asRecord(root.stats);
    const stats = mapStats(statsRaw);
    return {
        profile: {
            id: profileRaw.id,
            nombre: typeof profileRaw.nombre === 'string' ? profileRaw.nombre : null,
            nombre_usuario: typeof profileRaw.nombre_usuario === 'string' ? profileRaw.nombre_usuario : null,
            avatar_url: typeof profileRaw.avatar_url === 'string' ? profileRaw.avatar_url : null,
            cover_url: typeof profileRaw.cover_url === 'string' ? profileRaw.cover_url : null,
            descripcion: typeof profileRaw.descripcion === 'string' ? profileRaw.descripcion : null,
            etiquetas: asStringList(profileRaw.etiquetas),
            fecha_nacimiento: typeof profileRaw.fecha_nacimiento === 'string' ? profileRaw.fecha_nacimiento : null,
            genero: typeof profileRaw.genero === 'string' ? profileRaw.genero : null,
            habitos_consumo: asRecord(profileRaw.habitos_consumo),
            ambientes_preferidos: asStringList(profileRaw.ambientes_preferidos),
            perfil_gustos: asRecord(profileRaw.perfil_gustos),
            es_organizador: profileRaw.es_organizador === true,
            organizador: profileRaw.organizador && typeof profileRaw.organizador === 'object'
                ? asRecord(profileRaw.organizador)
                : null,
        },
        stats,
        badges: mapBadges(stats, statsRaw),
        attended: mapAttended(root.attended),
    };
}

/** Deja el perfil propio en memoria antes de que el usuario lo abra. */
export async function warmOwnProfile(userId: string): Promise<void> {
    if (!userId) return;
    const key = screenCacheKey.profileUI(userId);
    if (cacheGetStale(key)) return;
    const disk = await diskGet<ProfileUiSnapshot>(key, 3 * 24 * 60 * 60 * 1000);
    if (disk?.userId === userId) {
        cacheSet(key, disk, ScreenCacheTTL.profileUI);
        return;
    }
    const screen = await loadProfileScreen(userId);
    if (!screen) return;
    const habitos = parseHabitos(screen.profile.habitos_consumo);
    const snap: ProfileUiSnapshot = {
        userId,
        nombre: screen.profile.nombre ?? '',
        nombreUsuario: screen.profile.nombre_usuario,
        aboutMe: screen.profile.descripcion ?? '',
        avatarUrl: screen.profile.avatar_url,
        coverUrl: screen.profile.cover_url,
        age: calcAge(screen.profile.fecha_nacimiento),
        genero: (screen.profile.genero as Genero) || null,
        habitoBebida: habitos.bebida,
        habitoTabaco: habitos.tabaco,
        aficiones: screen.profile.ambientes_preferidos.length
            ? screen.profile.ambientes_preferidos
            : screen.profile.etiquetas,
        perfilGustos: screen.profile.perfil_gustos,
        privacy: parsePrivacy(screen.profile.perfil_gustos),
        stats: screen.stats,
        friendsCount: screen.stats.numeroAmistades || 0,
        friendsNotifCount: 0,
        planRequests: 0,
        pendingRatings: [],
        badges: getUserBadges(screen.badges),
        badgeStats: screen.badges,
        isOrganizer: screen.profile.es_organizador,
        organizer: parseOrganizerMeta(screen.profile.organizador),
        followersCount: 0,
        attendedPlans: screen.attended,
    };
    cacheSet(key, snap, ScreenCacheTTL.profileUI);
    void diskSet(key, snap);
}

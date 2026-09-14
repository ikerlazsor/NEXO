import { supabase } from './supabase';
import { parseOrganizerGallery, type OrganizerMedia } from './organizer';

export const MAX_PROFILE_GALLERY = 20;
export const PLAN_DESCRIPTION_MAX = 400;

export function parseProfileGallery(raw: unknown): OrganizerMedia[] {
    return parseOrganizerGallery(raw).slice(0, MAX_PROFILE_GALLERY);
}

export async function uploadProfileMoment(
    userId: string,
    uri: string,
    kind: 'image' | 'video',
    mimeType?: string | null,
): Promise<OrganizerMedia | null> {
    const { uploadLocalFile, makeVideoThumb } = await import('./mediaUpload');
    const url = await uploadLocalFile({ userId, uri, kind, mimeType, folder: 'moments' });
    if (!url) return null;
    if (kind !== 'video') return { url, kind };
    const posterUri = await makeVideoThumb(uri);
    const thumb = posterUri
        ? await uploadLocalFile({ userId, uri: posterUri, kind: 'image', mimeType: 'image/jpeg', folder: 'moments' })
        : null;
    return { url, kind, thumb };
}

export type ProfileMiniUser = {
    id: string;
    nombre: string;
    avatar_url: string | null;
};

export type MutualFriendsResult = {
    total: number;
    items: ProfileMiniUser[];
};

export type PublicAttendedPlan = {
    id: string;
    titulo: string;
    imagen_url: string | null;
    fecha_evento: string | null;
    nombre_ubicacion: string | null;
    categoria: string | null;
};

function asMiniUser(raw: unknown): ProfileMiniUser | null {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as Record<string, unknown>;
    if (typeof row.id !== 'string') return null;
    return {
        id: row.id,
        nombre: typeof row.nombre === 'string' && row.nombre.trim() ? row.nombre : 'Usuario',
        avatar_url: typeof row.avatar_url === 'string' ? row.avatar_url : null,
    };
}

function parsePeoplePayload(data: unknown): MutualFriendsResult {
    if (!data || typeof data !== 'object') return { total: 0, items: [] };
    const row = data as Record<string, unknown>;
    const items = Array.isArray(row.items)
        ? row.items.map(asMiniUser).filter((item): item is ProfileMiniUser => !!item)
        : [];
    const total = Number(row.total ?? items.length) || 0;
    return { total, items };
}

export async function getMutualFriends(
    otherId: string,
    limit = 5,
): Promise<MutualFriendsResult> {
    try {
        const { data, error } = await supabase.rpc('get_mutual_friends', {
            p_other_id: otherId,
            p_limit: limit,
        });
        if (error || data == null) return { total: 0, items: [] };
        return parsePeoplePayload(data);
    } catch {
        return { total: 0, items: [] };
    }
}

export async function getPublicAttendedPlans(
    userId: string,
    limit = 12,
): Promise<PublicAttendedPlan[]> {
    try {
        const { data, error } = await supabase.rpc('get_public_attended_plans', {
            p_user_id: userId,
            p_limit: limit,
        });
        if (error || !Array.isArray(data)) return [];
        return data
            .map((row) => {
                if (!row || typeof row !== 'object') return null;
                const o = row as Record<string, unknown>;
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
    } catch {
        return [];
    }
}

export async function getOrganizerFriendAttendees(
    organizerId: string,
    limit = 5,
): Promise<MutualFriendsResult> {
    try {
        const { data, error } = await supabase.rpc('get_organizer_friend_attendees', {
            p_organizador_id: organizerId,
            p_limit: limit,
        });
        if (error || data == null) return { total: 0, items: [] };
        return parsePeoplePayload(data);
    } catch {
        return { total: 0, items: [] };
    }
}

export function formatCompactCount(value: number): string {
    if (!Number.isFinite(value) || value < 0) return '0';
    if (value < 1000) return String(Math.round(value));
    if (value < 10_000) {
        const compact = (value / 1000).toFixed(1);
        return `${compact.replace(/\.0$/, '')}K`;
    }
    if (value < 1_000_000) return `${Math.round(value / 1000)}K`;
    const compact = (value / 1_000_000).toFixed(1);
    return `${compact.replace(/\.0$/, '')}M`;
}

export function formatProfilePlanWhen(iso: string | null | undefined, lang: 'es' | 'en'): string {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const locale = lang === 'en' ? 'en-GB' : 'es-ES';
    const weekday = date.toLocaleDateString(locale, { weekday: 'short' });
    const dayMonth = date.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
    const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
    const weekdayClean = weekday.replace(/\.$/, '');
    const cap = weekdayClean.charAt(0).toUpperCase() + weekdayClean.slice(1);
    return `${cap}, ${dayMonth} · ${time}`;
}

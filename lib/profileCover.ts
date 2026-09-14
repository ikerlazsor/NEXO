import type { ImageSourcePropType } from 'react-native';
import { compressImageForUpload } from './imageCompress';
import { supabase } from './supabase';
import { updateProfileFields } from './profile';
import { parseOrganizerMeta } from './organizer';
import { uploadLocalUriToStorage } from './storageUpload';

export const PROFILE_COVER_PREFIX = 'nexo_cover:';

export const PROFILE_COVER_PRESETS = [
    { id: 'party', image: require('../assets/images/FIESTA_1.jpg'), labelKey: 'cover.party' },
    { id: 'concert', image: require('../assets/images/CONCIERTO_1.jpg'), labelKey: 'cover.concert' },
    { id: 'people', image: require('../assets/images/PICNIC_1.jpg'), labelKey: 'cover.people' },
    { id: 'nature', image: require('../assets/images/SENDERISMO_1.jpg'), labelKey: 'cover.nature' },
    { id: 'city', image: require('../assets/images/MIRADOR_1.jpg'), labelKey: 'cover.city' },
    { id: 'sports', image: require('../assets/images/RUNNING_1.jpg'), labelKey: 'cover.sports' },
    { id: 'beach', image: require('../assets/images/PLAYA_1.jpg'), labelKey: 'cover.beach' },
    { id: 'travel', image: require('../assets/images/VIAJES_1.jpg'), labelKey: 'cover.travel' },
    { id: 'cafe', image: require('../assets/images/CAFE_1.jpg'), labelKey: 'cover.cafe' },
    { id: 'food', image: require('../assets/images/COMER_1.jpg'), labelKey: 'cover.food' },
    { id: 'cinema', image: require('../assets/images/CINE_1.jpg'), labelKey: 'cover.cinema' },
    { id: 'culture', image: require('../assets/images/MUSEO_1.jpg'), labelKey: 'cover.culture' },
    { id: 'sunset', image: require('../assets/images/MIRADOR_2.jpg'), labelKey: 'cover.sunset' },
    { id: 'indoor', image: require('../assets/images/ESTUDIO_1.jpg'), labelKey: 'cover.indoor' },
    { id: 'shopping', image: require('../assets/images/COMPRAS_1.jpg'), labelKey: 'cover.shopping' },
    { id: 'theater', image: require('../assets/images/TEATRO_1.jpg'), labelKey: 'cover.theater' },
] as const;

export const ORGANIZER_COVER_PRESETS = [
    { id: 'running_4', image: require('../assets/images/RUNNING_4.jpg'), labelKey: 'cover.sports' },
    { id: 'fiesta_3', image: require('../assets/images/FIESTA_3.jpg'), labelKey: 'cover.party' },
    { id: 'fiesta_2', image: require('../assets/images/FIESTA_2.jpg'), labelKey: 'cover.party' },
    { id: 'ocio_otro4', image: require('../assets/images/OCIO_OTRO4.jpg'), labelKey: 'cover.party' },
    { id: 'padel_4', image: require('../assets/images/PADEL_4.jpg'), labelKey: 'cover.sports' },
    { id: 'deportes_otro', image: require('../assets/images/DEPORTES_OTRO.jpg'), labelKey: 'cover.sports' },
    { id: 'mirador_4', image: require('../assets/images/MIRADOR_4.jpg'), labelKey: 'cover.city' },
    { id: 'idiomas_1', image: require('../assets/images/IDIOMAS_1.jpg'), labelKey: 'cover.culture' },
    { id: 'ocio_otro2', image: require('../assets/images/OCIO_OTRO2.jpg'), labelKey: 'cover.party' },
    { id: 'cine_3', image: require('../assets/images/CINE_3.jpg'), labelKey: 'cover.cinema' },
    { id: 'senderismo_3', image: require('../assets/images/SENDERISMO_3.jpg'), labelKey: 'cover.nature' },
] as const;

export type OrganizerCoverPresetId = (typeof ORGANIZER_COVER_PRESETS)[number]['id'];

export type ProfileCoverPresetId = (typeof PROFILE_COVER_PRESETS)[number]['id'];

export function coverPresetKey(id: string): string {
    return `${PROFILE_COVER_PREFIX}${id}`;
}

export function isCoverPresetKey(value?: string | null): boolean {
    return !!value && value.startsWith(PROFILE_COVER_PREFIX);
}

export function getCoverPreset(idOrKey?: string | null) {
    if (!idOrKey) return null;
    const id = idOrKey.startsWith(PROFILE_COVER_PREFIX)
        ? idOrKey.slice(PROFILE_COVER_PREFIX.length)
        : idOrKey;
    return (
        PROFILE_COVER_PRESETS.find((item) => item.id === id)
        ?? ORGANIZER_COVER_PRESETS.find((item) => item.id === id)
        ?? null
    );
}

export function resolveProfileCoverSource(
    coverUrl?: string | null,
    avatarUrl?: string | null,
    opts?: { allowAvatarFallback?: boolean },
): ImageSourcePropType | { uri: string } | null {
    const preset = getCoverPreset(coverUrl);
    if (preset) return preset.image;
    if (coverUrl && /^https?:\/\//i.test(coverUrl)) return { uri: coverUrl };
    if (opts?.allowAvatarFallback && avatarUrl?.trim()) {
        return { uri: avatarUrl.trim() };
    }
    return null;
}

export function readCoverUrl(profile?: {
    cover_url?: string | null;
    organizador?: unknown;
    perfil_gustos?: unknown;
} | null): string | null {
    if (!profile) return null;
    if (typeof profile.cover_url === 'string' && profile.cover_url.trim()) {
        return profile.cover_url.trim();
    }
    const org = parseOrganizerMeta(profile.organizador);
    if (org.portada) return org.portada;
    const gustos = profile.perfil_gustos;
    if (gustos && typeof gustos === 'object') {
        const raw = (gustos as Record<string, unknown>).cover_url;
        if (typeof raw === 'string' && raw.trim()) return raw.trim();
    }
    return null;
}

export async function uploadCoverFromUri(
    userId: string,
    uri: string,
    options?: { organizador?: Record<string, unknown> | null; perfilGustos?: Record<string, unknown> | null },
): Promise<{ url: string | null; error: string | null }> {
    try {
        const localUri = await compressImageForUpload(uri, 'cover');
        const fileName = `${userId}/cover.jpg`;
        await uploadLocalUriToStorage({
            bucket: 'avatars',
            path: fileName,
            uri: localUri,
            contentType: 'image/jpeg',
            upsert: true,
        });

        const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(fileName);
        const urlWithTimestamp = `${publicUrl}?t=${Date.now()}`;
        const saved = await saveProfileCover(userId, urlWithTimestamp, options);
        if (saved.error) return { url: null, error: saved.error };
        return { url: urlWithTimestamp, error: null };
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'upload_failed';
        return { url: null, error: msg };
    }
}

export async function saveProfileCover(
    userId: string,
    coverUrl: string,
    options?: { organizador?: Record<string, unknown> | null; perfilGustos?: Record<string, unknown> | null },
): Promise<{ error: string | null }> {
    const gustos = { ...(options?.perfilGustos ?? {}), cover_url: coverUrl };
    if (options?.organizador) {
        const { error: rpcError } = await supabase.rpc('update_organizer_page', {
            p_cover_url: coverUrl,
            p_organizador: { ...options.organizador, portada: coverUrl },
        });
        if (!rpcError) {
            if (options.perfilGustos) {
                await updateProfileFields(userId, { perfil_gustos: gustos });
            }
            return { error: null };
        }
    }
    const { error } = await updateProfileFields(userId, { cover_url: coverUrl });
    if (options?.organizador) {
        await supabase
            .from('perfiles')
            .update({ organizador: { ...options.organizador, portada: coverUrl } })
            .eq('id', userId);
    }
    if (options?.perfilGustos) {
        await supabase.from('perfiles').update({ perfil_gustos: gustos }).eq('id', userId);
    }
    if (!error) return { error: null };

    const fallback = await updateProfileFields(userId, { perfil_gustos: gustos });
    if (options?.organizador) {
        await supabase
            .from('perfiles')
            .update({ organizador: { ...options.organizador, portada: coverUrl } })
            .eq('id', userId);
    }
    return fallback;
}

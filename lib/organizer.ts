import { getAuthUser } from './auth';
import { supabase } from './supabase';
import { FEED_CACHE_KEY, type FeedSnapshot } from './feedCache';
import { cacheGetStale } from './ttlCache';

export const ORGANIZER_TYPES = [
    'sports',
    'erasmus',
    'leisure',
    'community',
    'other',
] as const;

export const ORGANIZER_ACTIVITY_PILLS = [
    'social',
    'tardeos',
    'sports',
    'travel',
    'events',
    'erasmus',
    'leisure',
    'community',
] as const;

export type OrganizerType = (typeof ORGANIZER_TYPES)[number];
export type OrganizerActivityPill = (typeof ORGANIZER_ACTIVITY_PILLS)[number];
export type OrganizerRequestEstado = 'pendiente' | 'aprobado' | 'rechazado';

export type OrganizerMedia = {
    url: string;
    kind: 'image' | 'video';
    thumb?: string | null;
};

export type OrganizerMeta = {
    tipo?: OrganizerType | string | null;
    ciudad?: string | null;
    web?: string | null;
    instagram?: string | null;
    whatsapp?: string | null;
    galeria?: OrganizerMedia[];
    portada?: string | null;
    categorias?: string[];
    informacion?: string | null;
};

export const MAX_ORGANIZER_GALLERY = 50;
export const ORGANIZER_DESC_MIN = 20;
export const ORGANIZER_DESC_MAX = 400;
export const ORGANIZER_INFO_MIN = 40;
export const ORGANIZER_INFO_MAX = 4000;

export type OrganizerRequest = {
    id: string;
    usuario_id: string;
    nombre_org: string;
    tipo: string;
    ciudad: string | null;
    web: string | null;
    instagram: string | null;
    whatsapp?: string | null;
    descripcion: string;
    informacion?: string | null;
    logo_url?: string | null;
    cover_url?: string | null;
    motivo: string;
    estado: OrganizerRequestEstado;
    notas_internas: string | null;
    creado_en: string;
    perfil?: { nombre: string | null; nombre_usuario: string | null; avatar_url: string | null } | null;
};

export function parseOrganizerMeta(raw: unknown): OrganizerMeta {
    if (!raw || typeof raw !== 'object') return {};
    const o = raw as Record<string, unknown>;
    return {
        tipo: typeof o.tipo === 'string' ? o.tipo : null,
        ciudad: typeof o.ciudad === 'string' ? o.ciudad : null,
        web: typeof o.web === 'string' ? o.web : null,
        instagram: typeof o.instagram === 'string' ? o.instagram : null,
        whatsapp: typeof o.whatsapp === 'string' ? o.whatsapp : null,
        galeria: parseOrganizerGallery(o.galeria),
        portada: typeof o.portada === 'string' && o.portada.trim() ? o.portada.trim() : null,
        categorias: Array.isArray(o.categorias)
            ? o.categorias.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            : [],
        informacion: typeof o.informacion === 'string' ? o.informacion : null,
    };
}

export function countOrganizerSentences(text: string): number {
    return text
        .trim()
        .split(/[.!?]+/)
        .map((part) => part.trim())
        .filter(Boolean).length;
}

export function organizerProfileCopy(
    descripcion?: string | null,
    meta?: OrganizerMeta | null,
): { description: string; information: string } {
    const desc = (descripcion ?? '').trim();
    const info = (meta?.informacion ?? '').trim();
    if (info) return { description: desc, information: info };
    if (desc.length > ORGANIZER_DESC_MAX) {
        return { description: desc.slice(0, ORGANIZER_DESC_MAX).trim(), information: desc };
    }
    return { description: desc, information: '' };
}

export async function saveOrganizerMeta(
    userId: string,
    meta: OrganizerMeta,
): Promise<{ error: string | null }> {
    const { error } = await supabase.rpc('update_organizer_page', { p_organizador: meta });
    if (!error) return { error: null };
    const fallback = await supabase.from('perfiles').update({ organizador: meta }).eq('id', userId);
    return { error: fallback.error?.message ?? error.message };
}

export async function uploadPendingOrganizerLogo(
    userId: string,
    uri: string,
): Promise<{ url: string | null; error: string | null }> {
    try {
        const { compressImageForUpload } = await import('./imageCompress');
        const { uploadLocalUriToStorage } = await import('./storageUpload');
        const localUri = await compressImageForUpload(uri, 'avatar');
        const fileName = `${userId}/avatar.jpg`;
        await uploadLocalUriToStorage({
            bucket: 'avatars',
            path: fileName,
            uri: localUri,
            contentType: 'image/jpeg',
            upsert: true,
        });
        const { data } = supabase.storage.from('avatars').getPublicUrl(fileName);
        return { url: `${data.publicUrl}?t=${Date.now()}`, error: null };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'upload_failed';
        return { url: null, error: msg };
    }
}

/** Si al aprobar no se copió el logo, sincroniza avatar desde la solicitud aprobada. */
export async function syncOrganizerAvatarFromRequest(userId: string): Promise<string | null> {
    const { data: profile } = await supabase
        .from('perfiles')
        .select('avatar_url, es_organizador')
        .eq('id', userId)
        .maybeSingle();
    if (!profile?.es_organizador) return profile?.avatar_url ?? null;

    const { data: req } = await supabase
        .from('solicitudes_organizador')
        .select('logo_url')
        .eq('usuario_id', userId)
        .eq('estado', 'aprobado')
        .order('revisado_en', { ascending: false })
        .limit(1)
        .maybeSingle();

    const logoUrl = typeof req?.logo_url === 'string' ? req.logo_url.trim() : '';
    if (!logoUrl) return profile.avatar_url ?? null;

    const currentBase = (profile.avatar_url ?? '').split('?')[0];
    const logoBase = logoUrl.split('?')[0];
    if (currentBase === logoBase) return profile.avatar_url ?? logoUrl;

    const { error } = await supabase
        .from('perfiles')
        .update({ avatar_url: logoUrl })
        .eq('id', userId);
    if (error) return profile.avatar_url ?? null;

    void supabase.auth.updateUser({ data: { avatar_url: logoUrl } });
    return logoUrl;
}

export async function uploadPendingOrganizerCover(
    userId: string,
    uri: string,
): Promise<{ url: string | null; error: string | null }> {
    try {
        const { compressImageForUpload } = await import('./imageCompress');
        const { uploadLocalUriToStorage } = await import('./storageUpload');
        const localUri = await compressImageForUpload(uri, 'cover');
        const fileName = `${userId}/pending-cover.jpg`;
        await uploadLocalUriToStorage({
            bucket: 'organizador-media',
            path: fileName,
            uri: localUri,
            contentType: 'image/jpeg',
            upsert: true,
        });
        const { data } = supabase.storage.from('organizador-media').getPublicUrl(fileName);
        return { url: `${data.publicUrl}?t=${Date.now()}`, error: null };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'upload_failed';
        return { url: null, error: msg };
    }
}

export function organizerCategoryKeys(meta?: OrganizerMeta | null): string[] {
    const fromList = meta?.categorias?.filter(Boolean) ?? [];
    if (fromList.length) return [...new Set(fromList)];
    return meta?.tipo ? [meta.tipo] : [];
}

export function parseOrganizerGallery(raw: unknown): OrganizerMedia[] {
    if (!Array.isArray(raw)) return [];
    const items: OrganizerMedia[] = [];
    for (const row of raw) {
        if (!row || typeof row !== 'object') continue;
        const o = row as Record<string, unknown>;
        const url = typeof o.url === 'string' ? o.url.trim() : '';
        const kind = o.kind === 'video' ? 'video' : o.kind === 'image' ? 'image' : null;
        if (!url || !kind) continue;
        const thumb = typeof o.thumb === 'string' && o.thumb.trim() ? o.thumb.trim() : null;
        items.push({ url, kind, thumb });
        if (items.length >= MAX_ORGANIZER_GALLERY) break;
    }
    return items;
}

export async function getMyOrganizerRequest(): Promise<OrganizerRequest | null> {
    const selectFull =
        'id, usuario_id, nombre_org, tipo, ciudad, web, instagram, whatsapp, descripcion, motivo, estado, notas_internas, creado_en';
    const selectLegacy =
        'id, usuario_id, nombre_org, tipo, ciudad, web, instagram, descripcion, motivo, estado, notas_internas, creado_en';
    let { data, error } = await supabase
        .from('solicitudes_organizador')
        .select(selectFull)
        .order('creado_en', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) {
        const fallback = await supabase
            .from('solicitudes_organizador')
            .select(selectLegacy)
            .order('creado_en', { ascending: false })
            .limit(1)
            .maybeSingle();
        data = fallback.data as typeof data;
        error = fallback.error;
    }
    if (error || !data) return null;
    return data as OrganizerRequest;
}

export async function submitOrganizerRequest(input: {
    nombre: string;
    tipo: OrganizerType;
    ciudad: string;
    web: string;
    instagram: string;
    whatsapp?: string;
    descripcion: string;
    informacion: string;
    coverUrl?: string | null;
    logoUrl?: string | null;
    categorias?: string[];
}): Promise<{ id: string | null; error: string | null }> {
    const payload: Record<string, unknown> = {
        p_nombre: input.nombre.trim(),
        p_tipo: input.tipo,
        p_ciudad: input.ciudad.trim(),
        p_web: input.web.trim(),
        p_instagram: input.instagram.trim().replace(/^@/, ''),
        p_whatsapp: input.whatsapp?.trim() || null,
        p_descripcion: input.descripcion.trim(),
        p_motivo: '',
        p_cover_url: input.coverUrl?.trim() || null,
        p_categorias: input.categorias?.length ? input.categorias : [input.tipo],
        p_informacion: input.informacion.trim(),
        p_logo_url: input.logoUrl?.trim() || null,
    };
    let { data, error } = await supabase.rpc('request_organizer_account', payload);
    if (error && /p_whatsapp|could not find the function/i.test(error.message)) {
        const legacy = { ...payload };
        delete legacy.p_whatsapp;
        const retry = await supabase.rpc('request_organizer_account', legacy);
        data = retry.data;
        error = retry.error;
    }
    if (error) return { id: null, error: error.message };
    return { id: typeof data === 'string' ? data : null, error: null };
}

export async function fetchOrganizerRequests(onlyPending = true): Promise<OrganizerRequest[]> {
    const selectFull =
        'id, usuario_id, nombre_org, tipo, ciudad, web, instagram, whatsapp, descripcion, informacion, logo_url, cover_url, motivo, estado, notas_internas, creado_en, perfil:perfiles!usuario_id(nombre, nombre_usuario, avatar_url)';
    const selectLegacy =
        'id, usuario_id, nombre_org, tipo, ciudad, web, instagram, descripcion, motivo, estado, notas_internas, creado_en, perfil:perfiles!usuario_id(nombre, nombre_usuario, avatar_url)';
    const run = async (select: string) => {
        let q = supabase
            .from('solicitudes_organizador')
            .select(select)
            .order('creado_en', { ascending: false })
            .limit(100);
        if (onlyPending) q = q.eq('estado', 'pendiente');
        return q;
    };
    let { data, error } = await run(selectFull);
    if (error) {
        const fallback = await run(selectLegacy);
        data = fallback.data as typeof data;
        error = fallback.error;
    }
    if (error) return [];
    return ((data ?? []) as unknown as OrganizerRequest[]).map((row) => ({
        ...row,
        perfil: Array.isArray(row.perfil) ? row.perfil[0] ?? null : row.perfil ?? null,
    }));
}

export async function reviewOrganizerRequest(
    id: string,
    estado: 'aprobado' | 'rechazado',
    notas?: string,
): Promise<{ error: string | null }> {
    const { error } = await supabase.rpc('admin_set_organizer_request', {
        p_id: id,
        p_estado: estado,
        p_notas: notas ?? null,
    });
    return { error: error?.message ?? null };
}

export async function getOrganizerFollowStats(organizerId: string): Promise<{
    followers: number | null;
    following: boolean;
}> {
    const { data, error } = await supabase.rpc('get_organizer_follow_stats', {
        p_organizador_id: organizerId,
    });
    if (error || !data || typeof data !== 'object') return { followers: null, following: false };
    const row = data as { followers?: number; following?: boolean };
    return { followers: Number(row.followers ?? 0), following: row.following === true };
}

export async function followOrganizer(organizerId: string): Promise<{ error: string | null }> {
    const { error } = await supabase.rpc('follow_organizer', { p_organizador_id: organizerId });
    return { error: error?.message ?? null };
}

export async function unfollowOrganizer(organizerId: string): Promise<{ error: string | null }> {
    const { error } = await supabase.rpc('unfollow_organizer', { p_organizador_id: organizerId });
    return { error: error?.message ?? null };
}

export function organizerTypeKey(tipo?: string | null): string {
    const raw = tipo || 'other';
    if (raw === 'running_club') return 'organizer.type.sports';
    if (raw === 'culture' || raw === 'nightlife') return 'organizer.type.leisure';
    return `organizer.type.${raw}`;
}

export function isOrganizerAccount(profile?: { es_organizador?: boolean } | null): boolean {
    return profile?.es_organizador === true;
}

let viewerOrganizerMem: boolean | null = null;

/** Recuerda si la cuenta actual es organizador para no mostrar “Unirme” mientras carga. */
export function rememberViewerIsOrganizer(value: boolean): void {
    viewerOrganizerMem = value;
}

export function peekViewerIsOrganizer(): boolean {
    if (viewerOrganizerMem === true) return true;
    if (viewerOrganizerMem === false) return false;
    const snap = cacheGetStale<FeedSnapshot>(FEED_CACHE_KEY);
    if (snap?.isOrganizer === true) {
        viewerOrganizerMem = true;
        return true;
    }
    return false;
}

export async function isUserOrganizer(userId: string): Promise<boolean> {
    const { data } = await supabase.from('perfiles').select('es_organizador').eq('id', userId).maybeSingle();
    return data?.es_organizador === true;
}

export function planIsOrganizer(plan: {
    es_organizador?: boolean;
    participantsList?: Array<{ isCreator?: boolean; es_organizador?: boolean }>;
}): boolean {
    if (plan.es_organizador === true) return true;
    return plan.participantsList?.some((p) => p.isCreator && p.es_organizador) === true;
}

export function withOrganizerFlag<T extends { creador_id?: string }>(
    plan: T,
    creator?: { es_organizador?: boolean } | null,
): T & { es_organizador: boolean } {
    return { ...plan, es_organizador: creator?.es_organizador === true };
}

export async function updateOrganizerProfile(input: {
    ciudad: string;
    web: string;
    instagram: string;
    tipo?: string | null;
}): Promise<{ error: string | null }> {
    const { error } = await supabase.rpc('update_organizer_profile', {
        p_ciudad: input.ciudad.trim(),
        p_web: input.web.trim(),
        p_instagram: input.instagram.trim().replace(/^@/, ''),
        p_tipo: input.tipo ?? null,
    });
    return { error: error?.message ?? null };
}

export async function updateOrganizerGallery(items: OrganizerMedia[]): Promise<{ error: string | null }> {
    const payload = items.slice(0, MAX_ORGANIZER_GALLERY).map((item) => ({
        url: item.url,
        kind: item.kind,
        ...(item.thumb ? { thumb: item.thumb } : {}),
    }));
    const { error } = await supabase.rpc('update_organizer_gallery', { p_galeria: payload });
    if (!error) return { error: null };

    const authUser = await getAuthUser();
    const uid = authUser?.id;
    if (!uid) return { error: error.message };
    const { data: row } = await supabase.from('perfiles').select('organizador').eq('id', uid).maybeSingle();
    const current = parseOrganizerMeta(row?.organizador);
    const { error: fallbackError } = await supabase
        .from('perfiles')
        .update({ organizador: { ...current, galeria: payload } })
        .eq('id', uid);
    return { error: fallbackError?.message ?? null };
}

export async function uploadOrganizerMedia(
    userId: string,
    uri: string,
    kind: 'image' | 'video',
    mimeType?: string | null,
): Promise<OrganizerMedia | null> {
    const { uploadLocalFile, makeVideoThumb } = await import('./mediaUpload');
    const url = await uploadLocalFile({ userId, uri, kind, mimeType, folder: 'org' });
    if (!url) return null;
    if (kind !== 'video') return { url, kind };
    const posterUri = await makeVideoThumb(uri);
    const thumb = posterUri
        ? await uploadLocalFile({ userId, uri: posterUri, kind: 'image', mimeType: 'image/jpeg', folder: 'org' })
        : null;
    return { url, kind, thumb };
}

export type OrganizerUpcomingPlan = {
    id: string;
    titulo: string;
    fecha_evento: string | null;
    nombre_ubicacion: string | null;
    imagen_url: string | null;
    categoria: string | null;
    maximo_participantes: number | null;
    ocupadas: number;
};

export async function getOrganizerMembers(organizerId: string): Promise<
    Array<{
        id: string;
        nombre: string | null;
        nombre_usuario: string | null;
        avatar_url: string | null;
    }>
> {
    const { getPublicProfiles } = await import('./profileData');
    let ids: string[] = [];
    const rpc = await supabase.rpc('get_organizer_member_ids', {
        p_organizador_id: organizerId,
    });
    if (!rpc.error && Array.isArray(rpc.data)) {
        ids = rpc.data.flatMap((row) => {
            if (typeof row === 'string') return [row];
            if (row && typeof row === 'object') {
                const id = (row as { seguidor_id?: unknown }).seguidor_id;
                if (typeof id === 'string' && id) return [id];
            }
            return [];
        });
    } else {
        const { data, error } = await supabase
            .from('seguidores')
            .select('seguidor_id')
            .eq('organizador_id', organizerId)
            .order('creado_en', { ascending: false })
            .limit(200);
        if (error || !data?.length) return [];
        ids = data
            .map((row) => (typeof row.seguidor_id === 'string' ? row.seguidor_id : ''))
            .filter(Boolean);
    }
    if (!ids.length) return [];
    const previewIds = ids.slice(0, 24);
    try {
        const profiles = await getPublicProfiles(previewIds);
        const map = new Map(profiles.map((row) => [row.id, row]));
        return previewIds.flatMap((id) => {
            const row = map.get(id);
            if (!row) return [];
            return [{
                id: row.id,
                nombre: row.nombre,
                nombre_usuario: row.nombre_usuario,
                avatar_url: row.avatar_url,
            }];
        });
    } catch {
        return [];
    }
}

export async function getOrganizerPlansCount(organizerId: string): Promise<number> {
    const { data, error } = await supabase.rpc('get_organizer_completed_plans_count', {
        p_organizador_id: organizerId,
    });
    if (!error && data != null && Number.isFinite(Number(data))) {
        return Math.max(0, Number(data));
    }

    const now = new Date().toISOString();
    const { data: plans, error: plansError } = await supabase
        .from('planes')
        .select('id')
        .eq('creador_id', organizerId)
        .eq('modo_privado', false)
        .not('fecha_evento', 'is', null)
        .lt('fecha_evento', now)
        .or('estado.is.null,estado.neq.cancelado');
    if (plansError || !plans?.length) return 0;
    const ids = plans.map((row) => String(row.id));
    const { data: parts, error: partsError } = await supabase
        .from('participantes')
        .select('plan_id')
        .in('plan_id', ids)
        .eq('estado', 'aceptado');
    if (partsError || !parts) return 0;
    const counts = new Map<string, number>();
    for (const row of parts) {
        const planId = String(row.plan_id);
        counts.set(planId, (counts.get(planId) ?? 0) + 1);
    }
    let n = 0;
    for (const id of ids) {
        if ((counts.get(id) ?? 0) >= 1) n += 1;
    }
    return n;
}

function mapOrganizerPlanRows(rows: Array<Record<string, unknown>>): OrganizerUpcomingPlan[] {
    return rows.map((row) => {
        const nested = row.participantes;
        const countRow = Array.isArray(nested) ? nested[0] : nested;
        const ocupadas =
            countRow && typeof countRow === 'object' && 'count' in countRow
                ? Number((countRow as { count?: number }).count ?? 0)
                : 0;
        return {
            id: String(row.id),
            titulo: String(row.titulo ?? ''),
            fecha_evento: typeof row.fecha_evento === 'string' ? row.fecha_evento : null,
            nombre_ubicacion: typeof row.nombre_ubicacion === 'string' ? row.nombre_ubicacion : null,
            imagen_url: typeof row.imagen_url === 'string' ? row.imagen_url : null,
            categoria: typeof row.categoria === 'string' ? row.categoria : null,
            maximo_participantes:
                typeof row.maximo_participantes === 'number' ? row.maximo_participantes : null,
            ocupadas: Number.isFinite(ocupadas) ? ocupadas : 0,
        };
    });
}

export async function getOrganizerUpcomingPlans(organizerId: string, limit = 4): Promise<OrganizerUpcomingPlan[]> {
    const withCount = await supabase
        .from('planes')
        .select('id, titulo, fecha_evento, nombre_ubicacion, imagen_url, categoria, maximo_participantes, participantes(count)')
        .eq('creador_id', organizerId)
        .eq('modo_privado', false)
        .or(`fecha_evento.is.null,fecha_evento.gte.${new Date().toISOString()}`)
        .order('fecha_evento', { ascending: true, nullsFirst: false })
        .limit(limit);
    if (!withCount.error && withCount.data) {
        return mapOrganizerPlanRows(withCount.data as Array<Record<string, unknown>>);
    }

    const { data, error } = await supabase
        .from('planes')
        .select('id, titulo, fecha_evento, nombre_ubicacion, imagen_url, categoria, maximo_participantes')
        .eq('creador_id', organizerId)
        .eq('modo_privado', false)
        .or(`fecha_evento.is.null,fecha_evento.gte.${new Date().toISOString()}`)
        .order('fecha_evento', { ascending: true, nullsFirst: false })
        .limit(limit);
    if (error || !data) return [];
    return mapOrganizerPlanRows(data as Array<Record<string, unknown>>);
}

export async function getOrganizerPastPlans(organizerId: string, limit = 12): Promise<OrganizerUpcomingPlan[]> {
    const now = new Date().toISOString();
    const withCount = await supabase
        .from('planes')
        .select('id, titulo, fecha_evento, nombre_ubicacion, imagen_url, categoria, maximo_participantes, participantes(count)')
        .eq('creador_id', organizerId)
        .eq('modo_privado', false)
        .lt('fecha_evento', now)
        .order('fecha_evento', { ascending: false })
        .limit(limit);
    if (!withCount.error && withCount.data) {
        return mapOrganizerPlanRows(withCount.data as Array<Record<string, unknown>>);
    }

    const { data, error } = await supabase
        .from('planes')
        .select('id, titulo, fecha_evento, nombre_ubicacion, imagen_url, categoria, maximo_participantes')
        .eq('creador_id', organizerId)
        .eq('modo_privado', false)
        .lt('fecha_evento', now)
        .order('fecha_evento', { ascending: false })
        .limit(limit);
    if (error || !data) return [];
    return mapOrganizerPlanRows(data as Array<Record<string, unknown>>);
}

export function organizerPlanCard(plan: OrganizerUpcomingPlan): {
    id: string;
    titulo: string;
    imagen_url: string | null;
    fecha_evento: string | null;
    nombre_ubicacion: string | null;
    categoria: string | null;
} {
    return {
        id: plan.id,
        titulo: plan.titulo,
        imagen_url: plan.imagen_url,
        fecha_evento: plan.fecha_evento,
        nombre_ubicacion: plan.nombre_ubicacion,
        categoria: plan.categoria,
    };
}

export function organizerWebUrl(web?: string | null): string | null {
    const raw = (web ?? '').trim();
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) return raw;
    return `https://${raw}`;
}

export function organizerInstagramUrl(handle?: string | null): string | null {
    const raw = (handle ?? '').trim().replace(/^@/, '');
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) return raw;
    return `https://instagram.com/${raw}`;
}

export function organizerWhatsappUrl(raw?: string | null): string | null {
    const value = (raw ?? '').trim();
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    if (/^(chat\.whatsapp\.com|wa\.me|api\.whatsapp\.com)\//i.test(value)) {
        return `https://${value}`;
    }
    if (/^[A-Za-z0-9_-]{8,}$/.test(value)) {
        return `https://chat.whatsapp.com/${value}`;
    }
    return `https://${value}`;
}

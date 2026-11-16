import { MAIN_CATEGORY_IDS } from './categories';
import { FEED_PLAN_COLUMNS } from './feedCache';
import { boundingBox } from './geo';
import { isFeedPlan } from './feedPlans';
import type { UserCoords } from './location';
import {
    formatPlanPeople,
    isAcceptedParticipant,
} from './participants';
import { getPublicProfileCards } from './profileData';
import { getAuthUser } from './auth';
import { supabase } from './supabase';

const GEO_KM = 80;
const BASE_LIMIT = 100;
const CATEGORY_LIMIT = 80;
const FRIEND_LIMIT = 40;
const GLOBAL_LIMIT = 120;
const MERGE_CAP = 160;
const MORE_PAGE_SIZE = 40;
const IN_CHUNK = 120;
const AVATAR_SAMPLE = 8;

export type FeedPlanRow = Record<string, unknown> & { id: string };

/** Cursor keyset para cargar más planes (fecha + id, para evitar saltos en empates). */
export type FeedMoreCursor = {
    eventAt: string;
    id: string;
};

type FeedPeopleRow = {
    plan_id: string;
    joinedCount?: number;
    es_organizador?: boolean;
    host?: Record<string, unknown> | null;
    participantsList?: unknown[];
};

function mergePlanRows(groups: Array<FeedPlanRow[] | null | undefined>): FeedPlanRow[] {
    const byId = new Map<string, FeedPlanRow>();
    for (const group of groups) {
        for (const row of group || []) {
            const id = String(row?.id || '');
            if (!id || byId.has(id)) continue;
            byId.set(id, row);
            if (byId.size >= MERGE_CAP) return [...byId.values()];
        }
    }
    return [...byId.values()];
}

async function runPlanSelect(query: PromiseLike<{ data: unknown[] | null; error: { message?: string } | null }>): Promise<FeedPlanRow[]> {
    const res = await query;
    if (res.error) throw res.error;
    return ((res.data || []) as FeedPlanRow[]).filter((row) => row?.id);
}

function upcomingQuery(nowIso: string) {
    return supabase
        .from('planes')
        .select(FEED_PLAN_COLUMNS)
        .or(`fecha_evento.is.null,fecha_evento.gte.${nowIso}`);
}

/**
 * Trae planes de la zona + los de las categorías que le gustan a la persona
 * + los de amigos. Ya no se corta en los 100 más próximos del mundo.
 */
export async function fetchUpcomingFeedPlanRows(opts: {
    nowIso: string;
    coords?: UserCoords | null;
    preferredCategories?: string[];
    friendIds?: string[];
    includeBase?: boolean;
    creatorId?: string | null;
    joinedPlanIds?: string[];
}): Promise<FeedPlanRow[]> {
    const includeBase = opts.includeBase !== false;
    const cats = (opts.preferredCategories || []).filter((c) =>
        (MAIN_CATEGORY_IDS as readonly string[]).includes(c),
    ).slice(0, 4);
    const friendIds = (opts.friendIds || []).filter(Boolean).slice(0, 60);
    const jobs: Array<Promise<FeedPlanRow[]>> = [];

    let localRows: FeedPlanRow[] = [];
    if (includeBase) {
        if (opts.coords) {
            const box = boundingBox(opts.coords.latitude, opts.coords.longitude, GEO_KM);
            localRows = await runPlanSelect(
                upcomingQuery(opts.nowIso)
                    .gte('latitud', box.minLat)
                    .lte('latitud', box.maxLat)
                    .gte('longitud', box.minLng)
                    .lte('longitud', box.maxLng)
                    .order('fecha_evento', { ascending: true })
                    .limit(BASE_LIMIT),
            );
            // La lista mundial solo si alrededor no hay casi nada (GPS en otra ciudad).
            if (localRows.length < 12) {
                jobs.push(runPlanSelect(
                    upcomingQuery(opts.nowIso)
                        .order('fecha_evento', { ascending: true })
                        .limit(GLOBAL_LIMIT),
                ));
            }
        } else {
            jobs.push(runPlanSelect(
                upcomingQuery(opts.nowIso)
                    .order('fecha_evento', { ascending: true })
                    .limit(GLOBAL_LIMIT),
            ));
        }
    }

    if (cats.length) {
        // Sin recorte geo: el chip “Cerca” filtra en cliente; aquí queremos planes de todo el mundo.
        jobs.push(runPlanSelect(
            upcomingQuery(opts.nowIso)
                .in('categoria', cats)
                .order('fecha_evento', { ascending: true })
                .limit(CATEGORY_LIMIT),
        ));
    }

    if (friendIds.length) {
        jobs.push(runPlanSelect(
            upcomingQuery(opts.nowIso)
                .in('creador_id', friendIds)
                .order('fecha_evento', { ascending: true })
                .limit(FRIEND_LIMIT),
        ));
    }

    if (opts.creatorId) {
        jobs.push(runPlanSelect(
            upcomingQuery(opts.nowIso)
                .eq('creador_id', opts.creatorId)
                .order('fecha_evento', { ascending: true })
                .limit(40),
        ));
    }

    const joinedIds = [...new Set((opts.joinedPlanIds || []).filter(Boolean))].slice(0, 80);
    if (joinedIds.length) {
        jobs.push(runPlanSelect(
            upcomingQuery(opts.nowIso)
                .in('id', joinedIds)
                .order('fecha_evento', { ascending: true })
                .limit(80),
        ));
    }

    const groups = jobs.length ? await Promise.all(jobs) : [];
    return mergePlanRows([localRows, ...groups]);
}

/**
 * Página siguiente del feed: próximos por fecha, sin los ya vistos.
 * No reordena la ventana de afinidad ya pintada; solo aporta cola.
 */
export async function fetchMoreFeedPlanRows(opts: {
    nowIso: string;
    excludeIds: string[];
    cursor?: FeedMoreCursor | null;
    limit?: number;
}): Promise<{ rows: FeedPlanRow[]; nextCursor: FeedMoreCursor | null; hasMore: boolean }> {
    const pageSize = Math.max(10, Math.min(opts.limit ?? MORE_PAGE_SIZE, 80));
    const exclude = new Set((opts.excludeIds || []).map(String).filter(Boolean));
    let cursor = opts.cursor ?? null;
    const found: FeedPlanRow[] = [];

    for (let attempt = 0; attempt < 6 && found.length < pageSize; attempt++) {
        // El paginador solo puede ordenar planes con fecha; los planes sin fecha
        // continúan mostrándose en la carga inicial, no en esta cola cronológica.
        let query = upcomingQuery(opts.nowIso)
            .not('fecha_evento', 'is', null)
            .order('fecha_evento', { ascending: true })
            .order('id', { ascending: true })
            .limit(pageSize);

        if (cursor?.eventAt) {
            // Un filtro gt(fecha) saltaba planes con la misma fecha y hora.
            // Utilizamos un cursor lexicográfico (fecha, UUID).
            const eventAt = new Date(cursor.eventAt);
            if (!Number.isFinite(eventAt.getTime()) ||
                !/^[0-9a-f-]{36}$/i.test(cursor.id)) {
                throw new Error('Invalid feed pagination cursor');
            }
            const iso = eventAt.toISOString();
            query = query.or(
                `fecha_evento.gt."${iso}",and(fecha_evento.eq."${iso}",id.gt.${cursor.id})`,
            );
        }

        const batch = await runPlanSelect(query);
        if (batch.length === 0) {
            return { rows: found, nextCursor: cursor, hasMore: false };
        }

        for (const row of batch) {
            const eventAt = typeof row.fecha_evento === 'string'
                ? row.fecha_evento : null;
            if (eventAt) cursor = { eventAt, id: String(row.id) };
            if (!exclude.has(String(row.id))) {
                found.push(row);
                exclude.add(String(row.id));
            }
            if (found.length >= pageSize) break;
        }

        if (batch.length < pageSize) {
            return { rows: found, nextCursor: cursor, hasMore: false };
        }
    }

    return {
        rows: found,
        nextCursor: cursor,
        hasMore: true,
    };
}

function asPeopleRows(data: unknown): FeedPeopleRow[] {
    if (Array.isArray(data)) return data as FeedPeopleRow[];
    if (typeof data === 'string') {
        try {
            const parsed = JSON.parse(data);
            return Array.isArray(parsed) ? parsed as FeedPeopleRow[] : [];
        } catch {
            return [];
        }
    }
    return [];
}

async function attachFeedPlanPeopleRpc(safePlans: FeedPlanRow[]): Promise<any[] | null> {
    const planIds = safePlans.map((p) => String(p.id));
    const { data, error } = await supabase.rpc('get_feed_plan_people', { p_plan_ids: planIds });
    if (error) throw error;
    const rows = asPeopleRows(data);
    if (rows.length === 0 && planIds.length > 0) return null;
    const byId = new Map<string, FeedPeopleRow>();
    for (const row of rows) {
        const id = String(row.plan_id || '');
        if (id) byId.set(id, row);
    }
    if (byId.size === 0) return null;
    return safePlans.map((plan) => {
        const people = byId.get(String(plan.id));
        if (!people) {
            return {
                ...plan,
                joinedCount: 0,
                participantsList: [],
                host: null,
                es_organizador: false,
            };
        }
        const list = Array.isArray(people.participantsList) ? people.participantsList : [];
        return {
            ...plan,
            joinedCount: Number(people.joinedCount) || 0,
            participantsList: list,
            host: people.host ?? null,
            es_organizador: people.es_organizador === true,
        };
    });
}

async function fetchAcceptedParticipants(planIds: string[]): Promise<Array<{ plan_id: string; usuario_id: string; estado: string }>> {
    const chunks: string[][] = [];
    for (let i = 0; i < planIds.length; i += IN_CHUNK) {
        chunks.push(planIds.slice(i, i + IN_CHUNK));
    }
    const groups = await Promise.all(chunks.map(async (ids) => {
        const { data, error } = await supabase
            .from('participantes')
            .select('plan_id, usuario_id, estado')
            .in('plan_id', ids)
            .eq('estado', 'aceptado');
        if (error) throw error;
        return (data || []) as Array<{ plan_id: string; usuario_id: string; estado: string }>;
    }));
    return groups.flat();
}

async function attachFeedPlanPeopleFallback(safePlans: FeedPlanRow[]): Promise<any[]> {
    const planIds = safePlans.map((p) => String(p.id));
    const creatorIds = Array.from(new Set(safePlans.map((p) => String(p.creador_id || '')).filter(Boolean)));
    const partRows = planIds.length > 0 ? await fetchAcceptedParticipants(planIds) : [];

    const partsByPlan: Record<string, typeof partRows> = {};
    for (const row of partRows) {
        if (!partsByPlan[row.plan_id]) partsByPlan[row.plan_id] = [];
        partsByPlan[row.plan_id].push(row);
    }

    const sampleIds = new Set<string>(creatorIds);
    for (const plan of safePlans) {
        const rows = partsByPlan[String(plan.id)] || [];
        let added = 0;
        for (const row of rows) {
            if (row.usuario_id === plan.creador_id) continue;
            sampleIds.add(row.usuario_id);
            added += 1;
            if (added >= AVATAR_SAMPLE) break;
        }
    }

    const publicProfiles = await getPublicProfileCards([...sampleIds]);
    const profileMap = Object.fromEntries(publicProfiles.map((profile) => [profile.id, profile]));

    return safePlans.map((plan) => {
        const rawParticipants = partsByPlan[String(plan.id)] || [];
        const accepted = rawParticipants.filter((p) => isAcceptedParticipant(p.estado));
        const people = formatPlanPeople({
            creadorId: String(plan.creador_id || ''),
            creatorProfile: profileMap[String(plan.creador_id || '')],
            acceptedUserIds: accepted.map((p) => p.usuario_id),
            profileOf: (id) => profileMap[id],
        });
        return {
            ...plan,
            joinedCount: people.joinedCount,
            participantsList: people.participantsList.slice(0, AVATAR_SAMPLE),
            host: people.host,
            es_organizador: people.es_organizador,
        };
    });
}

/** Une participantes y perfiles públicos a las filas crudas del feed. */
export async function attachFeedPlanPeople(
    rawPlans: FeedPlanRow[],
    opts?: { keepNonFeed?: boolean },
): Promise<any[]> {
    const safePlans = opts?.keepNonFeed
        ? rawPlans.filter((plan) => plan?.id)
        : rawPlans.filter((plan) => isFeedPlan(plan as { categoria?: string | null }));
    if (safePlans.length === 0) return [];
    try {
        const viaRpc = await attachFeedPlanPeopleRpc(safePlans);
        if (viaRpc) return viaRpc;
    } catch (e) {
        console.warn('get_feed_plan_people:', e);
    }
    return attachFeedPlanPeopleFallback(safePlans);
}

function asJsonRows(data: unknown): FeedPlanRow[] {
    const list = Array.isArray(data) ? data : [];
    return list.filter((row): row is FeedPlanRow => !!row && typeof row === 'object' && !!(row as { id?: unknown }).id);
}

const searchCache = new Map<string, { at: number; rows: any[] }>();
const SEARCH_CACHE_MS = 45_000;

/** Planes que no están en el lote del feed (título, sitio, categoría, anfitrión). */
export async function fetchSearchFeedPlans(query: string): Promise<any[]> {
    const q = query.trim().slice(0, 80);
    if (q.length < 2) return [];
    const cached = searchCache.get(q);
    if (cached && Date.now() - cached.at < SEARCH_CACHE_MS) return cached.rows;
    const { data, error } = await supabase.rpc('search_feed_plans', { p_query: q });
    if (error) throw error;
    const raw = asJsonRows(data);
    if (raw.length === 0) {
        searchCache.set(q, { at: Date.now(), rows: [] });
        return [];
    }
    const user = await getAuthUser();
    if (user) {
        try {
            const withPeople = await attachFeedPlanPeople(raw);
            searchCache.set(q, { at: Date.now(), rows: withPeople });
            return withPeople;
        } catch {
            /* fallback al payload del RPC */
        }
    }
    const plain = raw.map((row) => ({
        ...row,
        joinedCount: Number(row.joinedCount) || 0,
        participantsList: Array.isArray(row.participantsList) ? row.participantsList : [],
        host: row.host ?? null,
        es_organizador: row.es_organizador === true,
    }));
    searchCache.set(q, { at: Date.now(), rows: plain });
    return plain;
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { topAttendedCategory } from './badgeStats';
import { getCoincidedUserIds } from './coincidences';
import {
    getFriends,
    getIncomingRequests,
    getOutgoingRequests,
    type FriendProfile,
} from './friends';
import {
    affinityPersonFromProfile,
    countSharedOrganizerFollowsMany,
    resolveProfileAffinity,
} from './profileAffinity';
import { getMyProfile, getPublicProfiles, type PublicProfileRow } from './profileData';
import { calcAge } from './profileFields';
import { EMPTY_STATS, hasPublicRepeatStats, type UserStats } from './stats';
import { supabase } from './supabase';
import { cacheGetOrFetch, cacheInvalidate } from './ttlCache';

export type FriendSuggestionReason =
    | 'coincided_fof'
    | 'coincided'
    | 'friend_of_friend'
    | 'affinity';

export type FriendSuggestion = FriendProfile & {
    reason: FriendSuggestionReason;
};

const SUGGEST_TTL_MS = 90_000;
const DISMISS_PREFIX = '@nexo_friend_suggest_hide:';
export const FRIEND_SUGGESTIONS_MAX = 20;
const AFFINITY_POOL_MAX = 120;

type OrderedSuggestion = { id: string; reason: FriendSuggestionReason };

export function friendSuggestionsCacheKey(userId: string) {
    return `friendSuggestions:${userId}:v3`;
}

function dismissKey(userId: string, peerId: string) {
    return `${DISMISS_PREFIX}${userId}:${peerId}`;
}

/** Oculta un sugerido de la lista (persistente en el dispositivo). */
export async function dismissFriendSuggestion(userId: string, peerId: string): Promise<void> {
    if (!userId || !peerId) return;
    await AsyncStorage.setItem(dismissKey(userId, peerId), '1');
    cacheInvalidate(friendSuggestionsCacheKey(userId));
}

async function getDismissedSuggestionIds(userId: string, peerIds: string[]): Promise<Set<string>> {
    if (peerIds.length === 0) return new Set();
    const pairs = await AsyncStorage.multiGet(peerIds.map((id) => dismissKey(userId, id)));
    const hidden = new Set<string>();
    for (let i = 0; i < pairs.length; i++) {
        if (pairs[i]?.[1]) hidden.add(peerIds[i]);
    }
    return hidden;
}

async function getFriendOfFriendIds(userId: string, friendIds: string[]): Promise<string[]> {
    const ids = friendIds.filter(Boolean).slice(0, 80);
    if (!ids.length) return [];
    const [asOrigin, asDest] = await Promise.all([
        supabase
            .from('amistades')
            .select('usuario_destino_id')
            .eq('estado', 'aceptado')
            .in('usuario_origen_id', ids),
        supabase
            .from('amistades')
            .select('usuario_origen_id')
            .eq('estado', 'aceptado')
            .in('usuario_destino_id', ids),
    ]);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const row of asOrigin.data ?? []) {
        const id = row.usuario_destino_id as string;
        if (!id || id === userId || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    for (const row of asDest.data ?? []) {
        const id = row.usuario_origen_id as string;
        if (!id || id === userId || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}

function pushUnique(
    ordered: OrderedSuggestion[],
    seen: Set<string>,
    ids: string[],
    reason: FriendSuggestionReason,
) {
    for (const id of ids) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ordered.push({ id, reason });
    }
}

type StatsLite = {
    porcentaje_repetiria?: number | null;
    numero_evaluadores_distintos?: number | null;
    planes_tapas?: number | null;
    planes_deporte?: number | null;
    planes_fiesta?: number | null;
    planes_estudio?: number | null;
};

function statsToUserStats(row: StatsLite | undefined): UserStats | null {
    if (!row) return null;
    return {
        ...EMPTY_STATS,
        porcentajeRepetiria: Number(row.porcentaje_repetiria) || 0,
        numeroEvaluadoresDistintos: Number(row.numero_evaluadores_distintos) || 0,
    };
}

function topCategoryFromStats(row: StatsLite | undefined) {
    if (!row) return null;
    return topAttendedCategory({
        ...EMPTY_STATS,
        planesTapas: Number(row.planes_tapas) || 0,
        planesDeporte: Number(row.planes_deporte) || 0,
        planesFiesta: Number(row.planes_fiesta) || 0,
        planesEstudio: Number(row.planes_estudio) || 0,
        planesAireLibre: 0,
        planesShowtime: 0,
        planesSoloChicas: 0,
        planesCreados: 0,
        categoriasProbadas: 0,
        personasDistintas: 0,
        cuentaAntiguedadDias: 0,
    });
}

function tagsOf(profile: PublicProfileRow | { ambientes_preferidos?: string[] | null; etiquetas?: string[] | null }) {
    const preferred = Array.isArray(profile.ambientes_preferidos) ? profile.ambientes_preferidos : [];
    if (preferred.length) return preferred;
    return Array.isArray(profile.etiquetas) ? profile.etiquetas : [];
}

async function fetchStatsMap(userIds: string[]): Promise<Map<string, StatsLite>> {
    const out = new Map<string, StatsLite>();
    const ids = userIds.filter(Boolean);
    if (!ids.length) return out;
    for (let i = 0; i < ids.length; i += 80) {
        const chunk = ids.slice(i, i + 80);
        const { data } = await supabase
            .from('estadisticas_usuario')
            .select(
                'usuario_id, porcentaje_repetiria, numero_evaluadores_distintos, planes_tapas, planes_deporte, planes_fiesta, planes_estudio, numero_planes_realizados',
            )
            .in('usuario_id', chunk);
        for (const row of data ?? []) {
            const id = row.usuario_id as string;
            if (id) out.set(id, row);
        }
    }
    return out;
}

async function collectAffinityPoolIds(userId: string, exclude: Set<string>, viewerTags: string[]): Promise<string[]> {
    const seen = new Set<string>();
    const out: string[] = [];
    const take = (id: string | null | undefined) => {
        if (!id || exclude.has(id) || seen.has(id)) return;
        seen.add(id);
        out.push(id);
    };

    const tagQuery = viewerTags.filter(Boolean).slice(0, 11);
    const [activeRes, tagCandidatesRes, myFollowsRes] = await Promise.all([
        supabase
            .from('estadisticas_usuario')
            .select('usuario_id')
            .gt('numero_planes_realizados', 0)
            .order('numero_planes_realizados', { ascending: false })
            .limit(80),
        tagQuery.length
            ? supabase.rpc('get_profile_interest_candidates', { p_tags: tagQuery, p_limit: 120 })
            : Promise.resolve({ data: [] as { id: string }[] }),
        supabase.from('seguidores').select('organizador_id').eq('seguidor_id', userId),
    ]);

    for (const row of activeRes.data ?? []) take(row.usuario_id as string);
    for (const row of tagCandidatesRes.data ?? []) take(String(row.id));

    const myOrgs = [...new Set((myFollowsRes.data ?? []).map((row) => String(row.organizador_id || '')).filter(Boolean))].slice(0, 40);
    if (myOrgs.length) {
        const { data: peers } = await supabase
            .from('seguidores')
            .select('seguidor_id')
            .in('organizador_id', myOrgs)
            .neq('seguidor_id', userId)
            .limit(120);
        for (const row of peers ?? []) take(row.seguidor_id as string);
    }

    return out.slice(0, AFFINITY_POOL_MAX);
}

async function rankByAffinity(
    userId: string,
    exclude: Set<string>,
    limit: number,
): Promise<string[]> {
    if (limit <= 0) return [];

    const meRes = await getMyProfile();
    const me = meRes.data;
    const viewerTags = me ? tagsOf(me) : [];
    const viewer = affinityPersonFromProfile({
        age: calcAge(me?.fecha_nacimiento),
        tags: viewerTags,
    });

    const poolIds = await collectAffinityPoolIds(userId, exclude, viewerTags);
    if (!poolIds.length) return [];

    const [publics, statsMap, sharedMap] = await Promise.all([
        getPublicProfiles(poolIds),
        fetchStatsMap([userId, ...poolIds]),
        countSharedOrganizerFollowsMany(userId, poolIds),
    ]);
    viewer.topCategory = topCategoryFromStats(statsMap.get(userId));

    const scored = publics
        .filter((row) => row.es_organizador !== true)
        .map((row) => {
            const stats = statsToUserStats(statsMap.get(row.id));
            const target = affinityPersonFromProfile({
                age: row.edad,
                tags: tagsOf(row),
                stats: stats && hasPublicRepeatStats(stats) ? stats : null,
            });
            target.topCategory = topCategoryFromStats(statsMap.get(row.id));
            const { score } = resolveProfileAffinity({
                viewer,
                target,
                viewerId: userId,
                targetId: row.id,
                isFriends: false,
                mutualFriends: 0,
                sharedCommunities: sharedMap.get(row.id) ?? 0,
            });
            return { id: row.id, score };
        })
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

    return scored.slice(0, Math.max(limit, 1)).map((row) => row.id);
}

/**
 * Hasta 20: primero amigos de amigos con los que coincidiste,
 * luego coincidencias, luego solo amigos de amigos, y el resto por afinidad.
 */
export async function getFriendSuggestions(
    userId: string,
    limit = FRIEND_SUGGESTIONS_MAX,
): Promise<FriendSuggestion[]> {
    if (!userId) return [];
    const cap = Math.max(1, Math.min(limit, FRIEND_SUGGESTIONS_MAX));
    return cacheGetOrFetch(friendSuggestionsCacheKey(userId), SUGGEST_TTL_MS, async () => {
        const [coincided, friends, outgoing, incoming] = await Promise.all([
            getCoincidedUserIds(userId),
            getFriends(userId),
            getOutgoingRequests(userId),
            getIncomingRequests(userId),
        ]);

        const friendIds = friends.map((f) => f.id);
        const exclude = new Set<string>([
            userId,
            ...friendIds,
            ...outgoing.map((r) => r.perfil.id),
            ...incoming.map((r) => r.perfil.id),
        ]);

        const coincidedIds = [...coincided].filter((id) => !exclude.has(id));
        const fofIds = (await getFriendOfFriendIds(userId, friendIds)).filter((id) => !exclude.has(id));
        const fofSet = new Set(fofIds);

        const ordered: OrderedSuggestion[] = [];
        const seen = new Set<string>();
        pushUnique(ordered, seen, coincidedIds.filter((id) => fofSet.has(id)), 'coincided_fof');
        pushUnique(ordered, seen, coincidedIds.filter((id) => !fofSet.has(id)), 'coincided');
        pushUnique(ordered, seen, fofIds, 'friend_of_friend');

        const dismissed = await getDismissedSuggestionIds(userId, [
            ...ordered.map((row) => row.id),
        ]);
        let visible = ordered.filter((row) => !dismissed.has(row.id));

        if (visible.length < cap + 8) {
            const affinityExclude = new Set<string>([...exclude, ...seen, ...dismissed]);
            const affinityIds = await rankByAffinity(userId, affinityExclude, cap - visible.length + 12);
            const affinityDismissed = await getDismissedSuggestionIds(userId, affinityIds);
            pushUnique(
                visible,
                new Set(visible.map((row) => row.id)),
                affinityIds.filter((id) => !affinityDismissed.has(id) && !affinityExclude.has(id)),
                'affinity',
            );
        }

        if (visible.length === 0) return [];

        const fetchIds = visible.slice(0, Math.min(visible.length, cap + 24)).map((row) => row.id);
        const { data, error } = await supabase
            .from('perfiles')
            .select('id, nombre, nombre_usuario, avatar_url, es_organizador')
            .in('id', fetchIds);

        if (error || !data?.length) return [];

        const reasonById = new Map(visible.map((row) => [row.id, row.reason]));
        const order = new Map(visible.map((row, i) => [row.id, i]));
        return data
            .filter((row) => row.es_organizador !== true)
            .map((row) => ({
                id: row.id as string,
                nombre: (row.nombre as string) || 'Usuario',
                nombre_usuario: (row.nombre_usuario as string | null) ?? null,
                avatar_url: (row.avatar_url as string | null) ?? null,
                reason: reasonById.get(row.id as string) ?? ('coincided' as const),
            }))
            .sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99))
            .slice(0, cap);
    });
}

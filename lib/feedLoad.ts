import { getCoincidedUserIds } from './coincidences';
import {
    buildFeedTaste,
    emptyFeedTaste,
    preferredFetchCategories,
    type FeedTaste,
} from './feedAffinity';
import type { FeedSnapshot } from './feedCache';
import { attachFeedPlanPeople, fetchUpcomingFeedPlanRows } from './feedQuery';
import { getFriends } from './friends';
import type { UserCoords } from './location';
import { mapEstadoToMembership } from './participants';
import { calcAge, type Genero } from './profileFields';
import { getMyProfile } from './profileData';
import { rememberViewerIsOrganizer } from './organizer';
import { withRetry } from './retry';
import { supabase } from './supabase';

export type SignedInFeedLoad = FeedSnapshot & { isOrganizer: boolean };

const feedSnapshotInflight = new Map<string, Promise<SignedInFeedLoad>>();

function feedSnapshotKey(userId: string, coords?: UserCoords | null): string {
    const lat = coords?.latitude != null ? coords.latitude.toFixed(3) : 'x';
    const lng = coords?.longitude != null ? coords.longitude.toFixed(3) : 'x';
    return `${userId}:${lat}:${lng}`;
}

/**
 * Feed autenticado: geo en paralelo con perfil/amigos, y el extra de
 * categorías/amigos arranca en cuanto hay ids (sin esperar al geo).
 * Las llamadas simultáneas (Home + prefetch) comparten la misma promesa.
 */
export async function fetchSignedInFeedSnapshot(
    userId: string,
    coords?: UserCoords | null,
): Promise<SignedInFeedLoad> {
    const key = feedSnapshotKey(userId, coords);
    const pending = feedSnapshotInflight.get(key);
    if (pending) return pending;
    const work = loadSignedInFeedSnapshot(userId, coords).finally(() => {
        if (feedSnapshotInflight.get(key) === work) feedSnapshotInflight.delete(key);
    });
    feedSnapshotInflight.set(key, work);
    return work;
}

async function loadSignedInFeedSnapshot(
    userId: string,
    coords?: UserCoords | null,
): Promise<SignedInFeedLoad> {
    const nowIso = new Date().toISOString();

    const profileP = getMyProfile();
    const partsP = supabase.from('participantes').select('plan_id, estado').eq('usuario_id', userId);
    const savedP = supabase.from('planes_guardados').select('plan_id').eq('usuario_id', userId);
    const friendsP = getFriends(userId);
    const createdP = supabase
        .from('planes')
        .select('categoria, tipo_deporte')
        .eq('creador_id', userId)
        .order('fecha_evento', { ascending: false })
        .limit(40);
    const joinedHistoryP = supabase
        .from('participantes')
        .select('planes(categoria, tipo_deporte)')
        .eq('usuario_id', userId)
        .eq('estado', 'aceptado')
        .order('creado_en', { ascending: false })
        .limit(40);
    const coincidedP = getCoincidedUserIds(userId);
    const invitesP = supabase
        .from('invitaciones_planes')
        .select('plan_id')
        .eq('invitado_id', userId)
        .eq('estado', 'pendiente');
    const baseP = withRetry(() => fetchUpcomingFeedPlanRows({ nowIso, coords, creatorId: userId }));

    const supplementP = Promise.all([profileP, friendsP, partsP, createdP]).then(([
        profileRes,
        friendsData,
        participantsRes,
        createdPlansRes,
    ]) => {
        const tagsEarly =
            (Array.isArray(profileRes.data?.ambientes_preferidos) && profileRes.data.ambientes_preferidos.length
                ? profileRes.data.ambientes_preferidos
                : profileRes.data?.etiquetas) || [];
        const joinedIds = (participantsRes.data || [])
            .filter((p: { estado?: string | null }) => mapEstadoToMembership(p.estado) === 'joined')
            .map((p: { plan_id: string }) => p.plan_id);
        return fetchUpcomingFeedPlanRows({
            nowIso,
            coords,
            preferredCategories: preferredFetchCategories(
                buildFeedTaste(tagsEarly as string[], createdPlansRes.data || [], calcAge(profileRes.data?.fecha_nacimiento)),
            ),
            friendIds: friendsData.map((f) => f.id),
            includeBase: false,
            joinedPlanIds: joinedIds,
        });
    });

    const [
        profileRes,
        participantsRes,
        savedRes,
        friendsData,
        createdPlansRes,
        joinedHistoryRes,
        coincidedSet,
        invitesRes,
        basePlanRows,
        supplementRows,
    ] = await Promise.all([
        profileP,
        partsP,
        savedP,
        friendsP,
        createdP,
        joinedHistoryP,
        coincidedP,
        invitesP,
        baseP,
        supplementP,
    ]);

    const seen = new Set(basePlanRows.map((p) => String(p.id)));
    const mergedRows = [...basePlanRows];
    for (const row of supplementRows) {
        const id = String(row.id);
        if (seen.has(id)) continue;
        seen.add(id);
        mergedRows.push(row);
    }
    const formattedPlans = await attachFeedPlanPeople(mergedRows);

    const membershipMap: FeedSnapshot['membershipMap'] = {};
    (participantsRes.data || []).forEach((p: { plan_id: string; estado?: string | null }) => {
        const m = mapEstadoToMembership(p.estado);
        if (m) membershipMap[p.plan_id] = m;
    });

    const joinedHistoryFromDb = (joinedHistoryRes.data || [])
        .map((row) => {
            const plan = row.planes;
            const p = Array.isArray(plan) ? plan[0] : plan;
            if (!p || typeof p !== 'object') return null;
            const o = p as { categoria?: string | null; tipo_deporte?: string | null };
            return { categoria: o.categoria, tipo_deporte: o.tipo_deporte };
        })
        .filter((row): row is NonNullable<typeof row> => row != null);

    const joinedPlanIds = new Set(
        (participantsRes.data || [])
            .filter((p: { estado?: string | null }) => mapEstadoToMembership(p.estado) === 'joined')
            .map((p: { plan_id: string }) => p.plan_id),
    );
    const joinedHistoryFromFeed = mergedRows
        .filter((row) => joinedPlanIds.has(String(row.id)))
        .map((row) => ({
            categoria: row.categoria as string | null | undefined,
            tipo_deporte: row.tipo_deporte as string | null | undefined,
        }));

    const historyPlans = [
        ...(createdPlansRes.data || []),
        ...joinedHistoryFromDb,
        ...joinedHistoryFromFeed,
    ];

    const tags =
        (Array.isArray(profileRes.data?.ambientes_preferidos) && profileRes.data.ambientes_preferidos.length
            ? profileRes.data.ambientes_preferidos
            : profileRes.data?.etiquetas) ?? [];

    const organizer = profileRes.data?.es_organizador === true;
    rememberViewerIsOrganizer(organizer);

    return {
        plans: formattedPlans,
        membershipMap,
        savedPlans: savedRes.data?.map((s) => s.plan_id) || [],
        currentUserId: userId,
        currentUserGenero: (profileRes.data?.genero as Genero) ?? null,
        friendIds: friendsData.map((f) => f.id),
        coincidedIds: [...coincidedSet],
        invitedPlanIds: (invitesRes.data ?? []).map((r) => r.plan_id as string),
        feedTaste: buildFeedTaste(
            tags as string[],
            historyPlans.filter((row): row is NonNullable<typeof row> => row != null),
            calcAge(profileRes.data?.fecha_nacimiento),
        ),
        notifBreakdown: { friendRequests: 0, planRequests: 0, planInvites: 0 },
        isOrganizer: organizer,
    };
}

/** Tags de personalidad del perfil (onboarding) para el badge de encaje. */
export async function fetchFitPersonalityTags(): Promise<string[]> {
    const profileRes = await getMyProfile();
    const tags =
        (Array.isArray(profileRes.data?.ambientes_preferidos) && profileRes.data.ambientes_preferidos.length
            ? profileRes.data.ambientes_preferidos
            : profileRes.data?.etiquetas) ?? [];
    return (tags as string[]).map((t) => String(t).trim()).filter(Boolean);
}

/** Perfil + historial para ranking del feed (no usar para el badge de encaje). */
export async function fetchFeedTasteForUser(userId: string): Promise<FeedTaste> {
    const [profileRes, createdPlansRes, joinedHistoryRes] = await Promise.all([
        getMyProfile(),
        supabase
            .from('planes')
            .select('categoria, tipo_deporte')
            .eq('creador_id', userId)
            .order('fecha_evento', { ascending: false })
            .limit(40),
        supabase
            .from('participantes')
            .select('planes(categoria, tipo_deporte)')
            .eq('usuario_id', userId)
            .eq('estado', 'aceptado')
            .order('creado_en', { ascending: false })
            .limit(40),
    ]);

    const joinedHistoryFromDb = (joinedHistoryRes.data || [])
        .map((row) => {
            const plan = row.planes;
            const p = Array.isArray(plan) ? plan[0] : plan;
            if (!p || typeof p !== 'object') return null;
            const o = p as { categoria?: string | null; tipo_deporte?: string | null };
            return { categoria: o.categoria, tipo_deporte: o.tipo_deporte };
        })
        .filter((row): row is NonNullable<typeof row> => row != null);

    const tags =
        (Array.isArray(profileRes.data?.ambientes_preferidos) && profileRes.data.ambientes_preferidos.length
            ? profileRes.data.ambientes_preferidos
            : profileRes.data?.etiquetas) ?? [];

    return buildFeedTaste(
        tags as string[],
        [...(createdPlansRes.data || []), ...joinedHistoryFromDb].filter(
            (row): row is NonNullable<typeof row> => row != null,
        ),
        calcAge(profileRes.data?.fecha_nacimiento),
    );
}

export function emptyGuestFeedSnapshot(plans: unknown[]): FeedSnapshot {
    return {
        plans: plans as FeedSnapshot['plans'],
        membershipMap: {},
        savedPlans: [],
        currentUserId: null,
        currentUserGenero: null,
        friendIds: [],
        coincidedIds: [],
        invitedPlanIds: [],
        feedTaste: emptyFeedTaste(),
        notifBreakdown: { friendRequests: 0, planRequests: 0, planInvites: 0 },
        isOrganizer: false,
    };
}

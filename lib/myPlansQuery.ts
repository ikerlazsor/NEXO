import { isFeedPlan } from './feedPlans';
import { isConvertedPlanChat } from './planLifecycle';
import { getPlanJoinRequestCount } from './notifications';
import { getHiddenPlanIdSet } from './myPlansHide';
import { getDismissedPlanIdSet, fetchPendingRatingPlanMap, type PendingRatingPlan } from './ratings';
import { getMyProfile, getPublicProfileCards } from './profileData';
import { type Genero } from './profileFields';
import { attachFeedPlanPeople } from './feedQuery';
import { supabase } from './supabase';

const PLAN_COLS = 'id, titulo, titulo_cierre, imagen_url, imagen_cierre, categoria, is_group_chat, maximo_participantes, fecha_evento, creador_id, latitud, longitud';

export type MyPlanItem = {
    id: string;
    titulo: string;
    imagen_url: string | null;
    maximo_participantes: number;
    fecha_evento: string | null;
    creador_id: string;
    latitud?: number | null;
    longitud?: number | null;
    joinedCount: number;
    pending: { id: string; nombre?: string; avatar_url?: string | null }[];
    role: 'creator' | 'member';
    isPast: boolean;
};

export type MyPlansSnapshot = {
    plans: MyPlanItem[];
    pendingCount: number;
    ratingByPlan: Record<string, PendingRatingPlan>;
    userGenero?: Genero | null;
};

type PendingRow = { plan_id: string; usuario_id: string };

function unwrapPlan(raw: unknown): Record<string, unknown> | null {
    const plan = Array.isArray(raw) ? raw[0] : raw;
    if (!plan || typeof plan !== 'object') return null;
    return plan as Record<string, unknown>;
}

/**
 * Mis planes sin anidar todos los participantes en cada fila:
 * planes + RPC de cupos/avatares + solo pendientes del creador.
 */
export async function fetchMyPlansSnapshot(
    userId: string,
    opts?: { applyHidden?: boolean; forceRatings?: boolean },
): Promise<MyPlansSnapshot> {
    const now = Date.now();
    const [myProfileRes, pending, openRatings, createdRes, joinedRes] = await Promise.all([
        getMyProfile(),
        getPlanJoinRequestCount(userId),
        fetchPendingRatingPlanMap(userId, { force: !!opts?.forceRatings }),
        supabase
            .from('planes')
            .select(PLAN_COLS)
            .eq('creador_id', userId)
            .order('fecha_evento', { ascending: true }),
        supabase
            .from('participantes')
            .select(`plan_id, planes (${PLAN_COLS})`)
            .eq('usuario_id', userId)
            .eq('estado', 'aceptado'),
    ]);

    const createdPlans = (createdRes.data || []) as Array<Record<string, unknown> & { id: string }>;
    const joinedPlans: Array<Record<string, unknown> & { id: string }> = [];
    for (const row of joinedRes.data || []) {
        const plan = unwrapPlan((row as { planes?: unknown }).planes);
        if (!plan?.id || plan.creador_id === userId) continue;
        joinedPlans.push(plan as Record<string, unknown> & { id: string });
    }

    const createdIds = createdPlans.map((p) => String(p.id));
    const allRows = [...createdPlans, ...joinedPlans];
    const [people, pendingRes] = await Promise.all([
        attachFeedPlanPeople(allRows),
        createdIds.length > 0
            ? supabase
                .from('participantes')
                .select('plan_id, usuario_id')
                .in('plan_id', createdIds)
                .eq('estado', 'pendiente')
            : Promise.resolve({ data: [] as PendingRow[] }),
    ]);
    const peopleById = new Map(people.map((p) => [String(p.id), p]));

    const pendingRows = (pendingRes.data || []) as PendingRow[];
    const pendingByPlan = new Map<string, string[]>();
    const pendingUserIds = new Set<string>();
    for (const row of pendingRows) {
        if (!row.usuario_id || row.usuario_id === userId) continue;
        pendingUserIds.add(row.usuario_id);
        const list = pendingByPlan.get(row.plan_id) ?? [];
        list.push(row.usuario_id);
        pendingByPlan.set(row.plan_id, list);
    }
    const pendingProfiles = new Map<string, { id: string; nombre?: string; avatar_url?: string | null }>();
    if (pendingUserIds.size > 0) {
        const cards = await getPublicProfileCards([...pendingUserIds]);
        for (const pr of cards) {
            pendingProfiles.set(pr.id, {
                id: pr.id,
                nombre: pr.nombre ?? undefined,
                avatar_url: pr.avatar_url,
            });
        }
    }

    const formatPlan = (p: Record<string, unknown> & { id: string }, role: 'creator' | 'member'): MyPlanItem | null => {
        const categoria = typeof p.categoria === 'string' ? p.categoria : null;
        const fecha = (p.fecha_evento as string | null) ?? null;
        const converted = isConvertedPlanChat({ categoria, fecha_evento: fecha });
        if (!isFeedPlan({ categoria }) && !converted) return null;
        const closedTitle = typeof p.titulo_cierre === 'string' ? p.titulo_cierre.trim() : '';
        const closedCover = typeof p.imagen_cierre === 'string' ? p.imagen_cierre : '';
        const attached = peopleById.get(String(p.id));
        const pendingReqs = role === 'creator'
            ? (pendingByPlan.get(String(p.id)) ?? []).map((id) => pendingProfiles.get(id) ?? { id })
            : [];
        const eventMs = p.fecha_evento ? new Date(String(p.fecha_evento)).getTime() : 0;
        return {
            id: String(p.id),
            titulo: closedTitle || String(p.titulo ?? ''),
            imagen_url: closedCover || ((p.imagen_url as string | null) ?? null),
            maximo_participantes: Number(p.maximo_participantes) || 0,
            fecha_evento: (p.fecha_evento as string | null) ?? null,
            creador_id: String(p.creador_id ?? ''),
            latitud: p.latitud != null ? Number(p.latitud) : null,
            longitud: p.longitud != null ? Number(p.longitud) : null,
            joinedCount: Number(attached?.joinedCount) || 0,
            pending: pendingReqs,
            role,
            isPast: !!p.fecha_evento && eventMs < now,
        };
    };

    const byId = new Map<string, MyPlanItem>();
    for (const p of createdPlans) {
        const formatted = formatPlan(p, 'creator');
        if (formatted) byId.set(formatted.id, formatted);
    }
    for (const p of joinedPlans) {
        const formatted = formatPlan(p, 'member');
        if (formatted) byId.set(formatted.id, formatted);
    }

    const all = Array.from(byId.values());
    const pastIds = all.filter((p) => p.isPast).map((p) => p.id);
    const [dismissed, hidden, histRes] = await Promise.all([
        getDismissedPlanIdSet(userId, pastIds),
        opts?.applyHidden ? getHiddenPlanIdSet(userId, pastIds) : Promise.resolve(new Set<string>()),
        pastIds.length > 0
            ? supabase.from('historial_planes').select('plan_id').eq('usuario_id', userId).in('plan_id', pastIds)
            : Promise.resolve({ data: [] as Array<{ plan_id: string }> }),
    ]);
    const inHistory = new Set((histRes.data ?? []).map((r) => String(r.plan_id)));
    const ratingIds = new Set(Object.keys(openRatings));
    // Pasados = confirmé asistencia (historial) o aún pendiente de valorar. No todo lo que fui participante.
    const visible = all.filter((p) => {
        if (!p.isPast) return true;
        if (dismissed.has(p.id) || hidden.has(p.id)) return false;
        return inHistory.has(p.id) || ratingIds.has(p.id);
    });
    const upcoming = visible
        .filter((p) => !p.isPast)
        .sort((a, b) => {
            const da = a.fecha_evento ? new Date(a.fecha_evento).getTime() : 0;
            const db = b.fecha_evento ? new Date(b.fecha_evento).getTime() : 0;
            return da - db;
        });
    const past = visible
        .filter((p) => p.isPast)
        .sort((a, b) => {
            const da = a.fecha_evento ? new Date(a.fecha_evento).getTime() : 0;
            const db = b.fecha_evento ? new Date(b.fecha_evento).getTime() : 0;
            return db - da;
        });

    return {
        plans: [...upcoming, ...past],
        pendingCount: pending,
        ratingByPlan: openRatings,
        userGenero: (myProfileRes.data?.genero as Genero) ?? null,
    };
}

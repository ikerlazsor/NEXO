import { InteractionManager } from 'react-native';
import { getAuthUser } from './auth';
import { getUserBadges } from './badges';
import { getBadgeStats } from './badgeStats';
import { getChatUnreadMap } from './chatUnread';
import { getCoincidedUserIds } from './coincidences';
import { getDirectConversations } from './directChat';
import {
    FEED_CACHE_KEY,
    FEED_CACHE_TTL_MS,
    FEED_PLAN_COLUMNS,
    type FeedSnapshot,
} from './feedCache';
import { buildFeedTaste, emptyFeedTaste } from './feedAffinity';
import { isFeedPlan, isGroupChatPlan } from './feedPlans';
import {
    getFriends,
    getFriendsCount,
    getIncomingRequests,
    getOutgoingRequests,
} from './friends';
import { getPlanJoinRequestCount, getProfileNotificationCount } from './notifications';
import { isAcceptedParticipant, mapEstadoToMembership } from './participants';
import { getIncomingPlanInvites } from './planInvites';
import { isPlanChatAlive } from './planLifecycle';
import { calcAge, parseHabitos, parsePrivacy, type Genero } from './profileFields';
import { loadProfileRow, resolveDisplayName, syncProfileFromAuth } from './profile';
import { getOpenRatingPlanMap, getPendingRatingPlans, isPlanAttendanceDismissed } from './ratings';
import {
    adoptPublicRankings,
    prefetchPublicRankings,
    prefetchSearchRankings,
} from './rankings';
import { scheduleCoverPrefetch } from './prefetchCovers';
import { screenCacheKey, ScreenCacheTTL } from './screenCaches';
import { getUserStats } from './stats';
import { supabase } from './supabase';
import { cacheGetStale, cacheIsFresh, cacheSet } from './ttlCache';
import type { User } from '@supabase/supabase-js';

let inflight: Promise<void> | null = null;
let publicInflight: Promise<void> | null = null;

function previewLine(
    msg: { tipo: string; contenido: string; emisor_id: string },
    names: Record<string, string>,
    youLabel: string,
): string {
    const nombre = names[msg.emisor_id] || 'Usuario';
    if (msg.tipo === 'imagen') return `${nombre}: 📷`;
    if (msg.tipo === 'video') return `${nombre}: 🎬`;
    if (msg.tipo === 'audio') return `${nombre}: 🎤`;
    return `${nombre}: ${msg.contenido}`;
}

async function prefetchProfile(userId: string, authUser: Awaited<ReturnType<typeof getAuthUser>>) {
    if (!authUser || cacheIsFresh(screenCacheKey.profileUI(userId))) return;

    const row = await loadProfileRow(userId);
    let profile = row.data
        ? {
            nombre: row.data.nombre?.trim() || resolveDisplayName(authUser),
            nombre_usuario: row.data.nombre_usuario ?? null,
            avatar_url:
                row.data.avatar_url
                ?? (typeof authUser.user_metadata?.avatar_url === 'string'
                    ? authUser.user_metadata.avatar_url
                    : null),
            descripcion: row.data.descripcion ?? '',
            etiquetas: row.data.etiquetas ?? [],
            fecha_nacimiento: row.data.fecha_nacimiento ?? null,
            genero: row.data.genero ?? null,
            habitos_consumo: (row.data.habitos_consumo as Record<string, unknown>) ?? {},
            ambientes_preferidos: row.data.ambientes_preferidos ?? [],
            perfil_gustos: (row.data.perfil_gustos as Record<string, unknown>) ?? {},
        }
        : await syncProfileFromAuth(authUser);

    const [userStats, badgeStats, friendsCountVal, notifs, ratings] = await Promise.all([
        getUserStats(userId),
        getBadgeStats(userId, { userCreatedAt: authUser.created_at }),
        getFriendsCount(userId),
        getProfileNotificationCount(userId),
        getPendingRatingPlans(userId),
    ]);

    const habitos = parseHabitos(profile.habitos_consumo);
    cacheSet(screenCacheKey.profileUI(userId), {
        userId,
        nombre: profile.nombre,
        nombreUsuario: profile.nombre_usuario,
        aboutMe: profile.descripcion,
        avatarUrl: profile.avatar_url,
        age: calcAge(profile.fecha_nacimiento),
        genero: profile.genero,
        habitoBebida: habitos.bebida,
        habitoTabaco: habitos.tabaco,
        aficiones: profile.ambientes_preferidos?.length
            ? profile.ambientes_preferidos
            : profile.etiquetas,
        perfilGustos: profile.perfil_gustos,
        privacy: parsePrivacy(profile.perfil_gustos),
        stats: userStats,
        friendsCount: friendsCountVal,
        friendsNotifCount: notifs.friendRequests + notifs.planInvites,
        planRequests: notifs.planRequests,
        pendingRatings: ratings,
        badges: getUserBadges(badgeStats),
    }, ScreenCacheTTL.profileUI);
}

async function prefetchChats(userId: string) {
    if (cacheIsFresh(screenCacheKey.chatsList(userId))) return;

    const [{ data: myParts }, directConversations, unreadMap] = await Promise.all([
        supabase.from('participantes').select('plan_id').eq('usuario_id', userId).eq('estado', 'aceptado'),
        getDirectConversations(userId).catch(() => []),
        getChatUnreadMap(userId),
    ]);

    const planIds = [...new Set((myParts ?? []).map((p) => p.plan_id))].filter(Boolean);
    let planRows: Array<{
        id: string;
        title: string;
        image_url: string | null;
        kind: 'plan' | 'group' | 'direct';
        peerId?: string;
        ultimoTexto: string;
        lastAt: string;
        unread: number;
    }> = [];

    if (planIds.length > 0) {
        const { data: plans } = await supabase
            .from('planes')
            .select('id, titulo, imagen_url, categoria, creador_id, creado_en, fecha_evento, chat_eliminado_en')
            .in('id', planIds);

        const alivePlans = (plans ?? []).filter((p) => isPlanChatAlive(p));
        const ids = alivePlans.map((p) => p.id);
        const msgLimit = Math.min(Math.max(ids.length * 4, 40), 300);

        let lastMsgs: any[] = [];
        if (ids.length > 0) {
            const { data } = await supabase
                .from('mensajes')
                .select('plan_id, contenido, tipo, creado_en, emisor_id')
                .in('plan_id', ids)
                .order('creado_en', { ascending: false })
                .limit(msgLimit);
            lastMsgs = data ?? [];
        }

        const lastByPlan = new Map<string, any>();
        lastMsgs.forEach((m) => {
            if (!lastByPlan.has(m.plan_id)) lastByPlan.set(m.plan_id, m);
        });

        const nameIds = new Set<string>(lastMsgs.map((m) => m.emisor_id));
        const names: Record<string, string> = {};
        if (nameIds.size > 0) {
            const { data: profiles } = await supabase
                .from('perfiles')
                .select('id, nombre')
                .in('id', Array.from(nameIds));
            (profiles ?? []).forEach((pr) => { names[pr.id] = pr.nombre; });
        }

        planRows = alivePlans.map((p) => {
            const ult = lastByPlan.get(p.id);
            return {
                id: p.id,
                title: p.titulo,
                image_url: p.imagen_url,
                kind: isGroupChatPlan(p) ? 'group' as const : 'plan' as const,
                ultimoTexto: ult ? previewLine(ult, names, 'Tú') : 'Sin mensajes',
                lastAt: ult?.creado_en ?? p.creado_en ?? '',
                unread: unreadMap.plans[p.id] ?? 0,
            };
        });
    }

    const directRows = directConversations.map((c) => ({
        id: `direct-${c.peerId}`,
        peerId: c.peerId,
        title: c.nombre,
        image_url: c.avatarUri,
        kind: 'direct' as const,
        ultimoTexto: c.lastMessage
            ? previewLine(
                {
                    tipo: c.lastMessage.tipo,
                    contenido: c.lastMessage.contenido,
                    emisor_id: c.lastMessage.emisor_id,
                },
                { [c.peerId]: c.nombre, [userId]: 'Tú' },
                'Tú',
            )
            : 'Sin mensajes',
        lastAt: c.lastMessage?.creado_en ?? '',
        unread: unreadMap.directs[c.peerId] ?? 0,
    }));

    const rows = [...planRows, ...directRows].sort(
        (a, b) => new Date(b.lastAt || 0).getTime() - new Date(a.lastAt || 0).getTime(),
    );
    cacheSet(screenCacheKey.chatsList(userId), rows, ScreenCacheTTL.chatsList);
}

async function prefetchMyPlans(userId: string) {
    if (cacheIsFresh(screenCacheKey.myPlans(userId))) return;

    const now = Date.now();
    const [pending, openRatings, createdRes, joinedRes] = await Promise.all([
        getPlanJoinRequestCount(userId),
        getOpenRatingPlanMap(userId),
        supabase
            .from('planes')
            .select('id, titulo, imagen_url, categoria, maximo_participantes, fecha_evento, creador_id, participantes(usuario_id, estado, perfiles:usuario_id(id, nombre, avatar_url))')
            .eq('creador_id', userId)
            .order('fecha_evento', { ascending: true }),
        supabase
            .from('participantes')
            .select(`
                plan_id,
                planes (
                    id, titulo, imagen_url, categoria, maximo_participantes, fecha_evento, creador_id,
                    participantes ( usuario_id, estado, perfiles:usuario_id ( id, nombre, avatar_url ) )
                )
            `)
            .eq('usuario_id', userId)
            .eq('estado', 'aceptado'),
    ]);

    type PlanItem = {
        id: string;
        titulo: string;
        imagen_url: string | null;
        maximo_participantes: number;
        fecha_evento: string | null;
        creador_id: string;
        joinedCount: number;
        pending: { id: string; nombre?: string; avatar_url?: string | null }[];
        role: 'creator' | 'member';
        isPast: boolean;
    };

    const formatPlan = (p: any, role: 'creator' | 'member'): PlanItem | null => {
        if (!p || !isFeedPlan(p)) return null;
        const parts = (p.participantes || []) as any[];
        const accepted = parts.filter((x) => isAcceptedParticipant(x.estado));
        const pendingReqs = role === 'creator'
            ? parts
                .filter((x) => x.estado === 'pendiente' && x.usuario_id !== userId && x.perfiles)
                .map((x) => {
                    const prof = Array.isArray(x.perfiles) ? x.perfiles[0] : x.perfiles;
                    return { ...prof, id: x.usuario_id };
                })
            : [];
        const eventMs = p.fecha_evento ? new Date(p.fecha_evento).getTime() : 0;
        return {
            id: p.id,
            titulo: p.titulo,
            imagen_url: p.imagen_url,
            maximo_participantes: p.maximo_participantes,
            fecha_evento: p.fecha_evento,
            creador_id: p.creador_id,
            joinedCount: accepted.length,
            pending: pendingReqs,
            role,
            isPast: !!p.fecha_evento && eventMs < now,
        };
    };

    const byId = new Map<string, PlanItem>();
    for (const p of createdRes.data || []) {
        const formatted = formatPlan(p, 'creator');
        if (formatted) byId.set(formatted.id, formatted);
    }
    for (const row of joinedRes.data || []) {
        const raw = row.planes;
        const plan = Array.isArray(raw) ? raw[0] : raw;
        if (!plan || plan.creador_id === userId) continue;
        const formatted = formatPlan(plan, 'member');
        if (formatted) byId.set(formatted.id, formatted);
    }

    const all = Array.from(byId.values());
    const dismissedFlags = await Promise.all(
        all.filter((p) => p.isPast).map(async (p) => [p.id, await isPlanAttendanceDismissed(userId, p.id)] as const),
    );
    const dismissed = new Set(dismissedFlags.filter(([, d]) => d).map(([id]) => id));
    const visible = all.filter((p) => !p.isPast || !dismissed.has(p.id));
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

    cacheSet(screenCacheKey.myPlans(userId), {
        plans: [...upcoming, ...past],
        pendingCount: pending,
        ratingByPlan: openRatings,
    }, ScreenCacheTTL.myPlans);
}

async function prefetchFriends(userId: string) {
    if (cacheIsFresh(screenCacheKey.friends(userId))) return;

    const [friendsData, incomingData, outgoingData, invitesData] = await Promise.all([
        getFriends(userId),
        getIncomingRequests(userId),
        getOutgoingRequests(userId),
        getIncomingPlanInvites(userId).catch(() => []),
    ]);

    cacheSet(screenCacheKey.friends(userId), {
        friends: friendsData,
        incoming: incomingData,
        outgoing: outgoingData,
        planInvites: invitesData,
    }, ScreenCacheTTL.friends);
}

async function prefetchSavedPlans(userId: string) {
    if (cacheIsFresh(screenCacheKey.savedPlans(userId))) return;

    const [{ data: myProfile }, { data: savedData }, { data: joinedData }] = await Promise.all([
        supabase.from('perfiles').select('genero').eq('id', userId).maybeSingle(),
        supabase
            .from('planes_guardados')
            .select('plan_id, planes (*, participantes(usuario_id, estado, perfiles:usuario_id(id, nombre, avatar_url)))')
            .eq('usuario_id', userId),
        supabase.from('participantes').select('plan_id, estado').eq('usuario_id', userId),
    ]);

    const rawPlans = (savedData || []).map((s: any) => s.planes).filter(Boolean);
    const creatorIds = Array.from(new Set(rawPlans.map((p: any) => p.creador_id).filter(Boolean)));
    let creatorMap: Record<string, any> = {};
    if (creatorIds.length > 0) {
        const { data: creators } = await supabase.from('perfiles').select('id, nombre, avatar_url').in('id', creatorIds);
        creatorMap = Object.fromEntries((creators || []).map((c) => [c.id, c]));
    }

    const formatted = rawPlans.map((plan: any) => {
        const rawParticipants = (plan.participantes || []) as any[];
        const accepted = rawParticipants.filter((p: any) => isAcceptedParticipant(p.estado));
        const list: any[] = [];
        const creator = creatorMap[plan.creador_id];
        if (creator) list.push({ ...creator, isCreator: true });
        accepted.forEach((p: any) => {
            const prof = Array.isArray(p.perfiles) ? p.perfiles[0] : p.perfiles;
            if (prof && prof.id !== plan.creador_id) list.push({ ...prof, isCreator: false });
        });
        return { ...plan, joinedCount: accepted.length, participantsList: list };
    });

    const membershipMap: Record<string, string> = {};
    (joinedData || []).forEach((p: any) => {
        const m = mapEstadoToMembership(p.estado);
        if (m) membershipMap[p.plan_id] = m;
    });

    cacheSet(screenCacheKey.savedPlans(userId), {
        savedPlans: formatted,
        membershipMap,
        currentUserGenero: myProfile?.genero ?? null,
    }, ScreenCacheTTL.savedPlans);
}

async function prefetchFeed(userId: string | null): Promise<void> {
    if (cacheIsFresh(FEED_CACHE_KEY)) {
        const snap = cacheGetStale<FeedSnapshot>(FEED_CACHE_KEY);
        if (!userId) return;
        if (snap?.currentUserId === userId) return;
    }

    const nowIso = new Date().toISOString();
    const { data: plansData, error } = await supabase
        .from('planes')
        .select(FEED_PLAN_COLUMNS)
        .or(`fecha_evento.is.null,fecha_evento.gte.${nowIso}`)
        .order('fecha_evento', { ascending: true })
        .limit(100);

    if (error) throw error;

    const safePlans = (plansData || []).filter(isFeedPlan);
    const planIds = safePlans.map((p) => p.id);
    const creatorIds = Array.from(new Set(safePlans.map((p) => p.creador_id).filter(Boolean)));

    const [partsRes, creatorsRes] = await Promise.all([
        planIds.length > 0
            ? supabase
                .from('participantes')
                .select('plan_id, usuario_id, estado, perfiles:usuario_id(id, nombre, avatar_url)')
                .in('plan_id', planIds)
                .eq('estado', 'aceptado')
            : Promise.resolve({ data: [] as any[], error: null }),
        creatorIds.length > 0
            ? supabase.from('perfiles').select('id, nombre, avatar_url').in('id', creatorIds)
            : Promise.resolve({ data: [] as any[], error: null }),
    ]);

    const partsByPlan: Record<string, any[]> = {};
    (partsRes.data || []).forEach((row: any) => {
        if (!partsByPlan[row.plan_id]) partsByPlan[row.plan_id] = [];
        partsByPlan[row.plan_id].push(row);
    });
    const creatorMap = Object.fromEntries((creatorsRes.data || []).map((c) => [c.id, c]));

    const formattedPlans = safePlans.map((plan) => {
        const rawParticipants = partsByPlan[plan.id] || [];
        const accepted = rawParticipants.filter((p: any) => isAcceptedParticipant(p.estado));
        const list: any[] = [];
        const creator = creatorMap[plan.creador_id];
        if (creator) list.push({ ...creator, isCreator: true });
        accepted.forEach((p: any) => {
            const prof = Array.isArray(p.perfiles) ? p.perfiles[0] : p.perfiles;
            if (prof && prof.id !== plan.creador_id) list.push({ ...prof, isCreator: false });
        });
        return { ...plan, joinedCount: accepted.length, participantsList: list };
    });

    let membershipMap: FeedSnapshot['membershipMap'] = {};
    let savedPlans: string[] = [];
    let currentUserGenero: Genero | null = null;
    let friendIds: string[] = [];
    let coincidedIds: string[] = [];
    let invitedPlanIds: string[] = [];
    let feedTaste = emptyFeedTaste();
    let notifBreakdown = { friendRequests: 0, planRequests: 0, planInvites: 0 };

    if (userId) {
        const [
            profileRes,
            notifs,
            participantsRes,
            savedRes,
            friendsData,
            createdPlansRes,
            coincidedSet,
            invitesRes,
        ] = await Promise.all([
            supabase
                .from('perfiles')
                .select('genero, ambientes_preferidos, etiquetas')
                .eq('id', userId)
                .maybeSingle(),
            getProfileNotificationCount(userId),
            supabase.from('participantes').select('plan_id, estado').eq('usuario_id', userId),
            supabase.from('planes_guardados').select('plan_id').eq('usuario_id', userId),
            getFriends(userId),
            supabase
                .from('planes')
                .select('categoria, tipo_deporte')
                .eq('creador_id', userId)
                .order('fecha_evento', { ascending: false })
                .limit(40),
            getCoincidedUserIds(userId),
            supabase
                .from('invitaciones_planes')
                .select('plan_id')
                .eq('invitado_id', userId)
                .eq('estado', 'pendiente'),
        ]);

        currentUserGenero = (profileRes.data?.genero as Genero) ?? null;
        notifBreakdown = {
            friendRequests: notifs.friendRequests,
            planRequests: notifs.planRequests,
            planInvites: notifs.planInvites,
        };
        friendIds = friendsData.map((f) => f.id);
        coincidedIds = [...coincidedSet];
        invitedPlanIds = (invitesRes.data ?? []).map((r) => r.plan_id as string);
        const map: FeedSnapshot['membershipMap'] = {};
        (participantsRes.data || []).forEach((p: any) => {
            const m = mapEstadoToMembership(p.estado);
            if (m) map[p.plan_id] = m;
        });
        membershipMap = map;
        savedPlans = savedRes.data?.map((s) => s.plan_id) || [];

        const joinedPlanIds = (participantsRes.data || [])
            .filter((p: any) => mapEstadoToMembership(p.estado) === 'joined')
            .map((p: any) => p.plan_id as string);
        let joinedHistory: Array<{ categoria?: string | null; tipo_deporte?: string | null }> = [];
        if (joinedPlanIds.length > 0) {
            const { data: joinedPlans } = await supabase
                .from('planes')
                .select('categoria, tipo_deporte')
                .in('id', joinedPlanIds.slice(0, 50));
            joinedHistory = joinedPlans || [];
        }
        const tags =
            (Array.isArray(profileRes.data?.ambientes_preferidos) && profileRes.data.ambientes_preferidos.length
                ? profileRes.data.ambientes_preferidos
                : profileRes.data?.etiquetas) || [];
        feedTaste = buildFeedTaste(tags as string[], [
            ...(createdPlansRes.data || []),
            ...joinedHistory,
        ]);
    }

    cacheSet(FEED_CACHE_KEY, {
        plans: formattedPlans,
        membershipMap,
        savedPlans,
        currentUserId: userId,
        currentUserGenero,
        friendIds,
        coincidedIds,
        invitedPlanIds,
        feedTaste,
        notifBreakdown,
    } satisfies FeedSnapshot, FEED_CACHE_TTL_MS);
}

/** Semilla vacía solo si aún no hay caché (nuevo usuario / prefetch fallido). */
function seedEmptyPersonalCaches(userId: string): void {
    if (cacheGetStale(screenCacheKey.chatsList(userId)) == null) {
        cacheSet(screenCacheKey.chatsList(userId), [], ScreenCacheTTL.chatsList);
    }
    if (cacheGetStale(screenCacheKey.myPlans(userId)) == null) {
        cacheSet(screenCacheKey.myPlans(userId), {
            plans: [],
            pendingCount: 0,
            ratingByPlan: {},
        }, ScreenCacheTTL.myPlans);
    }
    if (cacheGetStale(screenCacheKey.friends(userId)) == null) {
        cacheSet(screenCacheKey.friends(userId), {
            friends: [],
            incoming: [],
            outgoing: [],
            planInvites: [],
        }, ScreenCacheTTL.friends);
    }
    if (cacheGetStale(screenCacheKey.savedPlans(userId)) == null) {
        cacheSet(screenCacheKey.savedPlans(userId), {
            savedPlans: [],
            membershipMap: {},
            currentUserGenero: null,
        }, ScreenCacheTTL.savedPlans);
    }
}

async function runPrefetch(userId: string, authUser: User) {
    adoptPublicRankings(userId);
    seedEmptyPersonalCaches(userId);
    await Promise.allSettled([
        prefetchFeed(userId),
        prefetchProfile(userId, authUser),
        prefetchChats(userId),
        prefetchMyPlans(userId),
        prefetchFriends(userId),
        prefetchSavedPlans(userId),
        prefetchSearchRankings(userId),
    ]);
}

/** Listo al instante (sin red): rankings públicos + pantallas personales vacías. */
export function prepareCachesForNewUser(userId: string): void {
    adoptPublicRankings(userId);
    seedEmptyPersonalCaches(userId);
}

/**
 * Durante el registro (aún sin sesión): feed público + rankings globales.
 * Así al entrar ya hay contenido listo.
 */
export function scheduleOnboardingPrefetch(): void {
    scheduleCoverPrefetch();
    if (publicInflight) return;
    InteractionManager.runAfterInteractions(() => {
        if (publicInflight) return;
        publicInflight = Promise.allSettled([
            prefetchFeed(null).catch(() => undefined),
            prefetchPublicRankings(),
        ]).then(() => undefined).finally(() => {
            publicInflight = null;
        });
    });
}

/**
 * Warmup completo y awaitable (fin de onboarding / primer login).
 * No bloquea la UI del feed si ya había caché pública.
 */
export async function warmAppCaches(authUser: User): Promise<void> {
    if (inflight) {
        await inflight;
        return;
    }
    inflight = runPrefetch(authUser.id, authUser).finally(() => {
        inflight = null;
    });
    await inflight;
}

/** Precarga en segundo plano tras entrar a la app / feed (sin bloquear la UI). */
export function scheduleHomePrefetch(): void {
    scheduleCoverPrefetch();
    void (async () => {
        const user = await getAuthUser();
        if (!user || inflight) return;

        const allFresh =
            cacheIsFresh(FEED_CACHE_KEY)
            && cacheIsFresh(screenCacheKey.profileUI(user.id))
            && cacheIsFresh(screenCacheKey.chatsList(user.id))
            && cacheIsFresh(screenCacheKey.myPlans(user.id))
            && cacheIsFresh(screenCacheKey.friends(user.id))
            && cacheIsFresh(screenCacheKey.savedPlans(user.id))
            && cacheIsFresh(screenCacheKey.rankings(user.id, 'plans', 'global'));
        if (allFresh) return;

        InteractionManager.runAfterInteractions(() => {
            if (inflight) return;
            inflight = runPrefetch(user.id, user).finally(() => {
                inflight = null;
            });
        });
    })();
}

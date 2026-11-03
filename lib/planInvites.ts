import { supabase } from './supabase';
import { canJoinMorePlans } from './planLimits';
import { invalidateProfileNotificationCount } from './profileNotificationBus';
import { isUserOrganizer } from './organizer';
import { canJoinPlanByGender, isSoloChicasPlan } from './soloChicas';
import { canJoinWaitlist } from './participants';
import { clearPlanKickIfHost, wasKickedFromPlan } from './planKicks';
import { isBlockedEitherWay } from './blocks';
import type { Genero } from './profileFields';

export type PlanInviteType = 'plan' | 'grupo';

export interface PlanInvitePlan {
    id: string;
    titulo: string;
    imagen_url: string | null;
    maximo_participantes: number | null;
    requiere_aprobacion: boolean | null;
    categoria?: string | null;
    fecha_evento?: string | null;
}

export interface PlanInvite {
    id: string;
    plan_id: string;
    invitador_id: string;
    invitado_id: string;
    tipo: PlanInviteType;
    estado: string;
    creado_en: string;
    plan?: PlanInvitePlan;
    invitador?: { id: string; nombre: string; avatar_url: string | null };
}

const INVITE_SELECT = `
    id, plan_id, invitador_id, invitado_id, tipo, estado, creado_en,
    planes:plan_id ( id, titulo, imagen_url, maximo_participantes, requiere_aprobacion, categoria, fecha_evento ),
    invitador:perfiles!inv_planes_invitador_fkey ( id, nombre, avatar_url )
`;

/** Misma regla que el feed: sin fecha futura = plan terminado (invites caducados). */
function isInvitePlanStillActive(plan: { fecha_evento?: string | null; categoria?: string | null } | undefined): boolean {
    if (!plan) return false;
    const cat = plan.categoria ?? '';
    if (cat === 'Grupo' || cat === 'Chat') return true;
    if (!plan.fecha_evento) return true;
    const t = new Date(plan.fecha_evento).getTime();
    return Number.isFinite(t) && t > Date.now();
}

function firstRow<T>(raw: T | T[] | null | undefined): T | undefined {
    if (!raw) return undefined;
    return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * Plan en modo solo chicas: quien no sea de género femenino no puede ser
 * invitado ni unirse, aunque la invitación llegue por un grupo mixto.
 */
export async function isGenderBlockedForPlan(planId: string, userId: string): Promise<boolean> {
    const { data: plan } = await supabase
        .from('planes')
        .select('categoria, solo_chicas')
        .eq('id', planId)
        .maybeSingle();
    if (!plan || !isSoloChicasPlan(plan)) return false;

    const { data: profile } = await supabase
        .from('perfiles')
        .select('genero')
        .eq('id', userId)
        .maybeSingle();
    return !canJoinPlanByGender(plan, (profile?.genero as Genero | null) ?? null);
}

export async function sendPlanInvite(
    planId: string,
    invitadorId: string,
    invitadoId: string,
    tipo: PlanInviteType,
    /** El invitado por grupo ya viene filtrado: evita repetir la consulta por miembro. */
    opts?: { skipGenderCheck?: boolean }
): Promise<{ error: string | null }> {
    // Si ya está unido (aceptado) o tiene solicitud pendiente, no se invita de nuevo
    const { data: existing } = await supabase
        .from('participantes')
        .select('id, estado')
        .eq('plan_id', planId)
        .eq('usuario_id', invitadoId)
        .maybeSingle();

    if (existing) {
        if (existing.estado === 'aceptado' || existing.estado === 'pendiente') {
            // Limpia invitación pendiente obsoleta si la hubiera
            void supabase
                .from('invitaciones_planes')
                .delete()
                .eq('plan_id', planId)
                .eq('invitado_id', invitadoId)
                .eq('estado', 'pendiente');
            return { error: 'already_member' };
        }
    }

    // Hay índice único (plan_id, invitado_id): si ya existe fila hay que reutilizarla,
    // si no el insert falla aunque la invitación anterior estuviera rechazada.
    const { data: previous } = await supabase
        .from('invitaciones_planes')
        .select('id, estado')
        .eq('plan_id', planId)
        .eq('invitado_id', invitadoId)
        .limit(1)
        .maybeSingle();

    if (previous?.estado === 'pendiente') return { error: 'already_invited' };

    if (await isUserOrganizer(invitadoId)) return { error: 'organizer_cannot_join' };

    if (await isBlockedEitherWay(invitadorId, invitadoId)) return { error: 'blocked' };

    if (!opts?.skipGenderCheck && (await isGenderBlockedForPlan(planId, invitadoId))) {
        return { error: 'gender_restricted' };
    }

    // Volver a invitar a alguien expulsado es la forma de readmitirle.
    void clearPlanKickIfHost(planId, invitadorId, invitadoId);

    const announceInvite = async () => {
        const { notifyPlanInvite } = await import('./push');
        notifyPlanInvite(planId, invitadoId);
        invalidateProfileNotificationCount(invitadoId);
    };

    if (previous?.id) {
        const { data: revived, error: reviveError } = await supabase
            .from('invitaciones_planes')
            .update({
                estado: 'pendiente',
                invitador_id: invitadorId,
                tipo,
                creado_en: new Date().toISOString(),
            })
            .eq('id', previous.id)
            .select('id')
            .maybeSingle();

        if (revived?.id) {
            await announceInvite();
            return { error: null };
        }

        // Invitación de otra persona: RLS no deja actualizarla, pero el anfitrión sí
        // puede borrarla y volver a crearla.
        const { error: dropError } = await supabase
            .from('invitaciones_planes')
            .delete()
            .eq('id', previous.id);
        if (dropError) return { error: reviveError?.message ?? dropError.message };
    }

    const { error } = await supabase.from('invitaciones_planes').insert({
        plan_id: planId,
        invitador_id: invitadorId,
        invitado_id: invitadoId,
        tipo,
        estado: 'pendiente',
    });

    if (!error) await announceInvite();

    return { error: error?.message ?? null };
}

/** Quita invitaciones pendientes cuando el usuario ya está en el plan (p. ej. se unió desde el feed). */
export async function clearPendingPlanInvitesForMember(
    planId: string,
    userId: string,
): Promise<void> {
    const { noteFeedInviteCleared } = await import('./feedReload');
    noteFeedInviteCleared(planId);
    const { cacheInvalidate } = await import('./ttlCache');
    const { screenCacheKey } = await import('./screenCaches');
    cacheInvalidate(screenCacheKey.friends(userId));

    const { error } = await supabase
        .from('invitaciones_planes')
        .delete()
        .eq('plan_id', planId)
        .eq('invitado_id', userId)
        .eq('estado', 'pendiente');
    if (!error) invalidateProfileNotificationCount(userId);
}

/** Invitación pendiente concreta de un plan (p. ej. tarjeta en chat de grupo). */
export async function getPendingInviteForPlan(
    planId: string,
    userId: string,
): Promise<PlanInvite | null> {
    const { data, error } = await supabase
        .from('invitaciones_planes')
        .select(INVITE_SELECT)
        .eq('plan_id', planId)
        .eq('invitado_id', userId)
        .eq('estado', 'pendiente')
        .order('creado_en', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error || !data) return null;
    const row = data as any;
    return {
        id: row.id,
        plan_id: row.plan_id,
        invitador_id: row.invitador_id,
        invitado_id: row.invitado_id,
        tipo: row.tipo,
        estado: row.estado,
        creado_en: row.creado_en,
        plan: firstRow(row.planes),
        invitador: firstRow(row.invitador),
    };
}

/** Invitación más reciente de un plan, en cualquier estado. */
export async function getAnyInviteForPlan(
    planId: string,
    userId: string,
): Promise<PlanInvite | null> {
    const { data, error } = await supabase
        .from('invitaciones_planes')
        .select(INVITE_SELECT)
        .eq('plan_id', planId)
        .eq('invitado_id', userId)
        .order('creado_en', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error || !data) return null;
    const row = data as any;
    return {
        id: row.id,
        plan_id: row.plan_id,
        invitador_id: row.invitador_id,
        invitado_id: row.invitado_id,
        tipo: row.tipo,
        estado: row.estado,
        creado_en: row.creado_en,
        plan: firstRow(row.planes),
        invitador: firstRow(row.invitador),
    };
}

/** Devuelve una invitación a pendiente: deshacer un rechazo o volver tras desunirse. */
export async function reopenPlanInvite(inviteId: string): Promise<{ error: string | null }> {
    const { data, error } = await supabase
        .from('invitaciones_planes')
        .update({ estado: 'pendiente' })
        .eq('id', inviteId)
        .select('id, invitado_id')
        .maybeSingle();
    if (error) return { error: error.message };
    if (!data?.id) return { error: 'not_reopenable' };
    if (data.invitado_id) invalidateProfileNotificationCount(data.invitado_id as string);
    return { error: null };
}

/** Plazas del plan: unidos aceptados y máximo (null = sin límite). */
export async function getPlanCapacity(
    planId: string,
): Promise<{ joined: number; max: number | null }> {
    const [{ data: planRow }, { count }] = await Promise.all([
        supabase.from('planes').select('maximo_participantes').eq('id', planId).maybeSingle(),
        supabase
            .from('participantes')
            .select('id', { count: 'exact', head: true })
            .eq('plan_id', planId)
            .eq('estado', 'aceptado'),
    ]);
    return {
        joined: count ?? 0,
        max: (planRow?.maximo_participantes as number | null) ?? null,
    };
}

export async function getIncomingPlanInvites(userId: string): Promise<PlanInvite[]> {
    const { data, error } = await supabase
        .from('invitaciones_planes')
        .select(INVITE_SELECT)
        .eq('invitado_id', userId)
        .eq('estado', 'pendiente')
        .order('creado_en', { ascending: false });

    if (error) throw error;

    const rows = data ?? [];
    if (!rows.length) return [];

    const planIds = [...new Set(rows.map((r: any) => r.plan_id as string))];
    const { data: memberRows } = await supabase
        .from('participantes')
        .select('plan_id, estado')
        .eq('usuario_id', userId)
        .in('plan_id', planIds)
        .in('estado', ['aceptado', 'pendiente', 'lista_espera']);

    const alreadyIn = new Set((memberRows ?? []).map((r) => r.plan_id as string));
    const endedPlanIds = rows
        .filter((row: any) => {
            const plan = firstRow(row.planes) as PlanInvitePlan | undefined;
            return !isInvitePlanStillActive(plan);
        })
        .map((row: any) => row.plan_id as string);
    const staleIds = [...new Set([...alreadyIn, ...endedPlanIds])];
    if (staleIds.length > 0) {
        void supabase
            .from('invitaciones_planes')
            .delete()
            .eq('invitado_id', userId)
            .eq('estado', 'pendiente')
            .in('plan_id', staleIds)
            .then(({ error: delErr }) => {
                if (!delErr) invalidateProfileNotificationCount(userId);
            });
    }

    return rows
        .filter((row: any) => {
            if (alreadyIn.has(row.plan_id as string)) return false;
            const plan = firstRow(row.planes) as PlanInvitePlan | undefined;
            return isInvitePlanStillActive(plan);
        })
        .map((row: any) => ({
            id: row.id,
            plan_id: row.plan_id,
            invitador_id: row.invitador_id,
            invitado_id: row.invitado_id,
            tipo: row.tipo,
            estado: row.estado,
            creado_en: row.creado_en,
            plan: firstRow(row.planes),
            invitador: firstRow(row.invitador),
        }));
}

export async function acceptPlanInvite(
    invite: PlanInvite,
    userId: string
): Promise<{ error: string | null; chatId?: string; estado?: string; max?: number; alreadyMember?: boolean }> {
    const plan = invite.plan;
    if (!plan) return { error: 'no_plan' };
    if (!isInvitePlanStillActive(plan)) return { error: 'plan_ended' };
    if (await isUserOrganizer(userId)) return { error: 'organizer_cannot_join' };
    // Red de seguridad para invitaciones antiguas o llegadas por un grupo mixto.
    if (await isGenderBlockedForPlan(invite.plan_id, userId)) {
        return { error: 'gender_restricted' };
    }
    if (await wasKickedFromPlan(invite.plan_id, userId)) return { error: 'kicked' };

    const { data: existing } = await supabase
        .from('participantes')
        .select('id, estado')
        .eq('plan_id', invite.plan_id)
        .eq('usuario_id', userId)
        .maybeSingle();

    if (existing) {
        await clearPendingPlanInvitesForMember(invite.plan_id, userId);
        return {
            error: null,
            chatId: invite.plan_id,
            estado: (existing.estado as string) || 'aceptado',
            alreadyMember: true,
        };
    }

    const limitCheck = await canJoinMorePlans(userId, invite.plan_id);
    if (!limitCheck.allowed) {
        if (limitCheck.reason === 'organizer') return { error: 'organizer_cannot_join' };
        return { error: 'limit', max: limitCheck.max };
    }

    const { count } = await supabase
        .from('participantes')
        .select('id', { count: 'exact', head: true })
        .eq('plan_id', invite.plan_id)
        .eq('estado', 'aceptado');

    const joined = count ?? 0;
    const max = plan.maximo_participantes ?? 999;
    // Plan completo: se entra en lista de espera mientras quede margen antes del evento.
    const isFull = joined >= max;
    if (isFull && !canJoinWaitlist(plan.fecha_evento)) return { error: 'full' };

    const isGroup = invite.tipo === 'grupo' || plan.categoria === 'Grupo';
    const estado = isFull
        ? 'lista_espera'
        : isGroup || !plan.requiere_aprobacion
          ? 'aceptado'
          : 'pendiente';

    const { error: partError } = await supabase.from('participantes').insert({
        plan_id: invite.plan_id,
        usuario_id: userId,
        estado,
    });

    if (partError) {
        const msg = String(partError.message || '').toLowerCase();
        if (msg.includes('duplicate') || msg.includes('unique') || msg.includes('already')) {
            await clearPendingPlanInvitesForMember(invite.plan_id, userId);
            return { error: null, chatId: invite.plan_id, estado, alreadyMember: true };
        }
        // Reglas que valida la base de datos: mejor un código que el mensaje crudo.
        if (msg.includes('solo_chicas_only')) return { error: 'gender_restricted' };
        if (msg.includes('plan_full')) return { error: 'full' };
        if (msg.includes('friends_only_plan')) return { error: 'friends_only' };
        if (msg.includes('plan_private_invite_required')) return { error: 'private_plan' };
        return { error: partError.message };
    }

    await supabase.from('invitaciones_planes').update({ estado: 'aceptado' }).eq('id', invite.id);

    const { notifyPlanJoin } = await import('./push');
    notifyPlanJoin(invite.plan_id, estado);
    invalidateProfileNotificationCount(userId);

    return { error: null, chatId: invite.plan_id, estado, alreadyMember: false };
}

export async function rejectPlanInvite(inviteId: string): Promise<{ error: string | null }> {
    const { data: row } = await supabase
        .from('invitaciones_planes')
        .select('invitado_id')
        .eq('id', inviteId)
        .maybeSingle();
    const { error } = await supabase
        .from('invitaciones_planes')
        .update({ estado: 'rechazado' })
        .eq('id', inviteId);
    if (!error && row?.invitado_id) {
        invalidateProfileNotificationCount(row.invitado_id as string);
    }
    return { error: error?.message ?? null };
}

export async function countPendingPlanInvites(userId: string): Promise<number> {
    const { data, error } = await supabase
        .from('invitaciones_planes')
        .select('plan_id, planes:plan_id ( fecha_evento, categoria )')
        .eq('invitado_id', userId)
        .eq('estado', 'pendiente');
    if (error || !data?.length) return 0;

    const activeRows = data.filter((r: any) => {
        const plan = firstRow(r.planes) as { fecha_evento?: string | null; categoria?: string | null } | undefined;
        return isInvitePlanStillActive(plan);
    });
    if (!activeRows.length) return 0;

    const planIds = [...new Set(activeRows.map((r) => r.plan_id as string))];
    const { data: memberRows } = await supabase
        .from('participantes')
        .select('plan_id')
        .eq('usuario_id', userId)
        .in('plan_id', planIds)
        .in('estado', ['aceptado', 'pendiente', 'lista_espera']);

    const alreadyIn = new Set((memberRows ?? []).map((r) => r.plan_id as string));
    return activeRows.filter((r) => !alreadyIn.has(r.plan_id as string)).length;
}

export type PlanInvitee = {
    inviteId: string;
    id: string;
    nombre: string;
    nombre_usuario: string | null;
    avatar_url: string | null;
    estado: string;
    invitadorId: string | null;
    invitadorNombre: string | null;
};

/** Invitaciones salientes de un plan (pendientes), con perfil del invitado.
 * Incluye invitaciones de cualquier integrante (si RLS lo permite).
 * Excluye a quien ya esté unido (aceptado) y limpia invitaciones obsoletas. */
export async function getPlanPendingInvitees(planId: string): Promise<PlanInvitee[]> {
    const { data, error } = await supabase
        .from('invitaciones_planes')
        .select('id, invitado_id, invitador_id, estado')
        .eq('plan_id', planId)
        .eq('estado', 'pendiente')
        .order('creado_en', { ascending: false });

    if (error || !data?.length) return [];

    const invitedIds = data.map((r) => r.invitado_id as string);
    const inviterIds = [...new Set(data.map((r) => r.invitador_id as string).filter(Boolean))];
    const profileIds = [...new Set([...invitedIds, ...inviterIds])];

    const [{ data: profiles }, { data: joinedRows }] = await Promise.all([
        supabase.from('perfiles').select('id, nombre, nombre_usuario, avatar_url').in('id', profileIds),
        supabase
            .from('participantes')
            .select('usuario_id')
            .eq('plan_id', planId)
            .eq('estado', 'aceptado')
            .in('usuario_id', invitedIds),
    ]);

    const joined = new Set((joinedRows ?? []).map((r) => r.usuario_id as string));
    const stale = invitedIds.filter((id) => joined.has(id));
    if (stale.length > 0) {
        void supabase
            .from('invitaciones_planes')
            .delete()
            .eq('plan_id', planId)
            .eq('estado', 'pendiente')
            .in('invitado_id', stale);
    }

    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
    return data
        .filter((r) => !joined.has(r.invitado_id as string))
        .map((r) => {
            const p = byId.get(r.invitado_id as string);
            const inviter = r.invitador_id ? byId.get(r.invitador_id as string) : undefined;
            return {
                inviteId: r.id as string,
                id: r.invitado_id as string,
                nombre: p?.nombre ?? '—',
                nombre_usuario: p?.nombre_usuario ?? null,
                avatar_url: p?.avatar_url ?? null,
                estado: r.estado as string,
                invitadorId: (r.invitador_id as string) ?? null,
                invitadorNombre: inviter?.nombre ?? null,
            };
        });
}

/** Quita una invitación pendiente (el invitado deja de verla). */
export async function cancelPlanInvite(
    planId: string,
    invitadoId: string,
): Promise<{ error: string | null }> {
    const { data, error } = await supabase
        .from('invitaciones_planes')
        .delete()
        .eq('plan_id', planId)
        .eq('invitado_id', invitadoId)
        .eq('estado', 'pendiente')
        .select('id');
    if (error) return { error: error.message };
    // RLS filtra en silencio: sin filas devueltas la invitación sigue en pie.
    if (!data?.length) return { error: 'not_removable' };
    invalidateProfileNotificationCount(invitadoId);
    return { error: null };
}

import { supabase } from './supabase';
import { canJoinMorePlans } from './planLimits';
import { invalidateProfileNotificationCount } from './profileNotificationBus';
import { isUserOrganizer } from './organizer';

export type PlanInviteType = 'plan' | 'grupo';

export interface PlanInvitePlan {
    id: string;
    titulo: string;
    imagen_url: string | null;
    maximo_participantes: number | null;
    requiere_aprobacion: boolean | null;
    categoria?: string | null;
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
    planes:plan_id ( id, titulo, imagen_url, maximo_participantes, requiere_aprobacion, categoria ),
    invitador:perfiles!inv_planes_invitador_fkey ( id, nombre, avatar_url )
`;

function firstRow<T>(raw: T | T[] | null | undefined): T | undefined {
    if (!raw) return undefined;
    return Array.isArray(raw) ? raw[0] : raw;
}

export async function sendPlanInvite(
    planId: string,
    invitadorId: string,
    invitadoId: string,
    tipo: PlanInviteType
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

    const { data: pending } = await supabase
        .from('invitaciones_planes')
        .select('id')
        .eq('plan_id', planId)
        .eq('invitado_id', invitadoId)
        .eq('estado', 'pendiente')
        .maybeSingle();

    if (pending) return { error: 'already_invited' };

    if (await isUserOrganizer(invitadoId)) return { error: 'organizer_cannot_join' };

    const { error } = await supabase.from('invitaciones_planes').insert({
        plan_id: planId,
        invitador_id: invitadorId,
        invitado_id: invitadoId,
        tipo,
        estado: 'pendiente',
    });

    if (!error) {
        const { notifyPlanInvite } = await import('./push');
        notifyPlanInvite(planId, invitadoId);
        invalidateProfileNotificationCount(invitadoId);
    }

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
    if (alreadyIn.size > 0) {
        void supabase
            .from('invitaciones_planes')
            .delete()
            .eq('invitado_id', userId)
            .eq('estado', 'pendiente')
            .in('plan_id', [...alreadyIn])
            .then(({ error: delErr }) => {
                if (!delErr) invalidateProfileNotificationCount(userId);
            });
    }

    return rows
        .filter((row: any) => !alreadyIn.has(row.plan_id as string))
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
    if (await isUserOrganizer(userId)) return { error: 'organizer_cannot_join' };

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
    if (joined >= max) return { error: 'full' };

    const isGroup = invite.tipo === 'grupo' || plan.categoria === 'Grupo';
    const estado = isGroup || !plan.requiere_aprobacion ? 'aceptado' : 'pendiente';

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
        .select('plan_id')
        .eq('invitado_id', userId)
        .eq('estado', 'pendiente');
    if (error || !data?.length) return 0;

    const planIds = [...new Set(data.map((r) => r.plan_id as string))];
    const { data: memberRows } = await supabase
        .from('participantes')
        .select('plan_id')
        .eq('usuario_id', userId)
        .in('plan_id', planIds)
        .in('estado', ['aceptado', 'pendiente', 'lista_espera']);

    const alreadyIn = new Set((memberRows ?? []).map((r) => r.plan_id as string));
    return data.filter((r) => !alreadyIn.has(r.plan_id as string)).length;
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
    const { error } = await supabase
        .from('invitaciones_planes')
        .delete()
        .eq('plan_id', planId)
        .eq('invitado_id', invitadoId)
        .eq('estado', 'pendiente');
    return { error: error?.message ?? null };
}

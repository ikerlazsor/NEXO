import { supabase } from './supabase';

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

    const { error } = await supabase.from('invitaciones_planes').insert({
        plan_id: planId,
        invitador_id: invitadorId,
        invitado_id: invitadoId,
        tipo,
        estado: 'pendiente',
    });

    return { error: error?.message ?? null };
}

export async function getIncomingPlanInvites(userId: string): Promise<PlanInvite[]> {
    const { data, error } = await supabase
        .from('invitaciones_planes')
        .select(INVITE_SELECT)
        .eq('invitado_id', userId)
        .eq('estado', 'pendiente')
        .order('creado_en', { ascending: false });

    if (error) throw error;

    return (data ?? []).map((row: any) => ({
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
): Promise<{ error: string | null; chatId?: string }> {
    const plan = invite.plan;
    if (!plan) return { error: 'no_plan' };

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

    if (partError) return { error: partError.message };

    await supabase.from('invitaciones_planes').update({ estado: 'aceptado' }).eq('id', invite.id);

    return { error: null, chatId: invite.plan_id };
}

export async function rejectPlanInvite(inviteId: string): Promise<{ error: string | null }> {
    const { error } = await supabase
        .from('invitaciones_planes')
        .update({ estado: 'rechazado' })
        .eq('id', inviteId);
    return { error: error?.message ?? null };
}

export async function countPendingPlanInvites(userId: string): Promise<number> {
    const { count, error } = await supabase
        .from('invitaciones_planes')
        .select('id', { count: 'exact', head: true })
        .eq('invitado_id', userId)
        .eq('estado', 'pendiente');
    if (error) return 0;
    return count ?? 0;
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

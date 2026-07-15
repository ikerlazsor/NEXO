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
    const { data: existing } = await supabase
        .from('participantes')
        .select('id')
        .eq('plan_id', planId)
        .eq('usuario_id', invitadoId)
        .maybeSingle();

    if (existing) return { error: 'already_member' };

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

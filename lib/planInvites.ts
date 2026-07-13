import { supabase } from './supabase';

export type PlanInviteType = 'plan' | 'grupo';

export interface PlanInvite {
    id: string;
    plan_id: string;
    invitador_id: string;
    invitado_id: string;
    tipo: PlanInviteType;
    estado: string;
    created_at: string;
    plan?: { id: string; title: string; image_url: string | null; max_people: number | null; requiere_aprobacion: boolean | null; is_group_chat?: boolean | null; category?: string };
    invitador?: { id: string; nombre: string; avatar_url: string | null };
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
        .from('plan_invitaciones')
        .select('id')
        .eq('plan_id', planId)
        .eq('invitado_id', invitadoId)
        .eq('estado', 'pendiente')
        .maybeSingle();

    if (pending) return { error: 'already_invited' };

    const { error } = await supabase.from('plan_invitaciones').insert({
        plan_id: planId,
        invitador_id: invitadorId,
        invitado_id: invitadoId,
        tipo,
        estado: 'pendiente',
    });

    return { error: error?.message ?? null };
}

export async function getIncomingPlanInvites(userId: string): Promise<PlanInvite[]> {
    const fullSelect = await supabase
        .from('plan_invitaciones')
        .select(`
            id, plan_id, invitador_id, invitado_id, tipo, estado, created_at,
            planes:plan_id ( id, title, image_url, max_people, requiere_aprobacion, is_group_chat, category ),
            invitador:invitador_id ( id, nombre, avatar_url )
        `)
        .eq('invitado_id', userId)
        .eq('estado', 'pendiente')
        .order('created_at', { ascending: false });

    let data = fullSelect.data;
    let error = fullSelect.error;

    if (error?.message?.includes('is_group_chat')) {
        const fallback = await supabase
            .from('plan_invitaciones')
            .select(`
                id, plan_id, invitador_id, invitado_id, tipo, estado, created_at,
                planes:plan_id ( id, title, image_url, max_people, requiere_aprobacion, category ),
                invitador:invitador_id ( id, nombre, avatar_url )
            `)
            .eq('invitado_id', userId)
            .eq('estado', 'pendiente')
            .order('created_at', { ascending: false });
        data = (fallback.data ?? []).map((row: any) => ({
            ...row,
            planes: row.planes ? { ...row.planes, is_group_chat: row.planes.category === 'Grupo' } : row.planes,
        }));
        error = fallback.error;
    }

    if (error) throw error;

    return (data ?? []).map((row: any) => ({
        id: row.id,
        plan_id: row.plan_id,
        invitador_id: row.invitador_id,
        invitado_id: row.invitado_id,
        tipo: row.tipo,
        estado: row.estado,
        created_at: row.created_at,
        plan: row.planes,
        invitador: row.invitador,
    }));
}

export async function acceptPlanInvite(invite: PlanInvite, userId: string): Promise<{ error: string | null; chatId?: string }> {
    const plan = invite.plan;
    if (!plan) return { error: 'no_plan' };

    const { count } = await supabase
        .from('participantes')
        .select('id', { count: 'exact', head: true })
        .eq('plan_id', invite.plan_id)
        .or('estado.eq.aceptado,estado.is.null');

    const joined = count ?? 0;
    const max = plan.max_people ?? 999;
    if (joined >= max) return { error: 'full' };

    const isGroup = plan.is_group_chat || plan.category === 'Grupo';
    const estado = isGroup ? 'aceptado' : plan.requiere_aprobacion ? 'pendiente' : 'aceptado';

    const { error: partError } = await supabase.from('participantes').insert({
        plan_id: invite.plan_id,
        usuario_id: userId,
        estado,
    });

    if (partError) return { error: partError.message };

    await supabase.from('plan_invitaciones').update({ estado: 'aceptado' }).eq('id', invite.id);

    return { error: null, chatId: invite.plan_id };
}

export async function rejectPlanInvite(inviteId: string): Promise<{ error: string | null }> {
    const { error } = await supabase
        .from('plan_invitaciones')
        .update({ estado: 'rechazado' })
        .eq('id', inviteId);
    return { error: error?.message ?? null };
}

export async function countPendingPlanInvites(userId: string): Promise<number> {
    const { count, error } = await supabase
        .from('plan_invitaciones')
        .select('id', { count: 'exact', head: true })
        .eq('invitado_id', userId)
        .eq('estado', 'pendiente');
    if (error) return 0;
    return count ?? 0;
}

import { encodePlanInviteCard, PLAN_INVITE_CARD_MARK } from './chatPlanInviteCard';
import { planCoverList } from './planCovers';
import { sendPlanInvite, type PlanInviteType } from './planInvites';
import { isSoloChicasPlan } from './soloChicas';
import { supabase } from './supabase';
import { getPublicProfiles, type PublicProfileRow } from './profileData';

/** Miembros que pueden entrar en el plan: en modo solo chicas filtra por género. */
async function filterMembersByGender(
    memberIds: string[],
    plan: { categoria?: string | null; solo_chicas?: boolean | null },
): Promise<{ eligible: string[]; blocked: number }> {
    if (memberIds.length === 0 || !isSoloChicasPlan(plan)) {
        return { eligible: memberIds, blocked: 0 };
    }
    const data: PublicProfileRow[] = [];
    for (let offset = 0; offset < memberIds.length; offset += 200) {
        data.push(...await getPublicProfiles(memberIds.slice(offset, offset + 200), { force: true }));
    }
    const female = new Set(
        (data ?? []).filter((p) => p.genero === 'femenino').map((p) => p.id as string),
    );
    const eligible = memberIds.filter((id) => female.has(id));
    return { eligible, blocked: memberIds.length - eligible.length };
}

export type ChatGroupOption = {
    id: string;
    title: string;
    image_url: string | null;
    memberCount: number;
};

/** Grupos de chat donde el usuario es miembro aceptado. */
export async function listMyChatGroups(userId: string): Promise<ChatGroupOption[]> {
    const { data: parts, error } = await supabase
        .from('participantes')
        .select('plan_id, planes!inner(id, titulo, imagen_url, is_group_chat, is_direct_chat, categoria)')
        .eq('usuario_id', userId)
        .eq('estado', 'aceptado')
        .limit(80);

    if (error || !parts) return [];

    const groups: ChatGroupOption[] = [];
    for (const row of parts as Array<{
        plan_id: string;
        planes:
            | {
                  id: string;
                  titulo: string | null;
                  imagen_url: string | null;
                  is_group_chat?: boolean | null;
                  is_direct_chat?: boolean | null;
                  categoria?: string | null;
              }
            | {
                  id: string;
                  titulo: string | null;
                  imagen_url: string | null;
                  is_group_chat?: boolean | null;
                  is_direct_chat?: boolean | null;
                  categoria?: string | null;
              }[]
            | null;
    }>) {
        const plan = Array.isArray(row.planes) ? row.planes[0] : row.planes;
        if (!plan?.id) continue;
        // Solo grupos: en un chat de uno a uno la tarjeta no tiene sentido.
        const isGroup =
            plan.is_direct_chat !== true
            && (plan.is_group_chat === true || plan.categoria === 'Grupo');
        if (!isGroup) continue;
        groups.push({
            id: plan.id,
            title: (plan.titulo || '').trim() || 'Grupo',
            image_url: plan.imagen_url,
            memberCount: 0,
        });
    }

    if (!groups.length) return [];

    const ids = groups.map((g) => g.id);
    const { data: counts } = await supabase
        .from('participantes')
        .select('plan_id')
        .in('plan_id', ids)
        .eq('estado', 'aceptado');

    const tally = new Map<string, number>();
    for (const c of counts ?? []) {
        const pid = c.plan_id as string;
        tally.set(pid, (tally.get(pid) ?? 0) + 1);
    }
    return groups
        .map((g) => ({ ...g, memberCount: tally.get(g.id) ?? 0 }))
        .sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }));
}

/**
 * Invita a todos los miembros del grupo al plan destino y deja una tarjeta
 * en el chat del grupo (aceptar/rechazar sincroniza con invitaciones recibidas).
 */
export async function inviteChatGroupToPlan(opts: {
    groupChatId: string;
    targetPlanId: string;
    invitadorId: string;
    inviteType?: PlanInviteType;
}): Promise<{
    error: string | null;
    invited: number;
    skipped: number;
    /** Miembros fuera por ser un plan solo chicas. */
    skippedGender: number;
}> {
    const { groupChatId, targetPlanId, invitadorId } = opts;
    const inviteType = opts.inviteType ?? 'plan';

    if (groupChatId === targetPlanId) {
        return { error: 'same_chat', invited: 0, skipped: 0, skippedGender: 0 };
    }

    const [{ data: members }, { data: plan }, { data: inviter }, { data: planMembers }] = await Promise.all([
        supabase
            .from('participantes')
            .select('usuario_id')
            .eq('plan_id', groupChatId)
            .eq('estado', 'aceptado'),
        supabase
            .from('planes')
            .select(
                'id, titulo, imagen_url, imagenes_url, nombre_ubicacion, fecha_evento, categoria, solo_chicas',
            )
            .eq('id', targetPlanId)
            .maybeSingle(),
        supabase.from('perfiles').select('nombre, avatar_url').eq('id', invitadorId).maybeSingle(),
        supabase
            .from('participantes')
            .select('usuario_id, perfiles:usuario_id ( id, nombre, avatar_url )')
            .eq('plan_id', targetPlanId)
            .eq('estado', 'aceptado')
            .limit(12),
    ]);

    if (!plan?.id) return { error: 'plan_not_found', invited: 0, skipped: 0, skippedGender: 0 };

    const memberIds = [...new Set((members ?? []).map((m) => m.usuario_id as string).filter(Boolean))];
    const { eligible, blocked: skippedGender } = await filterMembersByGender(
        memberIds.filter((id) => id !== invitadorId),
        plan,
    );
    let invited = 0;
    let skipped = memberIds.length - eligible.length;

    for (const memberId of eligible) {
        const { error } = await sendPlanInvite(targetPlanId, invitadorId, memberId, inviteType, {
            skipGenderCheck: true,
        });
        if (error) {
            skipped += 1;
            continue;
        }
        invited += 1;
    }

    // Grupo entero fuera por el filtro: no tiene sentido dejar la tarjeta en el chat.
    if (invited === 0 && skippedGender > 0) {
        return { error: 'gender_restricted', invited: 0, skipped, skippedGender };
    }

    const whenLabel = plan.fecha_evento
        ? new Date(plan.fecha_evento).toLocaleString(undefined, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
          })
        : null;

    const cover =
        planCoverList({
            imagen_url: plan.imagen_url,
            imagenes_url: (plan as { imagenes_url?: unknown }).imagenes_url,
        })[0] ?? plan.imagen_url ?? null;

    const cardMembers = (planMembers ?? [])
        .map((row) => {
            const perfil = Array.isArray(row.perfiles) ? row.perfiles[0] : row.perfiles;
            if (!perfil?.id) return null;
            return {
                id: String(perfil.id),
                nombre: String((perfil.nombre as string) || 'Nexo'),
                avatarUrl: (perfil.avatar_url as string | null) ?? null,
            };
        })
        .filter(Boolean) as Array<{ id: string; nombre: string; avatarUrl: string | null }>;

    const contenido = encodePlanInviteCard({
        planId: targetPlanId,
        titulo: plan.titulo || 'Plan',
        imagenUrl: cover,
        whenLabel,
        place: plan.nombre_ubicacion,
        inviterId: invitadorId,
        inviterName: (inviter?.nombre || '').trim() || 'Nexo',
        inviterAvatarUrl: (inviter?.avatar_url as string | null) ?? null,
        members: cardMembers,
    });

    const { error: msgError, data: msgRow } = await supabase
        .from('mensajes')
        .insert({
            plan_id: groupChatId,
            emisor_id: invitadorId,
            contenido,
            tipo: 'texto',
        })
        .select('id')
        .maybeSingle();

    if (msgError) {
        return { error: msgError.message, invited, skipped, skippedGender };
    }

    if (msgRow?.id) {
        try {
            const { notifyPlanMessage } = await import('./push');
            notifyPlanMessage(groupChatId, String(msgRow.id));
        } catch {
            /* best-effort */
        }
        try {
            const { refreshChatUnreadBadge } = await import('./chatUnread');
            // El invitador no suma unread; el badge de los demás llega por push/realtime.
            void refreshChatUnreadBadge(invitadorId);
        } catch {
            /* ignore */
        }
    }

    return { error: null, invited, skipped, skippedGender };
}

/** Miembros aceptados de varios grupos: ya tienen la invitación del plan. */
export async function listGroupMemberIds(
    groupIds: string[],
    opts?: { targetPlanId?: string | null },
): Promise<string[]> {
    if (groupIds.length === 0) return [];
    const { data } = await supabase
        .from('participantes')
        .select('usuario_id')
        .in('plan_id', groupIds)
        .eq('estado', 'aceptado');
    const ids = [...new Set((data ?? []).map((row) => row.usuario_id as string).filter(Boolean))];
    if (!opts?.targetPlanId || ids.length === 0) return ids;

    // En un plan solo chicas los chicos del grupo no recibieron invitación.
    const { data: plan } = await supabase
        .from('planes')
        .select('categoria, solo_chicas')
        .eq('id', opts.targetPlanId)
        .maybeSingle();
    if (!plan || !isSoloChicasPlan(plan)) return ids;
    const { eligible } = await filterMembersByGender(ids, plan);
    return eligible;
}

/** Ids de los mensajes-tarjeta de un plan dentro de un chat de grupo. */
async function findInviteCardMessageIds(groupChatId: string, targetPlanId: string): Promise<string[]> {
    const { data } = await supabase
        .from('mensajes')
        .select('id, contenido')
        .eq('plan_id', groupChatId)
        .like('contenido', `${PLAN_INVITE_CARD_MARK}%`)
        .limit(200);

    const needle = `"planId":"${targetPlanId}"`;
    return (data ?? [])
        .filter((row) => String(row.contenido ?? '').includes(needle))
        .map((row) => row.id as string);
}

/** Anula la invitación a un grupo: quita la tarjeta del chat y las invitaciones pendientes. */
export async function cancelChatGroupInvite(opts: {
    groupChatId: string;
    targetPlanId: string;
}): Promise<{ error: string | null }> {
    const { groupChatId, targetPlanId } = opts;

    const memberIds = await listGroupMemberIds([groupChatId]);
    if (memberIds.length) {
        const { error } = await supabase
            .from('invitaciones_planes')
            .delete()
            .eq('plan_id', targetPlanId)
            .eq('estado', 'pendiente')
            .in('invitado_id', memberIds);
        if (error) return { error: error.message };
    }

    const cardIds = await findInviteCardMessageIds(groupChatId, targetPlanId);
    if (cardIds.length) {
        const { data, error } = await supabase
            .from('mensajes')
            .delete()
            .in('id', cardIds)
            .select('id');
        if (error) return { error: error.message };
        // Sin filas borradas la tarjeta seguiría en el chat y el grupo volvería a salir como invitado.
        if (!data?.length) return { error: 'not_removable' };
    }

    return { error: null };
}

/** Grupos de chat que ya tienen tarjeta de invitación a este plan. */
export async function listGroupsInvitedToPlan(
    targetPlanId: string,
    groupIds: string[],
): Promise<ChatGroupOption[]> {
    if (!targetPlanId || groupIds.length === 0) return [];
    const { data, error } = await supabase
        .from('mensajes')
        .select('plan_id, contenido')
        .in('plan_id', groupIds)
        .like('contenido', `${PLAN_INVITE_CARD_MARK}%`)
        .order('creado_en', { ascending: false })
        .limit(200);
    if (error || !data?.length) return [];

    const needle = `"planId":"${targetPlanId}"`;
    const matchedGroupIds = new Set<string>();
    for (const row of data) {
        const contenido = String(row.contenido ?? '');
        if (!contenido.includes(needle)) continue;
        matchedGroupIds.add(row.plan_id as string);
    }
    if (!matchedGroupIds.size) return [];

    const { data: plans } = await supabase
        .from('planes')
        .select('id, titulo, imagen_url')
        .in('id', [...matchedGroupIds]);

    return (plans ?? []).map((p) => ({
        id: p.id as string,
        title: ((p.titulo as string) || '').trim() || 'Grupo',
        image_url: (p.imagen_url as string | null) ?? null,
        memberCount: 0,
    }));
}

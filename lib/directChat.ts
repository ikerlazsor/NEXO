import { getAvatarUri } from './friends';
import { supabase } from './supabase';

export function isDirectChatPlan(plan: {
    is_direct_chat?: boolean | null;
    is_group_chat?: boolean | null;
    category?: string | null;
}): boolean {
    const isGroup = !!plan.is_group_chat || plan.category === 'Grupo';
    if (isGroup) return false;
    return plan.is_direct_chat === true || plan.category === 'Chat';
}

export async function resolveDirectChatPeer(
    planId: string,
    userId: string
): Promise<{ id: string; nombre: string; avatar_url: string | null; avatarUri: string } | null> {
    const { data: rows, error } = await supabase
        .from('participantes')
        .select('usuario_id, perfiles:usuario_id(nombre, avatar_url)')
        .eq('plan_id', planId)
        .neq('usuario_id', userId)
        .limit(1);

    if (error || !rows?.length) return null;

    const peerId = rows[0].usuario_id as string;
    const raw = rows[0].perfiles;
    const embedded = Array.isArray(raw) ? raw[0] : raw;
    let nombre = (embedded?.nombre as string) || '';
    let avatar_url = (embedded?.avatar_url as string | null) ?? null;

    if (!nombre) {
        const { data: profile } = await supabase
            .from('perfiles')
            .select('nombre, avatar_url')
            .eq('id', peerId)
            .single();
        if (profile) {
            nombre = profile.nombre || '';
            avatar_url = profile.avatar_url ?? null;
        }
    }

    if (!nombre) return null;

    return {
        id: peerId,
        nombre,
        avatar_url,
        avatarUri: getAvatarUri({ nombre, avatar_url }),
    };
}

async function ensureParticipant(planId: string, userId: string): Promise<void> {
    const { data: existing } = await supabase
        .from('participantes')
        .select('id')
        .eq('plan_id', planId)
        .eq('usuario_id', userId)
        .maybeSingle();

    if (!existing) {
        await supabase.from('participantes').insert({
            plan_id: planId,
            usuario_id: userId,
            estado: 'aceptado',
        });
    }
}

export async function findOrCreateDirectChat(
    currentUserId: string,
    friendId: string
): Promise<{ planId: string | null; error: string | null }> {
    const { data: myParts } = await supabase
        .from('participantes')
        .select('plan_id')
        .eq('usuario_id', currentUserId);

    const { data: friendParts } = await supabase
        .from('participantes')
        .select('plan_id')
        .eq('usuario_id', friendId);

    if (myParts && friendParts) {
        const myIds = myParts.map((p) => p.plan_id);
        const friendIds = new Set(friendParts.map((p) => p.plan_id));
        const commonIds = myIds.filter((id) => friendIds.has(id));

        if (commonIds.length > 0) {
            const { data: directPlan } = await supabase
                .from('planes')
                .select('id')
                .in('id', commonIds)
                .eq('is_direct_chat', true)
                .limit(1)
                .maybeSingle();

            if (directPlan) {
                await ensureParticipant(directPlan.id, currentUserId);
                await ensureParticipant(directPlan.id, friendId);
                return { planId: directPlan.id, error: null };
            }
        }
    }

    const { data: newPlan, error: planError } = await supabase
        .from('planes')
        .insert({
            is_direct_chat: true,
            is_group_chat: false,
            title: 'Chat',
            category: 'Chat',
            user_id: currentUserId,
        })
        .select('id')
        .single();

    if (planError || !newPlan) {
        return { planId: null, error: planError?.message ?? 'create_failed' };
    }

    const { error: meError } = await supabase.from('participantes').insert({
        plan_id: newPlan.id,
        usuario_id: currentUserId,
        estado: 'aceptado',
    });
    if (meError) return { planId: null, error: meError.message };

    const { error: friendError } = await supabase.from('participantes').insert({
        plan_id: newPlan.id,
        usuario_id: friendId,
        estado: 'aceptado',
    });
    if (friendError) {
        return { planId: null, error: friendError.message };
    }

    return { planId: newPlan.id, error: null };
}

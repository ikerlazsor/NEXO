import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const KEY = '@nexo_muted_plan_chats_v1';

async function readSet(): Promise<Set<string>> {
    try {
        const raw = await AsyncStorage.getItem(KEY);
        if (!raw) return new Set();
        const arr = JSON.parse(raw) as string[];
        return new Set(Array.isArray(arr) ? arr : []);
    } catch {
        return new Set();
    }
}

async function writeSet(set: Set<string>): Promise<void> {
    await AsyncStorage.setItem(KEY, JSON.stringify([...set]));
}

export async function isPlanChatMuted(planId: string): Promise<boolean> {
    const set = await readSet();
    return set.has(planId);
}

export async function setPlanChatMuted(planId: string, muted: boolean): Promise<void> {
    const set = await readSet();
    if (muted) set.add(planId);
    else set.delete(planId);
    await writeSet(set);

    try {
        const { data } = await supabase.auth.getUser();
        const uid = data.user?.id;
        if (!uid) return;
        if (muted) {
            await supabase.from('push_chat_mutes').upsert(
                { user_id: uid, plan_id: planId },
                { onConflict: 'user_id,plan_id' },
            );
        } else {
            await supabase
                .from('push_chat_mutes')
                .delete()
                .eq('user_id', uid)
                .eq('plan_id', planId);
        }
    } catch {
        /* offline / table missing: local mute still works in foreground */
    }
}

export async function getMutedPlanChatIds(): Promise<string[]> {
    return [...(await readSet())];
}

/** Une mutes del servidor con el cache local (el silenciar funciona también con la app cerrada). */
export async function syncPlanChatMutesFromServer(userId: string): Promise<string[]> {
    try {
        const { data } = await supabase
            .from('push_chat_mutes')
            .select('plan_id')
            .eq('user_id', userId);
        const remote = new Set((data ?? []).map((r) => String(r.plan_id)));
        const local = await readSet();
        const merged = new Set([...local, ...remote]);
        // Subir mutes solo locales (migración)
        for (const planId of local) {
            if (!remote.has(planId)) {
                void supabase
                    .from('push_chat_mutes')
                    .upsert({ user_id: userId, plan_id: planId }, { onConflict: 'user_id,plan_id' });
            }
        }
        await writeSet(merged);
        return [...merged];
    } catch {
        return getMutedPlanChatIds();
    }
}

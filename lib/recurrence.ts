import { supabase } from './supabase';

export type RecurrenceRule = {
    freq: 'weekly';
    paused?: boolean;
    until?: string | null;
};

export function buildRecurrence(freq: 'weekly', until?: Date | null): RecurrenceRule {
    return {
        freq,
        until: until ? until.toISOString().slice(0, 10) : null,
    };
}

export async function pauseOrganizerSeries(planId: string): Promise<{ error: string | null }> {
    const { error } = await supabase.rpc('pause_organizer_series', { p_plan_id: planId });
    return { error: error?.message ?? null };
}

export async function materializeOrganizerRecurrence(): Promise<void> {
    try {
        await supabase.rpc('materialize_organizer_recurrence');
    } catch {
        /* RPC aún no aplicada */
    }
}

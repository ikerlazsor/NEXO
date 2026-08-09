import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export type FunnelEvent =
    | 'signup_complete'
    | 'onboarding_complete'
    | 'plan_join'
    | 'chat_open'
    | 'chat_send'
    | 'rating_start'
    | 'rating_complete';

const QUEUE_KEY = '@nexo_analytics_queue_v1';

type Queued = { name: FunnelEvent; userId: string | null; props: Record<string, string>; at: string };

/** Evento de embudo (best-effort; no bloquea UI). */
export function trackFunnel(
    name: FunnelEvent,
    opts?: { userId?: string | null; props?: Record<string, string | number | boolean | null | undefined> },
): void {
    const props: Record<string, string> = {};
    if (opts?.props) {
        for (const [k, v] of Object.entries(opts.props)) {
            if (v == null) continue;
            props[k] = String(v);
        }
    }
    const row: Queued = {
        name,
        userId: opts?.userId ?? null,
        props,
        at: new Date().toISOString(),
    };
    void enqueueAndFlush(row);
}

async function enqueueAndFlush(row: Queued): Promise<void> {
    try {
        const raw = await AsyncStorage.getItem(QUEUE_KEY);
        const q: Queued[] = raw ? (JSON.parse(raw) as Queued[]) : [];
        q.push(row);
        const keep = q.slice(-80);
        await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(keep));

        const { error } = await supabase.from('analytics_events').insert(
            keep.map((e) => ({
                event_name: e.name,
                user_id: e.userId,
                props: e.props,
                created_at: e.at,
            })),
        );
        if (!error) {
            await AsyncStorage.removeItem(QUEUE_KEY);
        }
    } catch {
        /* ignore */
    }
}

export type FunnelCounts = Record<FunnelEvent, number>;

const EMPTY: FunnelCounts = {
    signup_complete: 0,
    onboarding_complete: 0,
    plan_join: 0,
    chat_open: 0,
    chat_send: 0,
    rating_start: 0,
    rating_complete: 0,
};

/** Agregados últimos N días (solo staff/owner vía RLS). */
export async function fetchFunnelCounts(days = 30): Promise<FunnelCounts> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
        .from('analytics_events')
        .select('event_name')
        .gte('created_at', since)
        .limit(5000);
    if (error || !data) return { ...EMPTY };
    const out = { ...EMPTY };
    for (const row of data) {
        const n = row.event_name as FunnelEvent;
        if (n in out) out[n] += 1;
    }
    return out;
}

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

export type AnalyticsRangeDays = 7 | 30;

export type OwnerAnalytics = {
    days: AnalyticsRangeDays;
    generated_at: string;
    health: {
        users_total: number;
        users_onboarded: number;
        users_banned: number;
        dau: number;
        wau: number;
        mau: number;
        new_users: number;
        new_users_prev: number;
        retention_d1: number | null;
        retention_d1_n: number;
        retention_d7: number | null;
        retention_d7_n: number;
    };
    supply: {
        plans: number;
        plans_prev: number;
        upcoming: number;
        filled: number;
        lonely: number;
        joins: number;
        joins_prev: number;
    };
    funnel: {
        signed_up: number;
        onboarded: number;
        activated: number;
        messaged: number;
        rated: number;
    };
    series: { d: string; users: number; plans: number }[];
    categories: { key: string; n: number }[];
    trust: {
        reports_open: number;
        reports_period: number;
        tickets_open: number;
        tickets_period: number;
    };
    organizers: {
        approved: number;
        pending: number;
        plans: number;
    };
};

function asInt(v: unknown): number {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? Math.round(n) : 0;
}

function asNumOrNull(v: unknown): number | null {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
}

function asObj(v: unknown): Record<string, unknown> {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function parseOwnerAnalytics(raw: unknown): OwnerAnalytics | null {
    const root = asObj(raw);
    if (!('health' in root) || !('funnel' in root) || !('supply' in root)) return null;
    const health = asObj(root.health);
    const supply = asObj(root.supply);
    const funnel = asObj(root.funnel);
    const trust = asObj(root.trust);
    const organizers = asObj(root.organizers);
    const days = asInt(root.days) >= 30 ? 30 : 7;
    const series = Array.isArray(root.series)
        ? root.series.map((row) => {
              const r = asObj(row);
              return { d: String(r.d ?? ''), users: asInt(r.users), plans: asInt(r.plans) };
          })
        : [];
    const categories = Array.isArray(root.categories)
        ? root.categories.map((row) => {
              const r = asObj(row);
              return { key: String(r.key ?? ''), n: asInt(r.n) };
          })
        : [];
    return {
        days,
        generated_at: String(root.generated_at ?? ''),
        health: {
            users_total: asInt(health.users_total),
            users_onboarded: asInt(health.users_onboarded),
            users_banned: asInt(health.users_banned),
            dau: asInt(health.dau),
            wau: asInt(health.wau),
            mau: asInt(health.mau),
            new_users: asInt(health.new_users),
            new_users_prev: asInt(health.new_users_prev),
            retention_d1: asNumOrNull(health.retention_d1),
            retention_d1_n: asInt(health.retention_d1_n),
            retention_d7: asNumOrNull(health.retention_d7),
            retention_d7_n: asInt(health.retention_d7_n),
        },
        supply: {
            plans: asInt(supply.plans),
            plans_prev: asInt(supply.plans_prev),
            upcoming: asInt(supply.upcoming),
            filled: asInt(supply.filled),
            lonely: asInt(supply.lonely),
            joins: asInt(supply.joins),
            joins_prev: asInt(supply.joins_prev),
        },
        funnel: {
            signed_up: asInt(funnel.signed_up),
            onboarded: asInt(funnel.onboarded),
            activated: asInt(funnel.activated),
            messaged: asInt(funnel.messaged),
            rated: asInt(funnel.rated),
        },
        series,
        categories,
        trust: {
            reports_open: asInt(trust.reports_open),
            reports_period: asInt(trust.reports_period),
            tickets_open: asInt(trust.tickets_open),
            tickets_period: asInt(trust.tickets_period),
        },
        organizers: {
            approved: asInt(organizers.approved),
            pending: asInt(organizers.pending),
            plans: asInt(organizers.plans),
        },
    };
}

export async function fetchOwnerAnalytics(days: AnalyticsRangeDays): Promise<OwnerAnalytics | null> {
    const { data, error } = await supabase.rpc('get_owner_analytics_dashboard', { p_days: days });
    if (error || data == null) return null;
    return parseOwnerAnalytics(data);
}

export function deltaPct(current: number, previous: number): number | null {
    if (previous <= 0) return current > 0 ? null : 0;
    return Math.round(((current - previous) / previous) * 100);
}

export function convertPct(current: number, previous: number): number | null {
    if (previous <= 0) return null;
    return Math.round((current / previous) * 100);
}

export function fillRate(filled: number, total: number): number | null {
    if (total <= 0) return null;
    return Math.round((filled / total) * 100);
}

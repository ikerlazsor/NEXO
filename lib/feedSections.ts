import { normalizeMainCategory } from './categories';
import {
    compareFeedRanked,
    isFarFeedPlan,
    personalityPreferredCategories,
    type FeedTaste,
    type RankContext,
} from './feedAffinity';

export type FeedHeaderKey =
    | 'feed.sectionYours'
    | 'feed.sectionFriends'
    | 'feed.sectionToday'
    | 'feed.sectionForYou';

export type FeedRow =
    | { kind: 'header'; id: string; titleKey: FeedHeaderKey }
    | {
          kind: 'plan';
          id: string;
          plan: any;
          /** Estado de UI embebido para evitar re-renders globales del feed. */
          membership?: string;
          isSaved?: boolean;
          joining?: boolean;
          distanceLabel?: string;
      };

const EXPLORE_EVERY = 6;

function isMinePlan(
    plan: any,
    currentUserId: string | null,
    membershipMap: Record<string, string>,
    deferMineIds: Set<string>,
): boolean {
    if (!currentUserId) return false;
    if (mineSortBlocked(plan, deferMineIds)) return false;
    if (String(plan.creador_id) === String(currentUserId)) return true;
    const membership = membershipMap[plan.id] ?? membershipMap[String(plan.id)];
    return membership === 'joined';
}

function mineSortBlocked(plan: any, deferMineIds: Set<string>): boolean {
    return deferMineIds.has(plan.id) || deferMineIds.has(String(plan.id));
}

function sortRanked(plans: any[], ctx: RankContext): any[] {
    return [...plans].sort((a, b) => compareFeedRanked(a, b, ctx));
}

function injectExploration(ranked: any[], taste: FeedTaste, ctx: RankContext): any[] {
    const far: any[] = [];
    const near: any[] = [];
    for (const plan of ranked) {
        if (isFarFeedPlan(plan, ctx.coords)) far.push(plan);
        else near.push(plan);
    }

    if (near.length < EXPLORE_EVERY) return [...near, ...far];
    const preferred = new Set(personalityPreferredCategories(taste.personalityTags));
    if (preferred.size === 0) return [...near, ...far];

    const explore = near.filter((p) => {
        const cat = normalizeMainCategory(p.categoria);
        if (cat && !preferred.has(cat)) return true;
        const created = p.creado_en ? Date.now() - new Date(p.creado_en).getTime() : Infinity;
        return Number.isFinite(created) && created < 24 * 60 * 60 * 1000;
    });
    if (explore.length === 0) return [...near, ...far];

    const out: any[] = [];
    const used = new Set<string>();
    let ei = 0;
    for (let i = 0; i < near.length; i++) {
        if (i > 0 && i % EXPLORE_EVERY === 0) {
            while (ei < explore.length && used.has(String(explore[ei].id))) ei += 1;
            const extra = explore[ei++];
            if (extra) {
                out.push(extra);
                used.add(String(extra.id));
            }
        }
        const plan = near[i];
        const id = String(plan.id);
        if (used.has(id)) continue;
        out.push(plan);
        used.add(id);
    }
    return [...out, ...far];
}

function pushSection(rows: FeedRow[], titleKey: FeedHeaderKey, plans: any[]) {
    if (plans.length === 0) return;
    rows.push({ kind: 'header', id: `header:${titleKey}`, titleKey });
    for (const plan of plans) {
        rows.push({ kind: 'plan', id: String(plan.id), plan });
    }
}

function asPlanRows(plans: any[]): FeedRow[] {
    return plans.map((plan) => ({ kind: 'plan' as const, id: String(plan.id), plan }));
}

export function buildFeedRows(input: {
    plans: any[];
    currentUserId: string | null;
    membershipMap: Record<string, string>;
    friendIds: Set<string>;
    coincidedIds?: Set<string>;
    taste: FeedTaste;
    coords?: { latitude: number; longitude: number } | null;
    flatten?: boolean;
    deferMineIds?: Set<string>;
}): FeedRow[] {
    const deferMineIds = input.deferMineIds ?? new Set<string>();
    const ctx: RankContext = {
        taste: input.taste,
        friendIds: input.friendIds,
        coincidedIds: input.coincidedIds ?? new Set<string>(),
        coords: input.coords ?? null,
        currentUserId: input.currentUserId,
    };

    if (input.flatten) {
        return asPlanRows(sortRanked(input.plans, ctx));
    }

    const mine: any[] = [];
    const rest: any[] = [];
    const tail: any[] = [];
    for (const plan of input.plans) {
        if (plan?._feedTail) {
            tail.push(plan);
            continue;
        }
        if (isMinePlan(plan, input.currentUserId, input.membershipMap, deferMineIds)) {
            mine.push(plan);
        } else {
            rest.push(plan);
        }
    }

    const rankedMine = sortRanked(mine, ctx);
    const forYou = [
        ...injectExploration(sortRanked(rest, ctx), input.taste, ctx),
        ...tail,
    ];

    if (rankedMine.length === 0) {
        return asPlanRows(forYou);
    }

    const rows: FeedRow[] = [];
    pushSection(rows, 'feed.sectionYours', rankedMine);
    pushSection(rows, 'feed.sectionForYou', forYou);
    return rows;
}

export function feedRowPlans(rows: FeedRow[]): any[] {
    return rows.filter((row): row is Extract<FeedRow, { kind: 'plan' }> => row.kind === 'plan').map((row) => row.plan);
}

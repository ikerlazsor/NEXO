import { getAuthUser } from './auth';
import { prefetchPlanDetail, waitForPlanDetail } from './planDetailCache';
import { warmDirectChat, warmPlanChat } from './prefetchChats';
import { normalizePushData, resolvePushNavigation } from './push';
import { getPendingRatingPlans } from './ratings';
import { prefetchUserProfile } from './userProfileCache';

const WARM_BUDGET_MS = 1100;

function withBudget<T>(promise: Promise<T>, ms = WARM_BUDGET_MS): Promise<T | void> {
    return Promise.race([
        promise.then((v) => v).catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, ms)),
    ]);
}

/**
 * Precarga el destino de una push antes de navegar, para no enseñar pantallas vacías.
 * Nunca bloquea más de ~1.1s.
 */
export async function warmPushDestination(raw: Record<string, unknown> | undefined): Promise<void> {
    const data = normalizePushData(raw);
    if (!data) return;
    const target = resolvePushNavigation(data);
    if (!target) return;

    const href = target.href;
    const planId = data.planId ? String(data.planId) : '';
    const otherUserId = data.otherUserId ? String(data.otherUserId) : '';
    const userIdFromData = data.userId ? String(data.userId) : '';

    const tasks: Promise<unknown>[] = [];

    if (href.includes('/plan/') && planId) {
        void prefetchPlanDetail(planId);
        tasks.push(waitForPlanDetail(planId, WARM_BUDGET_MS));
    }

    if (href.includes('/chat/') && planId) {
        tasks.push(warmPlanChat(planId));
    }

    if (href.includes('/direct-chat/') && otherUserId) {
        tasks.push(
            (async () => {
                const user = await getAuthUser();
                if (!user) return;
                await warmDirectChat(user.id, otherUserId);
            })(),
        );
    }

    if (href.includes('rate-plan') && planId) {
        tasks.push(
            (async () => {
                const user = await getAuthUser();
                if (!user) return;
                await getPendingRatingPlans(user.id, { force: true });
                void prefetchPlanDetail(planId);
            })(),
        );
    }

    if (href.includes('/user-profile/')) {
        const profileId =
            otherUserId ||
            userIdFromData ||
            href.split('/user-profile/')[1]?.split('?')[0] ||
            '';
        if (profileId) {
            prefetchUserProfile(profileId);
        }
    }

    if (href.includes('/friends') || href.includes('/my-plans')) {
        return;
    }

    if (tasks.length === 0) return;
    await withBudget(Promise.all(tasks));
}

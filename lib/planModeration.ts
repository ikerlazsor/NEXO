import { supabase } from './supabase';

/**
 * Moderación de planes en servidor (función moderate-plan, OpenAI omni-moderation).
 * El móvil solo pregunta; quien decide es el servidor. Además, la base de datos
 * revisa cada plan guardado por su cuenta, así que saltarse esto no sirve.
 */
export type PlanBlockReason =
    | 'minors'
    | 'sexual'
    | 'hate'
    | 'harassment'
    | 'violence'
    | 'illicit'
    | 'self_harm';

export type PlanModerationResult = {
    verdict: 'ok' | 'review' | 'block';
    reason: PlanBlockReason | null;
};

const TIMEOUT_MS = 9000;
const REASONS = new Set<PlanBlockReason>([
    'minors', 'sexual', 'hate', 'harassment', 'violence', 'illicit', 'self_harm',
]);

export async function checkPlanContent(input: {
    title: string;
    description: string;
    images: string[];
}): Promise<PlanModerationResult> {
    const ok: PlanModerationResult = { verdict: 'ok', reason: null };
    try {
        const call = supabase.functions.invoke('moderate-plan', { body: input });
        const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS));
        const res = await Promise.race([call, timeout]);
        // Sin respuesta a tiempo: se publica; la revisión de la base de datos llega después.
        if (!res || res.error || !res.data) return ok;
        const data = res.data as { verdict?: unknown; reason?: unknown };
        const verdict = data.verdict === 'block' || data.verdict === 'review' ? data.verdict : 'ok';
        const reason =
            typeof data.reason === 'string' && REASONS.has(data.reason as PlanBlockReason)
                ? (data.reason as PlanBlockReason)
                : null;
        return { verdict, reason };
    } catch {
        return ok;
    }
}

/** Error de la base de datos cuando el texto choca con la lista mínima. */
export function isContentBlockedError(error: unknown): boolean {
    const msg =
        error && typeof error === 'object' && 'message' in error
            ? String((error as { message?: unknown }).message)
            : String(error ?? '');
    return /content_blocked/.test(msg);
}

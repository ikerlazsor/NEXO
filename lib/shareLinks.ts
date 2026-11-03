import { NEXO_SITE_ORIGIN } from './brand';
import { SUPABASE_URL } from './supabase';

/** Host de la web (Universal / App Links). Env opcional; por defecto appnexo.es. */
const configuredHost =
    typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_SHARE_HOST?.trim() : '';

function hostFromOrigin(origin: string): string {
    try {
        return new URL(origin).hostname;
    } catch {
        return origin.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    }
}

export const SHARE_WEB_HOST =
    (configuredHost?.replace(/^https?:\/\//i, '').replace(/\/+$/, '') || null)
    ?? hostFromOrigin(NEXO_SITE_ORIGIN);

export function planSchemeUrl(planId: string): string {
    return `nexo://plan/${planId}`;
}

/** HTTPS pinchable (WhatsApp). Preferir dominio propio; fallback landing Supabase. */
export function planHttpsUrl(planId: string, opts?: { team?: number }): string | null {
    if (!planId) return null;
    const teamQ =
        typeof opts?.team === 'number' && Number.isFinite(opts.team)
            ? `&team=${Math.max(0, Math.floor(opts.team))}`
            : '';
    if (SHARE_WEB_HOST) return `https://${SHARE_WEB_HOST}/plan/${planId}?v=7${teamQ}`;
    const base = (SUPABASE_URL || '').replace(/\/+$/, '');
    if (!base) return null;
    return `${base}/functions/v1/share-plan/${planId}?v=9${teamQ}`;
}

/** Preferir HTTPS (pinchable). Fallback scheme. */
export function planShareUrl(planId: string, opts?: { team?: number }): string {
    return planHttpsUrl(planId, opts) ?? planSchemeUrl(planId);
}

/** Mensaje = solo el link. */
export function buildPlanShareMessage(opts: { planId: string }): string {
    return planShareUrl(opts.planId);
}

export function buildFootballShareMessage(opts: { planId: string }): string {
    return planShareUrl(opts.planId);
}

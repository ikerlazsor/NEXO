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
export function planHttpsUrl(planId: string): string | null {
    if (!planId) return null;
    if (SHARE_WEB_HOST) return `https://${SHARE_WEB_HOST}/plan/${planId}`;
    const base = (SUPABASE_URL || '').replace(/\/+$/, '');
    if (!base) return null;
    return `${base}/functions/v1/share-plan/${planId}?v=8`;
}

/** Preferir HTTPS (pinchable). Fallback scheme. */
export function planShareUrl(planId: string): string {
    return planHttpsUrl(planId) ?? planSchemeUrl(planId);
}

/** Mensaje = solo el link. */
export function buildPlanShareMessage(opts: { planId: string }): string {
    return planShareUrl(opts.planId);
}

export function buildFootballShareMessage(opts: { planId: string }): string {
    return planShareUrl(opts.planId);
}

/**
 * Enlaces compartibles. HTTPS abre la app si hay App/Universal Links configurados;
 * el scheme nexo:// funciona si la app ya está instalada.
 */
export const SHARE_WEB_HOST =
    (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_SHARE_HOST) || 'nexo.app';

export function planHttpsUrl(planId: string): string {
    return `https://${SHARE_WEB_HOST}/plan/${planId}`;
}

export function planSchemeUrl(planId: string): string {
    return `nexo://plan/${planId}`;
}

/** URL preferida para compartir (https + path). */
export function planShareUrl(planId: string): string {
    return planHttpsUrl(planId);
}

export function buildPlanShareMessage(opts: {
    title: string;
    location?: string | null;
    when?: string | null;
    planId: string;
    hint?: string;
    /** Idioma de la app (`es` | `en` | …). */
    lang?: string;
}): string {
    const isEn = (opts.lang ?? 'es').startsWith('en');
    const where = opts.location?.trim() ? `\n📍 ${opts.location.trim()}` : '';
    const when = opts.when?.trim() ? `\n🗓️ ${opts.when.trim()}` : '';
    const hint =
        opts.hint?.trim() ||
        (isEn ? 'Open it in Nexo to join.' : 'Ábrelo en Nexo para apuntarte.');
    const head = isEn
        ? `Join "${opts.title}" on Nexo!`
        : `¡Únete a "${opts.title}" en Nexo!`;
    const link = planShareUrl(opts.planId);
    return `${head}${where}${when}\n\n${hint}\n${link}`;
}

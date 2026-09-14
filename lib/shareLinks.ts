/** Host opcional, solo cuando Nexo! controle el dominio y publique App Links. */
const configuredHost =
    typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_SHARE_HOST?.trim() : '';
export const SHARE_WEB_HOST = configuredHost?.replace(/^https?:\/\//i, '').replace(/\/+$/, '') || null;

export function planHttpsUrl(planId: string): string | null {
    return SHARE_WEB_HOST ? `https://${SHARE_WEB_HOST}/plan/${planId}` : null;
}

export function planSchemeUrl(planId: string): string {
    return `nexo://plan/${planId}`;
}

/** URL preferida: HTTPS solo con dominio verificado; mientras, scheme propio. */
export function planShareUrl(planId: string): string {
    return planHttpsUrl(planId) ?? planSchemeUrl(planId);
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
        (isEn ? 'Open it in Nexo! to join.' : 'Ábrelo en Nexo! para apuntarte.');
    const head = isEn
        ? `Join "${opts.title}" on Nexo!`
        : `¡Únete a "${opts.title}" en Nexo!`;
    const link = planShareUrl(opts.planId);
    return `${head}${where}${when}\n\n${hint}\n${link}`;
}

/** Copy corto tipo aviso para grupos de WhatsApp (fútbol / pachanga). */
export function buildFootballShareMessage(opts: {
    title: string;
    location?: string | null;
    when?: string | null;
    planId: string;
    spotsLeft: number;
    formatLabel?: string | null;
    lang?: string;
}): string {
    const isEn = (opts.lang ?? 'es').startsWith('en');
    const spots = Math.max(0, Math.floor(opts.spotsLeft));
    const alert =
        spots <= 0
            ? isEn
                ? '🔥 Full squad'
                : '🔥 ¡Completo!'
            : spots === 1
              ? isEn
                  ? '⚠️ 1 spot left'
                  : '⚠️ Queda 1 plaza'
              : isEn
                ? `⚠️ ${spots} spots left`
                : `⚠️ Quedan ${spots} plazas`;

    const bits: string[] = [];
    const fmt = opts.formatLabel?.trim();
    if (fmt) bits.push(fmt);
    if (opts.when?.trim()) bits.push(opts.when.trim());
    if (opts.location?.trim()) bits.push(opts.location.trim());
    const meta = bits.length ? bits.join(' · ') : opts.title.trim();

    const cta = isEn ? 'Join on Nexo!' : 'Apúntate en Nexo!';
    const link = planShareUrl(opts.planId);
    return `${alert}\n⚽ ${meta}\n${cta}\n${link}`;
}

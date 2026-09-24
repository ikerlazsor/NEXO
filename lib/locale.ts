/** BCP-47 / Intl locales for each app language. */
export type AppLang = 'es' | 'en' | 'fr' | 'de' | 'pt' | 'it';

const LOCALE_TAG: Record<AppLang, string> = {
    es: 'es-ES',
    en: 'en-GB',
    fr: 'fr-FR',
    de: 'de-DE',
    pt: 'pt-PT',
    it: 'it-IT',
};

export function localeTag(lang: string | null | undefined): string {
    if (lang && lang in LOCALE_TAG) return LOCALE_TAG[lang as AppLang];
    return LOCALE_TAG.en;
}

/** Map device languageCode → app lang; unknown → en. */
export function normalizeDeviceLang(code: string | null | undefined): AppLang {
    const c = (code || '').toLowerCase().split('-')[0];
    if (c === 'es') return 'es';
    if (c === 'en') return 'en';
    if (c === 'fr') return 'fr';
    if (c === 'de') return 'de';
    if (c === 'pt') return 'pt';
    if (c === 'it') return 'it';
    return 'en';
}

export function isAppLang(value: unknown): value is AppLang {
    return value === 'es' || value === 'en' || value === 'fr' || value === 'de' || value === 'pt' || value === 'it';
}

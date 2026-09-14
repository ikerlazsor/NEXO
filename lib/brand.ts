import { Linking } from 'react-native';

export const APP_DISPLAY_NAME = 'Nexo!';

export const NEXO_SUPPORT_EMAIL = 'hola@appnexo.es';
export const NEXO_SITE_ORIGIN = 'https://appnexo.es';

export const NEXO_PRIVACY_URL = `${NEXO_SITE_ORIGIN}/privacidad`;
export const NEXO_PRIVACY_EN_URL = `${NEXO_SITE_ORIGIN}/privacy`;
export const NEXO_TERMS_URL = `${NEXO_SITE_ORIGIN}/terminos`;
export const NEXO_NORMS_URL = `${NEXO_SITE_ORIGIN}/normas`;
export const NEXO_SUPPORT_URL = `${NEXO_SITE_ORIGIN}/soporte`;
export const NEXO_DELETE_ACCOUNT_URL = `${NEXO_SITE_ORIGIN}/eliminar-cuenta`;

export function supportMailtoUrl(subject?: string) {
    if (!subject) return `mailto:${NEXO_SUPPORT_EMAIL}`;
    return `mailto:${NEXO_SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

export function openSupportEmail(subject?: string) {
    return Linking.openURL(supportMailtoUrl(subject));
}

export function openBrandPage(url: string) {
    return Linking.openURL(url);
}

/** @deprecated Use openBrandPage */
export const openNexoPage = openBrandPage;

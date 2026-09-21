/** Códigos ISO 3166-1 alpha-2 + emoji de bandera (sin assets). */

export type CountryFlag = {
    code: string;
    nameEs: string;
    nameEn: string;
};

/** Lista curada (ES/LATAM/UE + frecuentes). */
export const COUNTRY_FLAGS: CountryFlag[] = [
    { code: 'ES', nameEs: 'España', nameEn: 'Spain' },
    { code: 'MX', nameEs: 'México', nameEn: 'Mexico' },
    { code: 'AR', nameEs: 'Argentina', nameEn: 'Argentina' },
    { code: 'CO', nameEs: 'Colombia', nameEn: 'Colombia' },
    { code: 'CL', nameEs: 'Chile', nameEn: 'Chile' },
    { code: 'PE', nameEs: 'Perú', nameEn: 'Peru' },
    { code: 'VE', nameEs: 'Venezuela', nameEn: 'Venezuela' },
    { code: 'EC', nameEs: 'Ecuador', nameEn: 'Ecuador' },
    { code: 'UY', nameEs: 'Uruguay', nameEn: 'Uruguay' },
    { code: 'PY', nameEs: 'Paraguay', nameEn: 'Paraguay' },
    { code: 'BO', nameEs: 'Bolivia', nameEn: 'Bolivia' },
    { code: 'CR', nameEs: 'Costa Rica', nameEn: 'Costa Rica' },
    { code: 'PA', nameEs: 'Panamá', nameEn: 'Panama' },
    { code: 'GT', nameEs: 'Guatemala', nameEn: 'Guatemala' },
    { code: 'HN', nameEs: 'Honduras', nameEn: 'Honduras' },
    { code: 'SV', nameEs: 'El Salvador', nameEn: 'El Salvador' },
    { code: 'NI', nameEs: 'Nicaragua', nameEn: 'Nicaragua' },
    { code: 'DO', nameEs: 'República Dominicana', nameEn: 'Dominican Republic' },
    { code: 'CU', nameEs: 'Cuba', nameEn: 'Cuba' },
    { code: 'PR', nameEs: 'Puerto Rico', nameEn: 'Puerto Rico' },
    { code: 'US', nameEs: 'Estados Unidos', nameEn: 'United States' },
    { code: 'CA', nameEs: 'Canadá', nameEn: 'Canada' },
    { code: 'BR', nameEs: 'Brasil', nameEn: 'Brazil' },
    { code: 'PT', nameEs: 'Portugal', nameEn: 'Portugal' },
    { code: 'FR', nameEs: 'Francia', nameEn: 'France' },
    { code: 'IT', nameEs: 'Italia', nameEn: 'Italy' },
    { code: 'DE', nameEs: 'Alemania', nameEn: 'Germany' },
    { code: 'GB', nameEs: 'Reino Unido', nameEn: 'United Kingdom' },
    { code: 'IE', nameEs: 'Irlanda', nameEn: 'Ireland' },
    { code: 'NL', nameEs: 'Países Bajos', nameEn: 'Netherlands' },
    { code: 'BE', nameEs: 'Bélgica', nameEn: 'Belgium' },
    { code: 'CH', nameEs: 'Suiza', nameEn: 'Switzerland' },
    { code: 'AT', nameEs: 'Austria', nameEn: 'Austria' },
    { code: 'SE', nameEs: 'Suecia', nameEn: 'Sweden' },
    { code: 'NO', nameEs: 'Noruega', nameEn: 'Norway' },
    { code: 'DK', nameEs: 'Dinamarca', nameEn: 'Denmark' },
    { code: 'FI', nameEs: 'Finlandia', nameEn: 'Finland' },
    { code: 'PL', nameEs: 'Polonia', nameEn: 'Poland' },
    { code: 'CZ', nameEs: 'Chequia', nameEn: 'Czechia' },
    { code: 'RO', nameEs: 'Rumanía', nameEn: 'Romania' },
    { code: 'GR', nameEs: 'Grecia', nameEn: 'Greece' },
    { code: 'TR', nameEs: 'Turquía', nameEn: 'Turkey' },
    { code: 'RU', nameEs: 'Rusia', nameEn: 'Russia' },
    { code: 'UA', nameEs: 'Ucrania', nameEn: 'Ukraine' },
    { code: 'MA', nameEs: 'Marruecos', nameEn: 'Morocco' },
    { code: 'DZ', nameEs: 'Argelia', nameEn: 'Algeria' },
    { code: 'TN', nameEs: 'Túnez', nameEn: 'Tunisia' },
    { code: 'EG', nameEs: 'Egipto', nameEn: 'Egypt' },
    { code: 'SN', nameEs: 'Senegal', nameEn: 'Senegal' },
    { code: 'NG', nameEs: 'Nigeria', nameEn: 'Nigeria' },
    { code: 'ZA', nameEs: 'Sudáfrica', nameEn: 'South Africa' },
    { code: 'CN', nameEs: 'China', nameEn: 'China' },
    { code: 'JP', nameEs: 'Japón', nameEn: 'Japan' },
    { code: 'KR', nameEs: 'Corea del Sur', nameEn: 'South Korea' },
    { code: 'IN', nameEs: 'India', nameEn: 'India' },
    { code: 'PH', nameEs: 'Filipinas', nameEn: 'Philippines' },
    { code: 'TH', nameEs: 'Tailandia', nameEn: 'Thailand' },
    { code: 'VN', nameEs: 'Vietnam', nameEn: 'Vietnam' },
    { code: 'ID', nameEs: 'Indonesia', nameEn: 'Indonesia' },
    { code: 'AU', nameEs: 'Australia', nameEn: 'Australia' },
    { code: 'NZ', nameEs: 'Nueva Zelanda', nameEn: 'New Zealand' },
    { code: 'AE', nameEs: 'Emiratos Árabes', nameEn: 'United Arab Emirates' },
    { code: 'SA', nameEs: 'Arabia Saudí', nameEn: 'Saudi Arabia' },
    { code: 'PK', nameEs: 'Pakistán', nameEn: 'Pakistan' },
    { code: 'BD', nameEs: 'Bangladés', nameEn: 'Bangladesh' },
];

const CODE_SET = new Set(COUNTRY_FLAGS.map((c) => c.code));

/** Convierte "ES" → 🇪🇸 */
export function countryCodeToFlagEmoji(code: string | null | undefined): string | null {
    if (!code || typeof code !== 'string') return null;
    const cc = code.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) return null;
    return String.fromCodePoint(...[...cc].map((ch) => 127397 + ch.charCodeAt(0)));
}

export function parseCountryCode(perfilGustos: unknown): string | null {
    if (!perfilGustos || typeof perfilGustos !== 'object') return null;
    const raw = (perfilGustos as Record<string, unknown>).pais;
    if (typeof raw !== 'string') return null;
    const cc = raw.trim().toUpperCase();
    return CODE_SET.has(cc) ? cc : null;
}

export function mergePerfilGustosCountry(
    existing: unknown,
    countryCode: string | null,
): Record<string, unknown> {
    const base =
        existing && typeof existing === 'object' ? { ...(existing as Record<string, unknown>) } : {};
    if (countryCode && CODE_SET.has(countryCode.toUpperCase())) {
        base.pais = countryCode.toUpperCase();
    } else {
        delete base.pais;
    }
    return base;
}

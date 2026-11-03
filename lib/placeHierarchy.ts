/** Continente → país → división (provincia / estado / región). */

import { SPAIN_PROVINCES } from './provinces';
import { Country, State } from 'country-state-city';

export type PlaceContinentId =
    | 'europe'
    | 'north_america'
    | 'south_america'
    | 'africa'
    | 'asia'
    | 'oceania';

export type PlaceContinent = {
    id: PlaceContinentId;
    nameEs: string;
    nameEn: string;
};

export type PlaceCountry = {
    code: string;
    nameEs: string;
    nameEn: string;
};

export type PlaceDivision = {
    code: string;
    name: string;
};

export const PLACE_CONTINENTS: PlaceContinent[] = [
    { id: 'europe', nameEs: 'Europa', nameEn: 'Europe' },
    { id: 'north_america', nameEs: 'América del Norte', nameEn: 'North America' },
    { id: 'south_america', nameEs: 'América del Sur', nameEn: 'South America' },
    { id: 'africa', nameEs: 'África', nameEn: 'Africa' },
    { id: 'asia', nameEs: 'Asia', nameEn: 'Asia' },
    { id: 'oceania', nameEs: 'Oceanía', nameEn: 'Oceania' },
];

/** ISO 3166-1 alpha-2 → continente (cobertura amplia). */
const CONTINENT_BY_ISO: Record<string, PlaceContinentId> = {
    // Europa
    AL: 'europe', AD: 'europe', AT: 'europe', BY: 'europe', BE: 'europe', BA: 'europe', BG: 'europe',
    HR: 'europe', CY: 'europe', CZ: 'europe', DK: 'europe', EE: 'europe', FI: 'europe', FR: 'europe',
    DE: 'europe', GR: 'europe', HU: 'europe', IS: 'europe', IE: 'europe', IT: 'europe', XK: 'europe',
    LV: 'europe', LI: 'europe', LT: 'europe', LU: 'europe', MT: 'europe', MD: 'europe', MC: 'europe',
    ME: 'europe', NL: 'europe', MK: 'europe', NO: 'europe', PL: 'europe', PT: 'europe', RO: 'europe',
    RU: 'europe', SM: 'europe', RS: 'europe', SK: 'europe', SI: 'europe', ES: 'europe', SE: 'europe',
    CH: 'europe', UA: 'europe', GB: 'europe', VA: 'europe',
    // América del Norte + Centroamérica + Caribe
    US: 'north_america', CA: 'north_america', MX: 'north_america', GT: 'north_america', BZ: 'north_america',
    SV: 'north_america', HN: 'north_america', NI: 'north_america', CR: 'north_america', PA: 'north_america',
    CU: 'north_america', DO: 'north_america', HT: 'north_america', JM: 'north_america', TT: 'north_america',
    BB: 'north_america', BS: 'north_america', AG: 'north_america', DM: 'north_america', GD: 'north_america',
    KN: 'north_america', LC: 'north_america', VC: 'north_america', PR: 'north_america',
    // América del Sur
    AR: 'south_america', BO: 'south_america', BR: 'south_america', CL: 'south_america', CO: 'south_america',
    EC: 'south_america', GY: 'south_america', PY: 'south_america', PE: 'south_america', SR: 'south_america',
    UY: 'south_america', VE: 'south_america',
    // África
    DZ: 'africa', AO: 'africa', BJ: 'africa', BW: 'africa', BF: 'africa', BI: 'africa', CV: 'africa',
    CM: 'africa', CF: 'africa', TD: 'africa', KM: 'africa', CG: 'africa', CD: 'africa', CI: 'africa',
    DJ: 'africa', EG: 'africa', GQ: 'africa', ER: 'africa', SZ: 'africa', ET: 'africa', GA: 'africa',
    GM: 'africa', GH: 'africa', GN: 'africa', GW: 'africa', KE: 'africa', LS: 'africa', LR: 'africa',
    LY: 'africa', MG: 'africa', MW: 'africa', ML: 'africa', MR: 'africa', MU: 'africa', MA: 'africa',
    MZ: 'africa', NA: 'africa', NE: 'africa', NG: 'africa', RW: 'africa', ST: 'africa', SN: 'africa',
    SC: 'africa', SL: 'africa', SO: 'africa', ZA: 'africa', SS: 'africa', SD: 'africa', TZ: 'africa',
    TG: 'africa', TN: 'africa', UG: 'africa', ZM: 'africa', ZW: 'africa',
    // Asia
    AF: 'asia', AM: 'asia', AZ: 'asia', BH: 'asia', BD: 'asia', BT: 'asia', BN: 'asia', KH: 'asia',
    CN: 'asia', GE: 'asia', IN: 'asia', ID: 'asia', IR: 'asia', IQ: 'asia', IL: 'asia', JP: 'asia',
    JO: 'asia', KZ: 'asia', KW: 'asia', KG: 'asia', LA: 'asia', LB: 'asia', MY: 'asia', MV: 'asia',
    MN: 'asia', MM: 'asia', NP: 'asia', KP: 'asia', OM: 'asia', PK: 'asia', PS: 'asia', PH: 'asia',
    QA: 'asia', SA: 'asia', SG: 'asia', KR: 'asia', LK: 'asia', SY: 'asia', TW: 'asia', TJ: 'asia',
    TH: 'asia', TL: 'asia', TR: 'asia', TM: 'asia', AE: 'asia', UZ: 'asia', VN: 'asia', YE: 'asia',
    // Oceanía
    AU: 'oceania', FJ: 'oceania', KI: 'oceania', MH: 'oceania', FM: 'oceania', NR: 'oceania',
    NZ: 'oceania', PW: 'oceania', PG: 'oceania', WS: 'oceania', SB: 'oceania', TO: 'oceania',
    TV: 'oceania', VU: 'oceania',
};

function sortByName<T>(rows: T[], nameOf: (row: T) => string): T[] {
    return [...rows].sort((a, b) =>
        nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base' }),
    );
}

function countryDisplayName(c: { isoCode: string; name: string }, lang: 'es' | 'en'): string {
    // Prefer Spanish official names for a few frequent ones; library is English.
    if (lang === 'es') {
        const esNames: Record<string, string> = {
            ES: 'España', MX: 'México', AR: 'Argentina', CO: 'Colombia', CL: 'Chile', PE: 'Perú',
            VE: 'Venezuela', EC: 'Ecuador', UY: 'Uruguay', PY: 'Paraguay', BO: 'Bolivia',
            US: 'Estados Unidos', CA: 'Canadá', BR: 'Brasil', PT: 'Portugal', FR: 'Francia',
            IT: 'Italia', DE: 'Alemania', GB: 'Reino Unido', IE: 'Irlanda', NL: 'Países Bajos',
            BE: 'Bélgica', CH: 'Suiza', AT: 'Austria', SE: 'Suecia', NO: 'Noruega', DK: 'Dinamarca',
            FI: 'Finlandia', PL: 'Polonia', CZ: 'Chequia', RO: 'Rumanía', GR: 'Grecia', TR: 'Turquía',
            RU: 'Rusia', UA: 'Ucrania', MA: 'Marruecos', CN: 'China', JP: 'Japón', KR: 'Corea del Sur',
            IN: 'India', AU: 'Australia', NZ: 'Nueva Zelanda', AE: 'Emiratos Árabes', SA: 'Arabia Saudí',
        };
        return esNames[c.isoCode] || c.name;
    }
    return c.name;
}

export function getPlaceContinents(): PlaceContinent[] {
    return PLACE_CONTINENTS;
}

export function getCountriesForContinent(
    continentId: PlaceContinentId,
    lang: 'es' | 'en',
): PlaceCountry[] {
    const all = Country.getAllCountries();
    const rows: PlaceCountry[] = [];
    for (const c of all) {
        const mapped = CONTINENT_BY_ISO[c.isoCode];
        if (mapped !== continentId) continue;
        rows.push({
            code: c.isoCode,
            nameEs: countryDisplayName(c, 'es'),
            nameEn: c.name,
        });
    }
    return sortByName(rows, (r) => (lang === 'en' ? r.nameEn : r.nameEs));
}

export function getDivisionsForCountry(countryCode: string): PlaceDivision[] {
    const code = countryCode.toUpperCase();
    if (code === 'ES') {
        const rows = SPAIN_PROVINCES.map((name) => ({ code: `ES-${name}`, name }));
        return sortByName(rows, (r) => r.name);
    }
    const states = State.getStatesOfCountry(code) || [];
    const rows = states.map((s) => ({
        code: s.isoCode,
        name: s.name,
    }));
    return sortByName(rows, (r) => r.name);
}

export function getCountryName(countryCode: string, lang: 'es' | 'en'): string {
    const c = Country.getCountryByCode(countryCode.toUpperCase());
    if (!c) return countryCode;
    return countryDisplayName(c, lang);
}

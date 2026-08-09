import type { Genero } from './profileFields';

export type ReadyAgeBand = '18_25' | '26_35' | '36_50' | '51_plus';
export type ReadyGender = 'm' | 'f' | 'o';

export type ReadyRewrite = {
    /** Texto que se borra (debe coincidir al final del mensaje). */
    remove: string;
    /** Texto que se escribe después del borrado. */
    insert: string;
};

export function readyAgeBand(age: number): ReadyAgeBand {
    if (age <= 25) return '18_25';
    if (age <= 35) return '26_35';
    if (age <= 50) return '36_50';
    return '51_plus';
}

export function readyGenderKey(genero: Genero | null | undefined): ReadyGender {
    if (genero === 'masculino') return 'm';
    if (genero === 'femenino') return 'f';
    return 'o';
}

export function readyMessageKey(age: number, genero: Genero | null | undefined): string {
    return `onboarding.ready.${readyGenderKey(genero)}.${readyAgeBand(age)}.msg`;
}

export function readyCtaKey(age: number, genero: Genero | null | undefined): string {
    return `onboarding.ready.${readyGenderKey(genero)}.${readyAgeBand(age)}.cta`;
}

/** Reescritura typewriter (borrar + escribir) para 18–35. */
export function readyRewrite(age: number, lang: string): ReadyRewrite | null {
    const band = readyAgeBand(age);
    if (band !== '18_25' && band !== '26_35') return null;
    if (lang === 'en') {
        return { remove: 'shitty ones', insert: 'bad ones :)' };
    }
    return { remove: 'de mierda', insert: 'malos :)' };
}

/** Primer nombre para el saludo (evita "Ana María, máquina"). */
export function readyFirstName(fullName: string, fallback = ''): string {
    const trimmed = fullName.trim();
    if (!trimmed) return fallback;
    return trimmed.split(/\s+/)[0] ?? trimmed;
}

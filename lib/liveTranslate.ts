import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Lang } from './i18n';

const memory = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();
let active = 0;
const pending: Array<() => void> = [];
const MAX_PARALLEL = 2;
/** v3: no traducir argot / títulos ambiguos (p. ej. «Partidito Furbo» → «Smart Party»). */
const CACHE_PREFIX = '@nexo_tr3:';

const LANG_MARKERS: Record<Lang, RegExp[]> = {
    es: [
        /[áéíóúñ¿¡]/i,
        /\b(que|qué|por|para|una|unos|unas|los|las|del|con|está|esta|también|hola|gracias|hoy|vamos|venga|quedada|quedadas|partido|partidito|furbo|futbol|fútbol|pachanga|cañas|birras|planazo|terraceo|vermut|cenita|after|mañana|finde)\b/i,
    ],
    en: [
        /\b(the|and|with|this|that|you|are|for|your|hello|thanks|today|tonight|let's|lets)\b/i,
    ],
    fr: [
        /[àâçéèêëîïôùûüÿœæ]/i,
        /\b(que|les|des|une|est|pour|avec|bonjour|merci|aujourd|soir)\b/i,
    ],
    de: [
        /[äöüß]/i,
        /\b(und|der|die|das|mit|für|nicht|heute|danke|hallo)\b/i,
    ],
    pt: [
        /[áàâãéêíóôõúç]/i,
        /\b(que|para|uma|os|as|com|está|também|olá|obrigado|hoje)\b/i,
    ],
    it: [
        /[àèéìíîòóùú]/i,
        /\b(che|per|una|con|sono|oggi|grazie|ciao|della|degli)\b/i,
    ],
};

/** Argots / diminutivos latinos: Google inventa traducciones absurdas. */
const INFORMAL_HINT =
    /\b(partidito|furbo|futbol|fútbol|pachanga|cañas|birras|planazo|terraceo|vermut|cenita|quedada|quedadas|finde|venga|mañanita|after|birra|caña|partido)\b/i;

function cacheKey(text: string, lang: Lang): string {
    let h = 0;
    for (let i = 0; i < text.length; i += 1) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
    return `${CACHE_PREFIX}${lang}:${text.length}:${h}`;
}

function wordList(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^\p{L}0-9]+/u)
        .filter((w) => w.length >= 2);
}

function looksLikeLang(text: string, lang: Lang): boolean {
    const sample = text.slice(0, 400);
    if (LANG_MARKERS[lang].some((re) => re.test(sample))) return true;
    if (lang === 'es') {
        return wordList(sample).some((w) => w.length >= 6 && /(ito|ita|itos|itas)$/.test(w));
    }
    return false;
}

function onlyLatinInformal(text: string): boolean {
    const words = wordList(text);
    if (words.length === 0 || words.length > 6) return false;
    if (text.length > 48) return false;
    return !/[\u0400-\u04FF\u0600-\u06FF\u4E00-\u9FFF\u3040-\u30FF]/.test(text);
}

/** Títulos cortos ambiguos / argot: mejor dejar el original. */
function shouldSkipTranslation(text: string, lang: Lang): boolean {
    if (looksLikeLang(text, lang)) return true;
    if (INFORMAL_HINT.test(text) && onlyLatinInformal(text)) return true;
    if (
        onlyLatinInformal(text)
        && !looksLikeLang(text, 'en')
        && !looksLikeLang(text, 'fr')
        && !looksLikeLang(text, 'de')
        && !looksLikeLang(text, 'it')
        && !looksLikeLang(text, 'pt')
        && !looksLikeLang(text, 'es')
    ) {
        return true;
    }
    // Diminutivos tipo «partidito» aunque la UI no sea español.
    if (onlyLatinInformal(text) && wordList(text).some((w) => /(ito|ita|itos|itas)$/.test(w))) {
        return true;
    }
    return false;
}

function parseGooglePayload(data: unknown): { text: string | null; detected: string | null } {
    if (!Array.isArray(data) || !Array.isArray(data[0])) return { text: null, detected: null };
    const parts = data[0]
        .map((row) => (Array.isArray(row) && typeof row[0] === 'string' ? row[0] : ''))
        .join('');
    const text = parts.trim() || null;
    const detected = typeof data[2] === 'string' ? data[2].slice(0, 2).toLowerCase() : null;
    return { text, detected };
}

function chunksOf(text: string, size: number): string[] {
    if (text.length <= size) return [text];
    const chunks: string[] = [];
    let rest = text;
    while (rest.length) {
        if (rest.length <= size) {
            chunks.push(rest);
            break;
        }
        let cut = rest.lastIndexOf(' ', size);
        if (cut < size * 0.5) cut = size;
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
    }
    return chunks.filter(Boolean);
}

function runQueued<T>(job: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        const start = () => {
            active += 1;
            job().then(resolve, reject).finally(() => {
                active -= 1;
                const next = pending.shift();
                if (next) next();
            });
        };
        if (active < MAX_PARALLEL) start();
        else pending.push(start);
    });
}

async function translateChunk(text: string, lang: Lang): Promise<{ text: string | null; detected: string | null }> {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${lang}&dt=t&q=${encodeURIComponent(text)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) return { text: null, detected: null };
        const data = await res.json();
        return parseGooglePayload(data);
    } catch {
        return { text: null, detected: null };
    } finally {
        clearTimeout(timer);
    }
}

/** Si el resultado se aleja mucho del original (alucinación), descartar. */
function looksLikeBadTranslation(raw: string, translated: string): boolean {
    const a = wordList(raw);
    const b = wordList(translated);
    if (a.length === 0 || b.length === 0) return true;
    // Títulos cortos: si Google inventa palabras nuevas sin solape, no aplicar.
    if (a.length <= 4) {
        const setB = new Set(b);
        const overlap = a.filter((w) => setB.has(w)).length;
        if (overlap === 0 && Math.abs(a.length - b.length) <= 2) return true;
        // «Partidito Furbo» → «Smart Party»: longitudes parecidas, cero solape.
        if (overlap === 0 && raw.length <= 40 && translated.length <= 48) return true;
    }
    return false;
}

export async function translateIfNeeded(text: string, lang: Lang): Promise<string | null> {
    const raw = text.trim();
    if (raw.length < 4 || raw.length > 4000) return null;
    if (shouldSkipTranslation(raw, lang)) return null;

    const key = cacheKey(raw, lang);
    const hit = memory.get(key);
    if (hit) return hit === raw ? null : hit;

    const existing = inflight.get(key);
    if (existing) return existing;

    const job = runQueued(async () => {
        try {
            const stored = await AsyncStorage.getItem(key);
            if (stored) {
                memory.set(key, stored);
                return stored === raw ? null : stored;
            }
        } catch {
            /* ignore */
        }

        const parts = chunksOf(raw, 420);
        const translated: string[] = [];
        let detected: string | null = null;
        for (const part of parts) {
            const next = await translateChunk(part, lang);
            if (next.detected) detected = next.detected;
            if (!next.text) return null;
            translated.push(next.text);
        }
        if (detected && detected === lang) {
            memory.set(key, raw);
            AsyncStorage.setItem(key, raw).catch(() => {});
            return null;
        }
        // Detectó español (u otro) pero el UI pide otra lengua y el texto era argot → no forzar.
        if (detected === 'es' && lang !== 'es' && onlyLatinInformal(raw)) {
            memory.set(key, raw);
            AsyncStorage.setItem(key, raw).catch(() => {});
            return null;
        }
        const result = translated.join(' ').trim();
        if (!result || result === raw || looksLikeBadTranslation(raw, result)) {
            memory.set(key, raw);
            AsyncStorage.setItem(key, raw).catch(() => {});
            return null;
        }
        memory.set(key, result);
        AsyncStorage.setItem(key, result).catch(() => {});
        return result;
    });

    inflight.set(key, job);
    try {
        return await job;
    } finally {
        inflight.delete(key);
    }
}

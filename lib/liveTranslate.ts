import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Lang } from './i18n';

const memory = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();
let active = 0;
const pending: Array<() => void> = [];
const MAX_PARALLEL = 2;
const CACHE_PREFIX = '@nexo_tr:';

function cacheKey(text: string, lang: Lang): string {
    let h = 0;
    for (let i = 0; i < text.length; i += 1) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
    return `${CACHE_PREFIX}${lang}:${text.length}:${h}`;
}

function looksLikeLang(text: string, lang: Lang): boolean {
    const sample = text.slice(0, 400).toLowerCase();
    const esHits = (sample.match(/[áéíóúñ¿¡]/g)?.length ?? 0)
        + (sample.match(/\b(que|por|para|una|los|las|del|con|está|también|hola|gracias)\b/g)?.length ?? 0);
    const enHits = (sample.match(/\b(the|and|with|this|that|you|are|for|your|hello|thanks)\b/g)?.length ?? 0);
    if (lang === 'es') return esHits > enHits && esHits >= 1;
    return enHits > esHits && enHits >= 1;
}

function parseGooglePayload(data: unknown): string | null {
    if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
    const parts = data[0]
        .map((row) => (Array.isArray(row) && typeof row[0] === 'string' ? row[0] : ''))
        .join('');
    const out = parts.trim();
    return out || null;
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

async function translateChunk(text: string, lang: Lang): Promise<string | null> {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${lang}&dt=t&q=${encodeURIComponent(text)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) return null;
        const data = await res.json();
        return parseGooglePayload(data);
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

export async function translateIfNeeded(text: string, lang: Lang): Promise<string | null> {
    const raw = text.trim();
    if (raw.length < 4 || raw.length > 4000) return null;
    if (looksLikeLang(raw, lang)) return null;

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
        for (const part of parts) {
            const next = await translateChunk(part, lang);
            if (!next) return null;
            translated.push(next);
        }
        const result = translated.join(' ').trim();
        if (!result || result === raw) {
            memory.set(key, raw);
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

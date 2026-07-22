/**
 * Moderación de títulos de plan (rápida, en cliente).
 * - Solo alfabeto latino (ES/EN/DE/FR/PT… con acentos)
 * - Rechaza chino, árabe, japonés, cirílico, etc.
 * - Rechaza basura tipo "jdkjdiheiu" (solo títulos de una sola palabra)
 * - Rechaza contenido inapropiado (lista + patrones) con límites de palabra
 */

export type TitleModerationReason = 'script' | 'gibberish' | 'inappropriate';

export type TitleModerationResult = {
    ok: boolean;
    reason: TitleModerationReason | null;
};

/** Letras latinas (incluye acentos europeos comunes). */
const LATIN_LETTER =
    /[A-Za-zÀ-ÖØ-öø-ÿĀ-žǺ-ǿȘșȚț]/;

/** Scripts no latinos frecuentes. */
const NON_LATIN_SCRIPT =
    /[\u0400-\u04FF\u0500-\u052F\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0900-\u097F\u4E00-\u9FFF\u3040-\u30FF\u3400-\u4DBF\uAC00-\uD7AF\u0590-\u05FF\u0E00-\u0E7F\u1200-\u137F]/;

const VOWELS = /[aeiouáéíóúüàèìòùâêîôûäëïöüãõæœyAEIOUÁÉÍÓÚÜÀÈÌÒÙÂÊÎÔÛÄËÏÖÜÃÕÆŒY]/;

/** Palabras / frases inapropiadas (mín. 4 letras salvo frases y cortas explícitas). */
const BAD_TERMS = [
    // —— ES ——
    'puta', 'puto', 'putas', 'putos', 'mierda', 'joder', 'jodete', 'coño', 'coños',
    'gilipollas', 'imbecil', 'imbécil', 'idiota', 'subnormal', 'retrasado',
    'maricón', 'maricon', 'marica', 'maricas', 'zorra', 'zorras', 'pendejo', 'pendeja',
    'cabron', 'cabrón', 'cabrones', 'hijoputa', 'hijodeputa', 'hijo de puta',
    'polla', 'pollas', 'pene', 'penes', 'vagina', 'vaginas', 'cojones',
    'follar', 'follada', 'follando', 'sexo', 'porno', 'pornografia', 'pornografía',
    'xxx', 'onlyfans', 'prostituta', 'prostitutas', 'prostitucion', 'prostitución',
    'violar', 'violacion', 'violación', 'pedofilo', 'pedófilo', 'pedofilia',
    'nazi', 'nazis', 'hitler',
    // escatológico / asqueroso
    'caca', 'cacas', 'cagar', 'cagada', 'cagadas', 'cagon', 'cagón', 'cagona',
    'mierdas', 'mojon', 'mojón', 'mojones', 'pedo', 'pedos', 'peerse', 'pearse',
    'pis', 'mear', 'meada', 'orinar', 'orina', 'vomito', 'vómito', 'vomitar',
    'comer caca', 'come caca', 'comiendo caca', 'tragar caca',
    'droga', 'drogas', 'cocaina', 'cocaína', 'heroina', 'heroína', 'marihuana',
    'porro', 'porros', 'cannabis', 'hachis', 'hashis', 'crack',
    'extasis', 'éxtasis', 'mdma', 'metanfetamina', 'anfetamina', 'ketamina',
    'fumar hierba', 'fumar maria', 'colocaros', 'colocarse',
    'robar', 'atracar', 'atraco', 'atracos', 'asaltar', 'asalto',
    'hurtar', 'hurto', 'estafar', 'estafa', 'secuestro', 'secuestrar',
    'matar', 'asesinar', 'asesinato', 'homicidio', 'torturar', 'tortura',
    'paliza', 'apunalar', 'apuñalar', 'disparar', 'tiroteo',
    'agredir', 'agresion', 'agresión', 'maltratar', 'maltrato',
    'navaja', 'pistola', 'escopeta', 'bomba', 'explosivo',
    // —— EN ——
    'fuck', 'fucking', 'fucker', 'shit', 'shitting', 'shitty', 'bullshit',
    'bitch', 'asshole', 'bastard', 'cunt', 'poop', 'poo', 'diarrhea', 'diarrhoea',
    'piss', 'pissing', 'vomit', 'puke', 'nigger', 'nigga', 'retard', 'whore', 'slut',
    'dick', 'cock', 'pussy', 'rape', 'rapist', 'kill yourself', 'murder', 'murderer',
    'steal', 'stealing', 'robbery', 'assault', 'kidnap', 'kidnapping',
    'weed', 'joint', 'joints', 'cocaine', 'heroin', 'meth', 'drugs',
    'eat shit', 'eating shit', 'eat poop',
    // —— FR ——
    'putain', 'salope', 'connard', 'connasse', 'encule', 'merde', 'chatte',
    'niquer', 'baiser', 'pedo', 'pedophile', 'violer', 'crotte', 'chier', 'pipi',
    'drogue', 'drogues', 'heroine', 'cocaïne',
    'voler', 'braquage', 'tuer', 'assassinat', 'tabasser', 'frapper',
    'kidnapper', 'enlevement',
    // —— PT ——
    'caralho', 'porra', 'foda', 'foder', 'viado', 'buceta', 'pinto', 'cocô',
    'estuprar', 'estupro', 'maconha', 'baseado',
    'roubar', 'roubo', 'assaltar', 'assassinar', 'espancar', 'sequestro',
    // —— DE ——
    'scheisse', 'scheiße', 'arschloch', 'fotze', 'hure', 'wichser', 'ficken', 'kacke',
    'vergewaltigen', 'umbringen', 'schlagen', 'klauen', 'stehlen', 'drogen', 'kiffen',
    // —— IT ——
    'cazzo', 'puttana', 'troia', 'fanculo', 'stronzo', 'merda', 'cacca',
    'stuprare', 'stupri', 'droghe', 'rubare', 'furto', 'uccidere',
    'picchiare', 'ammazzare',
];

/**
 * Términos cortos (3 letras) solo como palabra completa.
 * No usar en substring: causan falsos positivos (vol→evolución, etc.).
 */
const BAD_SHORT_WORDS = ['kkk', 'lsd', 'kys', 'pis', 'poo'];

const PERSON_ES =
    'ninos?|ninas?|menores?|bebes?|criaturas?|chavales?|chiquillos?|abuelas?|abuelos?|ancianos?|ancianas?|viejos?|viejas?|mujeres?|hombres?|senoras?|senores?|personas?|gente|alguien|cualquiera|indefensos?|discapacitados?';

const BAD_PATTERNS: RegExp[] = [
    /\b(ir\s+a\s+)?robar\b/,
    /\b(vamos\s+a\s+)?robar\b/,
    /\ba\s+robar\b/,
    /\brobar\s+\w+/,
    /\b(atracar|asaltar|hurtar)\b/,
    /\bfumar\s+(porros?|hierba|maria|marihuana|cannabis|hachis)\b/,
    /\b(porros?|cannabis|cocaina|heroina)\b/,
    /\b(comer|come|comiendo|tragar|traga)\s+(caca|mierda|mojones?)\b/,
    /\b(eat|eating)\s+(shit|poop|poo)\b/,
    new RegExp(`\\bpegar(\\s+a)?\\s+(${PERSON_ES})\\b`),
    new RegExp(`\\b(golpear|maltratar|torturar|matar|asesinar|violar|agredir|espancar)\\s+(a\\s+)?(${PERSON_ES})\\b`),
    new RegExp(`\\b(${PERSON_ES})\\b.*\\b(pegar|golpear|maltratar|violar|matar|abusar|abuso|agredir)\\b`),
    new RegExp(`\\b(pegar|golpear|maltratar|violar|matar|abusar|abuso|agredir)\\b.*\\b(${PERSON_ES})\\b`),
    /\bdar\s+(una\s+)?paliza\b/,
    /\b(rob|steal|mug)\b.*\b(stores?|shops?|banks?)\b/,
    /\b(hit|hurt|kill|beat|abuse|murder)\b.*\b(kids?|children|minors?|grandmas?|grandmothers?|grandpas?|elderly|women|people|someone)\b/,
    /\b(kids?|children|minors?|grandmas?|elderly|women|people)\b.*\b(hit|hurt|kill|beat|abuse|murder)\b/,
    /\bsmoke\s+(weed|joints?|crack|meth)\b/,
    /\bkill\s+(yourself|everyone|people|kids?|someone)\b/,
    /\b(voler|braquer)\b/,
    /\b(frapper|tabasser|battre|tuer)\b.*\b(enfants?|gamins?|vieux|vieilles?|femmes?|gens|personne)\b/,
    /\bfumer\s+(de\s+la\s+)?(weed|shit|herbe|cannabis)\b/,
    /\b(roubar|assaltar)\b/,
    /\b(bater|espancar|matar|estuprar)\b.*\b(criancas?|idosos?|avo[sx]?|mulheres?|pessoas?)\b/,
    /\bfumar\s+(maconha|baseado|baseados)\b/,
    /\b(klauen|stehlen|rauben)\b/,
    /\b(schlagen|umbringen|toeten|toten|vergewaltigen)\b.*\b(kinder|oma|opa|frauen|leute|menschen)\b/,
    /\b(rubare|rapinare)\b/,
    /\b(picchiare|ammazzare|uccidere|stuprare)\b.*\b(bambini|nonne?|donne|persone|gente)\b/,
];

function normalizeForMatch(value: string): string {
    return value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Palabra completa en el título normalizado. */
function hasWholeWord(haystack: string, word: string): boolean {
    const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(word)}(?:[^a-z0-9]|$)`, 'i');
    return re.test(haystack);
}

export function hasNonLatinScript(title: string): boolean {
    // Solo rangos explícitos (evita falsos positivos con \p{L} en algunos motores)
    return NON_LATIN_SCRIPT.test(title);
}

function wordLooksGibberish(word: string): boolean {
    const w = word.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // Muy permisivo: solo basura extrema de una sola palabra
    if (w.length < 12) return false;
    if (!/^[a-z]+$/.test(w)) return false;

    if (
        /(?:cion|sion|dad|mente|ando|iendo|idad|able|ible|oso|osa|ado|ada|ido|ida|ismo|ista|anza|encia|bienvenid[oa]|welcome|partido|partida|quedada|amigos?|amigas?|tarde|noche|manana|plan|planes)$/i.test(
            w,
        )
    ) {
        return false;
    }

    const vowelCount = (w.match(VOWELS) || []).length;
    const vowelRatio = vowelCount / w.length;
    // Sin vocales o casi ninguna en una palabra muy larga
    if (vowelCount === 0) return true;
    if (vowelRatio < 0.15) return true;
    // Racha absurda de consonantes
    if (/[bcdfghjklmnpqrstvwxz]{8,}/i.test(w)) return true;

    return false;
}

export function looksLikeGibberish(title: string): boolean {
    const cleaned = title.trim();
    if (cleaned.length < 12) return false;

    const words = cleaned
        .split(/[\s,.\-_/\\|]+/)
        .map((w) => w.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, ''))
        .filter(Boolean);

    if (words.length === 0) return false;

    // Con 2+ palabras (p.ej. "dia de bienvenida") nunca marcar como basura
    if (words.length >= 2) return false;

    // Solo una sola palabra muy larga y claramente aleatoria
    return wordLooksGibberish(words[0]);
}

export function isInappropriateTitle(title: string): boolean {
    const n = normalizeForMatch(title);
    if (!n) return false;

    for (const pattern of BAD_PATTERNS) {
        if (pattern.test(n)) return true;
    }

    for (const term of BAD_SHORT_WORDS) {
        if (hasWholeWord(n, term)) return true;
    }

    for (const term of BAD_TERMS) {
        const t = normalizeForMatch(term);
        if (!t || t.length < 4) continue;

        if (t.includes(' ')) {
            if (n.includes(t)) return true;
            continue;
        }

        // Solo palabra completa — NUNCA substring (evita falsos positivos)
        if (hasWholeWord(n, t)) return true;
    }

    return false;
}

/** Revisión del título. Async por si más adelante se conecta un modelo. */
export async function moderatePlanTitle(title: string): Promise<TitleModerationResult> {
    const trimmed = title.trim();
    if (!trimmed) return { ok: true, reason: null };

    await Promise.resolve();

    try {
        if (hasNonLatinScript(trimmed)) {
            return { ok: false, reason: 'script' };
        }
        if (looksLikeGibberish(trimmed)) {
            return { ok: false, reason: 'gibberish' };
        }
        if (isInappropriateTitle(trimmed)) {
            return { ok: false, reason: 'inappropriate' };
        }
        return { ok: true, reason: null };
    } catch {
        // Fail-open si algo raro falla en el motor de regex
        return { ok: true, reason: null };
    }
}

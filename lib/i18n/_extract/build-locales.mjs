/**
 * Build FR/DE/PT/IT locale files from en.json with protected placeholders & brands.
 * Uses Google translate_a (unofficial) with retries; post-processes known UI glossary.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const en = JSON.parse(fs.readFileSync(path.join(__dirname, 'en.json'), 'utf8'));

const TARGETS = [
  { code: 'fr', file: 'fr.ts', exportName: 'fr', tl: 'fr' },
  { code: 'de', file: 'de.ts', exportName: 'de', tl: 'de' },
  { code: 'pt', file: 'pt.ts', exportName: 'pt', tl: 'pt' }, // European PT via glossary overrides
  { code: 'it', file: 'it.ts', exportName: 'it', tl: 'it' },
];

const BRANDS = [
  'Nexo!',
  'WhatsApp',
  'App Store',
  'Google Play',
  'hola@appnexo.es',
  'Supabase',
  'AEPD',
  'GDPR',
  'Erasmus',
  'Instagram',
];

function protect(text) {
  const tokens = [];
  let out = text;
  // placeholders first
  out = out.replace(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g, (m) => {
    const i = tokens.length;
    tokens.push(m);
    return `[[PH${i}]]`;
  });
  for (const b of BRANDS) {
    const re = new RegExp(b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    out = out.replace(re, (m) => {
      const i = tokens.length;
      tokens.push(m);
      return `[[PH${i}]]`;
    });
  }
  // keep emoji / camera symbols
  out = out.replace(/[📷🎬🎤]/g, (m) => {
    const i = tokens.length;
    tokens.push(m);
    return `[[PH${i}]]`;
  });
  // strip unpaired surrogates that break encodeURIComponent
  out = [...out]
    .filter((ch) => {
      const c = ch.codePointAt(0);
      return c !== undefined && !(c >= 0xd800 && c <= 0xdfff);
    })
    .join('');
  return { out, tokens };
}

function restore(text, tokens) {
  let out = text;
  tokens.forEach((t, i) => {
    out = out.split(`[[PH${i}]]`).join(t);
    out = out.split(`[PH${i}]`).join(t);
    out = out.split(`[[ PH${i} ]]`).join(t);
  });
  return out;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function gtx(text, tl, retries = 4) {
  if (!text || !text.trim()) return text;
  let protectedText;
  let tokens;
  try {
    ({ out: protectedText, tokens } = protect(text));
  } catch {
    return text;
  }
  // Skip pure symbols / numbers
  if (!/[A-Za-zÀ-ÿ]/.test(protectedText)) return text;

  let encoded;
  try {
    encoded = encodeURIComponent(protectedText);
  } catch {
    try {
      encoded = encodeURIComponent(
        protectedText.replace(/[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD]/g, ''),
      );
    } catch {
      return text;
    }
  }
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=' +
    encodeURIComponent(tl) +
    '&dt=t&q=' +
    encoded;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NexoI18n/1.0)' },
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const translated = (data[0] || []).map((x) => x[0]).join('');
      return restore(translated, tokens);
    } catch (e) {
      await sleep(400 * (attempt + 1));
      if (attempt === retries - 1) {
        console.error('FAIL', tl, text.slice(0, 60), e.message);
        return text;
      }
    }
  }
  return text;
}

/** European Portuguese / UI glossary post-fixes after MT */
function postProcess(lang, key, value) {
  let v = value;
  if (lang === 'pt') {
    // Prefer European Portuguese forms
    v = v.replace(/\bvocê\b/gi, (m) => (m[0] === 'V' ? 'Você' : 'você')); // keep você ok in BR; we'll prefer PT-PT below
    // Common BR→PT swaps for UI tone
    const swaps = [
      [/\bAplicativo\b/g, 'Aplicação'],
      [/\baplicativo\b/g, 'aplicação'],
      [/\busuário\b/g, 'utilizador'],
      [/\bUsuário\b/g, 'Utilizador'],
      [/\bSenha\b/g, 'Palavra-passe'],
      [/\bsenha\b/g, 'palavra-passe'],
      [/\bcelular\b/g, 'telemóvel'],
      [/\bCelular\b/g, 'Telemóvel'],
      [/\barquivo\b/g, 'ficheiro'],
      [/\bArquivo\b/g, 'Ficheiro'],
      [/\bsalvar\b/g, 'guardar'],
      [/\bSalvar\b/g, 'Guardar'],
      [/\bdeletar\b/g, 'eliminar'],
      [/\bDeletar\b/g, 'Eliminar'],
      [/\btela\b/g, 'ecrã'],
      [/\bTela\b/g, 'Ecrã'],
    ];
    for (const [a, b] of swaps) v = v.replace(a, b);
  }
  // Ensure brands / emails untouched if MT mangled
  if (key.includes('support') || key.includes('privacy') || key.includes('terms') || key.includes('settings.support')) {
    v = v.replace(/hola@appnexo\.es/gi, 'hola@appnexo.es');
  }
  v = v.replace(/Nexo\s*!/g, 'Nexo!');
  v = v.replace(/Whats\s*App/gi, 'WhatsApp');
  return v;
}

function escapeTsString(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

function writeLocaleTs(exportName, dict, outPath) {
  const keys = Object.keys(dict);
  const lines = [
    `/** Auto-generated ${exportName} locale — every key from English dict. */`,
    `export const ${exportName}: Record<string, string> = {`,
  ];
  for (const k of keys) {
    lines.push(`    '${k}': '${escapeTsString(dict[k])}',`);
  }
  lines.push('};');
  lines.push('');
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
}

async function translateDict(tl, code, concurrency = 6) {
  const keys = Object.keys(en);
  const cachePath = path.join(__dirname, `${code}.partial.json`);
  const out = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};
  const todo = keys.filter((k) => !(k in out));
  console.log(`[${code}] resume: have ${Object.keys(out).length}, todo ${todo.length}`);
  let i = 0;
  let failed = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= todo.length) return;
      const k = todo[idx];
      const src = en[k];
      try {
        let translated = await gtx(src, tl);
        translated = postProcess(code, k, translated);
        out[k] = translated;
        if (translated === src && /[A-Za-z]{4,}/.test(src) && src.length > 12) {
          failed++;
        }
      } catch (e) {
        console.error(`[${code}] key fail`, k, e.message);
        out[k] = src;
        failed++;
      }
      if ((Object.keys(out).length) % 50 === 0) {
        fs.writeFileSync(cachePath, JSON.stringify(out));
      }
      if ((idx + 1) % 100 === 0) {
        console.log(`[${code}] ${idx + 1}/${todo.length} (total ${Object.keys(out).length})`);
      }
      await sleep(40);
    }
  }
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  fs.writeFileSync(cachePath, JSON.stringify(out));
  // ensure every key present
  for (const k of keys) {
    if (!(k in out)) out[k] = en[k];
  }
  return { out, failed };
}

async function main() {
  const localesDir = path.join(__dirname, '../locales');
  fs.mkdirSync(localesDir, { recursive: true });

  const summary = {};
  for (const t of TARGETS) {
    console.log('=== Translating', t.code, '===');
    const { out, failed } = await translateDict(t.tl, t.code);
    writeLocaleTs(t.exportName, out, path.join(localesDir, t.file));
    fs.writeFileSync(path.join(__dirname, `${t.code}.json`), JSON.stringify(out, null, 2));
    summary[t.code] = { keys: Object.keys(out).length, likelyUntranslated: failed };
    console.log('done', t.code, summary[t.code]);
  }

  const index = `export { fr } from './fr';
export { de } from './de';
export { pt } from './pt';
export { it } from './it';
`;
  fs.writeFileSync(path.join(localesDir, 'index.ts'), index);
  fs.writeFileSync(path.join(__dirname, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log('ALL DONE', summary);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Slow, resumable MyMemory translation (higher daily limit than gtx when polite).
 * concurrency=1, delay ~250ms, caches partials.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const en = JSON.parse(fs.readFileSync(path.join(__dirname, 'en.json'), 'utf8'));

const TARGETS = [
  { code: 'fr', tl: 'fr' },
  { code: 'de', tl: 'de' },
  { code: 'pt', tl: 'pt-PT' },
  { code: 'it', tl: 'it' },
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
  out = out.replace(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g, (m) => {
    tokens.push(m);
    return `[[PH${tokens.length - 1}]]`;
  });
  for (const b of BRANDS) {
    const re = new RegExp(b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    out = out.replace(re, () => {
      tokens.push(b);
      return `[[PH${tokens.length - 1}]]`;
    });
  }
  out = out.replace(/[📷🎬🎤]/g, (m) => {
    tokens.push(m);
    return `[[PH${tokens.length - 1}]]`;
  });
  return { out, tokens };
}

function restore(text, tokens) {
  let out = text || '';
  tokens.forEach((t, i) => {
    out = out.split(`[[PH${i}]]`).join(t);
    out = out.split(`[PH${i}]`).join(t);
  });
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function myMemory(text, tl) {
  const { out, tokens } = protect(text);
  if (!/[A-Za-zÀ-ÿ]/.test(out)) return text;
  // MyMemory max ~500 chars per request; chunk long strings by sentences
  const chunks = chunkText(out, 450);
  const parts = [];
  for (const chunk of chunks) {
    const url =
      'https://api.mymemory.translated.net/get?q=' +
      encodeURIComponent(chunk) +
      '&langpair=en|' +
      encodeURIComponent(tl);
    let translated = chunk;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const res = await fetch(url);
        if (res.status === 429 || res.status === 503) {
          await sleep(1500 * (attempt + 1));
          continue;
        }
        const data = await res.json();
        if (data?.responseData?.translatedText) {
          translated = data.responseData.translatedText;
          // MyMemory sometimes returns QUOTA EXCEEDED as the text
          if (/QUOTA|LIMIT|MYMEMORY WARNING/i.test(translated)) {
            await sleep(2000);
            continue;
          }
          break;
        }
      } catch {
        await sleep(800 * (attempt + 1));
      }
    }
    parts.push(translated);
    await sleep(280);
  }
  return restore(parts.join(' '), tokens);
}

function chunkText(text, max) {
  if (text.length <= max) return [text];
  const parts = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('. ', max);
    if (cut < max * 0.4) cut = rest.lastIndexOf(' ', max);
    if (cut < max * 0.4) cut = max;
    parts.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

function postProcess(code, value) {
  let v = value;
  v = v.replace(/Nexo\s*!/g, 'Nexo!');
  v = v.replace(/Whats\s*App/gi, 'WhatsApp');
  v = v.replace(/hola@appnexo\.es/gi, 'hola@appnexo.es');
  if (code === 'pt') {
    const swaps = [
      [/\bAplicativo\b/g, 'Aplicação'],
      [/\baplicativo\b/g, 'aplicação'],
      [/\busuário\b/g, 'utilizador'],
      [/\bUsuário\b/g, 'Utilizador'],
      [/\bSenha\b/g, 'Palavra-passe'],
      [/\bsenha\b/g, 'palavra-passe'],
      [/\bcelular\b/g, 'telemóvel'],
      [/\barquivo\b/g, 'ficheiro'],
      [/\bArquivo\b/g, 'Ficheiro'],
      [/\bsalvar\b/g, 'guardar'],
      [/\bSalvar\b/g, 'Guardar'],
      [/\bdeletar\b/g, 'eliminar'],
      [/\btela\b/g, 'ecrã'],
    ];
    for (const [a, b] of swaps) v = v.replace(a, b);
  }
  return v;
}

function escapeTs(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

function writeTs(name, dict, outPath) {
  const lines = [
    `/** ${name} locale — full coverage of English keys. */`,
    `export const ${name}: Record<string, string> = {`,
  ];
  for (const k of Object.keys(en)) {
    lines.push(`    '${k}': '${escapeTs(dict[k] ?? en[k])}',`);
  }
  lines.push('};', '');
  fs.writeFileSync(outPath, lines.join('\n'));
}

async function translateLang(code, tl) {
  const cachePath = path.join(__dirname, `${code}.partial.json`);
  const out = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};
  const todo = Object.keys(en).filter((k) => !out[k]);
  console.log(`[${code}] have ${Object.keys(out).length}, todo ${todo.length}`);
  let n = 0;
  for (const k of todo) {
    const src = en[k];
    let translated = await myMemory(src, tl);
    translated = postProcess(code, translated);
    out[k] = translated;
    n++;
    if (n % 25 === 0) {
      fs.writeFileSync(cachePath, JSON.stringify(out));
      console.log(`[${code}] ${Object.keys(out).length}/${Object.keys(en).length}`);
    }
  }
  fs.writeFileSync(cachePath, JSON.stringify(out));
  for (const k of Object.keys(en)) if (!out[k]) out[k] = en[k];
  return out;
}

async function main() {
  const localesDir = path.join(__dirname, '../locales');
  fs.mkdirSync(localesDir, { recursive: true });
  const summary = {};
  for (const t of TARGETS) {
    console.log('===', t.code, '===');
    const dict = await translateLang(t.code, t.tl);
    writeTs(t.code, dict, path.join(localesDir, `${t.code}.ts`));
    fs.writeFileSync(path.join(__dirname, `${t.code}.json`), JSON.stringify(dict, null, 2));
    // count identical to en (excluding brands/short)
    let same = 0;
    const leftovers = [];
    for (const k of Object.keys(en)) {
      if (dict[k] === en[k] && en[k].length > 8 && !/^(WhatsApp|Nexo!|OK|Chat|Networking|Tapas|Picnic|Running|Padel|Showtime|Gaming|Erasmus)/.test(en[k])) {
        same++;
        leftovers.push(k);
      }
    }
    summary[t.code] = { keys: Object.keys(dict).length, sameAsEn: same, sample: leftovers.slice(0, 15) };
    console.log('done', summary[t.code]);
  }
  fs.writeFileSync(
    path.join(localesDir, 'index.ts'),
    `export { fr } from './fr';\nexport { de } from './de';\nexport { pt } from './pt';\nexport { it } from './it';\n`,
  );
  fs.writeFileSync(path.join(__dirname, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log('ALL DONE');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

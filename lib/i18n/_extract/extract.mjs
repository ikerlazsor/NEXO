import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const s = fs.readFileSync(path.join(__dirname, '../../i18n.tsx'), 'utf8');

function unescape(str, quote) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\\' && i + 1 < str.length) {
      const n = str[i + 1];
      if (n === 'n') {
        out += '\n';
        i++;
        continue;
      }
      if (n === 't') {
        out += '\t';
        i++;
        continue;
      }
      if (n === '\\' || n === quote || n === "'") {
        out += n;
        i++;
        continue;
      }
      out += n;
      i++;
      continue;
    }
    out += str[i];
  }
  return out;
}

function extractDict(name) {
  const marker = `const ${name}: Dict = {`;
  const startIdx = s.indexOf(marker);
  if (startIdx < 0) throw new Error('no ' + name);
  let i = startIdx + marker.length;
  let depth = 1;
  const start = i;
  while (i < s.length && depth > 0) {
    const c = s[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i++;
      while (i < s.length) {
        if (s[i] === '\\') {
          i += 2;
          continue;
        }
        if (s[i] === q) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  const body = s.slice(start, i - 1);
  const dict = {};
  // Allow newline between key and value; support ', ", `
  const entryRe =
    /'([^']+)'\s*:\s*((?:'(?:\\.|[^'\\])*')|(?:"(?:\\.|[^"\\])*")|(?:`(?:\\.|[^`\\])*`))/gs;
  let em;
  while ((em = entryRe.exec(body))) {
    const raw = em[2];
    const quote = raw[0];
    dict[em[1]] = unescape(raw.slice(1, -1), quote);
  }
  return dict;
}

const en = extractDict('en');
const es = extractDict('es');
console.log('en', Object.keys(en).length, 'es', Object.keys(es).length);
const missingEs = Object.keys(en).filter((k) => !(k in es));
const missingEn = Object.keys(es).filter((k) => !(k in en));
console.log('en keys missing in es', missingEs.length, missingEs);
console.log('es keys missing in en', missingEn.length, missingEn.slice(0, 20));
fs.writeFileSync(path.join(__dirname, 'en.json'), JSON.stringify(en, null, 2));
fs.writeFileSync(path.join(__dirname, 'es.json'), JSON.stringify(es, null, 2));

// Also dump keys list for verification
fs.writeFileSync(path.join(__dirname, 'en.keys.txt'), Object.keys(en).sort().join('\n'));
console.log('sample double-quoted:', en['feed.loadError'], en['card.join']);
console.log('privacy.intro length', (en['privacy.intro'] || '').length);
console.log('help.faq.ratings.body length', (en['help.faq.ratings.body'] || '').length);

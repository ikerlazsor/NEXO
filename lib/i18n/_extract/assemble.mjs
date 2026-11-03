/**
 * Assemble hand-translated part JSON files into locale .ts files.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const en = JSON.parse(fs.readFileSync(path.join(__dirname, 'en.json'), 'utf8'));
const handDir = path.join(__dirname, 'hand');
const localesDir = path.join(__dirname, '../locales');

function escapeTs(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

function writeTs(name, dict) {
  const lines = [
    `/** ${name} locale — full coverage of English dict keys. */`,
    `export const ${name}: Record<string, string> = {`,
  ];
  for (const k of Object.keys(en)) {
    if (!(k in dict)) throw new Error(`${name} missing key: ${k}`);
    lines.push(`    '${k}': '${escapeTs(dict[k])}',`);
  }
  lines.push('};', '');
  fs.writeFileSync(path.join(localesDir, `${name}.ts`), lines.join('\n'));
}

const langs = ['fr', 'de', 'pt', 'it'];
const report = {};

for (const lang of langs) {
  const dict = {};
  const missingParts = [];
  for (let p = 1; p <= 4; p++) {
    const fp = path.join(handDir, `${lang}-part${p}.json`);
    if (!fs.existsSync(fp)) {
      missingParts.push(p);
      continue;
    }
    Object.assign(dict, JSON.parse(fs.readFileSync(fp, 'utf8')));
  }
  if (missingParts.length) {
    report[lang] = { status: 'incomplete', missingParts, keysSoFar: Object.keys(dict).length };
    console.log(lang, report[lang]);
    continue;
  }
  const missingKeys = Object.keys(en).filter((k) => !(k in dict));
  const extraKeys = Object.keys(dict).filter((k) => !(k in en));
  const sameAsEn = [];
  const brandOk = /^(WhatsApp|Nexo!|OK|Chat|Networking|Tapas|Picnic|Running|Padel|Showtime|Gaming|Erasmus|Instagram|Supabase|AEPD|GDPR|App Store|Google Play)$/i;
  for (const k of Object.keys(en)) {
    if (dict[k] === en[k] && en[k].length > 2 && !brandOk.test(en[k].trim())) {
      // allow identical short/shared words
      const shared = /^(OK|Chat|Tapas|Picnic|Running|Padel|Showtime|Gaming|Networking|Erasmus|Instagram|Supabase|Football|Basketball|Museum|Concert|Theatre|Cinema|Beach|Coffee|Party|Sport|Group|Map|Zone|Error|Offline|Online|Email|WhatsApp|Nexo!)/i;
      if (!shared.test(en[k]) && en[k].length > 10) sameAsEn.push(k);
    }
  }
  if (missingKeys.length) {
    report[lang] = { status: 'missing_keys', missingKeys: missingKeys.slice(0, 20), count: missingKeys.length };
    console.log(lang, report[lang]);
    continue;
  }
  writeTs(lang, dict);
  report[lang] = {
    status: 'ok',
    keys: Object.keys(dict).length,
    extraKeys: extraKeys.length,
    likelyUntranslated: sameAsEn.length,
    sampleUntranslated: sameAsEn.slice(0, 20),
  };
  console.log(lang, report[lang]);
}

fs.mkdirSync(localesDir, { recursive: true });
if (langs.every((l) => report[l]?.status === 'ok')) {
  fs.writeFileSync(
    path.join(localesDir, 'index.ts'),
    `export { fr } from './fr';\nexport { de } from './de';\nexport { pt } from './pt';\nexport { it } from './it';\n`,
  );
  console.log('wrote index.ts');
}
fs.writeFileSync(path.join(__dirname, 'assemble-report.json'), JSON.stringify(report, null, 2));

import fs from 'fs';
import path from 'path';

const hand = 'c:/Users/ikerl/nexo/lib/i18n/_extract/hand';
const en = JSON.parse(fs.readFileSync('c:/Users/ikerl/nexo/lib/i18n/_extract/en.json', 'utf8'));
const enKeys = new Set(Object.keys(en));

for (const lang of ['fr', 'de', 'pt', 'it']) {
  for (let p = 1; p <= 4; p++) {
    const f = path.join(hand, `${lang}-part${p}.json`);
    if (!fs.existsSync(f)) continue;
    let raw = fs.readFileSync(f, 'utf8');
    // Strip trailing literal \n (backslash + n) corruption
    raw = raw.replace(/\}\s*\\n\s*$/, '}');
    let j;
    try {
      j = JSON.parse(raw);
    } catch (e) {
      console.error('FAIL', f, e.message);
      continue;
    }
    // Drop keys not in this part's expected set is hard; drop keys not in en
    for (const k of Object.keys(j)) {
      if (!enKeys.has(k)) {
        console.log('extra key removed', lang, p, k);
        delete j[k];
      }
    }
    if (j['profile.searchPlaceholder'] === 'Username...') {
      j['profile.searchPlaceholder'] = 'Nome utente...';
    }
    if (lang === 'de') {
      if (j['organizer.fieldWeb'] === 'Website (optional)') {
        j['organizer.fieldWeb'] = 'Webseite (optional)';
      }
    }
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
    console.log('ok', lang, p, Object.keys(j).length);
  }
}

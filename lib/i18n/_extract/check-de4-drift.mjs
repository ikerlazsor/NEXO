import fs from 'fs';

const enPart4 = JSON.parse(fs.readFileSync('c:/Users/ikerl/nexo/lib/i18n/_extract/en-part4.json', 'utf8'));
const part = JSON.parse(fs.readFileSync('c:/Users/ikerl/nexo/lib/i18n/_extract/hand/de-part4.json', 'utf8'));
const missing = Object.keys(enPart4).filter((k) => !(k in part));
const extra = Object.keys(part).filter((k) => !(k in enPart4));
console.log({ partKeys: Object.keys(part).length, missing: missing.length, extra: extra.length });

// Parse de.ts into a dict
const deTs = fs.readFileSync('c:/Users/ikerl/nexo/lib/i18n/locales/de.ts', 'utf8');
const dict = {};
const re = /'([^']+)': '((?:\\.|[^'\\])*)'/g;
let m;
while ((m = re.exec(deTs))) {
  dict[m[1]] = m[2]
    .replace(/\\'/g, "'")
    .replace(/\\n/g, '\n')
    .replace(/\\\\/g, '\\');
}

let drift = 0;
const samples = [];
for (const k of Object.keys(enPart4)) {
  if (dict[k] !== part[k]) {
    drift++;
    if (samples.length < 8) samples.push({ k, ts: dict[k], hand: part[k] });
  }
}
console.log({ driftCount: drift, samples });

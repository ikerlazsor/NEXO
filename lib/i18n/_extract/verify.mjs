import fs from 'fs';

const en = JSON.parse(fs.readFileSync('c:/Users/ikerl/nexo/lib/i18n/_extract/en.json', 'utf8'));
const langs = ['fr', 'de', 'pt', 'it'];

for (const lang of langs) {
  const src = fs.readFileSync(`c:/Users/ikerl/nexo/lib/i18n/locales/${lang}.ts`, 'utf8');
  const keys = [...src.matchAll(/'([^']+)': '/g)].map((m) => m[1]);
  const set = new Set(keys);
  const missing = Object.keys(en).filter((k) => !set.has(k));
  const privacyEn = /'privacy\.intro': 'This Privacy/.test(src);
  const termsEn = /'terms\.acceptance\.body': 'By creating/.test(src);
  console.log({
    lang,
    keys: keys.length,
    missing: missing.length,
    privacyStillEnglish: privacyEn,
    termsStillEnglish: termsEn,
    fileKB: Math.round(src.length / 1024),
  });
}
console.log(fs.readFileSync('c:/Users/ikerl/nexo/lib/i18n/locales/index.ts', 'utf8'));

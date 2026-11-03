import fs from 'fs';

const f = 'c:/Users/ikerl/nexo/lib/i18n/_extract/hand/de-part2.json';
let raw = fs.readFileSync(f, 'utf8');
// Remove trailing literal \n (backslash + n)
raw = raw.replace(/\}\s*\\n\s*$/, '}');
const j = JSON.parse(raw);

j['organizer.fieldWeb'] = 'Webseite (optional)';
j['organizer.fieldInstagram'] = 'Instagram (optional)';
j['settings.organizersInbox'] = 'Communities';
j['search.filterCommunities'] = 'Communities';
j['search.rankCommunities'] = 'Communities';
j['friends.invitePlan'] = 'Plan: {title}';
j['friends.inviteGroup'] = 'Chat: {title}';

fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
JSON.parse(fs.readFileSync(f, 'utf8'));
console.log('de-part2 repaired, keys', Object.keys(j).length);

// Fix IT username placeholder
for (const p of [1, 2, 3, 4]) {
  const fp = `c:/Users/ikerl/nexo/lib/i18n/_extract/hand/it-part${p}.json`;
  const obj = JSON.parse(fs.readFileSync(fp, 'utf8'));
  if (obj['profile.searchPlaceholder'] === 'Username...') {
    obj['profile.searchPlaceholder'] = 'Nome utente...';
    fs.writeFileSync(fp, JSON.stringify(obj, null, 2) + '\n');
    console.log('patched it-part' + p + ' profile.searchPlaceholder');
  }
}

// DE festivals
const de4p = 'c:/Users/ikerl/nexo/lib/i18n/_extract/hand/de-part4.json';
const de4 = JSON.parse(fs.readFileSync(de4p, 'utf8'));
if (de4['onboarding.cat.Festivales'] === 'Festivals') {
  // Festivals is fine in DE; leave or use Festivals
  de4['onboarding.cat.Festivales'] = 'Festivals';
  fs.writeFileSync(de4p, JSON.stringify(de4, null, 2) + '\n');
}
console.log('ok');

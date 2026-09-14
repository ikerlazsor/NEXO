/**
 * Genera el Secret Key (JWT) de Sign in with Apple para pegar en Supabase.
 *
 * Uso:
 *   node scripts/generate-apple-secret.js ruta\AuthKey_XXXXXX.p8 TEAM_ID KEY_ID com.ikerlazsor.nexo
 *
 * TEAM_ID: Membership → Team ID (10 caracteres)
 * KEY_ID: el ID de la clave que descargaste
 * El último argumento es el Client ID: el bundle de la app.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function b64url(data) {
  return Buffer.from(data).toString('base64url');
}

function usage() {
  console.error(
    'Uso: node scripts/generate-apple-secret.js <AuthKey.p8> <TEAM_ID> <KEY_ID> <CLIENT_ID>',
  );
  process.exit(1);
}

const [, , p8Path, teamId, keyId, clientId] = process.argv;
if (!p8Path || !teamId || !keyId || !clientId) usage();

const pem = fs.readFileSync(path.resolve(p8Path), 'utf8');
if (!pem.includes('BEGIN PRIVATE KEY')) {
  console.error('Ese archivo no parece un .p8 de Apple.');
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const header = { alg: 'ES256', kid: keyId };
const payload = {
  iss: teamId,
  iat: now,
  exp: now + 60 * 60 * 24 * 180,
  aud: 'https://appleid.apple.com',
  sub: clientId,
};

const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
const key = crypto.createPrivateKey(pem);
const signature = crypto.sign('SHA256', Buffer.from(unsigned), {
  key,
  dsaEncoding: 'ieee-p1363',
});

console.log(`${unsigned}.${b64url(signature)}`);

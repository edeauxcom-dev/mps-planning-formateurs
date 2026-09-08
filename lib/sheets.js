// Bibliothèque partagée Google Sheets — syntaxe Cloudflare Workers (JS, pas TS)
import { createSign } from 'node:crypto';

export const SPREADSHEET_ID = "1EQyoupwSwC4Es5sju0rOFGwFQy20InQBUvGv3Nk1xKQ";
export const ONGLET_FORMATEURS  = "My Partner School — Formateurs (config rotation)";
export const ONGLET_DISPONIBILITES = "Disponibilités";
export const ONGLET_PLANNING   = "Planning";
export const ONGLET_CONFIG     = "Config";

function base64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

async function sign(privateKeyPem, data) {
  // Cloudflare Workers : SubtleCrypto pour signer en RS256
  const pemBody = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const binaryDer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8', binaryDer.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  const enc = new TextEncoder();
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(data));
  return base64url(sig);
}

let cachedToken = null;

export async function getAccessToken(env) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30000) return cachedToken.value;

  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Variable d'environnement GOOGLE_SERVICE_ACCOUNT_JSON manquante.");
  const key = JSON.parse(raw);

  const now = Math.floor(Date.now() / 1000);
  const header   = { alg: 'RS256', typ: 'JWT' };
  const claimSet = { iss: key.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: key.token_uri, exp: now + 3600, iat: now };

  const h = base64url(new TextEncoder().encode(JSON.stringify(header)));
  const c = base64url(new TextEncoder().encode(JSON.stringify(claimSet)));
  const sigInput = `${h}.${c}`;
  const signature = await sign(key.private_key, sigInput);
  const jwt = `${sigInput}.${signature}`;

  const res = await fetch(key.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Auth Google échouée : ' + JSON.stringify(data));
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function sheetsFetch(env, path, init = {}) {
  const token = await getAccessToken(env);
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

export async function sheetsGet(env, range) {
  const d = await sheetsFetch(env, `/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`);
  return d.values || [];
}

export async function sheetsAppend(env, range, rows) {
  await sheetsFetch(env, `/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST', body: JSON.stringify({ values: rows })
  });
}

export async function sheetsBatchUpdate(env, updates) {
  if (!updates.length) return;
  await sheetsFetch(env, `/values:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: updates })
  });
}

export function versTexteDate(v) {
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  }
  return (v || '').toString();
}

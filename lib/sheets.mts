import crypto from "node:crypto";

// Configuration commune — un seul endroit à modifier si le fichier change.
export const SPREADSHEET_ID = "1EQyoupwSwC4Es5sju0rOFGwFQy20InQBUvGv3Nk1xKQ";
export const ONGLET_FORMATEURS = "My Partner School — Formateurs (config rotation)";
export const ONGLET_DISPONIBILITES = "Disponibilités";
export const ONGLET_PLANNING = "Planning";

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * Authentification au compte de service Google via un JWT signé localement
 * (RS256, crypto natif de Node) — pas de dépendance npm nécessaire.
 */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }

  const raw = Netlify.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!raw) {
    throw new Error("Variable d'environnement GOOGLE_SERVICE_ACCOUNT_JSON manquante.");
  }
  const key = JSON.parse(raw);

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: key.token_uri,
    exp: now + 3600,
    iat: now,
  };

  const signatureInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signatureInput);
  signer.end();
  const signature = signer.sign(key.private_key);
  const jwt = `${signatureInput}.${base64url(signature)}`;

  const res = await fetch(key.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error("Échec de l'authentification Google : " + JSON.stringify(data));
  }

  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function sheetsFetch(path: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Erreur API Google Sheets (${res.status}) : ${JSON.stringify(data)}`);
  }
  return data;
}

/** Lit une plage de cellules. range ex: "'Disponibilités'!A2:F" */
export async function sheetsGet(range: string): Promise<any[][]> {
  const data = await sheetsFetch(
    `/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`
  );
  return data.values || [];
}

/** Ajoute des lignes à la fin d'un onglet. */
export async function sheetsAppend(range: string, rows: any[][]): Promise<void> {
  await sheetsFetch(
    `/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      body: JSON.stringify({ values: rows }),
    }
  );
}

/** Met à jour un ensemble de cellules ponctuelles en un seul appel. */
export async function sheetsBatchUpdate(updates: { range: string; values: any[][] }[]): Promise<void> {
  if (updates.length === 0) return;
  await sheetsFetch(`/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: updates,
    }),
  });
}

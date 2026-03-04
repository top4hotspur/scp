// amplify/lib/lwa.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

let cachedToken: { token: string; expMs: number } | null = null;

function dbgShape(name: string, v: string) {
  const s = String(v ?? "");
  const first = s.slice(0, 1);
  const last = s.slice(-1);
  const len = s.length;
  return `${name}{len=${len},first=${JSON.stringify(first)},last=${JSON.stringify(last)}}`;
}

function mustEnv(name: string): string {
  let v = String(process.env[name] ?? "").trim();
  if (!v) throw new Error(`Missing env var: ${name}`);

  // Defensive: secrets often get stored with quotes, e.g. "amzn1...."
  // Strip one layer of wrapping quotes if present.
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    v = v.slice(1, -1).trim();
  }

  return v;
}


function base64(s: string) {
  return Buffer.from(s, "utf8").toString("base64");
}

/**
 * Gets an LWA access token using refresh_token grant.
 * Caches in-memory for ~55 minutes (lambda warm reuse).
 */
  export async function getLwaAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expMs > now) return cachedToken.token;

  const clientId = mustEnv("SPAPI_LWA_CLIENT_ID");
  const clientSecret = mustEnv("SPAPI_LWA_CLIENT_SECRET");
  const refreshToken = mustEnv("SPAPI_LWA_REFRESH_TOKEN");

  // SAFE debug (remove after one run)
  console.log("[LWA]", dbgShape("client_id", clientId));
  console.log("[LWA]", dbgShape("client_secret", clientSecret));
  console.log("[LWA]", dbgShape("refresh_token", refreshToken));

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const tokenUrl = "https://api.amazon.com/auth/o2/token";

  // Standard LWA: client auth via HTTP Basic
  const basic = base64(`${clientId}:${clientSecret}`);

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      authorization: `Basic ${basic}`,
    },
    body,
  });

  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !json?.access_token) {
    throw new Error(`LWA token failed: HTTP ${res.status} ${JSON.stringify(json)}`);
  }

  // token lifetime is usually 3600; cache for 55 mins
  cachedToken = { token: String(json.access_token), expMs: now + 55 * 60 * 1000 };
  return cachedToken.token;
}
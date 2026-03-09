import { needEnv } from "./env";

// lib/spapi/lwa.ts
export async function getLwaAccessToken(): Promise<string> {
  const clientId = needEnv("SPAPI_LWA_CLIENT_ID");
  const clientSecret = needEnv("SPAPI_LWA_CLIENT_SECRET");
  const refreshToken = needEnv("SPAPI_LWA_REFRESH_TOKEN");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !json?.access_token) {
    throw new Error(json?.error_description ?? json?.error ?? `LWA token HTTP ${res.status}`);
  }
  return String(json.access_token);
}
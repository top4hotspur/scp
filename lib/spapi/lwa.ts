// lib/spapi/lwa.ts
export async function getLwaAccessToken(): Promise<string> {
  const clientId = String(process.env.SPAPI_LWA_CLIENT_ID ?? "").trim();
  const clientSecret = String(process.env.SPAPI_LWA_CLIENT_SECRET ?? "").trim();
  const refreshToken = String(process.env.SPAPI_LWA_REFRESH_TOKEN ?? "").trim();

  if (!clientId) throw new Error("Missing env var: SPAPI_LWA_CLIENT_ID");
  if (!clientSecret) throw new Error("Missing env var: SPAPI_LWA_CLIENT_SECRET");
  if (!refreshToken) throw new Error("Missing env var: SPAPI_LWA_REFRESH_TOKEN");

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
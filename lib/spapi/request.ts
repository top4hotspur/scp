// lib/spapi/request.ts
import { signSpApiRequest } from "./sigv4";
import { getLwaAccessToken } from "./lwa";

export async function spapiFetch<T>(args: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string; // e.g. "/sellers/v1/marketplaceParticipations"
  query?: Record<string, string | number | boolean | undefined>;
  body?: any;
}) : Promise<T> {
  const accessToken = await getLwaAccessToken();

  // Endpoint host (EU region) â€” weâ€™ll keep it stable for now.
  const base = "https://sellingpartnerapi-eu.amazon.com";
  const url = new URL(base + args.path);

  if (args.query) {
    for (const [k, v] of Object.entries(args.query)) {
      if (v === undefined) continue;
      url.searchParams.set(k, String(v));
    }
  }

  const bodyStr = args.body ? JSON.stringify(args.body) : "";

  const { headers } = signSpApiRequest({
    method: args.method,
    url,
    headers: {
      "content-type": "application/json",
      "x-amz-access-token": accessToken,
    },
    body: bodyStr,
  });

  const res = await fetch(url, {
    method: args.method,
    headers,
    body: bodyStr ? bodyStr : undefined,
    cache: "no-store",
  });

  const text = await res.text().catch(() => "");
const json = (() => {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
})();

if (!res.ok) {
  const msg =
    (json as any)?.message ??
    (json as any)?.errors?.[0]?.message ??
    `SP-API HTTP ${res.status}`;

  // IMPORTANT: include status + a snippet of the raw body so we can see what's *actually* happening
  const snippet = text ? text.slice(0, 600) : "";
  throw new Error(`${msg} (status=${res.status}) ${snippet}`);
}

return json as T;
}
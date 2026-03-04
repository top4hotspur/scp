// app/api/new-lines/scan/route.ts
import { NextResponse } from "next/server";
import outputs from "@/amplify_outputs.json";

type GqlResp<T> = { data?: T; errors?: { message: string }[] };

const DATA_URL = outputs.data.url;
const DATA_API_KEY = outputs.data.api_key;

// REST API output from backend.addOutput(...)
const REST = (outputs as any)?.custom?.API?.newLinesApi;
const REST_ENDPOINT =
  (outputs as any)?.custom?.newLinesApi?.endpoint ??
  (outputs as any)?.custom?.API?.newLinesApi?.endpoint ??
  "";
  if (!REST_ENDPOINT) {
  throw new Error("Missing newLinesApi endpoint in amplify_outputs.json");
}

async function gql<T>(query: string, variables?: any): Promise<T> {
  const res = await fetch(DATA_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": DATA_API_KEY },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as GqlResp<T>;
  if (!res.ok || json.errors?.length) {
    throw new Error(json.errors?.map((e) => e.message).join(" | ") || `HTTP ${res.status}`);
  }
  return json.data as T;
}

const GET_APP = /* GraphQL */ `
  query GetAppSettings($id: ID!) {
    getAppSettings(id: $id) {
      id
      ukMarketplaceId
      euInventoryMarketplaceId
      euMarketplaceIdsJson
      newLinesMarketplaceIdsJson
    }
  }
`;

export async function POST(req: Request) {
  try {
    if (!REST_ENDPOINT) throw new Error("Missing outputs.custom.API.newLinesApi.endpoint (check amplify_outputs.json)");

    const body = await req.json().catch(() => ({} as any));
    const eans = Array.isArray(body?.eans) ? body.eans.map((x: any) => String(x).trim()).filter(Boolean) : [];
    const marketplaceIdsIn = Array.isArray(body?.marketplaceIds)
      ? body.marketplaceIds.map((x: any) => String(x).trim()).filter(Boolean)
      : [];

    if (!eans.length) return NextResponse.json({ ok: false, error: "Missing eans[]" }, { status: 400 });

    // Default marketplaces from settings if caller didn’t specify
    const app = await gql<{ getAppSettings?: any }>(GET_APP, { id: "global" });
    const s = app?.getAppSettings ?? {};

    const fallbackMids: string[] = (() => {
      // prefer dedicated newLines list; else default to UK only
      try {
        const j = JSON.parse(String(s.newLinesMarketplaceIdsJson || "[]"));
        if (Array.isArray(j) && j.length) return j.map(String);
      } catch {}
      return [String(s.ukMarketplaceId || "A1F83G8C2ARO7P")];
    })();

    const marketplaceIds = marketplaceIdsIn.length ? marketplaceIdsIn : fallbackMids;

    const base = String(REST_ENDPOINT).replace(/\/$/, ""); // trims trailing slash
    const url = `${base}/new-lines/scan`;                  // endpoint already includes /dev
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eans, marketplaceIds }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: json?.error ?? `HTTP ${res.status}`, raw: json }, { status: 500 });
    }
    return NextResponse.json(json);
  } catch (e: any) {
  console.error("[/api/new-lines/scan] error", e);
  return NextResponse.json(
    {
      ok: false,
      error: String(e?.message ?? e),
      stack: e?.stack ? String(e.stack) : undefined,
    },
    { status: 500 }
  );
}
}
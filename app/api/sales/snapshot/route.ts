//app/api/sales/snapshot/route.ts
import { NextResponse } from "next/server";
import outputs from "@/amplify_outputs.json";

const DATA_URL = outputs.data.url;
const DATA_API_KEY = outputs.data.api_key;

type GqlResp<T> = { data?: T; errors?: { message: string }[] };

async function gql<T>(query: string, variables?: any): Promise<T> {
  if (!DATA_URL || !DATA_API_KEY)
    throw new Error("Missing DATA_URL / DATA_API_KEY");

  const res = await fetch(DATA_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": DATA_API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = (await res.json().catch(() => ({}))) as GqlResp<T>;

  if (!res.ok || json.errors?.length) {
    throw new Error(
      json.errors?.map((e) => e.message).join(" | ") ||
      `HTTP ${res.status}`
    );
  }

  return json.data as T;
}

const GET_SALES_SNAPSHOT = /* GraphQL */ `
  query GetSalesSnapshot($marketplaceId: String!, $bucket: String!) {
    getSalesSnapshot(marketplaceId: $marketplaceId, bucket: $bucket) {
      marketplaceId
      bucket
      createdAtIso
      rowsJson
      topSellersJson
      totalsJson
    }
  }
`;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const mid = String(searchParams.get("mid") ?? "").trim();
    const bucket = String(searchParams.get("bucket") ?? "today").trim();

    if (!mid) return NextResponse.json({ ok: false, error: "Missing mid" }, { status: 400 });

    const data = await gql<{ getSalesSnapshot: any }>(GET_SALES_SNAPSHOT, {
      marketplaceId: mid,
      bucket,
    });

    const snap = data?.getSalesSnapshot ?? null;

    return NextResponse.json({
      ok: true,
      marketplaceId: mid,
      bucket,
      snapshot: snap,
      // parse JSON fields for convenience
      rows: safeJson(snap?.rowsJson, []),
      topSellers: safeJson(snap?.topSellersJson, []),
      totals: safeJson(snap?.totalsJson, {}),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

function safeJson<T>(s: any, fallback: T): T {
  try {
    if (!s || typeof s !== "string") return fallback;
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
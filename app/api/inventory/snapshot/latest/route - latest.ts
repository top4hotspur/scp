// app/api/inventory/snapshot/latest/route.ts
import { NextResponse } from "next/server";
import outputs from "@/amplify_outputs.json";

const DATA_URL = outputs.data.url;
const DATA_API_KEY = outputs.data.api_key;

type GqlResp<T> = { data?: T; errors?: { message: string }[] };

async function gql<T>(query: string, variables?: any): Promise<T> {
  if (!DATA_URL || !DATA_API_KEY) throw new Error("Missing amplify_outputs.json data.url/api_key");

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

const GET_ONE = /* GraphQL */ `
  query GetInventorySnapshot($marketplaceId: String!, $bucket: String!) {
    getInventorySnapshot(marketplaceId: $marketplaceId, bucket: $bucket) {
      marketplaceId
      bucket
      createdAtIso
      source
      status
      message
      skus
      availableUnits
      inboundUnits
      reservedUnits
      topLowStockJson
    }
  }
`;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const marketplaceId = String(url.searchParams.get("mid") ?? "").trim();
    const bucket = String(url.searchParams.get("bucket") ?? "latest").trim();

    if (!marketplaceId) {
      return NextResponse.json({ ok: false, error: "Missing query param: mid" }, { status: 400 });
    }

    const data = await gql<{ getInventorySnapshot?: any }>(GET_ONE, { marketplaceId, bucket });

    // If no snapshot yet, return EMPTY (pages still render instantly)
    const snap = data?.getInventorySnapshot ?? {
      marketplaceId,
      bucket,
      createdAtIso: new Date().toISOString(),
      source: "none",
      status: "EMPTY",
      message: "No snapshot yet",
      skus: 0,
      availableUnits: 0,
      inboundUnits: 0,
      reservedUnits: 0,
      topLowStockJson: "[]",
    };

    return NextResponse.json({ ok: true, snapshot: snap });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
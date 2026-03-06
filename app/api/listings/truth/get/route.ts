// app/api/listings/truth/get/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from "next/server";
import { DATA_URL, DATA_API_KEY } from "@/lib/dataEnv";
export const runtime = "nodejs";
type GqlResp<T> = { data?: T; errors?: { message: string }[] };

async function gql<T>(query: string, variables?: any): Promise<T> {
  if (!DATA_URL || !DATA_API_KEY) throw new Error("Missing DATA_URL / DATA_API_KEY");

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

const GET_OFFERTRUTH = /* GraphQL */ `
  query GetOfferTruth($marketplaceId: String!, $sku: String!) {
    getOfferTruth(marketplaceId: $marketplaceId, sku: $sku) {
      marketplaceId
      sku
      asin
      currency
      ownPrice
      buyBoxPrice
      isOnlySeller
      ownBuyBox
      numberOfOffers
      source
      updatedAtIso
      rawSummaryJson
    }
  }
`;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const mid = String(searchParams.get("mid") ?? "").trim();
    const sku = String(searchParams.get("sku") ?? "").trim();

    if (!mid) return NextResponse.json({ ok: false, error: "Missing mid" }, { status: 400 });
    if (!sku) return NextResponse.json({ ok: false, error: "Missing sku" }, { status: 400 });

    const data: any = await gql(GET_OFFERTRUTH, { marketplaceId: mid, sku });
    const row = data?.getOfferTruth ?? null;

    if (!row) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    return NextResponse.json({ ok: true, truth: row });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}


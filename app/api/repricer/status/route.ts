// app/api/repricer/status/route.ts
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
  if (!res.ok || json.errors?.length) throw new Error(json.errors?.map((e) => e.message).join(" | ") || `HTTP ${res.status}`);
  return json.data as T;
}

const LIST_STATES = /* GraphQL */ `
  query ListStates($marketplaceId: String!, $limit: Int) {
    listPricePilotStatesByMarketplaceUpdated(marketplaceId: $marketplaceId, limit: $limit) {
      items {
        marketplaceId
        sku
        mode
        reason
        currentPrice
        baselineVelPerDay
        last2dVelPerDay
        last7dVelPerDay
        cooldownUntilIso
        updatedAtIso
      }
    }
  }
`;

const LIST_DECISIONS = /* GraphQL */ `
  query ListDecisions($marketplaceId: String!, $limit: Int) {
    listRepricerDecisionsByMarketplaceTs(marketplaceId: $marketplaceId, limit: $limit) {
      items {
        id
        sku
        tsIso
        action
        reason
        ownPrice
        buyBoxPrice
        proposedPrice
        strategyId
        assignmentId
      }
    }
  }
`;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const mid = String(searchParams.get("mid") ?? "").trim();
    const limit = Math.max(1, Math.min(200, Number(searchParams.get("limit") ?? 50)));

    if (!mid) return NextResponse.json({ ok: false, error: "Missing mid" }, { status: 400 });

    const s: any = await gql(LIST_STATES, { marketplaceId: mid, limit });
    const d: any = await gql(LIST_DECISIONS, { marketplaceId: mid, limit });

    return NextResponse.json({
      ok: true,
      mid,
      states: s?.listPricePilotStatesByMarketplaceUpdated?.items ?? [],
      decisions: d?.listRepricerDecisionsByMarketplaceTs?.items ?? [],
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}


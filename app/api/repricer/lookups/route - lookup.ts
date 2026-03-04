// app/api/repricer/lookups/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from "next/server";
import outputs from "@/amplify_outputs.json";

export const runtime = "nodejs";

const DATA_URL = (outputs as any)?.data?.url ?? process.env.DATA_URL;
const DATA_API_KEY = (outputs as any)?.data?.api_key ?? process.env.DATA_API_KEY;

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

function safeJson<T>(s: any, fallback: T): T {
  try {
    const v = typeof s === "string" ? JSON.parse(s) : s;
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function uniqSorted(arr: string[]) {
  return Array.from(new Set(arr.map((x) => String(x ?? "").trim()).filter(Boolean))).sort();
}

// MarketplaceId -> 2-letter code (extend anytime)
const MID_TO_CODE: Record<string, string> = {
  A1F83G8C2ARO7P: "UK",
  A1PA6795UKMFR9: "DE",
  A13V1IB3VIYZZH: "FR",
  APJ6JRA9NG5V4: "IT",
  A1RKKUPIHCS9HS: "ES",
  A1805IZSGTT6HS: "NL",
  AMEN7PMS3EDWL: "SE",
  A2NODRKZP88ZB9: "PL",
  A1C3SOZRARQ6R3: "BE",
  A28R8C7NBKEWEA: "AE", // (keep if you use it)
};

const GET_SETTINGS = /* GraphQL */ `
  query GetAppSettings($id: ID!) {
    getAppSettings(id: $id) {
      id
      ukMarketplaceId
      euMarketplaceIdsJson
    }
  }
`;

const LIST_SUPPLIERMAP = /* GraphQL */ `
  query ListSupplierMaps($limit: Int, $nextToken: String) {
    listSupplierMaps(limit: $limit, nextToken: $nextToken) {
      items {
        sku
        shortTitle
        supplierName
        prodGroup1
        prodGroup2
        prodGroup3
        prodGroup4
        prodGroup5
        updatedAtIso
      }
      nextToken
    }
  }
`;

export async function GET() {
  try {
    // Marketplaces from settings
    const s: any = await gql(GET_SETTINGS, { id: "global" });
    const uk = String(s?.getAppSettings?.ukMarketplaceId ?? "").trim();
    const eu = safeJson<string[]>(s?.getAppSettings?.euMarketplaceIdsJson ?? "[]", []);
    const mids = uniqSorted([uk, ...eu].filter(Boolean));

    const marketplaces = [
      { code: "ALL", id: "ALL" },
      ...mids.map((id) => ({ id, code: MID_TO_CODE[id] ?? id })),
    ];

    // Suppliers + PG paths from SupplierMap (best-effort)
    const suppliers: string[] = [];
    const pgPaths: any[] = [];

    try {
      let nextToken: string | null = null;
      for (let page = 0; page < 30; page++) {
        const d: any = await gql(LIST_SUPPLIERMAP, { limit: 1000, nextToken });
        const items: any[] = d?.listSupplierMaps?.items ?? [];

        for (const it of items) {
          const supplierName = String(it?.supplierName ?? "").trim();
          if (supplierName) suppliers.push(supplierName);

          // store path rows for cascading dropdowns
          pgPaths.push({
            supplierName: supplierName || "",
            prodGroup1: it?.prodGroup1 ? String(it.prodGroup1) : "",
            prodGroup2: it?.prodGroup2 ? String(it.prodGroup2) : "",
            prodGroup3: it?.prodGroup3 ? String(it.prodGroup3) : "",
            prodGroup4: it?.prodGroup4 ? String(it.prodGroup4) : "",
            prodGroup5: it?.prodGroup5 ? String(it.prodGroup5) : "",
          });
        }

        nextToken = d?.listSupplierMaps?.nextToken ?? null;
        if (!nextToken) break;
      }
    } catch {
      // swallow – mapper still works, just without dropdown lookups
    }

    return NextResponse.json({
      ok: true,
      marketplaces,
      suppliers: uniqSorted(suppliers),
      pgPaths,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
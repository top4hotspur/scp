// app/api/inventory/coverage-scan/route.ts
import { NextResponse } from "next/server";
import { DATA_URL, DATA_API_KEY } from "@/lib/dataEnv";
import { spapiFetch } from "@/lib/spapi/request";
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

const GET_SETTINGS = /* GraphQL */ `
  query GetAppSettings($id: ID!) {
    getAppSettings(id: $id) {
      euInventoryMarketplaceId
      euMarketplaceIdsJson
    }
  }
`;

const LIST_ANCHORS = /* GraphQL */ `
  query ListSkuAnchors($limit: Int, $nextToken: String) {
    listSkuAnchors(limit: $limit, nextToken: $nextToken) {
      items { sku inventoryAnchorMarketplaceId }
      nextToken
    }
  }
`;

const UPSERT_ANCHOR = /* GraphQL */ `
  mutation UpsertSkuAnchor($input: CreateSkuAnchorInput!) {
    createSkuAnchor(input: $input) {
      id
      sku
      inventoryAnchorMarketplaceId
    }
  }
`;

function parseJsonArr(s: string): string[] {
  try {
    const a = JSON.parse(s);
    return Array.isArray(a) ? a.map(String).map((x) => x.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function nowIso() {
  return new Date().toISOString();
}

async function listAllAnchors(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let nextToken: string | null = null;

  while (true) {
    const data = (await gql(LIST_ANCHORS, { limit: 1000, nextToken })) as any;
    const page = (data as any)?.listSkuAnchors;
    const items = Array.isArray(page?.items) ? page.items : [];
    for (const it of items) {
      if (it?.sku && it?.inventoryAnchorMarketplaceId) {
        map.set(String(it.sku), String(it.inventoryAnchorMarketplaceId));
      }
    }
    nextToken = page?.nextToken ?? null;
    if (!nextToken) break;
  }

  return map;
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);

    // Optional: limit marketplaces scanned (debug)
    const onlyMid = String(url.searchParams.get("mid") ?? "").trim();

    const set = await gql<any>(GET_SETTINGS, { id: "global" });
    const euAnchorMid = String(set?.getAppSettings?.euInventoryMarketplaceId ?? "A1PA6795UKMFR9").trim();
    const euList = parseJsonArr(String(set?.getAppSettings?.euMarketplaceIdsJson ?? "[]"));

    const scanMids = (onlyMid ? [onlyMid] : euList).filter((x) => x && x !== euAnchorMid);

    // Existing anchors
    const anchorBySku = await listAllAnchors();

    let created = 0;
    let scannedRows = 0;

    for (const mid of scanMids) {
      let nextToken: string | undefined = undefined;

      while (true) {
        const data = (await spapiFetch({
  method: "GET",
  path: "/fba/inventory/v1/summaries",
  query: {
    granularityType: "Marketplace",
    granularityId: mid,
    marketplaceIds: mid,
    details: false,
    startDateTime: new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString(),
    ...(nextToken ? { nextToken } : {}),
  },
})) as any;

        const payload = data?.payload ?? data;
        const inv: any[] = Array.isArray(payload?.inventorySummaries) ? payload.inventorySummaries : [];

        for (const row of inv) {
          const sku = String(row?.sellerSku ?? "").trim();
          if (!sku) continue;
          scannedRows++;

          if (anchorBySku.has(sku)) continue;

          await gql(UPSERT_ANCHOR, {
            input: {
              id: sku,
              sku,
              inventoryAnchorMarketplaceId: mid,
              updatedAtIso: nowIso(),
            },
          });

          anchorBySku.set(sku, mid);
          created++;
        }

        nextToken = payload?.nextToken ? String(payload.nextToken) : undefined;
        if (!nextToken) break;
      }
    }

    return NextResponse.json({
      ok: true,
      euAnchorMid,
      scannedMids: scanMids,
      scannedRows,
      anchorsCreated: created,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}


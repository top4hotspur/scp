// app/api/inventory/snapshot/eu-total/build/route.ts
import { NextResponse } from "next/server";
import outputs from "@/amplify_outputs.json";

const DATA_URL = outputs.data.url;
const DATA_API_KEY = outputs.data.api_key;

type GqlResp<T> = { data?: T; errors?: { message: string }[] };

async function gql(query: string, variables?: any): Promise<any> {
  if (!DATA_URL || !DATA_API_KEY) throw new Error("Missing DATA_URL / DATA_API_KEY");
  const res = await fetch(DATA_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": DATA_API_KEY },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as GqlResp<any>;
  if (!res.ok || json.errors?.length) {
    throw new Error(json.errors?.map((e) => e.message).join(" | ") || `HTTP ${res.status}`);
  }
  return json.data;
}

const GET_SETTINGS = /* GraphQL */ `
  query GetAppSettings($id: ID!) {
    getAppSettings(id: $id) {
      euInventoryMarketplaceId
    }
  }
`;

const LIST_SKUS = /* GraphQL */ `
  query ListInventorySkus($limit: Int, $nextToken: String, $filter: ModelInventorySkuFilterInput) {
    listInventorySkus(limit: $limit, nextToken: $nextToken, filter: $filter) {
      items { marketplaceId sku availableUnits inboundUnits reservedUnits }
      nextToken
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

const UPDATE_SNAP = /* GraphQL */ `
  mutation UpdateInventorySnapshot($input: UpdateInventorySnapshotInput!) {
    updateInventorySnapshot(input: $input) {
      marketplaceId bucket createdAtIso source status message skus availableUnits inboundUnits reservedUnits topLowStockJson
    }
  }
`;

const CREATE_SNAP = /* GraphQL */ `
  mutation CreateInventorySnapshot($input: CreateInventorySnapshotInput!) {
    createInventorySnapshot(input: $input) {
      marketplaceId bucket createdAtIso source status message skus availableUnits inboundUnits reservedUnits topLowStockJson
    }
  }
`;

function num(v: any): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

async function listAllInventorySkusByMid(mid: string) {
  const out: Array<{ sku: string; a: number; i: number; r: number }> = [];
  let nextToken: string | null = null;

  while (true) {
    const data = (await gql(LIST_SKUS, {
      limit: 1000,
      nextToken,
      filter: { marketplaceId: { eq: mid } },
    })) as any;

    const page = (data as any)?.listInventorySkus;
    const items = Array.isArray(page?.items) ? page.items : [];

    for (const it of items) {
      const sku = String(it?.sku ?? "").trim();
      if (!sku) continue;
      out.push({
        sku,
        a: num(it?.availableUnits),
        i: num(it?.inboundUnits),
        r: num(it?.reservedUnits),
      });
    }

    nextToken = page?.nextToken ?? null;
    if (!nextToken) break;
  }

  return out;
}

async function listAllSkuAnchors() {
  const out: Array<{ sku: string; mid: string }> = [];
  let nextToken: string | null = null;

  while (true) {
    const data = (await gql(LIST_ANCHORS, { limit: 1000, nextToken })) as any;
    const page = (data as any)?.listSkuAnchors;
    const items = Array.isArray(page?.items) ? page.items : [];
    for (const it of items) {
      const sku = String(it?.sku ?? "").trim();
      const mid = String(it?.inventoryAnchorMarketplaceId ?? "").trim();
      if (!sku || !mid) continue;
      out.push({ sku, mid });
    }
    nextToken = page?.nextToken ?? null;
    if (!nextToken) break;
  }

  return out;
}

export async function POST() {
  try {
    const settings = (await gql(GET_SETTINGS, { id: "global" })) as any;
    const deMid = String(settings?.getAppSettings?.euInventoryMarketplaceId ?? "A1PA6795UKMFR9").trim();
    if (!deMid) throw new Error("Missing euInventoryMarketplaceId");

    // 1) Default anchor = DE (covers most SKUs)
    const deRows = await listAllInventorySkusByMid(deMid);
    const chosen = new Map<string, { a: number; i: number; r: number }>();
    for (const r of deRows) chosen.set(r.sku, { a: r.a, i: r.i, r: r.r });

    // 2) For SKUs not present in DE, use SkuAnchor marketplace
    const anchors = await listAllSkuAnchors();

    // group SKUs by their anchor mid, excluding those already covered by DE
    const needByMid = new Map<string, Set<string>>();
    for (const a of anchors) {
      if (chosen.has(a.sku)) continue;
      if (!needByMid.has(a.mid)) needByMid.set(a.mid, new Set());
      needByMid.get(a.mid)!.add(a.sku);
    }

    // fetch each anchor marketplaceâ€™s InventorySku list, and pick only the anchored SKUs
    for (const [mid, skuSet] of needByMid.entries()) {
      const rows = await listAllInventorySkusByMid(mid);
      for (const r of rows) {
        if (!skuSet.has(r.sku)) continue;
        if (chosen.has(r.sku)) continue;
        chosen.set(r.sku, { a: r.a, i: r.i, r: r.r });
      }
    }

    // 3) Rollups + top low-stock
    let availableUnits = 0;
    let inboundUnits = 0;
    let reservedUnits = 0;

    const low: Array<{ sku: string; availableUnits: number }> = [];

    for (const [sku, v] of chosen.entries()) {
      availableUnits += v.a;
      inboundUnits += v.i;
      reservedUnits += v.r;
      if (v.a <= 2) low.push({ sku, availableUnits: v.a });
    }

    low.sort((x, y) => x.availableUnits - y.availableUnits || x.sku.localeCompare(y.sku));
    const topLowStockJson = JSON.stringify(low.slice(0, 100));

    const snap = {
      marketplaceId: "EU_TOTAL",
      bucket: "latest",
      createdAtIso: new Date().toISOString(),
      source: "eu_total",
      status: "OK",
      message: `Anchored EU total (DE=${deMid})`,
      skus: chosen.size,
      availableUnits,
      inboundUnits,
      reservedUnits,
      topLowStockJson,
    };

    // upsert snapshot (update then create fallback)
    try {
      const u = (await gql(UPDATE_SNAP, { input: snap })) as any;
      return NextResponse.json({ ok: true, snapshot: u?.updateInventorySnapshot ?? snap });
    } catch {
      const c = (await gql(CREATE_SNAP, { input: snap })) as any;
      return NextResponse.json({ ok: true, snapshot: c?.createInventorySnapshot ?? snap });
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
// app/api/inventory/ingest/route.ts
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

const CREATE = /* GraphQL */ `
  mutation CreateInventorySku($input: CreateInventorySkuInput!) {
    createInventorySku(input: $input) {
      marketplaceId
      sku
    }
  }
`;

const UPDATE = /* GraphQL */ `
  mutation UpdateInventorySku($input: UpdateInventorySkuInput!) {
    updateInventorySku(input: $input) {
      marketplaceId
      sku
    }
  }
`;

function n(v: any): number | null {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function isoMinusDays(days: number) {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const mid = String(url.searchParams.get("mid") ?? "").trim();
    if (!mid) return NextResponse.json({ ok: false, error: "Missing mid" }, { status: 400 });

    const startDateTime = String(url.searchParams.get("startDateTime") ?? isoMinusDays(365));

    let nextToken: string | undefined = undefined;
    let total = 0;
    let ok = 0;
    let failed = 0;

    const errors: Array<{ sku?: string; error: string }> = [];

    while (true) {
      const data = (await spapiFetch({
        method: "GET",
        path: "/fba/inventory/v1/summaries",
        query: {
          granularityType: "Marketplace",
          granularityId: mid,
          marketplaceIds: mid,
          details: true,
          startDateTime,
          ...(nextToken ? { nextToken } : {}),
          },
})) as any;

      const payload = data?.payload ?? data;
      const inv: any[] = Array.isArray(payload?.inventorySummaries) ? payload.inventorySummaries : [];

      for (const row of inv) {
        const sku = String(row?.sellerSku ?? row?.sellerSKU ?? "").trim();
        if (!sku) continue;

        const details = row?.inventoryDetails ?? {};

const fulfillable = n(details?.fulfillableQuantity);
const available = fulfillable ?? 0;

const inboundWorking = n(details?.inboundWorkingQuantity) ?? 0;
const inboundShipped = n(details?.inboundShippedQuantity) ?? 0;
const inboundReceiving = n(details?.inboundReceivingQuantity) ?? 0;
const inbound = inboundWorking + inboundShipped + inboundReceiving;

const reservedQty = n(details?.reservedQuantity);
const reservedTransfer = n(details?.reservedFcTransfer) ?? 0;
const reservedProcessing = n(details?.reservedFcProcessing) ?? 0;
const reserved = reservedQty ?? (reservedTransfer + reservedProcessing);
const updatedAtIso = new Date().toISOString();  
        total++;

        try {
  // Try create first (cheap when new)
  await gql(CREATE, {
  input: {
    marketplaceId: mid,
    sku,
    availableUnits: available,
    inboundUnits: inbound,
    reservedUnits: reserved,
    updatedAtIso,
  },
});
  ok++;
} catch (e1: any) {
  // If already exists, fall back to update (true upsert)
  try {
    await gql(UPDATE, {
  input: {
    marketplaceId: mid,
    sku,
    availableUnits: available,
    inboundUnits: inbound,
    reservedUnits: reserved,
    updatedAtIso,
  },
});
    ok++;
  } catch (e2: any) {
    failed++;
    if (errors.length < 30) errors.push({ sku, error: String(e2?.message ?? e2) });
  }
}
      }

      nextToken = payload?.nextToken ? String(payload.nextToken) : undefined;
      if (!nextToken) break;
    }

    // Build snapshot from InventorySku truth
    const origin = url.origin;
    let snap: any = null;
    try {
      const snapRes = await fetch(
        `${origin}/api/inventory/snapshot/build?mid=${encodeURIComponent(mid)}&source=ingest`,
        { method: "POST" }
      );
      const snapJson = await snapRes.json().catch(() => ({} as any));
      if (snapRes.ok && snapJson?.ok) snap = snapJson.snapshot ?? null;
      else errors.push({ error: `Snapshot build failed: ${snapJson?.error ?? `HTTP ${snapRes.status}`}` });
    } catch (e: any) {
      errors.push({ error: `Snapshot build failed: ${String(e?.message ?? e)}` });
    }

    return NextResponse.json({
      ok: true,
      mid,
      startDateTime,
      fetchedRows: total,
      insertedOrUpdated: ok,
      failed,
      snapshot: snap,
      errors,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}


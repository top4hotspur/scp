// app/api/inventory/snapshot/build/route.ts
import { NextResponse } from "next/server";
import { gql } from "@/lib/appsyncGql";

const LIST_SKUS = /* GraphQL */ `
  query ListInventorySkus($limit: Int, $nextToken: String, $filter: ModelInventorySkuFilterInput) {
    listInventorySkus(limit: $limit, nextToken: $nextToken, filter: $filter) {
      items {
        marketplaceId
        sku
        availableUnits
        inboundUnits
        reservedUnits
      }
      nextToken
    }
  }
`;

const UPDATE_SNAP = /* GraphQL */ `
  mutation UpdateInventorySnapshot($input: UpdateInventorySnapshotInput!) {
    updateInventorySnapshot(input: $input) {
      marketplaceId
      bucket
    }
  }
`;

const CREATE_SNAP = /* GraphQL */ `
  mutation CreateInventorySnapshot($input: CreateInventorySnapshotInput!) {
    createInventorySnapshot(input: $input) {
      marketplaceId
      bucket
    }
  }
`;

async function upsertSnapshot(input: any) {
  try {
    await gql(UPDATE_SNAP, { input });
  } catch {
    await gql(CREATE_SNAP, { input });
  }
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const marketplaceId = String(url.searchParams.get("mid") ?? "").trim();
    const bucket = String(url.searchParams.get("bucket") ?? "latest").trim();
    const source = String(url.searchParams.get("source") ?? "manual").trim();

    if (!marketplaceId) {
      return NextResponse.json({ ok: false, error: "Missing query param: mid" }, { status: 400 });
    }

    let nextToken: string | null = null;
    let skus = 0;
    let availableUnits = 0;
    let inboundUnits = 0;
    let reservedUnits = 0;

    const low: Array<{ sku: string; availableUnits: number }> = [];

    do {
      const data: any = await gql(LIST_SKUS, {
  limit: 500,
  nextToken,
  filter: { marketplaceId: { eq: marketplaceId } },
});

      const page = data?.listInventorySkus?.items ?? [];
      nextToken = data?.listInventorySkus?.nextToken ?? null;

      for (const r of page) {
        skus += 1;

        const a = Number(r?.availableUnits ?? 0);
        const i = Number(r?.inboundUnits ?? 0);
        const z = Number(r?.reservedUnits ?? 0);

        if (Number.isFinite(a)) availableUnits += a;
        if (Number.isFinite(i)) inboundUnits += i;
        if (Number.isFinite(z)) reservedUnits += z;

        if (Number.isFinite(a) && a <= 2) {
          low.push({ sku: String(r?.sku ?? ""), availableUnits: a });
        }
      }
    } while (nextToken);

    low.sort((x, y) => x.availableUnits - y.availableUnits || x.sku.localeCompare(y.sku));
    const topLowStockJson = JSON.stringify(low.slice(0, 80));

    const snap = {
      marketplaceId,
      bucket,
      createdAtIso: new Date().toISOString(),
      source,
      status: skus ? "OK" : "EMPTY",
      message: skus ? "Built from InventorySku" : "No InventorySku rows yet",
      skus,
      availableUnits,
      inboundUnits,
      reservedUnits,
      topLowStockJson,
    };

    await upsertSnapshot(snap);

    return NextResponse.json({ ok: true, snapshot: snap });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}



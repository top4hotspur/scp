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

const GET_SETTINGS = /* GraphQL */ `
  query GetAppSettings($id: ID!) {
    getAppSettings(id: $id) {
      id
      repricerAssignmentsJson
      repricerStrategiesJson
    }
  }
`;

// NOTE: adjust field names if your SupplierMap model differs.
// We only need SKU -> shortTitle.
const LIST_SUPPLIERMAP = /* GraphQL */ `
  query ListSupplierMaps($limit: Int, $nextToken: String) {
    listSupplierMaps(limit: $limit, nextToken: $nextToken) {
      items { sku shortTitle }
      nextToken
    }
  }
`;

function safeJson<T>(s: any, fallback: T): T {
  try {
    const v = typeof s === "string" ? JSON.parse(s) : s;
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function csvEscape(v: any) {
  const s = String(v ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const strategyId = String(searchParams.get("strategyId") ?? "").trim();
    if (!strategyId) return NextResponse.json({ ok: false, error: "Missing strategyId" }, { status: 400 });

    const d: any = await gql(GET_SETTINGS, { id: "global" });
    const rawAsg = d?.getAppSettings?.repricerAssignmentsJson ?? "[]";
    const rawStrat = d?.getAppSettings?.repricerStrategiesJson ?? "[]";

    const assignments: any[] = safeJson(rawAsg, []);
    const strategies: any[] = safeJson(rawStrat, []);

    const stratName = strategies.find((s) => String(s?.id) === strategyId)?.name ?? strategyId;

    // Build sku->shortTitle map (cheap enough for button-click; we can optimize later)
    const skuTitle: Record<string, string> = {};
    let nextToken: string | null = null;
    for (let i = 0; i < 20; i++) {
      const sm: any = await gql(LIST_SUPPLIERMAP, { limit: 1000, nextToken });
      const items: any[] = sm?.listSupplierMaps?.items ?? [];
      for (const it of items) {
        const sku = String(it?.sku ?? "").trim();
        if (sku) skuTitle[sku] = String(it?.shortTitle ?? "").trim();
      }
      nextToken = sm?.listSupplierMaps?.nextToken ?? null;
      if (!nextToken) break;
    }

    const rows = assignments
      .filter((a) => String(a?.strategyId ?? "") === strategyId)
      .map((a) => {
        const scopeType = String(a?.scopeType ?? "");
        const scopeValue = String(a?.scopeValue ?? "");
        const marketplaceId = String(a?.marketplaceId ?? "ALL");
        const shortTitle = scopeType === "SKU" ? (skuTitle[scopeValue] ?? "") : "";

        return {
          scopeType,
          scopeValue,
          supplier: scopeType === "SUPPLIER" ? scopeValue : "",
          pg1: a?.pg1 ?? "",
          pg2: a?.pg2 ?? "",
          pg3: a?.pg3 ?? "",
          pg4: a?.pg4 ?? "",
          pg5: a?.pg5 ?? "",
          marketplaceId,
          strategyId,
          strategyName: stratName,
          minProfit: a?.overrideMinProfitGbp ?? "",
          maxPrice: a?.overrideMaxPriceGbp ?? "",
          noSalesDays: a?.moveIfNoSalesDays ?? "",
          moveNoSales: a?.moveToStrategyIdNoSales ?? "",
          lowStockBelow: a?.moveIfLowStockBelow ?? "",
          moveLowStock: a?.moveToStrategyIdLowStock ?? "",
          paused: Boolean(a?.isPaused),
          shortTitle,
        };
      });

    const header = [
      "strategyName",
      "strategyId",
      "scopeType",
      "scopeValue",
      "shortTitle",
      "supplier",
      "pg1",
      "pg2",
      "pg3",
      "pg4",
      "pg5",
      "marketplaceId",
      "overrideMinProfitGbp",
      "overrideMaxPriceGbp",
      "moveIfNoSalesDays",
      "moveToStrategyIdNoSales",
      "moveIfLowStockBelow",
      "moveToStrategyIdLowStock",
      "isPaused",
    ];

    const lines = [
      header.join(","),
      ...rows.map((r) =>
        [
          r.strategyName,
          r.strategyId,
          r.scopeType,
          r.scopeValue,
          r.shortTitle,
          r.supplier,
          r.pg1,
          r.pg2,
          r.pg3,
          r.pg4,
          r.pg5,
          r.marketplaceId,
          r.minProfit,
          r.maxPrice,
          r.noSalesDays,
          r.moveNoSales,
          r.lowStockBelow,
          r.moveLowStock,
          r.paused ? "true" : "false",
        ]
          .map(csvEscape)
          .join(",")
      ),
    ].join("\n");

    return new NextResponse(lines, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="strategy-assignments-${strategyId}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}


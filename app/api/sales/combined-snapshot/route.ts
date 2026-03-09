// app/api/sales/combined-snapshot/route.ts
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

const GET_SETTINGS = /* GraphQL */ `
  query GetAppSettings($id: ID!) {
    getAppSettings(id: $id) {
      id
      ukMarketplaceId
      euMarketplaceIdsJson
    }
  }
`;

const GET_SNAPSHOT = /* GraphQL */ `
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

function baseUrlFromReq(req: Request) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  if (!host) return null;
  return `${proto}://${host}`;
}

type Snapshot = {
  marketplaceId: string;
  bucket: string;
  createdAtIso?: string | null;
  rowsJson?: string | null;
  topSellersJson?: string | null;
  totalsJson?: string | null;
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const bucket = String(searchParams.get("bucket") ?? "today").trim();
    const fresh = String(searchParams.get("fresh") ?? "").trim() === "1";
    if (!bucket) return NextResponse.json({ ok: false, error: "Missing bucket" }, { status: 400 });

    const s = await gql<{ getAppSettings: any }>(GET_SETTINGS, { id: "global" });
    const settings = s?.getAppSettings ?? {};
    const uk = String(settings.ukMarketplaceId ?? "").trim();
    const eu = safeJson<string[]>(settings.euMarketplaceIdsJson ?? "[]", []);
    const mids = [uk, ...eu].filter(Boolean);

    if (fresh) {
      const base = baseUrlFromReq(req);
      if (base) {
        await Promise.all(
          mids.map((mid) =>
            fetch(`${base}/api/sales/build-snapshot?mid=${encodeURIComponent(mid)}`, {
              method: "POST",
              cache: "no-store",
            }).catch(() => null)
          )
        );
      }
    }

    const allRows: any[] = [];

    for (const mid of mids) {
      const d = await gql<{ getSalesSnapshot: Snapshot | null }>(GET_SNAPSHOT, {
        marketplaceId: mid,
        bucket,
      });
      const snap = d?.getSalesSnapshot;
      if (!snap?.rowsJson) continue;
      const rows = safeJson<any[]>(snap.rowsJson, []);
      for (const r of rows) allRows.push(r);
    }

    // Cross-market de-duplication safety: if the same line appears in multiple marketplace snapshots,
    // keep one row in combined view.
    const dedup = new Map<string, any>();
    for (const r of allRows) {
      const key = `${String(r?.marketplaceId ?? "")}#${String(r?.orderId ?? "")}#${String(r?.sku ?? "")}#${String(r?.shippedAtIso ?? r?.purchaseAtIso ?? "")}#${String(r?.revenueExVat ?? "")}`;
      if (!dedup.has(key)) dedup.set(key, r);
    }

    // Sort newest first (we store bucket timestamp in shippedAtIso)
    const dedupRows = [...dedup.values()];
    dedupRows.sort((a, b) => String(b?.shippedAtIso ?? "").localeCompare(String(a?.shippedAtIso ?? "")));

    const rows = dedupRows.slice(0, 500);

    // Aggregate top sellers across all mids
    const bySku = new Map<string, { sku: string; units: number; profit: number }>();
    for (const r of rows) {
      const sku = String(r?.sku ?? "").trim();
      if (!sku) continue;
      const cur = bySku.get(sku) ?? { sku, units: 0, profit: 0 };
      cur.units += Number(r?.qty ?? 0) || 0;
      cur.profit += Number(r?.profitExVat ?? 0) || 0;
      bySku.set(sku, cur);
    }
    const topSellers = [...bySku.values()].sort((a, b) => b.units - a.units).slice(0, 10);

    const totals = {
      rows: rows.length,
      units: rows.reduce((s, r) => s + (Number(r?.qty ?? 0) || 0), 0),
      profitExVat: rows.reduce((s, r) => s + (Number(r?.profitExVat ?? 0) || 0), 0),
    };

    return NextResponse.json({ ok: true, bucket, mids, rows, topSellers, totals });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

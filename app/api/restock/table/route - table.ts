// app/api/restock/table/route.ts
import { NextResponse } from "next/server";
import outputs from "@/amplify_outputs.json";

export const runtime = "nodejs";

const DATA_URL = outputs.data.url;
const DATA_API_KEY = outputs.data.api_key;

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

const LIST_SUPPLIERMAPS = /* GraphQL */ `
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
        productCost
        prepCost
        shippingCost
        leadTimeDays
      }
      nextToken
    }
  }
`;

// SalesLine is already in your system (used by Sales module) :contentReference[oaicite:5]{index=5}
// We only need marketplaceId, sku, qty, and a timestamp.
const LIST_SALESLINES = /* GraphQL */ `
  query ListSalesLines($limit: Int, $nextToken: String) {
    listSalesLines(limit: $limit, nextToken: $nextToken) {
      items {
        marketplaceId
        sku
        qty
        shippedAtIso
        purchaseAtIso
      }
      nextToken
    }
  }
`;

type SupplierMapRow = {
  sku?: string | null;
  shortTitle?: string | null;
  supplierName?: string | null;
  prodGroup1?: string | null;
  prodGroup2?: string | null;
  prodGroup3?: string | null;
  prodGroup4?: string | null;
  prodGroup5?: string | null;
  leadTimeDays?: number | null;
  productCost?: number | null;
  prepCost?: number | null;
  shippingCost?: number | null;
};

type SalesLineRow = {
  marketplaceId: string;
  sku: string;
  qty: number;
  shippedAtIso?: string | null;
  purchaseAtIso?: string | null;
};

type ListResp<T> = { listSupplierMaps?: { items?: (T | null)[] | null; nextToken?: string | null } | null };
type ListSalesResp = { listSalesLines?: { items?: (SalesLineRow | null)[] | null; nextToken?: string | null } | null };

function safeNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// London-midnight-safe day start (same pattern you used in Sales)
function londonDayStartIso(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";

  let t = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
  for (let i = 0; i < 4; i++) {
    const p2 = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(t);

    const yy = p2.find((p) => p.type === "year")?.value ?? y;
    const mm = p2.find((p) => p.type === "month")?.value ?? m;
    const dd = p2.find((p) => p.type === "day")?.value ?? d;
    const hh = Number(p2.find((p) => p.type === "hour")?.value ?? "0");
    const mi = Number(p2.find((p) => p.type === "minute")?.value ?? "0");

    const curYmd = `${yy}-${mm}-${dd}`;
    const tgtYmd = `${y}-${m}-${d}`;
    let delta = hh * 60 + mi;

    if (curYmd > tgtYmd) delta += 1440;
    if (curYmd < tgtYmd) delta -= 1440;

    if (delta === 0) break;
    t = new Date(t.getTime() - delta * 60_000);
  }

  return t.toISOString();
}

function subtractDaysIsoFromLondonMidnight(days: number): string {
  const start = new Date(londonDayStartIso(new Date()));
  start.setUTCDate(start.getUTCDate() - days);
  return start.toISOString();
}

function matchesFilters(x: SupplierMapRow, supplier: string, pg: (string | null)[]) {
  if (supplier && String(x.supplierName ?? "").trim() !== supplier) return false;

  const [pg1, pg2, pg3, pg4, pg5] = pg.map((v) => (v ? v.trim() : ""));
  if (pg1 && String(x.prodGroup1 ?? "").trim() !== pg1) return false;
  if (pg2 && String(x.prodGroup2 ?? "").trim() !== pg2) return false;
  if (pg3 && String(x.prodGroup3 ?? "").trim() !== pg3) return false;
  if (pg4 && String(x.prodGroup4 ?? "").trim() !== pg4) return false;
  if (pg5 && String(x.prodGroup5 ?? "").trim() !== pg5) return false;

  return true;
}

// Choose a timestamp for velocity (prefer shipped; fallback purchase)
function lineAtIso(s: SalesLineRow): string | null {
  return (s.shippedAtIso ?? s.purchaseAtIso ?? null) as any;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const mid = String(searchParams.get("mid") ?? "").trim();
    const supplier = String(searchParams.get("supplier") ?? "").trim();

    const horizonDays = Math.max(30, Math.min(90, Number(searchParams.get("days") ?? 30)));
    const pg = [
      searchParams.get("pg1"),
      searchParams.get("pg2"),
      searchParams.get("pg3"),
      searchParams.get("pg4"),
      searchParams.get("pg5"),
    ].map((x) => (x == null ? null : String(x)));

    if (!mid) return NextResponse.json({ ok: false, error: "Missing mid" }, { status: 400 });
    if (!supplier) return NextResponse.json({ ok: false, error: "Missing supplier" }, { status: 400 });

    // 1) Load SupplierMap, filter to supplier + product groups
    let nextToken: string | null = null;
    const supplierRows: SupplierMapRow[] = [];

    do {
      const vars: any = { limit: 1000 };
if (nextToken) vars.nextToken = nextToken;
const data = await gql<ListResp<SupplierMapRow>>(LIST_SUPPLIERMAPS, vars);
      const items = data?.listSupplierMaps?.items ?? [];
      for (const it of items) if (it && matchesFilters(it, supplier, pg)) supplierRows.push(it);
      nextToken = data?.listSupplierMaps?.nextToken ?? null;
    } while (nextToken);

    const skus = supplierRows.map((x) => String(x.sku ?? "").trim()).filter(Boolean);
const skuSet = new Set(skus);

    // 2) Stock (available) – use your existing inventory availability endpoint :contentReference[oaicite:6]{index=6}
    // We call local API so we don’t duplicate inventory logic here.
    const origin = new URL(req.url).origin;
    const aRes = await fetch(
      `${origin}/api/inventory/availability?mid=${encodeURIComponent(mid)}&skus=${encodeURIComponent(skus.slice(0, 300).join(","))}`,
      { cache: "no-store" }
    );
    const aJson = await aRes.json().catch(() => ({} as any));
    const availability: Record<string, number> = aRes.ok && aJson?.ok ? (aJson.availability ?? {}) : {};

    // Inbound is not exposed yet in availability; we’ll show 0 until we add an inbound endpoint.
    const inboundBySku: Record<string, number> = {};

    // 3) Velocity from SalesLine last horizonDays
    const fromIso = subtractDaysIsoFromLondonMidnight(horizonDays);

    let nextSales: string | null = null;
    const soldUnitsBySku = new Map<string, number>();

    do {
      const vars: any = { limit: 1000 };
if (nextSales) vars.nextToken = nextSales;
const data = await gql<ListSalesResp>(LIST_SALESLINES, vars);
      const items = data?.listSalesLines?.items ?? [];
      for (const it of items) {
        if (!it) continue;
        if (String(it.marketplaceId ?? "").trim() !== mid) continue;
        const sku = String(it.sku ?? "").trim();
        if (!sku) continue;
       if (!skuSet.has(sku)) continue;
      

        const at = lineAtIso(it);
        if (!at) continue;
        if (at < fromIso) continue;

        soldUnitsBySku.set(sku, (soldUnitsBySku.get(sku) ?? 0) + safeNum(it.qty));
      }
      nextSales = data?.listSalesLines?.nextToken ?? null;
    } while (nextSales);

    // 4) Build rows
    const supplierBySku = new Map<string, SupplierMapRow>();
    for (const r of supplierRows) {
      const k = String(r.sku ?? "").trim();
      if (k) supplierBySku.set(k, r);
    }

    const rows = skus.map((sku) => {
      const sm = supplierBySku.get(sku) ?? {};

      const available = safeNum(availability[sku]);
      const inbound = safeNum(inboundBySku[sku]);
      const stockTotal = available + inbound;

      const soldUnits = safeNum(soldUnitsBySku.get(sku) ?? 0);
      const dailyVel = soldUnits / horizonDays;

      const projectedSales = soldUnits; // naive projection
      const projectedBalance = stockTotal - projectedSales;

      const daysOfCover = dailyVel > 0 ? stockTotal / dailyVel : null;

      // Lead time from SupplierMap (field: leadtimedays).default to 7 if missing
      const leadTimeDays = (() => {
        const raw = (sm as any)?.leadTimeDays;
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 7;
      })();

      const daysToOrder = daysOfCover == null ? null : Math.max(0, daysOfCover - leadTimeDays);

      const unitCost = safeNum(sm.productCost) + safeNum(sm.prepCost) + safeNum(sm.shippingCost);

      return {
        sku,
        shortTitle: sm.shortTitle ?? null,

        available,
        inbound,

        soldUnits,
        dailyVel,

        projectedSales,
        projectedBalance,

        daysOfCover,
        leadTimeDays,
        daysToOrder,

        unitCost,
        supplier,
      };
    });
      return NextResponse.json({ ok: true, mid, supplier, horizonDays, skus: skus.length, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
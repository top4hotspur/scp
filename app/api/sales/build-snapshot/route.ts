// app/api/sales/build-snapshot/route.ts
import { NextResponse } from "next/server";
import { gql } from "@/lib/appsyncGql";
type GqlResp<T> = { data?: T; errors?: { message: string }[] };



const LIST_SUPPLIERMAPS = /* GraphQL */ `
  query ListSupplierMaps($limit: Int, $nextToken: String) {
    listSupplierMaps(limit: $limit, nextToken: $nextToken) {
      items {
        sku
        productCost
        prepCost
        shippingCost
      }
      nextToken
    }
  }
`;

  type SupplierMapRow = {
  sku?: string | null;
  productCost?: number | null;
  prepCost?: number | null;
  shippingCost?: number | null;
};

type ListSupplierMapsResp = {
  listSupplierMaps?: {
    items?: (SupplierMapRow | null)[] | null;
    nextToken?: string | null;
  } | null;
};

function londonDayStartIso(now = new Date()): string {
  // UTC instant that corresponds to 00:00 in Europe/London for "today"
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";

  // Start with a UTC guess, then correct until London local time is 00:00 on that date
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

    // If we drifted into adjacent day, correct by whole days first
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

function londonDayStartDate(now = new Date()): Date {
  return new Date(londonDayStartIso(now));
}

function normSku(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}


async function loadSupplierCostBySku(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  let nextToken: string | null = null;

  do {
    const vars: any = { limit: 1000 };
    if (nextToken) vars.nextToken = nextToken;

    const data = await gql<ListSupplierMapsResp>(LIST_SUPPLIERMAPS, vars);

    const items = data?.listSupplierMaps?.items ?? [];
    for (const it of items) {
      if (!it) continue;
      const sku = normSku(it.sku);
      if (!sku) continue;

      const productCost = Number(it.productCost);
const prepCost = Number(it.prepCost);
const shippingCost = Number(it.shippingCost);

// We treat these as UNIT costs (same currency as your SupplierMap entries)
// If you later store exVAT vs incVAT, we can extend this.
const unit = (Number.isFinite(productCost) ? productCost : 0)
  + (Number.isFinite(prepCost) ? prepCost : 0)
  + (Number.isFinite(shippingCost) ? shippingCost : 0);

if (unit > 0) map.set(sku, unit);
    }

    nextToken = data?.listSupplierMaps?.nextToken ?? null;
  } while (nextToken);

  return map;
}

const LIST_SALESLINES = /* GraphQL */ `
  query ListSalesLines($limit: Int, $nextToken: String) {
    listSalesLines(limit: $limit, nextToken: $nextToken) {
      items {
        marketplaceId
        orderId
        sku
        shippedAtIso
        purchaseAtIso
        currency
        qty

        itemPrice
        itemTax
        shippingPrice
        shippingTax
        promoDiscount
        promoDiscountTax

        shortTitle
        listingTitle
        imageUrl

        supplierCostExVat
        inboundShipping
        prepCost

        feeEstimateTotal
        profitExVat
        marginPct
        roiPct
      }
      nextToken
    }
  }
`;

const CREATE_SNAPSHOT = /* GraphQL */ `
  mutation CreateSalesSnapshot($input: CreateSalesSnapshotInput!) {
    createSalesSnapshot(input: $input) {
      marketplaceId
      bucket
      createdAtIso
    }
  }
`;

const GET_SETTINGS = /* GraphQL */ `
  query GetAppSettings($id: ID!) {
    getAppSettings(id: $id) {
      id
      ukMarketplaceId
      euMarketplaceIdsJson
      euInventoryMarketplaceId
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

function baseUrlFromReq(req: Request) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  if (!host) return null;
  return `${proto}://${host}`;
}

async function loadStockBySku(req: Request, invMid: string): Promise<Map<string, number>> {
  const base = baseUrlFromReq(req);
  const map = new Map<string, number>();
  if (!base || !invMid) return map;

  const res = await fetch(`${base}/api/inventory/snapshot/latest?mid=${encodeURIComponent(invMid)}`, { cache: "no-store" });
  const json = await res.json().catch(() => ({} as any));
  if (!res.ok || !json?.ok) return map;

  // Support either json.rows OR json.snapshot.rowsJson shapes
  const rows =
    Array.isArray(json.rows) ? json.rows :
    Array.isArray(json.snapshot?.rows) ? json.snapshot.rows :
    safeJson<any[]>(json.snapshot?.rowsJson ?? "[]", []);

  for (const r of rows) {
    const sku = String(r?.sku ?? "").trim();
    if (!sku) continue;

    // support common field names
    const n =
      Number(r?.available ?? r?.stockAvailable ?? r?.availableQty ?? r?.qtyAvailable ?? r?.afnAvailable ?? r?.onHand ?? null);

    if (Number.isFinite(n)) map.set(sku, n);
  }
  return map;
}

const UPDATE_SNAPSHOT = /* GraphQL */ `
  mutation UpdateSalesSnapshot($input: UpdateSalesSnapshotInput!) {
    updateSalesSnapshot(input: $input) {
      marketplaceId
      bucket
      createdAtIso
    }
  }
`;

type SalesLine = {
  marketplaceId: string;
  orderId: string;
  sku: string;

  shippedAtIso?: string | null;
  purchaseAtIso?: string | null;

  currency: string;
  qty: number;

  itemPrice?: number | null;
  itemTax?: number | null;
  shippingPrice?: number | null;
  shippingTax?: number | null;
  promoDiscount?: number | null;
  promoDiscountTax?: number | null;

  shortTitle?: string | null;
  listingTitle?: string | null;
  imageUrl?: string | null;

  supplierCostExVat?: number | null;
  inboundShipping?: number | null;
  prepCost?: number | null;

  feeEstimateTotal?: number | null;

  profitExVat?: number | null;
  marginPct?: number | null;
  roiPct?: number | null;
};

type ListSalesLinesResp = {
  listSalesLines?: {
    items?: (SalesLine | null)[] | null;
    nextToken?: string | null;
  } | null;
};

type ListVars = {
  limit: number;
  nextToken?: string;
};

function isoDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

function safeNum(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function withinWindow(iso: string | null | undefined, fromIso: string, toIso: string): boolean {
  if (!iso) return false;
  return iso >= fromIso && iso < toIso;
}

function pickAtIso(x: SalesLine, bucket: string): string | null {
  // STK rule:
  // - today = Orders stream only (purchase time)
  // - yesterday+ = shipped truth (shipped time) with fallback to purchase ONLY if shipped missing
  if (bucket === "today") return (x.purchaseAtIso ?? null) as any;
  return (x.shippedAtIso ?? x.purchaseAtIso ?? null) as any;
}

function betterLine(a: SalesLine, b: SalesLine, bucket: string): SalesLine {
  // Prefer shipped record if either has shippedAtIso (for all buckets)
  const aShipped = Boolean(a.shippedAtIso);
  const bShipped = Boolean(b.shippedAtIso);
  if (aShipped !== bShipped) return bShipped ? b : a;

  // Otherwise choose whichever has later "atIso" for that bucket
  const aIso = pickAtIso(a, bucket) ?? "";
  const bIso = pickAtIso(b, bucket) ?? "";
  return bIso > aIso ? b : a;
}



export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const mid = String(searchParams.get("mid") ?? "").trim();
    if (!mid) return NextResponse.json({ ok: false, error: "Missing mid" }, { status: 400 });

    // Load settings (so we can use DE anchor for EU stock if configured)
const s = await gql<{ getAppSettings: any }>(GET_SETTINGS, { id: "global" });
const settings = s?.getAppSettings ?? {};
const ukMid = String(settings.ukMarketplaceId ?? "").trim();
const euMids = safeJson<string[]>(settings.euMarketplaceIdsJson ?? "[]", []);
const euInvMid = String(settings.euInventoryMarketplaceId ?? "").trim();

// Decide which inventory snapshot to use for this marketplace:
// - UK: UK inventory
// - EU: DE anchor inventory (until per-marketplace inventory is implemented)
const invMid = mid === ukMid ? ukMid : (euMids.includes(mid) ? (euInvMid || mid) : mid);

// Load stock once (snapshot-first)
const stockBySku = await loadStockBySku(req, invMid);

    const now = new Date();
const todayStart = londonDayStartDate(now);
    const yesterdayStart = addDays(todayStart, -1);

    const buckets: { bucket: string; from: Date; to: Date }[] = [
      { bucket: "today", from: todayStart, to: addDays(todayStart, 1) },
      { bucket: "yesterday", from: yesterdayStart, to: todayStart },
      { bucket: "7d", from: addDays(todayStart, -7), to: addDays(todayStart, 1) },
      { bucket: "30d", from: addDays(todayStart, -30), to: addDays(todayStart, 1) },
    ];

    // Load ALL sales lines (paged) and filter in memory for now.
    let nextToken: string | null = null;
    const all: SalesLine[] = [];

    do {
      const vars: ListVars = { limit: 500 };
      if (typeof nextToken === "string" && nextToken.length) vars.nextToken = nextToken;

      const data = await gql<ListSalesLinesResp>(LIST_SALESLINES, vars as unknown as Record<string, unknown>);

      const page = data?.listSalesLines?.items ?? [];
      for (const it of page) {
        if (it) all.push(it);
      }

      nextToken = data?.listSalesLines?.nextToken ?? null;
    } while (nextToken);

    const results: unknown[] = [];

// Load SupplierMap costs once (COGS-first profit/ROI/margin)
const supplierCostBySku = await loadSupplierCostBySku();

    for (const b of buckets) {
      const fromIso = b.from.toISOString();
      const toIso = b.to.toISOString();

      const windowLinesRaw = all.filter((x) => {
  if (x.marketplaceId !== mid) return false;

  // TODAY = everything since midnight (shipped + unshipped), bucketed by purchase time
  const atIso = b.bucket === "today" ? (x.purchaseAtIso ?? null) : pickAtIso(x, b.bucket);
  return withinWindow(atIso, fromIso, toIso);
});

// Dedupe by (orderId, sku) and prefer shipped rows when present
const byKey = new Map<string, SalesLine>();
for (const x of windowLinesRaw) {
  const k = `${x.orderId}#${x.sku}`;
  const prev = byKey.get(k);
  byKey.set(k, prev ? betterLine(prev, x, b.bucket) : x);
}

const windowLines = [...byKey.values()];

      const rows = windowLines
        .sort((a, c) => {
  const aIso = b.bucket === "today" ? (a.purchaseAtIso ?? "") : (pickAtIso(a, b.bucket) ?? "");
  const cIso = b.bucket === "today" ? (c.purchaseAtIso ?? "") : (pickAtIso(c, b.bucket) ?? "");
  return String(cIso).localeCompare(String(aIso));
})
        .slice(0, 500)
        .map((x) => {
          const revenueExVat =
            safeNum(x.itemPrice) +
            safeNum(x.shippingPrice) -
            safeNum(x.promoDiscount);

          // SupplierMap unit cost (productCost + prepCost + shippingCost)
const skuKey = normSku(x.sku);

// Resolve UNIT cost (ex VAT)
// Priority: SalesLine.supplierCostExVat (if already stored) else SupplierMap-derived cost
const unitCost =
  (Number.isFinite(Number(x.supplierCostExVat)) ? Number(x.supplierCostExVat) : null) ??
  supplierCostBySku.get(skuKey) ??
  null;

const qty = safeNum(x.qty);
const supplierCostLine = unitCost != null ? unitCost * qty : 0;

// Fees: require explicit stored value for cost-complete profitability.
const hasFeeEstimate = Number.isFinite(Number(x.feeEstimateTotal)) && x.feeEstimateTotal != null;
const fees = hasFeeEstimate ? Number(x.feeEstimateTotal) : 0;

// Other operational costs (already ex-VAT in your model intent)
const inbound = safeNum(x.inboundShipping);
const prep = safeNum(x.prepCost);

const costs = supplierCostLine + inbound + prep + fees;

// Always recompute profit from current cost truth so fee updates flow through snapshots.
const profit = revenueExVat - costs;

const marginPct = revenueExVat > 0 ? (profit / revenueExVat) * 100 : null;

// ROI should be against TOTAL supplier line cost, not the raw single-field supplierCostExVat
const denom = supplierCostLine > 0 ? supplierCostLine : null;
const roiPct = denom ? (profit / denom) * 100 : null;

// Missing flags: row is complete only when supplier cost and stored fee estimate are both present.
const missingCostFields =
  unitCost == null || !hasFeeEstimate;

          const stockAvailable = stockBySku.get(String(x.sku)) ?? null;

return {
  sku: x.sku,
  shortTitle: x.shortTitle ?? null,
  listingTitle: x.listingTitle ?? null,
  marketplaceId: x.marketplaceId,
  qty: x.qty,
  shippedAtIso: pickAtIso(x, b.bucket), // bucket timestamp
  currency: x.currency,

  // NEW
  stockAvailable,

  revenueExVat,
  feeEstimateTotal: hasFeeEstimate ? fees : null,
  profitExVat: profit,
  marginPct,
  roiPct,
  missingCostFields,
};
        });

      const bySku = new Map<string, { sku: string; units: number; profit: number }>();
      for (const r of rows) {
        const key = String(r.sku);
        const cur = bySku.get(key) ?? { sku: key, units: 0, profit: 0 };
        cur.units += safeNum(r.qty);
        cur.profit += safeNum(r.profitExVat);
        bySku.set(key, cur);
      }

      const topSellers = [...bySku.values()]
        .sort((a, c) => c.units - a.units)
        .slice(0, 10);

      const completeRows = rows.filter((r) => !r.missingCostFields);

      const input = {
        marketplaceId: mid,
        bucket: b.bucket,
        createdAtIso: new Date().toISOString(),
        rowsJson: JSON.stringify(rows),
        topSellersJson: JSON.stringify(topSellers),
        totalsJson: JSON.stringify({
          rows: rows.length,
          rowsWithCompleteCosts: completeRows.length,
          units: rows.reduce((s, r) => s + safeNum(r.qty), 0),
          profitExVat: completeRows.reduce((s, r) => s + safeNum(r.profitExVat), 0),
        }),
      };

      try {
  await gql(UPDATE_SNAPSHOT, { input });
} catch (e: any) {
  const msg = String(e?.message ?? e);

  // Most common on "update" when item doesn't exist yet:
  // - "not found", "does not exist"
  // If we accidentally hit conditional failures, also fallback to create.
  if (
    msg.toLowerCase().includes("not found") ||
    msg.toLowerCase().includes("does not exist") ||
    msg.toLowerCase().includes("conditional request failed")
  ) {
    await gql(CREATE_SNAPSHOT, { input });
  } else {
    throw e;
  }
} 
      results.push({ bucket: b.bucket, rows: rows.length, topSellers: topSellers.length });
    }

    return NextResponse.json({ ok: true, mid, totalSalesLinesLoaded: all.length, built: results });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}


// app/api/restock/table/route.ts
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

type SupplierMapRow = {
  id?: string;
  sku?: string;
  supplierName?: string;
  shortTitle?: string | null;

  productCost?: number | null;
  prepCost?: number | null;
  shippingCost?: number | null;

  prodGroup1?: string | null;
  prodGroup2?: string | null;
  prodGroup3?: string | null;
  prodGroup4?: string | null;
  prodGroup5?: string | null;

  leadTimeDays?: number | null;
};

type SalesLineRow = {
  marketplaceId?: string | null;
  sku?: string | null;
  qty?: number | null;
  shippedAtIso?: string | null;
  purchaseAtIso?: string | null;
};

type ListResp<T> = { listSupplierMaps?: { items?: (T | null)[]; nextToken?: string | null } };
type ListSalesResp = { listSalesLines?: { items?: (SalesLineRow | null)[]; nextToken?: string | null } };

const LIST_SUPPLIERMAPS = /* GraphQL */ `
  query ListSupplierMaps($limit: Int, $nextToken: String) {
    listSupplierMaps(limit: $limit, nextToken: $nextToken) {
      items {
        id
        sku
        supplierName
        shortTitle
        productCost
        prepCost
        shippingCost
        prodGroup1
        prodGroup2
        prodGroup3
        prodGroup4
        prodGroup5
        leadTimeDays
      }
      nextToken
    }
  }
`;

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

function safeNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normSku(s: any) {
  return String(s ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function londonDayStartIso(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const dd = parts.find((p) => p.type === "day")?.value ?? "01";

  return new Date(`${y}-${m}-${dd}T00:00:00.000Z`).toISOString();
}

function subtractDaysIsoFromLondonMidnight(days: number): string {
  const start = new Date(londonDayStartIso(new Date()));
  start.setUTCDate(start.getUTCDate() - days);
  return start.toISOString();
}

function matchesFilters(x: SupplierMapRow, supplier: string | null, pg: (string | null)[]) {
  if (supplier && String(x.supplierName ?? "").trim() !== supplier) return false;

  const [pg1, pg2, pg3, pg4, pg5] = pg.map((v) => (v ? v.trim() : ""));
  if (pg1 && String(x.prodGroup1 ?? "").trim() !== pg1) return false;
  if (pg2 && String(x.prodGroup2 ?? "").trim() !== pg2) return false;
  if (pg3 && String(x.prodGroup3 ?? "").trim() !== pg3) return false;
  if (pg4 && String(x.prodGroup4 ?? "").trim() !== pg4) return false;
  if (pg5 && String(x.prodGroup5 ?? "").trim() !== pg5) return false;

  return true;
}

function lineAtIso(s: SalesLineRow): string | null {
  return (s.shippedAtIso ?? s.purchaseAtIso ?? null) as any;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function loadAvailability(origin: string, mid: string, skus: string[]) {
  const availability: Record<string, number> = {};
  const inbound: Record<string, number> = {};
  const reserved: Record<string, number> = {};

  let maxUpdatedAtIso: string | null = null;

  for (const part of chunk(skus, 300)) {
    if (!part.length) continue;

    const r = await fetch(
      `${origin}/api/inventory/availability?mid=${encodeURIComponent(mid)}&skus=${encodeURIComponent(part.join(","))}`,
      { cache: "no-store" }
    );
    const j = await r.json().catch(() => ({} as any));
    if (!r.ok || !j?.ok) continue;

    Object.assign(availability, j.availability ?? {});
    Object.assign(inbound, j.inbound ?? {});
    Object.assign(reserved, j.reserved ?? {});

    const m = j.maxUpdatedAtIso ? String(j.maxUpdatedAtIso) : null;
    if (m && (!maxUpdatedAtIso || m > maxUpdatedAtIso)) maxUpdatedAtIso = m;
  }

  return { availability, inbound, reserved, maxUpdatedAtIso };
}

function buildSupplierSkuAliasMaps(supplierSkus: string[]) {
  // Map BOTH:
  // - fullSku -> fullSku
  // - alias (eg "4771") -> fullSku
  const aliasToFull: Record<string, string> = {};
  const fullSet = new Set<string>();

  for (const raw of supplierSkus) {
    const full = normSku(raw);
    if (!full) continue;

    fullSet.add(full);
    if (!aliasToFull[full]) aliasToFull[full] = full;

    // last-token alias: STYLECRAFT-PATTERN-4771 -> 4771
    const parts = full.split("-").map((x) => x.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      if (last && !aliasToFull[last]) aliasToFull[last] = full;
    }

    // if it ends with a 3-6 digit number, alias that too
    const m = full.match(/(\d{3,6})$/);
    if (m?.[1] && !aliasToFull[m[1]]) aliasToFull[m[1]] = full;
  }

  return { aliasToFull, fullSet };
}

function parseWindows(requestedDays: number, extraParam: string) {
  const baseDays = 30;

  const extraDays = String(extraParam ?? "")
    .split(",")
    .map((x) => Math.trunc(Number(x.trim())))
    .filter((n) => Number.isFinite(n) && n >= 2 && n <= 90);

  const windows = Array.from(new Set([baseDays, requestedDays, ...extraDays])).sort((a, b) => a - b);
  return { baseDays, windows };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const mid = String(searchParams.get("mid") ?? "").trim();
    const supplierRaw = String(searchParams.get("supplier") ?? "").trim(); // OPTIONAL
    const supplierFilter = supplierRaw ? supplierRaw : null;

    const requestedDays = Math.max(2, Math.min(90, Number(searchParams.get("days") ?? 30)));
    const { baseDays, windows } = parseWindows(requestedDays, String(searchParams.get("extra") ?? ""));

    const pg = [
      searchParams.get("pg1"),
      searchParams.get("pg2"),
      searchParams.get("pg3"),
      searchParams.get("pg4"),
      searchParams.get("pg5"),
    ].map((x) => (x == null ? null : String(x)));

    if (!mid) return NextResponse.json({ ok: false, error: "Missing mid" }, { status: 400 });

    // 1) SupplierMap (filter to supplier (optional) + product groups)
    let nextToken: string | null = null;
    const supplierRows: SupplierMapRow[] = [];

    do {
      const vars: any = { limit: 1000 };
      if (nextToken) vars.nextToken = nextToken;

      const data = await gql<ListResp<SupplierMapRow>>(LIST_SUPPLIERMAPS, vars);
      const items = data?.listSupplierMaps?.items ?? [];
      for (const it of items) if (it && matchesFilters(it, supplierFilter, pg)) supplierRows.push(it);

      nextToken = data?.listSupplierMaps?.nextToken ?? null;
    } while (nextToken);

    const supplierSkusRaw = supplierRows.map((x) => String(x.sku ?? "").trim()).filter(Boolean);
    const supplierSkus = supplierSkusRaw.map(normSku).filter(Boolean);

    const { aliasToFull, fullSet } = buildSupplierSkuAliasMaps(supplierSkus);

    // 2) Stock truth from /api/inventory/availability
    const origin = new URL(req.url).origin;
    const stock = await loadAvailability(origin, mid, supplierSkus);

    // 3) Velocity windows: compute once, fill many
    const maxWindow = windows[windows.length - 1] ?? baseDays;
    const fromIsoMin = subtractDaysIsoFromLondonMidnight(maxWindow);

    // Precompute window start times
    const fromIsoByDays = new Map<number, string>();
    for (const d of windows) fromIsoByDays.set(d, subtractDaysIsoFromLondonMidnight(d));

    // soldUnitsByDays.get(30).get(sku) -> qty
    const soldUnitsByDays = new Map<number, Map<string, number>>();
    for (const d of windows) soldUnitsByDays.set(d, new Map<string, number>());

    // Freshness:
    let maxSalesAtIsoAll: string | null = null;
    let maxSalesAtIsoMatched: string | null = null;

    let nextSales: string | null = null;

    do {
      const vars: any = { limit: 1000 };
      if (nextSales) vars.nextToken = nextSales;

      const data = await gql<ListSalesResp>(LIST_SALESLINES, vars);
      const items = data?.listSalesLines?.items ?? [];

      for (const it of items) {
        if (!it) continue;
        if (String(it.marketplaceId ?? "").trim() !== mid) continue;

        const at = lineAtIso(it);
        if (at) {
          if (!maxSalesAtIsoAll || at > maxSalesAtIsoAll) maxSalesAtIsoAll = at;
        }

        const salesSkuRaw = normSku(it.sku);
        if (!salesSkuRaw) continue;

        // Resolve sales SKU -> canonical FULL supplier SKU (if possible)
        const full = aliasToFull[salesSkuRaw];
        if (!full || !fullSet.has(full)) continue;

        if (at) {
          if (!maxSalesAtIsoMatched || at > maxSalesAtIsoMatched) maxSalesAtIsoMatched = at;
        }

        // Below the largest window => ignore for totals
        if (!at || at < fromIsoMin) continue;

        const qty = safeNum(it.qty);

        for (const d of windows) {
          const fromIso = fromIsoByDays.get(d);
          if (!fromIso) continue;
          if (at >= fromIso) {
            const m = soldUnitsByDays.get(d)!;
            m.set(full, (m.get(full) ?? 0) + qty);
          }
        }
      }

      nextSales = data?.listSalesLines?.nextToken ?? null;
    } while (nextSales);

    // 4) Build rows
    const supplierByFullSku = new Map<string, SupplierMapRow>();
    for (const r of supplierRows) {
      const k = normSku(r.sku);
      if (k) supplierByFullSku.set(k, r);
    }

    const rows = supplierSkus.map((fullSku) => {
      const sm = supplierByFullSku.get(fullSku) ?? {};

      const available = safeNum(stock.availability[fullSku]);
      const inbound = safeNum(stock.inbound[fullSku]);
      const reserved = safeNum(stock.reserved[fullSku]);

      const stockForCover = Math.max(0, available + inbound);

      const soldReq = safeNum(soldUnitsByDays.get(requestedDays)?.get(fullSku) ?? 0);
      const dailyVelReq = soldReq / requestedDays;

      const sold30 = safeNum(soldUnitsByDays.get(baseDays)?.get(fullSku) ?? 0);
      const dailyVel30 = sold30 / baseDays;

      const projectedSalesReq = soldReq;
      const projectedBalance = stockForCover - projectedSalesReq;

      const daysOfCover = dailyVelReq > 0 ? stockForCover / dailyVelReq : null;

      const leadTimeDays = (() => {
        const raw = (sm as any)?.leadTimeDays;
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 7;
      })();

      const daysToOrder = daysOfCover == null ? null : Math.max(0, daysOfCover - leadTimeDays);

      const unitCost = safeNum(sm.productCost) + safeNum(sm.prepCost) + safeNum(sm.shippingCost);

      // Optional window stats (only if requested via extra=)
      const windowStats: Record<string, { soldUnits: number; dailyVel: number }> = {};
      for (const d of windows) {
        if (d === requestedDays) continue; // already exposed as soldUnits/dailyVel
        const sold = safeNum(soldUnitsByDays.get(d)?.get(fullSku) ?? 0);
        windowStats[String(d)] = { soldUnits: sold, dailyVel: sold / d };
      }

      return {
        sku: fullSku,
        shortTitle: sm.shortTitle ?? null,

        available,
        inbound,
        reserved,

        projectedBalance,
        daysOfCover,
        daysToOrder,

        unitCost,

        // Primary (requested days)
        soldUnits: soldReq,
        dailyVel: dailyVelReq,

        // Baseline always available (30d)
        soldUnits30d: sold30,
        dailyVel30d: dailyVel30,

        // Optional additional windows
        windows: windowStats,
      };
    });

    // Freshness helpers
    const now = Date.now();
    const invAgeMinutes =
      stock.maxUpdatedAtIso ? Math.max(0, Math.round((now - new Date(stock.maxUpdatedAtIso).getTime()) / 60000)) : null;

    const salesMaxAtIso = maxSalesAtIsoMatched ?? maxSalesAtIsoAll;
    const salesAgeMinutes =
      salesMaxAtIso ? Math.max(0, Math.round((now - new Date(salesMaxAtIso).getTime()) / 60000)) : null;

    return NextResponse.json({
      ok: true,
      mid,
      supplier: supplierFilter ?? "ALL",
      requestedDays,
      baseDays,
      windows,
      skus: supplierSkus.length,
      rows,
      freshness: {
        inventoryMaxUpdatedAtIso: stock.maxUpdatedAtIso,
        inventoryAgeMinutes: invAgeMinutes,
        salesMaxAtIso,
        salesAgeMinutes,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
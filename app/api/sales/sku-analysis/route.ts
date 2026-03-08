//app/api/sales/sku-analysis/route.ts
import { NextResponse } from "next/server";
import { DATA_URL, DATA_API_KEY } from "@/lib/dataEnv";
type GqlResp<T> = { data?: T; errors?: { message: string }[] };

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  if (!DATA_URL || !DATA_API_KEY) throw new Error("Missing DATA_URL / DATA_API_KEY");

  const res = await fetch(DATA_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": DATA_API_KEY },
    body: JSON.stringify({ query, variables }),
  });

  const json = (await res.json().catch(() => ({}))) as GqlResp<T>;
  if (!res.ok || json.errors?.length) throw new Error(json.errors?.map((e) => e.message).join(" | ") || `HTTP ${res.status}`);
  return json.data as T;
}

// Keep it generator-proof: list all, filter in memory (like our snapshot builder).
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
        shippingPrice
        promoDiscount
        supplierCostExVat
        inboundShipping
        prepCost
        feeEstimateTotal
        profitExVat
      }
      nextToken
    }
  }
`;

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

function safeNum(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function normSku(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}

async function loadSupplierCostBySku(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  let nextToken: string | null = null;

  do {
    const vars: Record<string, unknown> = { limit: 1000 };
    if (nextToken) vars.nextToken = nextToken;

    const data = await gql<{ listSupplierMaps?: { items?: Array<Record<string, unknown> | null> | null; nextToken?: string | null } | null }>(LIST_SUPPLIERMAPS, vars);
    const items = data?.listSupplierMaps?.items ?? [];

    for (const it of items) {
      if (!it) continue;
      const sku = normSku(it.sku);
      if (!sku) continue;

      const unit = safeNum(it.productCost) + safeNum(it.prepCost) + safeNum(it.shippingCost);
      if (unit > 0) map.set(sku, unit);
    }

    nextToken = data?.listSupplierMaps?.nextToken ?? null;
  } while (nextToken);

  return map;
}

function withinWindow(iso: string | null | undefined, fromIso: string, toIso: string): boolean {
  if (!iso) return false;
  return iso >= fromIso && iso < toIso;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const mid = String(searchParams.get("mid") ?? "").trim();
    const sku = String(searchParams.get("sku") ?? "").trim();
    const days = searchParams.get("days");
    const from = String(searchParams.get("from") ?? "").trim();
    const to = String(searchParams.get("to") ?? "").trim();

    if (!mid) return NextResponse.json({ ok: false, error: "Missing mid" }, { status: 400 });
    if (!sku) return NextResponse.json({ ok: false, error: "Missing sku" }, { status: 400 });

    let fromIso: string;
    let toIso: string;

    if (from && to) {
      // interpret YYYY-MM-DD in local as UTC midnight bounds
      const f = new Date(`${from}T00:00:00.000Z`);
      const t = new Date(`${to}T23:59:59.999Z`);
      if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) {
        return NextResponse.json({ ok: false, error: "Invalid from/to dates" }, { status: 400 });
      }
      fromIso = f.toISOString();
      toIso = t.toISOString();
    } else {
      const d = Number(days ?? 30);
      const nDays = Number.isFinite(d) && d > 0 ? d : 30;
      const end = new Date();
      const start = new Date(end.getTime() - nDays * 24 * 3600_000);
      fromIso = start.toISOString();
      toIso = end.toISOString();
    }

    // Load all sales lines (paged) and filter.
    const supplierCostBySku = await loadSupplierCostBySku();
    let nextToken: string | null = null;
    const all: any[] = [];

    do {
      const vars: Record<string, unknown> = { limit: 500 };
      if (nextToken) vars.nextToken = nextToken;

      const data = await gql<any>(LIST_SALESLINES, vars);

      const page = data?.listSalesLines?.items ?? [];
      for (const it of page) if (it) all.push(it);

      nextToken = data?.listSalesLines?.nextToken ?? null;
    } while (nextToken);

    const lines = all.filter(
      (x) =>
        String(x.marketplaceId ?? "") === mid &&
        normSku(x.sku) === normSku(sku) &&
        withinWindow(String(x.shippedAtIso ?? x.purchaseAtIso ?? ""), fromIso, toIso)
    );

    const series = lines
      .map((x) => {
        const dateIso = String(x.shippedAtIso ?? x.purchaseAtIso ?? "");
        const date = dateIso ? dateIso.slice(0, 10) : "unknown";

        const revenueExVat =
          safeNum(x.itemPrice) + safeNum(x.shippingPrice) - safeNum(x.promoDiscount);

        const qty = Math.max(1, safeNum(x.qty));
        const unitCost =
          (Number.isFinite(Number(x.supplierCostExVat)) ? Number(x.supplierCostExVat) : null) ??
          supplierCostBySku.get(normSku(x.sku)) ??
          0;

        const supplierCostLine = unitCost * qty;
        const inbound = safeNum(x.inboundShipping);
        const prep = safeNum(x.prepCost);
        const fees = safeNum(x.feeEstimateTotal);

        const costs = supplierCostLine + inbound + prep + fees;

        // Always recompute from current inputs so fee updates are reflected immediately.
        const profit = revenueExVat - costs;

        // For chart we want a Ã¢â‚¬Å“sale priceÃ¢â‚¬Â proxy:
        // If itemPrice exists, use that; else use revenueExVat.
        const price = Number.isFinite(Number(x.itemPrice)) && x.itemPrice != null ? Number(x.itemPrice) : revenueExVat;

        return {
          date,
          orderId: x.orderId,
          qty: x.qty,
          price,
          profit,
          currency: x.currency,
        };
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    return NextResponse.json({
      ok: true,
      mid,
      sku,
      fromIso,
      toIso,
      count: series.length,
      series,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}


//app/api/sales/reports/fba-invoicing/download/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { DATA_URL, DATA_API_KEY } from "@/lib/dataEnv";
import { spapi, downloadAndDecryptReportDocument, parseTsv, decodeReportText } from "@/app/api/sales/reports/_spapi";
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

const GET_SETTINGS = /* GraphQL */ `
  query GetAppSettings($id: ID!) {
    getAppSettings(id: $id) {
      id
      reportPendingByKeyJson
      reportLastSuccessByKeyJson
      reportBackfillDays
    }
  }
`;

const PUT_SETTINGS = /* GraphQL */ `
  mutation UpdateAppSettings($input: UpdateAppSettingsInput!) {
    updateAppSettings(input: $input) {
      id
      reportPendingByKeyJson
      reportLastSuccessByKeyJson
      reportBackfillDays
    }
  }
`;

const CREATE_SALESLINE = /* GraphQL */ `
  mutation CreateSalesLine($input: CreateSalesLineInput!) {
    createSalesLine(input: $input) { marketplaceId orderId sku }
  }
`;

const LIST_SUPPLIERMAP = /* GraphQL */ `
  query ListSupplierMap($filter: ModelSupplierMapFilterInput, $limit: Int) {
    listSupplierMaps(filter: $filter, limit: $limit) {
      items { sku shortTitle productCost shippingCost prepCost updatedAtIso }
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

function nowIso() {
  return new Date().toISOString();
}

function parseIso(s: string): number {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
}

function addHoursIso(iso: string, hours: number) {
  const t = parseIso(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t + hours * 3600_000).toISOString();
}

function clampToMaxDays(fromIso: string, toIso: string, maxDays: number): { fromIso: string; toIso: string; clipped: boolean } {
  const a = parseIso(fromIso);
  const b = parseIso(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return { fromIso, toIso, clipped: false };

  const maxMs = maxDays * 86400_000;
  if (b - a <= maxMs) return { fromIso, toIso, clipped: false };

  return { fromIso, toIso: new Date(a + maxMs).toISOString(), clipped: true };
}

function subtractDaysIso(days: number) {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

function numMaybe(s: any): number | null {
  const n = Number(String(s ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

function toIsoMaybe(s: any): string | null {
  const t = String(s ?? "").trim();
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function pick(r: Record<string, string>, ...names: string[]): string {
  for (const n of names) {
    if (n in r) return String(r[n] ?? "").trim();
    const lower = n.toLowerCase();
    const hit = Object.keys(r).find((k) => k.toLowerCase() === lower);
    if (hit) return String(r[hit] ?? "").trim();
  }
  return "";
}

/**
 * Map row from GET_AMAZON_FULFILLED_SHIPMENTS_DATA_INVOICING into your SalesLine shape.
 * We only rely on a minimal set of fields that are commonly present.
 */
function rowToSalesLineInput(mid: string, row: Record<string, string>, sm: any) {
  const orderId = pick(row, "amazon-order-id", "amazon order id", "order-id", "order id");
  const sku = pick(row, "merchant-sku", "merchant sku", "sku");
  const title = pick(row, "title", "product-name", "product name");

  // Dates (varies a bit across exports)
  const purchaseAtIso =
    toIsoMaybe(pick(row, "purchase-date", "purchase date")) ??
    toIsoMaybe(pick(row, "order-date", "order date")) ??
    null;

  const shippedAtIso =
    toIsoMaybe(pick(row, "shipment-date", "shipment date")) ??
    toIsoMaybe(pick(row, "shipped-date", "shipped date")) ??
    null;

  const reportingAtIso =
    toIsoMaybe(pick(row, "reporting-date", "reporting date")) ??
    null;

  const currency = pick(row, "currency", "currency-code", "currency code") || "GBP";

  // Quantity
  const qtyRaw =
    pick(row, "dispatched-quantity", "dispatched quantity") ||
    pick(row, "quantity", "quantity-shipped", "quantity shipped") ||
    "1";
  const qty = Math.max(1, Math.trunc(Number(qtyRaw) || 1));

  // Money fields Ã¢â‚¬â€ name variations exist. We map the common Ã¢â‚¬Å“item price/tax + delivery price/tax + promo discountÃ¢â‚¬Â
  const itemPrice = numMaybe(pick(row, "item-price", "item price"));
  const itemTax = numMaybe(pick(row, "item-tax", "item tax"));
  const shippingPrice = numMaybe(pick(row, "delivery-price", "delivery price", "shipping-price", "shipping price"));
  const shippingTax = numMaybe(pick(row, "delivery-tax", "delivery tax", "shipping-tax", "shipping tax"));
  const promoDiscount = numMaybe(pick(row, "promotion-discount", "promotion discount", "promo-discount", "promo discount"));
  const promoDiscountTax = numMaybe(pick(row, "promotion-discount-tax", "promotion discount tax", "promo-discount-tax", "promo discount tax"));

  return {
    marketplaceId: mid,
    orderId,
    sku,
    currency,
    qty,

    purchaseAtIso,
    shippedAtIso,
    reportingAtIso,

    listingTitle: title || null,

    itemPrice,
    itemTax,
    shippingPrice,
    shippingTax,
    promoDiscount,
    promoDiscountTax,

    shortTitle: sm?.shortTitle ?? null,

    supplierCostExVat: sm?.productCost ?? null,
    inboundShipping: sm?.shippingCost ?? null,
    prepCost: sm?.prepCost ?? null,
  };
}

export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const mid = String(searchParams.get("mid") ?? "").trim();
    if (!mid) return NextResponse.json({ ok: false, error: "Missing mid" }, { status: 400 });

    // Optional explicit window (recommended for 60d backfill chunks)
    const fromQ = String(searchParams.get("from") ?? "").trim(); // ISO or YYYY-MM-DD
    const toQ = String(searchParams.get("to") ?? "").trim();

    // Load scheduler state
    const s = await gql<{ getAppSettings: any }>(GET_SETTINGS, { id: "global" });
    const settings = s?.getAppSettings ?? {};
    const pending = safeJson<Record<string, any>>(settings.reportPendingByKeyJson ?? "{}", {});
    const lastSuccess = safeJson<Record<string, string>>(settings.reportLastSuccessByKeyJson ?? "{}", {});
    const backfillDays = Number(settings.reportBackfillDays ?? 60) || 60;

    const key = `SALES_FBA_INVOICING:${mid}`;

    // If pending, poll + ingest
    if (pending[key]?.reportId) {
      const reportId = String(pending[key].reportId);
      const rep = await spapi<any>(`/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`, "GET");
      const status = String(rep?.processingStatus ?? "");

      if (status === "IN_QUEUE" || status === "IN_PROGRESS") {
        return NextResponse.json({ ok: true, mid, key, status, reportId });
      }

      if (status !== "DONE") {
        delete pending[key];
        await gql(PUT_SETTINGS, {
          input: { id: "global", reportPendingByKeyJson: JSON.stringify(pending) },
        });
        return NextResponse.json({ ok: false, mid, key, status, reportId, error: "Report not DONE" }, { status: 500 });
      }

      const docId = String(rep?.reportDocumentId ?? "").trim();
      if (!docId) throw new Error("DONE but missing reportDocumentId");

      const doc = await spapi<any>(`/reports/2021-06-30/documents/${encodeURIComponent(docId)}`, "GET");
      const buf = await downloadAndDecryptReportDocument(doc);

      const text = decodeReportText(buf);
      const { rows } = parseTsv(text);

      // SupplierMap cache (cheap)
      const smCache = new Map<string, any>();

      let inserted = 0;
      let skipped = 0;

      for (const row of rows) {
        const orderId = pick(row, "amazon-order-id", "amazon order id", "order-id", "order id");
        const sku = pick(row, "merchant-sku", "merchant sku", "sku");
        if (!orderId || !sku) continue;

        // supplier map per sku
        let sm = smCache.get(sku);
        if (!smCache.has(sku)) {
          const smRes = await gql<{ listSupplierMaps: { items: any[] } }>(LIST_SUPPLIERMAP, {
            filter: { sku: { eq: sku } },
            limit: 1,
          });
          sm = smRes?.listSupplierMaps?.items?.[0] ?? null;
          smCache.set(sku, sm);
        }

        const input = rowToSalesLineInput(mid, row, sm);

        try {
          await gql(CREATE_SALESLINE, { input });
          inserted++;
        } catch (e: any) {
          const msg = String(e?.message ?? e);
          if (msg.toLowerCase().includes("conditional request failed")) {
            skipped++;
            continue;
          }
          // keep going (donÃ¢â‚¬â„¢t kill entire run)
          skipped++;
        }
      }

      // mark success window end and clear pending
      const toIso = String(pending[key]?.toIso ?? nowIso());
      lastSuccess[key] = toIso;
      delete pending[key];

      await gql(PUT_SETTINGS, {
        input: {
          id: "global",
          reportPendingByKeyJson: JSON.stringify(pending),
          reportLastSuccessByKeyJson: JSON.stringify(lastSuccess),
        },
      });

      return NextResponse.json({
        ok: true,
        mid,
        key,
        status: "INGESTED",
        reportId,
        rows: rows.length,
        inserted,
        skipped,
      });
    }

    // No pending: request a report
    const toIso = toQ ? new Date(toQ).toISOString() : nowIso();

    // Determine fromIso
    const last = String(lastSuccess[key] ?? "").trim();
    let fromIso =
      fromQ
        ? new Date(fromQ).toISOString()
        : last
          ? addHoursIso(last, -2) // small overlap
          : subtractDaysIso(backfillDays);

    // IMPORTANT: FBA invoicing report windows are typically limited (safe cap 30 days)
    const clipped = clampToMaxDays(fromIso, toIso, 30);
    fromIso = clipped.fromIso;

    const reportType = "GET_AMAZON_FULFILLED_SHIPMENTS_DATA_INVOICING";

    const created = await spapi<any>("/reports/2021-06-30/reports", "POST", {
      reportType,
      dataStartTime: fromIso,
      dataEndTime: clipped.toIso,
      marketplaceIds: [mid],
    });

    const reportId = String(created?.reportId ?? "").trim();
    if (!reportId) throw new Error("createReport returned no reportId");

    pending[key] = {
      reportId,
      reportType,
      createdAtIso: nowIso(),
      fromIso,
      toIso: clipped.toIso,
      clipped: clipped.clipped,
      requestedToIso: toIso,
    };

    await gql(PUT_SETTINGS, {
      input: {
        id: "global",
        reportPendingByKeyJson: JSON.stringify(pending),
      },
    });

    return NextResponse.json({
      ok: true,
      mid,
      key,
      status: "REQUESTED",
      reportId,
      fromIso,
      toIso: clipped.toIso,
      clipped: clipped.clipped,
      requestedToIso: toIso,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}


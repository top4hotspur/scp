// app/api/sales/reports/orders/download/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from "next/server";
import { gql } from "@/lib/appsyncGql"; 
import { spapi, downloadAndDecryptReportDocument, parseTsv, decodeReportText } from "@/app/api/sales/reports/_spapi";

export const runtime = "nodejs";
type GqlResp<T> = { data?: T; errors?: { message: string }[] };



const GET_SETTINGS = /* GraphQL */ `
  query GetAppSettings($id: ID!) {
    getAppSettings(id: $id) {
      id
      reportPendingByKeyJson
      reportLastSuccessByKeyJson
      reportBackfillDays
      inventoryLastRunByKeyJson
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
      inventoryLastRunByKeyJson
    }
  }
`;

const INTROSPECT_CREATE_SALESLINE_INPUT = /* GraphQL */ `
  query IntrospectCreateSalesLineInput {
    __type(name: "CreateSalesLineInput") {
      name
      inputFields {
        name
        type {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
            }
          }
        }
      }
    }
  }
`;

function unwrapType(t: any): { base: string; nonNull: boolean } {
  // Handles: NON_NULL -> (SCALAR/INPUT_OBJECT) -> name
  if (!t) return { base: "Unknown", nonNull: false };
  if (t.kind === "NON_NULL") {
    const inner = unwrapType(t.ofType);
    return { base: inner.base, nonNull: true };
  }
  if (t.name) return { base: String(t.name), nonNull: false };
  if (t.ofType) return unwrapType(t.ofType);
  return { base: "Unknown", nonNull: false };
}

let _cachedSalesLineInputSpec: null | { requiredStringFields: string[]; fieldNames: Set<string> } = null;

async function getSalesLineInputSpec(): Promise<{ requiredStringFields: string[]; fieldNames: Set<string> }> {
  if (_cachedSalesLineInputSpec) return _cachedSalesLineInputSpec;

  const r = await gql<any>(INTROSPECT_CREATE_SALESLINE_INPUT);
  const fields = r?.__type?.inputFields ?? [];

  const requiredStringFields: string[] = [];
  const fieldNames = new Set<string>();

  for (const f of fields) {
    const name = String(f?.name ?? "");
    if (!name) continue;
    fieldNames.add(name);

    const u = unwrapType(f?.type);
    if (u.nonNull && u.base === "String") requiredStringFields.push(name);
  }

  _cachedSalesLineInputSpec = { requiredStringFields, fieldNames };
  return _cachedSalesLineInputSpec;
}

function yyyyMmDd(iso: string | null | undefined): string | null {
  const t = String(iso ?? "").trim();
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// Fill required String! fields *only if they exist in schema* and are missing/null
function fillRequiredStrings(
  input: any,
  requiredStringFields: string[],
  mid: string
) {
  const purchaseDay = yyyyMmDd(input.purchaseAtIso) ?? yyyyMmDd(input.reportingAtIso) ?? yyyyMmDd(nowIso());
  const regionGuess = mid === "A1F83G8C2ARO7P" ? "UK" : "EU";

  for (const f of requiredStringFields) {
    const v = input[f];
    if (v !== null && v !== undefined && String(v).trim() !== "") continue;

    const key = f.toLowerCase();

    // Common required fields (guess + keep stable)
    if (key.includes("region")) input[f] = regionGuess;
    else if (key.includes("source") || key.includes("stream")) input[f] = "ORDERS";
    else if (key.includes("bucket") || key.includes("period")) input[f] = "ORDERS";
    else if (key.includes("day") || key.includes("date")) input[f] = purchaseDay ?? "1970-01-01";
    else if (key.includes("skukey")) input[f] = `${mid}#${input.sku ?? ""}`;
    else if (key.includes("orderkey")) input[f] = `${mid}#${input.orderId ?? ""}`;
    else if (key.includes("pk") || key.includes("key")) input[f] = `${mid}#${input.orderId ?? ""}#${input.sku ?? ""}`;
    else input[f] = "UNKNOWN"; // fallback: non-null string
  }

  return input;
}

const CREATE_SALESLINE = /* GraphQL */ `
  mutation CreateSalesLine($input: CreateSalesLineInput!) {
    createSalesLine(input: $input) { marketplaceId orderId sku }
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

function addHoursIso(iso: string, hours: number) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t + hours * 3600_000).toISOString();
}

function subtractDaysIso(days: number) {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

function subtractMinutesIso(iso: string, mins: number) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t - mins * 60_000).toISOString();
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

function londonDayStartIso(now = new Date()): string {
  // Find the UTC instant that corresponds to 00:00 in Europe/London for "today"
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";

  // start with a UTC guess, then iteratively correct until London local time is 00:00 on that date
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

const MARKETPLACE_BY_DOMAIN: Record<string, string> = {
  "amazon.co.uk": "A1F83G8C2ARO7P",
  "amazon.de": "A1PA6795UKMFR9",
  "amazon.fr": "A13V1IB3VIYZZH",
  "amazon.it": "APJ6JRA9NG5V4",
  "amazon.es": "A1RKKUPIHCS9HS",
  "amazon.nl": "A1805IZSGTT6HS",
  "amazon.se": "A2NODRKZP88ZB9",
  "amazon.pl": "A1C3SOZRARQ6R3",
  "amazon.com.be": "AMEN7PMS3EDWL",
  "amazon.ie": "A28R8C7NBKEWEA",
};

function inferMarketplaceId(defaultMid: string, r: Record<string, string>): string {
  const channelRaw =
    r["sales-channel"] ||
    r["sales channel"] ||
    r["sales_channel"] ||
    r["saleschannel"] ||
    "";

  const channel = String(channelRaw).trim().toLowerCase();
  if (!channel) return defaultMid;

  for (const [domain, mid] of Object.entries(MARKETPLACE_BY_DOMAIN)) {
    if (channel.includes(domain)) return mid;
  }

  return defaultMid;
}

// Map TSV row -> SalesLine input (unshipped: shippedAtIso stays null)
function toSalesLineInput(mid: string, r: Record<string, string>) {
  const orderId = r["amazon-order-id"] || r["Amazon Order Id"] || r["amazon order id"] || "";
  const sku = r["sku"] || r["merchant-sku"] || r["Merchant SKU"] || r["merchant sku"] || "";
  const qty = r["quantity"] || r["quantity-purchased"] || r["Quantity"] || r["quantity purchased"] || "1";

  const purchaseDate = r["purchase-date"] || r["Purchase Date"] || r["purchase date"] || "";
  const lastUpdate = r["last-updated-date"] || r["Last Updated Date"] || r["last updated date"] || "";

  const orderStatus = r["order-status"] || r["Order Status"] || r["order status"] || "";
  const itemStatus = r["item-status"] || r["Item Status"] || r["item status"] || "";

  const isCanceled =
    String(orderStatus).toLowerCase() === "canceled" ||
    String(orderStatus).toLowerCase() === "cancelled" ||
    String(itemStatus).toLowerCase() === "canceled" ||
    String(itemStatus).toLowerCase() === "cancelled";

  // Price fields vary; we at least capture item price if present
  const itemPrice =
    r["item-price"] ||
    r["Item Price"] ||
    r["item price"] ||
    r["item-price-amount"] ||
    r["item price amount"] ||
    "";

  const currency =
    r["currency"] || r["Currency"] || r["currency-code"] || r["currency code"] || "GBP";

  const title = r["product-name"] || r["Product Name"] || r["title"] || r["Title"] || null;

  return {
    marketplaceId: inferMarketplaceId(mid, r),
    orderId: String(orderId).trim(),
    sku: String(sku).trim(),
    qty: Math.max(1, Math.trunc(Number(qty) || 1)),
    currency: String(currency).trim() || "GBP",

    purchaseAtIso: toIsoMaybe(purchaseDate) ?? toIsoMaybe(lastUpdate),
    reportingAtIso: toIsoMaybe(lastUpdate),
    

    listingTitle: title ? String(title).trim() : null,
    itemPrice: numMaybe(itemPrice),

    orderStatus: orderStatus ? String(orderStatus).trim() : null,
    isCanceled,
  };
}

export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const mid = String(searchParams.get("mid") ?? "").trim();
    if (!mid) return NextResponse.json({ ok: false, error: "Missing mid" }, { status: 400 });

    // Load settings
    const s = await gql<{ getAppSettings: any }>(GET_SETTINGS, { id: "global" });
    const settings = s?.getAppSettings ?? {};
    const pending = safeJson<Record<string, any>>(settings.reportPendingByKeyJson ?? "{}", {});
    const lastSuccess = safeJson<Record<string, string>>(settings.reportLastSuccessByKeyJson ?? "{}", {});
    const runMap = safeJson<Record<string, string>>(settings.inventoryLastRunByKeyJson ?? "{}", {});
    const backfillDays = Number(settings.reportBackfillDays ?? 60) || 60;

    const key = `SALES_ORDERS:${mid}`;
    const runKey = `SALES:${mid}`;
    const now = nowIso();
    runMap[runKey] = now;

    // If a report is pending, poll it
    if (pending[key]?.reportId) {
      const pendingInfo = pending[key] ?? {};
      const reportId = String(pendingInfo.reportId);

      const rep = await spapi<any>(`/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`, "GET");
      const status = String(rep?.processingStatus ?? "");

      if (status === "IN_QUEUE" || status === "IN_PROGRESS") {
        await gql(PUT_SETTINGS, {
          input: {
            id: "global",
            reportPendingByKeyJson: JSON.stringify(pending),
            inventoryLastRunByKeyJson: JSON.stringify(runMap),
          },
        }).catch(() => null);

        return NextResponse.json({ ok: true, mid, key, status, reportId });
      }

      if (status !== "DONE") {
        // Clear pending on terminal failure
        delete pending[key];
        await gql(PUT_SETTINGS, {
          input: {
            id: "global",
            reportPendingByKeyJson: JSON.stringify(pending),
            inventoryLastRunByKeyJson: JSON.stringify(runMap),
          },
        });
        return NextResponse.json(
          { ok: false, mid, key, status, reportId, error: "Report not DONE" },
          { status: 500 }
        );
      }

      const docId = String(rep?.reportDocumentId ?? "").trim();
      if (!docId) throw new Error("DONE but missing reportDocumentId");

      const doc = await spapi<any>(`/reports/2021-06-30/documents/${encodeURIComponent(docId)}`, "GET");
      const buf = await downloadAndDecryptReportDocument(doc);

      const text = decodeReportText(buf);
      const { rows } = parseTsv(text);

      if (!rows.length) {
        // Return tiny preview to diagnose format (TSV vs CSV vs XML error vs UTF16 etc)
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
        const firstLine = lines[0] ?? "";
        const preview = text.slice(0, 500);

        // Clear pending so next call can request again after we adjust
        delete pending[key];
        await gql(PUT_SETTINGS, {
          input: {
            id: "global",
            reportPendingByKeyJson: JSON.stringify(pending),
            inventoryLastRunByKeyJson: JSON.stringify(runMap),
          },
        });

        return NextResponse.json(
          {
            ok: false,
            mid,
            key,
            status: "EMPTY_OR_UNPARSEABLE",
            reportId,
            docInfo: {
              compressionAlgorithm: doc?.compressionAlgorithm ?? null,
              hasEncryption: Boolean(doc?.encryptionDetails?.key),
              bytes: buf.length,
            },
            firstLine,
            preview,
          },
          { status: 500 }
        );
      }

      let inserted = 0;
      let skipped = 0;
      let errorCount = 0;
      const rowErrors: any[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const input = toSalesLineInput(mid, row);

        if (!input.orderId || !input.sku) {
          skipped++;
          continue;
        }

        try {
          const spec = await getSalesLineInputSpec();

const base = input as Record<string, any>;

// Only send fields that exist in CreateSalesLineInput (prevents Ã¢â‚¬Å“unknown fieldÃ¢â‚¬Â errors)
const pruned: Record<string, any> = {};
for (const k of Object.keys(base)) {
  if (spec.fieldNames.has(k)) pruned[k] = base[k];
}

// Fill required String! fields that schema demands
fillRequiredStrings(pruned, spec.requiredStringFields, mid);

await gql(CREATE_SALESLINE, { input: pruned });
          inserted++;
        } catch (e: any) {
          const msg = String(e?.message ?? e);
          // add a tiny hint of which required fields are still null
try {
  const spec = await getSalesLineInputSpec();
  const missing = spec.requiredStringFields.filter((f) => {
    const v = (input as any)[f];
    return v === null || v === undefined || String(v).trim() === "";
  });
  if (missing.length) {
    // tack on to message (keeps your output compact)
    // eslint-disable-next-line no-unused-vars
    const _hint = missing.slice(0, 10).join(",");
  }
} catch {
  // ignore introspection failures
}

          // Normal idempotency case
          if (msg.toLowerCase().includes("conditional request failed")) {
            skipped++;
            continue;
          }

          // Real error Ã¢â‚¬â€ surface it
          errorCount++;
          skipped++;

          if (rowErrors.length < 25) {
            rowErrors.push({
              row: i + 1,
              orderId: input.orderId,
              sku: input.sku,
              error: msg,
              orderStatus: row["order-status"] ?? row["order status"] ?? null,
              itemStatus: row["item-status"] ?? row["item status"] ?? null,
            });
          }
        }
      }

      // Mark success window and clear pending
      const toIso = String(pendingInfo?.toIso ?? nowIso());
      lastSuccess[key] = toIso;
      lastSuccess[runKey] = toIso;

      delete pending[key];
      await gql(PUT_SETTINGS, {
        input: {
          id: "global",
          reportPendingByKeyJson: JSON.stringify(pending),
          reportLastSuccessByKeyJson: JSON.stringify(lastSuccess),
          inventoryLastRunByKeyJson: JSON.stringify(runMap),
        },
      });

      return NextResponse.json({
        ok: true,
        mid,
        key,
        status: "INGESTED",
        reportId,
        reportType: String(pendingInfo?.reportType ?? ""),
        fromIso: String(pendingInfo?.fromIso ?? ""),
        toIso: String(pendingInfo?.toIso ?? ""),
        rows: rows.length,
        inserted,
        skipped,
        errorCount,
        rowErrors,
        header: Object.keys(rows[0] ?? {}).slice(0, 40),
        sample: rows.slice(0, 3),
      });
    }

    // No pending: request a report window
    const toIso = nowIso();

    // Incremental window from last successful ingest with small overlap to avoid misses.
    const overlapMinutes = 15;
    const fromIso = (() => {
      const last = String(lastSuccess[key] ?? "").trim();
      if (last) return subtractMinutesIso(last, overlapMinutes);
      return subtractDaysIso(backfillDays);
    })();

    const reportType = "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL";

    const created = await spapi<any>("/reports/2021-06-30/reports", "POST", {
      reportType,
      dataStartTime: fromIso,
      dataEndTime: toIso,
      marketplaceIds: [mid],
    });

    const reportId = String(created?.reportId ?? "").trim();
    if (!reportId) throw new Error("createReport returned no reportId");

    pending[key] = { reportId, reportType, createdAtIso: nowIso(), fromIso, toIso };

    await gql(PUT_SETTINGS, {
      input: {
        id: "global",
        reportPendingByKeyJson: JSON.stringify(pending),
        inventoryLastRunByKeyJson: JSON.stringify(runMap),
      },
    });

    return NextResponse.json({ ok: true, mid, key, status: "REQUESTED", reportId, fromIso, toIso, backfillDays, overlapMinutes });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

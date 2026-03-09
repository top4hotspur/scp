// app/api/clean/all-listings/ingest/route.ts
import { NextResponse } from "next/server";
import zlib from "node:zlib";
import { spapiFetch } from "@/lib/spapi/request";
import { DATA_URL, DATA_API_KEY } from "@/lib/dataEnv";
type GqlResp<T> = { data?: T; errors?: { message: string }[] };

async function gql<T>(query: string, variables?: any): Promise<T> {
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

// NOTE: We are automating via Reports API.
// ReportType for this file format is typically merchant listings all data.
const REPORT_TYPE = "GET_MERCHANT_LISTINGS_ALL_DATA";

const GET_SETTINGS = /* GraphQL */ `
  query GetAppSettings($id: ID!) {
    getAppSettings(id: $id) {
      id
      reportPendingByKeyJson
      reportLastSuccessByKeyJson
    }
  }
`;

const PUT_SETTINGS = /* GraphQL */ `
  mutation UpdateAppSettings($input: UpdateAppSettingsInput!) {
    updateAppSettings(input: $input) {
      id
      reportPendingByKeyJson
      reportLastSuccessByKeyJson
    }
  }
`;

const LIST_STRANDED_ISSUES = /* GraphQL */ `
  query ListCleanListingIssues($limit: Int, $nextToken: String, $filter: ModelCleanListingIssueFilterInput) {
    listCleanListingIssues(limit: $limit, nextToken: $nextToken, filter: $filter) {
      items { marketplaceId sku issueType }
      nextToken
    }
  }
`;

async function listAll<TItem>(query: string, rootKey: string, variables: any): Promise<TItem[]> {
  const out: TItem[] = [];
  let nextToken: string | null = null;

  while (true) {
    const data = (await gql<any>(query, { ...variables, limit: 1000, nextToken })) as any;
    const page = data?.[rootKey];
    const items = Array.isArray(page?.items) ? page.items : [];
    out.push(...items);
    nextToken = page?.nextToken ?? null;
    if (!nextToken) break;
  }
  return out;
}

async function getStrandedSkus(mid: string): Promise<Set<string>> {
  try {
    const issues = await listAll<any>(LIST_STRANDED_ISSUES, "listCleanListingIssues", {
      filter: { marketplaceId: { eq: mid }, issueType: { eq: "STRANDED" } },
    });
    return new Set(issues.map((x) => normSku(x?.sku)).filter(Boolean));
  } catch {
    // Never fail ingest because overlay read failed
    return new Set<string>();
  }
}

const CREATE_LISTING = /* GraphQL */ `
  mutation CreateCleanListing($input: CreateCleanListingInput!) {
    createCleanListing(input: $input) { id }
  }
`;

const UPDATE_LISTING = /* GraphQL */ `
  mutation UpdateCleanListing($input: UpdateCleanListingInput!) {
    updateCleanListing(input: $input) { id }
  }
`;

const CREATE_SNAPSHOT = /* GraphQL */ `
  mutation CreateCleanListingSnapshot($input: CreateCleanListingSnapshotInput!) {
    createCleanListingSnapshot(input: $input) { marketplaceId bucket createdAtIso }
  }
`;

const UPDATE_SNAPSHOT = /* GraphQL */ `
  mutation UpdateCleanListingSnapshot($input: UpdateCleanListingSnapshotInput!) {
    updateCleanListingSnapshot(input: $input) { marketplaceId bucket createdAtIso }
  }
`;

// You will add these models in amplify/data/resource.ts in the next step (IÃ¢â‚¬â„¢ll give that patch next).
// For now, createCleanListing / createCleanListingSnapshot will fail until schema is added.

function parseTsv(text: string): { header: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return { header: [], rows: [] };

  // Some exports begin with BOM
  const headLine = lines[0].replace(/^\uFEFF/, "");
  const header = headLine.split("\t").map((s) => s.trim());

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split("\t");
    const obj: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = String(parts[c] ?? "");
    rows.push(obj);
  }
  return { header, rows };
}

function nowIso() {
  return new Date().toISOString();
}

function parseWaitSeconds(v: string | null, def = 20) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(2, Math.min(120, Math.floor(n)));
}

function safeJson<T>(s: unknown, fallback: T): T {
  try {
    const v = typeof s === "string" ? JSON.parse(s) : s;
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function normSku(x: any): string {
  // Normalize across ALL sources (SP-API report text + CSV uploads + GraphQL)
  return String(x ?? "")
    .replace(/^\uFEFF/, "")                 // BOM
    .replace(/\u00A0/g, " ")                // NBSP
    .replace(/[\u200B-\u200D\uFEFF]/g, "")  // zero-width chars
    .replace(/[\s\r\n\t]+/g, " ")           // collapse whitespace
    .trim();
}

function normBucketFromRow(rawStatus: string, row: Record<string, string>) {
  const s = String(rawStatus || "").trim();
  const lower = (x: any) => String(x ?? "").toLowerCase();

  // quantity sometimes blank; treat blank as unknown not zero
  const qtyRaw =
    row["quantity"] ??
    row["qty"] ??
    row["available"] ??
    row["available-quantity"] ??
    "";

  const qtyNum = Number(String(qtyRaw).trim());
  const hasQtyNum = Number.isFinite(qtyNum);

  // Build a "signal blob" from common report columns (if present)
  const blob = [
    row["status"],
    row["listing-status"],
    row["item-note"],
    row["notes"],
    row["reason"],
    row["issue"],
    row["issue-code"],
    row["issue-description"],
    row["listing-quality-issues"],
    row["suppressed"],
    row["search-suppressed"],
    row["suppression-reason"],
    row["product-id"],
    row["fulfillment-channel"],
    row["item-name"],
  ]
    .map((x) => lower(x))
    .filter(Boolean)
    .join(" | ");

  // Active stays Active (no reason)
  if (s.toLowerCase() === "active") {
    return { bucket: "Active", code: "", reason: "" };
  }

  // Everything else we treat as "some kind of not-sellable"
  // 1) Out of stock:
// Only mark as Out of Stock when rawStatus is NOT explicitly Inactive.
// If Amazon says Inactive, keep it Inactive (until we learn a stronger reason from other reports).
if (hasQtyNum && qtyNum === 0 && s.toLowerCase() !== "inactive") {
  return { bucket: "Out of Stock", code: "OUT_OF_STOCK", reason: "Out of Stock" };
}

  // 2) Search suppressed
  if (blob.includes("search suppressed") || blob.includes("search-suppressed") || blob.includes("suppressed")) {
    return { bucket: "Search suppressed", code: "SEARCH_SUPPRESSED", reason: "Search suppressed" };
  }

  // 3) Improve listing quality
  if (blob.includes("improve listing quality") || blob.includes("listing quality")) {
    return { bucket: "Improve listing quality", code: "IMPROVE_LISTING_QUALITY", reason: "Improve listing quality" };
  }

  // 4) Detail page removed
  if (blob.includes("detail page removed") || blob.includes("detail-page-removed")) {
    return { bucket: "Detail Page Removed", code: "DETAIL_PAGE_REMOVED", reason: "Detail Page Removed" };
  }

  // 5) Approval required / restricted
  if (blob.includes("approval required") || blob.includes("restricted") || blob.includes("requires approval")) {
    return { bucket: "Approval Required", code: "APPROVAL_REQUIRED", reason: "Approval Required" };
  }

  // 6) Fulfillment issue
  if (blob.includes("fulfillment") && (blob.includes("issue") || blob.includes("error") || blob.includes("problem"))) {
    return { bucket: "Fulfillment issue", code: "FULFILLMENT_ISSUE", reason: "Fulfillment issue" };
  }

  // Default inactive bucket
  return { bucket: "Inactive", code: "INACTIVE", reason: "Inactive" };
}

async function upsertListing(input: any) {
  try {
    await gql<any>(CREATE_LISTING, { input });
  } catch {
    await gql<any>(UPDATE_LISTING, { input });
  }
}

async function upsertSnapshot(input: any) {
  try {
    await gql<any>(CREATE_SNAPSHOT, { input });
  } catch {
    await gql<any>(UPDATE_SNAPSHOT, { input });
  }
}

async function fetchDocumentText(url: string, compressionAlgorithm?: string | null): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download failed: HTTP ${r.status}`);

  // Some SP-API report docs are GZIP compressed.
  if (String(compressionAlgorithm ?? "").toUpperCase() === "GZIP") {
    const buf = Buffer.from(await r.arrayBuffer());
    const out = zlib.gunzipSync(buf);
    return out.toString("utf-8");
  }

  return await r.text();
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const mid = String(url.searchParams.get("mid") ?? "").trim();
    const waitSeconds = parseWaitSeconds(url.searchParams.get("waitSeconds"), 20);
    const maxRows = Math.max(50, Math.min(2000, Number(url.searchParams.get("maxRows") ?? 400)));
    const maxProcessSeconds = Math.max(5, Math.min(60, Number(url.searchParams.get("maxProcessSeconds") ?? 20)));

    if (!mid) return NextResponse.json({ ok: false, error: "Missing mid" }, { status: 400 });

    const settings = await gql<{ getAppSettings?: any }>(GET_SETTINGS, { id: "global" }).catch(() => ({ getAppSettings: null }));
    const pending = safeJson<Record<string, any>>(settings?.getAppSettings?.reportPendingByKeyJson ?? "{}", {});
    const lastSuccess = safeJson<Record<string, string>>(settings?.getAppSettings?.reportLastSuccessByKeyJson ?? "{}", {});

    const pendingKey = `LISTINGS_REPORT:${mid}`;
    const pendingInfo = pending?.[pendingKey] ?? null;
    let reportId = String(pendingInfo?.reportId ?? "").trim();

    // 1) Create report only when we do not already have one pending
    if (!reportId) {
      const created = (await spapiFetch({
        method: "POST",
        path: "/reports/2021-06-30/reports",
        body: { reportType: REPORT_TYPE, marketplaceIds: [mid] },
      })) as any;

      reportId = String(created?.reportId ?? "");
      if (!reportId) throw new Error("Missing reportId from create report");

      pending[pendingKey] = { reportId, reportType: REPORT_TYPE, createdAtIso: nowIso(), nextRow: 0 };
      await gql(PUT_SETTINGS, { input: { id: "global", reportPendingByKeyJson: JSON.stringify(pending) } }).catch(() => null);
    }

    // 2) Poll until DONE within wait budget (avoid long request timeouts on hosting)
    let report: any = null;
    const startedAt = Date.now();
    while (Date.now() - startedAt < waitSeconds * 1000) {
      report = (await spapiFetch({
        method: "GET",
        path: `/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`,
      })) as any;

      const status = String(report?.processingStatus ?? "");
      if (status === "DONE") break;
      if (status === "CANCELLED" || status === "FATAL") {
        delete pending[pendingKey];
        await gql(PUT_SETTINGS, { input: { id: "global", reportPendingByKeyJson: JSON.stringify(pending) } }).catch(() => null);
        throw new Error(`Report failed: ${status}`);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    const finalStatus = String(report?.processingStatus ?? pendingInfo?.status ?? "IN_PROGRESS");
    if (finalStatus !== "DONE") {
      pending[pendingKey] = {
        ...(pending[pendingKey] ?? {}),
        reportId,
        reportType: REPORT_TYPE,
        status: finalStatus,
        createdAtIso: String(pending?.[pendingKey]?.createdAtIso ?? nowIso()),
      };
      await gql(PUT_SETTINGS, { input: { id: "global", reportPendingByKeyJson: JSON.stringify(pending) } }).catch(() => null);

      return NextResponse.json({
        ok: true,
        mid,
        status: finalStatus,
        reportId,
        resumedPending: Boolean(pendingInfo?.reportId),
        note: "Listings report queued/in-progress. Re-run this endpoint in ~1-2 minutes to continue tracking the same report.",
      });
    }

    const reportDocumentId = String(report?.reportDocumentId ?? pendingInfo?.reportDocumentId ?? "");
    if (!reportDocumentId) throw new Error("Missing reportDocumentId");

    // 3) Get report document
    const doc = (await spapiFetch({
      method: "GET",
      path: `/reports/2021-06-30/documents/${encodeURIComponent(reportDocumentId)}`,
    })) as any;

    const downloadUrl = String(doc?.url ?? "");
    if (!downloadUrl) throw new Error("Missing document url");

    const compressionAlgorithm = doc?.compressionAlgorithm ?? null;

    // 4) Download report content
    const text = await fetchDocumentText(downloadUrl, compressionAlgorithm);
    const parsed = parseTsv(text);

    // Overlay set: SKUs currently flagged as STRANDED for this marketplace
    const strandedSkus = await getStrandedSkus(mid);

    // Build full status counts once so snapshot is correct on completion
    const countsByStatusAll: Record<string, number> = {};
    for (const r of parsed.rows) {
      const sku = normSku(String(r?.["seller-sku"] ?? "").trim());
      if (!sku) continue;
      const rawStatus = String(r?.["status"] ?? "Unknown").trim() || "Unknown";
      const norm = normBucketFromRow(rawStatus, r);
      countsByStatusAll[norm.bucket] = (countsByStatusAll[norm.bucket] ?? 0) + 1;
    }

    const get = (r: Record<string, string>, k: string) => String(r?.[k] ?? "").trim();
    const totalRows = parsed.rows.length;
    const startRow = Math.max(0, Math.min(totalRows, Number(pendingInfo?.nextRow ?? 0)));
    const chunkStarted = Date.now();

    let idx = startRow;
    let processedThisRun = 0;

    for (; idx < totalRows; idx++) {
      if (processedThisRun >= maxRows) break;
      if (Date.now() - chunkStarted >= maxProcessSeconds * 1000) break;

      const r = parsed.rows[idx];
      const sku = normSku(get(r, "seller-sku"));
      if (!sku) continue;

      const rawStatus = get(r, "status") || "Unknown";
      const norm = normBucketFromRow(rawStatus, r);

      await upsertListing({
        id: `${mid}#${sku}`,
        marketplaceId: mid,
        sku,
        title: get(r, "item-name"),
        asin: get(r, "asin1"),
        price: get(r, "price"),
        quantity: get(r, "quantity"),
        status: norm.bucket,
        rawStatus,
        inactiveReason: norm.reason || null,
        inactiveReasonCode: norm.code || null,
        fulfillmentChannel: get(r, "fulfillment-channel"),
        updatedAtIso: nowIso(),
      });

      processedThisRun++;
    }

    const nextRow = idx;
    const done = nextRow >= totalRows;

    if (!done) {
      pending[pendingKey] = {
        ...(pending[pendingKey] ?? {}),
        reportId,
        reportType: REPORT_TYPE,
        reportDocumentId,
        status: "PARTIAL",
        nextRow,
        totalRows,
        updatedAtIso: nowIso(),
      };
      await gql(PUT_SETTINGS, { input: { id: "global", reportPendingByKeyJson: JSON.stringify(pending) } }).catch(() => null);

      return NextResponse.json({
        ok: true,
        mid,
        status: "PARTIAL",
        reportId,
        reportDocumentId,
        processedThisRun,
        nextRow,
        totalRows,
        remainingRows: Math.max(0, totalRows - nextRow),
        note: "Listings ingest chunk saved. Re-run to continue from next row.",
      });
    }

    await upsertSnapshot({
      id: `${mid}#latest`,
      marketplaceId: mid,
      bucket: "latest",
      createdAtIso: nowIso(),
      total: Object.values(countsByStatusAll).reduce((a, b) => a + b, 0),
      countsByStatusJson: JSON.stringify(countsByStatusAll),
      overlayCountsJson: JSON.stringify({ STRANDED: strandedSkus.size }),
    });

    delete pending[pendingKey];
    lastSuccess[pendingKey] = nowIso();
    await gql(PUT_SETTINGS, {
      input: {
        id: "global",
        reportPendingByKeyJson: JSON.stringify(pending),
        reportLastSuccessByKeyJson: JSON.stringify(lastSuccess),
      },
    }).catch(() => null);

    return NextResponse.json({
      ok: true,
      mid,
      reportId,
      reportDocumentId,
      processedThisRun,
      totalRows,
      countsByStatus: countsByStatusAll,
      overlays: { STRANDED: strandedSkus.size },
      pendingCleared: true,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

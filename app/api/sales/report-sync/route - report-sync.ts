//app/api/sales/report-sync/route.ts
import { NextResponse } from "next/server";
import outputs from "@/amplify_outputs.json";
import { spapiFetch } from "@/lib/spapi/request";

const DATA_URL = outputs.data.url;
const DATA_API_KEY = outputs.data.api_key;

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

const UPSERT_SALESLINE = /* GraphQL */ `
  mutation UpsertSalesLine($input: CreateSalesLineInput!) {
    createSalesLine(input: $input) { marketplaceId orderId sku }
  }
`;

function parseTsvLine(line: string): string[] {
  // Order report is tab-delimited
  return line.split("\t").map((s) => s.trim());
}
function numMaybe(s: string): number | null {
  const t = (s ?? "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const mid = String(searchParams.get("mid") ?? "").trim();
    const hours = Number(searchParams.get("hours") ?? 6);

    if (!mid) return NextResponse.json({ ok: false, error: "Missing mid" }, { status: 400 });

    const end = new Date();
    const start = new Date(end.getTime() - (Number.isFinite(hours) ? hours : 6) * 3600_000);

    // 1) create report
    const create = await spapiFetch<{ reportId: string }>({
      method: "POST",
      path: "/reports/2021-06-30/reports",
      body: {
        reportType: "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL",
        marketplaceIds: [mid],
        dataStartTime: start.toISOString(),
        dataEndTime: end.toISOString(),
      },
    });

    const reportId = String((create as any)?.reportId ?? "").trim();
    if (!reportId) throw new Error("createReport did not return reportId");

    // 2) poll report status
    let docId: string | null = null;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));

      const rep = await spapiFetch<any>({
        method: "GET",
        path: `/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`,
      });

      const status = String(rep?.processingStatus ?? "");
      if (status === "DONE") {
        docId = String(rep?.reportDocumentId ?? "");
        break;
      }
      if (status === "FATAL" || status === "CANCELLED") {
        throw new Error(`Report ${reportId} failed: ${status}`);
      }
    }
    if (!docId) throw new Error("Report did not reach DONE in time");

    // 3) get document info
    const doc = await spapiFetch<any>({
      method: "GET",
      path: `/reports/2021-06-30/documents/${encodeURIComponent(docId)}`,
    });

    const url = String(doc?.url ?? "");
    if (!url) throw new Error("Report document missing url");

    // 4) download (most order reports are plain TSV; if compressionAlgorithm exists, we’ll handle later)
    const raw = await fetch(url, { cache: "no-store" }).then((r) => r.text());

    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length);
    if (lines.length < 2) return NextResponse.json({ ok: true, mid, reportId, rows: 0 });

    const header = parseTsvLine(lines[0]).map((h) => h.toLowerCase());
    const idx = (name: string) => header.indexOf(name.toLowerCase());

    // Common columns in this report (varies slightly, we’ll adapt once we see real output)
    const iOrder = idx("order-id");
    const iSku = idx("sku");
    const iQty = idx("quantity-purchased");
    const iPurchase = idx("purchase-date");
    const iStatus = idx("order-status");
    const iCurrency = idx("currency");
    const iItemPrice = idx("item-price");
    const iShipPrice = idx("shipping-price");

    if (iOrder < 0 || iSku < 0 || iQty < 0) {
      throw new Error("Order report missing required columns: order-id, sku, quantity-purchased");
    }

    let upserted = 0;
    let skipped = 0;

    for (let r = 1; r < lines.length; r++) {
      const cols = parseTsvLine(lines[r]);

      const orderId = String(cols[iOrder] ?? "").trim();
      const sku = String(cols[iSku] ?? "").trim();
      const qty = Number(cols[iQty] ?? 0);

      if (!orderId || !sku || !Number.isFinite(qty) || qty <= 0) {
        skipped++;
        continue;
      }

      const status = iStatus >= 0 ? String(cols[iStatus] ?? "").trim() : "";

      // IMPORTANT: we store status so cancel sweep can flip/remove later.
      // Snapshot builder will eventually ignore status==="Canceled"
      const input: any = {
        marketplaceId: mid,
        orderId,
        sku,
        currency: iCurrency >= 0 ? String(cols[iCurrency] ?? "").trim() || "GBP" : "GBP",
        qty: Math.trunc(qty),

        purchaseAtIso: iPurchase >= 0 ? new Date(String(cols[iPurchase] ?? "")).toISOString() : null,
        shippedAtIso: null,

        listingTitle: null,
        promoDiscount: null,

        itemPrice: iItemPrice >= 0 ? numMaybe(String(cols[iItemPrice] ?? "")) : null,
        shippingPrice: iShipPrice >= 0 ? numMaybe(String(cols[iShipPrice] ?? "")) : null,

        // you can add a field later in model for this, or keep a “status” in totalsJson only
        // orderStatus: status,
      };

      await gql(UPSERT_SALESLINE, { input });
      upserted++;
    }

    // 5) build snapshots
    const origin = new URL(req.url).origin;
    await fetch(`${origin}/api/sales/build-snapshot?mid=${encodeURIComponent(mid)}`, { method: "POST" });

    return NextResponse.json({ ok: true, mid, reportId, upserted, skipped });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
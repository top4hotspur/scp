import { NextResponse } from "next/server";
import { gql } from "@/lib/appsyncGql";

export const runtime = "nodejs";

type FeeUpdate = {
  orderId: string;
  lineId: string | null;
  sku: string | null;
  orderItemId: string | null;
  feeEstimateTotal: number;
};

type UpdateResp = {
  updateSalesLine?: {
    marketplaceId?: string | null;
    orderId?: string | null;
    lineId?: string | null;
    feeEstimateTotal?: number | null;
  } | null;
};

type SalesLineLite = {
  marketplaceId?: string | null;
  orderId?: string | null;
  lineId?: string | null;
  sku?: string | null;
  orderItemId?: string | null;
};

type ListSalesLinesResp = {
  listSalesLines?: {
    items?: (SalesLineLite | null)[] | null;
    nextToken?: string | null;
  } | null;
};

const UPDATE_SALESLINE_FEE = /* GraphQL */ `
  mutation UpdateSalesLineFee($input: UpdateSalesLineInput!) {
    updateSalesLine(input: $input) {
      marketplaceId
      orderId
      lineId
      feeEstimateTotal
    }
  }
`;

const GET_SETTINGS = /* GraphQL */ `
  query GetAppSettings($id: ID!) {
    getAppSettings(id: $id) {
      id
      inventoryLastRunByKeyJson
      reportLastSuccessByKeyJson
    }
  }
`;

const PUT_SETTINGS = /* GraphQL */ `
  mutation UpdateAppSettings($input: UpdateAppSettingsInput!) {
    updateAppSettings(input: $input) {
      id
      inventoryLastRunByKeyJson
      reportLastSuccessByKeyJson
    }
  }
`;

const LIST_SALESLINES_LITE = /* GraphQL */ `
  query ListSalesLinesLite($filter: ModelSalesLineFilterInput, $limit: Int, $nextToken: String) {
    listSalesLines(filter: $filter, limit: $limit, nextToken: $nextToken) {
      items {
        marketplaceId
        orderId
        lineId
        sku
        orderItemId
      }
      nextToken
    }
  }
`;

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeJson<T>(s: unknown, fallback: T): T {
  try {
    const v = typeof s === "string" ? JSON.parse(s) : s;
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function toOptStr(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s ? s : null;
}

function sanitizeUpdates(input: unknown): FeeUpdate[] {
  if (!Array.isArray(input)) return [];

  const out: FeeUpdate[] = [];
  for (const row of input) {
    const obj = typeof row === "object" && row ? (row as Record<string, unknown>) : {};
    const orderId = String(obj.orderId ?? "").trim();

    const feeEstimateTotal =
      toFiniteNumber(obj.feeEstimateTotal) ??
      toFiniteNumber(obj.feeTotal) ??
      toFiniteNumber(obj.estimatedFeeTotal);

    if (!orderId || feeEstimateTotal == null) continue;

    out.push({
      orderId,
      lineId: toOptStr(obj.lineId),
      sku: toOptStr(obj.sku),
      orderItemId: toOptStr(obj.orderItemId),
      feeEstimateTotal,
    });
  }

  return out;
}

async function findLineId(mid: string, u: FeeUpdate): Promise<string | null> {
  if (u.lineId) return u.lineId;

  let nextToken: string | null = null;
  do {
    const data: ListSalesLinesResp = await gql<ListSalesLinesResp>(LIST_SALESLINES_LITE, {
      filter: {
        marketplaceId: { eq: mid },
        orderId: { eq: u.orderId },
      },
      limit: 200,
      nextToken,
    });

    const items = data?.listSalesLines?.items ?? [];
    const rows: SalesLineLite[] = items.filter((x): x is SalesLineLite => Boolean(x));

    if (u.orderItemId) {
      const hit = rows.find((x) => String(x.orderItemId ?? "").trim() === u.orderItemId);
      if (hit?.lineId) return String(hit.lineId);
    }

    if (u.sku) {
      const hit = rows.find((x) => String(x.sku ?? "").trim() === u.sku);
      if (hit?.lineId) return String(hit.lineId);
    }

    if (rows.length === 1 && rows[0].lineId) {
      return String(rows[0].lineId);
    }

    nextToken = data?.listSalesLines?.nextToken ?? null;
  } while (nextToken);

  return null;
}

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const mid = String(searchParams.get("mid") ?? "").trim();

  if (!mid) {
    return NextResponse.json({ ok: false, error: "Missing mid" }, { status: 400 });
  }

  const settings = await gql<{ getAppSettings?: any }>(GET_SETTINGS, { id: "global" }).catch(() => ({ getAppSettings: null }));
  const runMap = safeJson<Record<string, string>>(settings?.getAppSettings?.inventoryLastRunByKeyJson ?? "{}", {});
  const successMap = safeJson<Record<string, string>>(settings?.getAppSettings?.reportLastSuccessByKeyJson ?? "{}", {});
  const runKey = `FEE:${mid}`;
  runMap[runKey] = new Date().toISOString();

  const body: unknown = await req.json().catch(() => ({}));
  const parsedBody = typeof body === "object" && body ? (body as Record<string, unknown>) : {};
  const updates = sanitizeUpdates(parsedBody.updates);

  // Keep scheduler behaviour stable: no-op when no fee payload was supplied.
  if (!updates.length) {
    await gql(PUT_SETTINGS, {
      input: {
        id: "global",
        inventoryLastRunByKeyJson: JSON.stringify(runMap),
      },
    }).catch(() => null);

    return NextResponse.json({
      ok: true,
      disabled: true,
      mid,
      applied: 0,
      lastAutomationAt: runMap[runKey],
      note: "Fee estimate writer is idle. Provide body.updates[] with { orderId, lineId|sku|orderItemId, feeEstimateTotal }.",
    });
  }

  let applied = 0;
  const errors: string[] = [];

  for (const u of updates) {
    const lineId = await findLineId(mid, u);
    if (!lineId) {
      errors.push(`${u.orderId}#${u.sku ?? u.orderItemId ?? "?"}: lineId not found`);
      continue;
    }

    try {
      await gql<UpdateResp>(UPDATE_SALESLINE_FEE, {
        input: {
          marketplaceId: mid,
          orderId: u.orderId,
          lineId,
          feeEstimateTotal: u.feeEstimateTotal,
        },
      });
      applied++;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push(`${u.orderId}#${lineId}: ${message}`);
    }
  }

  if (applied > 0) successMap[runKey] = new Date().toISOString();

  await gql(PUT_SETTINGS, {
    input: {
      id: "global",
      inventoryLastRunByKeyJson: JSON.stringify(runMap),
      reportLastSuccessByKeyJson: JSON.stringify(successMap),
    },
  }).catch(() => null);

  return NextResponse.json({
    ok: errors.length === 0,
    mid,
    disabled: false,
    received: updates.length,
    applied,
    failed: errors.length,
    lastAutomationAt: runMap[runKey],
    lastSuccessAt: successMap[runKey] ?? null,
    errors: errors.slice(0, 20),
  });
}

export async function GET(req: Request) {
  return POST(req);
}

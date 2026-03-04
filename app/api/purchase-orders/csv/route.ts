// app/api/purchase-orders/csv/route.ts
import { NextResponse } from "next/server";
import outputs from "@/amplify_outputs.json";

const DATA_URL = (outputs as any)?.data?.url ?? process.env.DATA_URL;
const DATA_API_KEY = (outputs as any)?.data?.api_key ?? process.env.DATA_API_KEY;

type GqlResp<T> = { data?: T; errors?: { message: string }[] };

async function gql<T>(query: string, variables?: any): Promise<T> {
  if (!DATA_URL || !DATA_API_KEY) {
    throw new Error(
      `Missing Amplify Data connection. DATA_URL=${DATA_URL ? "Y" : "N"} DATA_API_KEY=${DATA_API_KEY ? "Y" : "N"}`
    );
  }

  const res = await fetch(DATA_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": DATA_API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = (await res.json().catch(() => ({}))) as GqlResp<T>;
  if (!res.ok || json.errors?.length) {
    throw new Error(json.errors?.map((e) => e.message).join(" | ") || `HTTP ${res.status}`);
  }
  return json.data as T;
}

// ✅ THIS is the index your schema actually has:
const LINES_BY_PO = /* GraphQL */ `
  query LinesByPo($purchaseOrderId: String!, $limit: Int) {
    listPurchaseOrderLineByPurchaseOrderIdAndSku(purchaseOrderId: $purchaseOrderId, limit: $limit) {
      items {
        sku
        qty
      }
    }
  }
`;

// Optional: for labels.csv filtering
const GET_SUPPLIERMAP = /* GraphQL */ `
  query GetSupplierMap($id: ID!) {
    getSupplierMap(id: $id) {
      id
      label
    }
  }
`;

function csvEscape(v: any) {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const poId = String(searchParams.get("poId") ?? "").trim();
    const type = String(searchParams.get("type") ?? "").trim(); // manifest | labels

    if (!poId) return NextResponse.json({ ok: false, error: "Missing poId" }, { status: 400 });
    if (type !== "manifest" && type !== "labels") {
      return NextResponse.json({ ok: false, error: "type must be manifest|labels" }, { status: 400 });
    }

    const linesData = await gql<any>(LINES_BY_PO, { purchaseOrderId: poId, limit: 2000 });
    const lines = (linesData?.listPurchaseOrderLineByPurchaseOrderIdAndSku?.items ?? [])
      .map((r: any) => ({ sku: String(r?.sku ?? "").trim(), qty: Number(r?.qty ?? 0) }))
      .filter((r: any) => r.sku && Number.isFinite(r.qty) && r.qty > 0);

    let out = "sku,qty\n";

    if (type === "manifest") {
      for (const r of lines) out += `${csvEscape(r.sku)},${csvEscape(r.qty)}\n`;
    } else {
      // labels: only sku where SupplierMap.label == "y" (case-insensitive)
      for (const r of lines) {
        const sm = await gql<any>(GET_SUPPLIERMAP, { id: r.sku }).catch(() => null);
        const label = String(sm?.getSupplierMap?.label ?? "").trim().toLowerCase();
        if (label === "y") out += `${csvEscape(r.sku)},${csvEscape(r.qty)}\n`;
      }
    }

    const filename = type === "manifest" ? "manifest.csv" : "labels.csv";

    return new NextResponse(out, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
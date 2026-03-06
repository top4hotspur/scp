// app/api/purchase-orders/delete/route.ts
import { NextResponse } from "next/server";
import { DATA_URL, DATA_API_KEY } from "@/lib/dataEnv";
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

// Ã¢Å“â€¦ correct query name per your schema
const LINES_BY_PO = /* GraphQL */ `
  query LinesByPo($purchaseOrderId: String!, $limit: Int) {
    listPurchaseOrderLineByPurchaseOrderIdAndSku(purchaseOrderId: $purchaseOrderId, limit: $limit) {
      items {
        id
      }
    }
  }
`;

const DELETE_LINE = /* GraphQL */ `
  mutation DeletePurchaseOrderLine($input: DeletePurchaseOrderLineInput!) {
    deletePurchaseOrderLine(input: $input) {
      id
    }
  }
`;

const DELETE_PO = /* GraphQL */ `
  mutation DeletePurchaseOrder($input: DeletePurchaseOrderInput!) {
    deletePurchaseOrder(input: $input) {
      id
    }
  }
`;

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as any;
    const poId = String(body.poId ?? "").trim();
    if (!poId) return NextResponse.json({ ok: false, error: "Missing poId" }, { status: 400 });

    // 1) delete lines first
    const linesData = await gql<any>(LINES_BY_PO, { purchaseOrderId: poId, limit: 5000 });
    const lines = (linesData?.listPurchaseOrderLineByPurchaseOrderIdAndSku?.items ?? []).filter(Boolean);

    for (const l of lines) {
      const id = String(l?.id ?? "").trim();
      if (id) await gql<any>(DELETE_LINE, { input: { id } });
    }

    // 2) delete header
    await gql<any>(DELETE_PO, { input: { id: poId } });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}


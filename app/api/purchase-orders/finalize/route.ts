//app/api/purchase-orders/finalize/route.ts
import { NextResponse } from "next/server";
import { DATA_URL, DATA_API_KEY } from "@/lib/dataEnv";
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

function nowIso() {
  return new Date().toISOString();
}

const GET_PO = /* GraphQL */ `
  query GetPurchaseOrder($id: ID!) {
    getPurchaseOrder(id: $id) {
      id
      status
      supplier
      marketplaceId
      draftSuffix
      totalUnits
      totalValue
    }
  }
`;

const UPDATE_PO = /* GraphQL */ `
  mutation UpdatePurchaseOrder($input: UpdatePurchaseOrderInput!) {
    updatePurchaseOrder(input: $input) {
      id
      status
      supplier
      marketplaceId
      draftSuffix
      updatedAtIso
      totalUnits
      totalValue
    }
  }
`;

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as any;
    const poId = String(body.poId ?? "").trim();
    if (!poId) return NextResponse.json({ ok: false, error: "Missing poId" }, { status: 400 });

    const got = await gql<any>(GET_PO, { id: poId });
    const po = got?.getPurchaseOrder;
    if (!po) return NextResponse.json({ ok: false, error: "PO not found" }, { status: 404 });
    if (String(po.status) !== "DRAFT")
      return NextResponse.json({ ok: false, error: `PO status is ${po.status}, expected DRAFT` }, { status: 400 });

    const upd = await gql<any>(UPDATE_PO, {
      input: {
        id: poId,
        status: "SENT",
        updatedAtIso: nowIso(),
      },
    });

    return NextResponse.json({ ok: true, po: upd?.updatePurchaseOrder ?? null });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}


//app/api/purchase-orders/draft/route.ts
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

function nowIso() {
  return new Date().toISOString();
}

const LIST_DRAFT_PO = /* GraphQL */ `
  query ListPurchaseOrders($marketplaceId: String!, $supplier: String!, $limit: Int) {
    purchaseOrdersByMarketplaceSupplierStatus(
      marketplaceId: $marketplaceId
      sortDirection: DESC
      supplierStatusUpdatedAtIso: { beginsWith: $supplier } # NOTE: we filter in-memory below
      limit: $limit
    ) {
      items {
  id
  status
  supplier
  marketplaceId
  draftSuffix
  createdAtIso
  updatedAtIso
  totalUnits
  totalValue
}
    }
  }
`;

// Safer + simpler (works even if beginsWith shape differs): use list + filter
const LIST_PO_FALLBACK = /* GraphQL */ `
  query ListPurchaseOrders($filter: ModelPurchaseOrderFilterInput, $limit: Int) {
    listPurchaseOrders(filter: $filter, limit: $limit) {
      items {
        id
        status
        supplier
        marketplaceId
        draftSuffix
        createdAtIso
        updatedAtIso
        totalUnits
        totalValue
      }
    }
  }
`;

const CREATE_PO = /* GraphQL */ `
  mutation CreatePurchaseOrder($input: CreatePurchaseOrderInput!) {
    createPurchaseOrder(input: $input) {
  id
  status
  supplier
  marketplaceId
  draftSuffix
  createdAtIso
  updatedAtIso
  totalUnits
  totalValue
}
  }
`;

const LIST_LINES = /* GraphQL */ `
  query LinesByPo($purchaseOrderId: String!, $limit: Int) {
    listPurchaseOrderLineByPurchaseOrderIdAndSku(purchaseOrderId: $purchaseOrderId, limit: $limit) {
      items {
        id
        purchaseOrderId
        sku
        qty
        unitCost
        lineValue
        updatedAtIso
      }
    }
  }
`;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
const mid = String(searchParams.get("mid") ?? "").trim();
const supplier = String(searchParams.get("supplier") ?? "").trim();
const suffix = String(searchParams.get("suffix") ?? "").trim();

    if (!mid) return NextResponse.json({ ok: false, error: "Missing mid" }, { status: 400 });
    if (!supplier) return NextResponse.json({ ok: false, error: "Missing supplier" }, { status: 400 });
    if (!suffix) return NextResponse.json({ ok: false, error: "Missing suffix" }, { status: 400 });
    // 1) Find existing DRAFT
    let items: any[] = [];
    try {
      const d = await gql<any>(LIST_DRAFT_PO, { marketplaceId: mid, supplier, limit: 20 });
      items = d?.purchaseOrdersByMarketplaceSupplierStatus?.items ?? [];
    } catch {
      const d = await gql<any>(LIST_PO_FALLBACK, {
        filter: { marketplaceId: { eq: mid }, supplier: { eq: supplier }, status: { eq: "DRAFT" } },
        limit: 50,
      });
      items = d?.listPurchaseOrders?.items ?? [];
    }

    const drafts = (items ?? []).filter(
  (x: any) => x && x.status === "DRAFT" && x.marketplaceId === mid && x.supplier === supplier
);

const draft = drafts.find((x: any) => String(x.draftSuffix ?? "") === suffix) ?? null;

    // 2) Create if none
    const po =
      draft ??
      (await gql<any>(CREATE_PO, {
        input: {
  status: "DRAFT",
  supplier,
  marketplaceId: mid,
  draftSuffix: suffix,
  createdAtIso: nowIso(),
  updatedAtIso: nowIso(),
  totalUnits: 0,
  totalValue: 0,
},
      }))?.createPurchaseOrder;

    // 3) Load lines snapshot (fast, single indexed query)
    const linesData = await gql<any>(LIST_LINES, { purchaseOrderId: po.id, limit: 500 });
    const lines = linesData?.listPurchaseOrderLineByPurchaseOrderIdAndSku?.items ?? [];

    return NextResponse.json({
      ok: true,
      draft: po,
      lines,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
// app/api/purchase-orders/active/route.ts
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

const LIST_PO = /* GraphQL */ `
  query ListPurchaseOrders($filter: ModelPurchaseOrderFilterInput, $limit: Int) {
    listPurchaseOrders(filter: $filter, limit: $limit) {
      items {
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
  }
`;

export async function GET() {
  try {
    const data = await gql<any>(LIST_PO, {
      filter: { status: { eq: "DRAFT" } },
      limit: 200,
    });

    const items =
      (data?.listPurchaseOrders?.items ?? [])
        .filter((x: any) => x && x.status === "DRAFT" && x.marketplaceId && x.supplier)
        .map((x: any) => ({
          id: String(x.id),
          marketplaceId: String(x.marketplaceId),
          supplier: String(x.supplier),
          draftSuffix: String(x.draftSuffix ?? ""),
          updatedAtIso: String(x.updatedAtIso ?? ""),
          totalUnits: Number(x.totalUnits ?? 0) || 0,
          totalValue: Number(x.totalValue ?? 0) || 0,
        })) ?? [];

    // newest first
    items.sort((a: any, b: any) => String(b.updatedAtIso).localeCompare(String(a.updatedAtIso)));

    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}


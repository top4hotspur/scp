// app/api/restock/options/route.ts
import { NextResponse } from "next/server";
import outputs from "@/amplify_outputs.json";

export const runtime = "nodejs";

const DATA_URL = outputs.data.url;
const DATA_API_KEY = outputs.data.api_key;

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

const LIST_SUPPLIERMAP = /* GraphQL */ `
  query ListSupplierMaps($limit: Int, $nextToken: String) {
    listSupplierMaps(limit: $limit, nextToken: $nextToken) {
      items {
        supplierName
        prodGroup1
        prodGroup2
        prodGroup3
        prodGroup4
        prodGroup5
      }
      nextToken
    }
  }
`;

type SmRow = {
  supplierName?: string | null;
  prodGroup1?: string | null;
  prodGroup2?: string | null;
  prodGroup3?: string | null;
  prodGroup4?: string | null;
  prodGroup5?: string | null;
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const supplierFilter = String(searchParams.get("supplier") ?? "").trim();

    const suppliersSet = new Set<string>();
    const pg1 = new Set<string>();
    const pg2 = new Set<string>();
    const pg3 = new Set<string>();
    const pg4 = new Set<string>();
    const pg5 = new Set<string>();

    let nextToken: string | null = null;
    let safety = 0;

    while (true) {
      const vars: any = { limit: 1000 };
      if (nextToken) vars.nextToken = nextToken;

      const d = await gql<any>(LIST_SUPPLIERMAP, vars);
      const items: SmRow[] = d?.listSupplierMaps?.items ?? [];

      for (const it of items) {
        const supplierName = String(it?.supplierName ?? "").trim();
        if (supplierName) suppliersSet.add(supplierName);

        if (supplierFilter && supplierName !== supplierFilter) continue;

        const a = String(it?.prodGroup1 ?? "").trim();
        const b = String(it?.prodGroup2 ?? "").trim();
        const c = String(it?.prodGroup3 ?? "").trim();
        const e = String(it?.prodGroup4 ?? "").trim();
        const f = String(it?.prodGroup5 ?? "").trim();

        if (a) pg1.add(a);
        if (b) pg2.add(b);
        if (c) pg3.add(c);
        if (e) pg4.add(e);
        if (f) pg5.add(f);
      }

      nextToken = d?.listSupplierMaps?.nextToken ?? null;
      safety++;
      if (!nextToken) break;
      if (safety > 50) break; // safety cap
    }

    return NextResponse.json({
      ok: true,
      suppliers: Array.from(suppliersSet).sort((a, b) => a.localeCompare(b)),
      productGroups: {
        pg1: Array.from(pg1).sort((a, b) => a.localeCompare(b)),
        pg2: Array.from(pg2).sort((a, b) => a.localeCompare(b)),
        pg3: Array.from(pg3).sort((a, b) => a.localeCompare(b)),
        pg4: Array.from(pg4).sort((a, b) => a.localeCompare(b)),
        pg5: Array.from(pg5).sort((a, b) => a.localeCompare(b)),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
// app/api/purchase-orders/options/route.ts
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
    headers: { "content-type": "application/json", "x-api-key": DATA_API_KEY },
    body: JSON.stringify({ query, variables }),
  });

  const json = (await res.json().catch(() => ({}))) as GqlResp<T>;
  if (!res.ok || json.errors?.length) {
    throw new Error(json.errors?.map((e) => e.message).join(" | ") || `HTTP ${res.status}`);
  }
  return json.data as T;
}

const GET_SETTINGS = /* GraphQL */ `
  query GetSettings($id: ID!) {
    getAppSettings(id: $id) {
      id
      ukMarketplaceId
      euMarketplaceIdsJson
    }
  }
`;

const LIST_SUPPLIERMAPS = /* GraphQL */ `
  query ListSupplierMaps($limit: Int) {
    listSupplierMaps(limit: $limit) {
      items {
        supplierName
      }
    }
  }
`;

function uniq(arr: string[]) {
  return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

const nameByMid: Record<string, string> = {
  A1F83G8C2ARO7P: "United Kingdom",
  A1PA6795UKMFR9: "Germany",
  A13V1IB3VIYZZH: "France",
  APJ6JRA9NG5V4: "Italy",
  A1RKKUPIHCS9HS: "Spain",
  A1805IZSGTT6HS: "Netherlands",
  AMEN7PMS3EDWL: "Belgium",
  A2NODRKZP88ZB9: "Sweden",
  A1C3SOZRARQ6R3: "Poland",
  A28R8C7NBKEWEA: "Ireland",
};

export async function GET() {
  try {
    // 1) Marketplaces from AppSettings (global)
    let uk = "A1F83G8C2ARO7P";
    let euMids: string[] = [];

    try {
      const s = await gql<any>(GET_SETTINGS, { id: "global" });
      const settings = s?.getAppSettings ?? {};
      uk = String(settings.ukMarketplaceId ?? uk).trim() || uk;

      const euJson = String(settings.euMarketplaceIdsJson ?? "[]");
      try {
        const parsed = JSON.parse(euJson);
        euMids = Array.isArray(parsed) ? parsed.map(String).map((x) => x.trim()).filter(Boolean) : [];
      } catch {
        euMids = [];
      }
    } catch {
      // if settings missing, fall back to UK only
    }

    const mids = uniq([uk, ...euMids.filter((x) => x !== uk)]);
    const marketplaces = mids.map((id) => ({
      id,
      // IMPORTANT: Management page displays `code` - use country name (not the ID)
      code: nameByMid[id] ?? id,
    }));

    // 2) Suppliers from SupplierMap
    let suppliers: string[] = [];
    try {
      const r = await gql<any>(LIST_SUPPLIERMAPS, { limit: 10000 });
      const items = (r?.listSupplierMaps?.items ?? []) as any[];
      suppliers = uniq(items.map((x) => String(x?.supplierName ?? "")).filter(Boolean));
    } catch {
      suppliers = [];
    }

    return NextResponse.json({ ok: true, marketplaces, suppliers });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
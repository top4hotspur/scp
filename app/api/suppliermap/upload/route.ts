//app/api/suppliermap/upload/route.ts
import { NextResponse } from "next/server";
import outputs from "@/amplify_outputs.json";
import { parse } from "csv-parse/sync";

const DATA_URL = outputs.data.url;
const DATA_API_KEY = outputs.data.api_key;

type GqlResp<T> = { data?: T; errors?: { message: string }[] };

async function gql<T>(query: string, variables?: any): Promise<T> {
  if (!DATA_URL || !DATA_API_KEY) throw new Error("Missing amplify_outputs.json data.url/api_key");

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

const CREATE = /* GraphQL */ `
  mutation CreateSupplierMap($input: CreateSupplierMapInput!) {
    createSupplierMap(input: $input) { id }
  }
`;

const UPDATE = /* GraphQL */ `
  mutation UpdateSupplierMap($input: UpdateSupplierMapInput!) {
    updateSupplierMap(input: $input) { id }
  }
`;

function asStr(v: any) {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}
function asNum(v: any) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function asBool(v: any) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (["1", "true", "y", "yes"].includes(s)) return true;
  if (["0", "false", "n", "no"].includes(s)) return false;
  return null;
}

export async function POST(req: Request) {
  const nowIso = new Date().toISOString();

  const form = await req.formData();
  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Missing file (field name must be 'file')" }, { status: 400 });
  }

  const text = await file.text();
  const rows = parse(text, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
    trim: true,
  }) as Record<string, any>[];

  let ok = 0;
  let fail = 0;
  const errors: { row: number; sku?: string; error: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const sku = asStr(r["sku"]);
    if (!sku) {
      fail++;
      errors.push({ row: i + 2, error: "Missing sku" });
      continue;
    }

    const input: any = {
      id: sku,
      sku,

      asin: asStr(r["asin"]),
      shortTitle: asStr(r["short_title"]),
      fulfillmentChannel: asStr(r["fulfillment_channel"]),

      supplierName: asStr(r["supplier_name"]),
      leadTimeDays: asNum(r["lead_time_days"]),

      prodGroup1: asStr(r["prod_group_1"]),
      prodGroup2: asStr(r["prod_group_2"]),
      prodGroup3: asStr(r["prod_group_3"]),
      prodGroup4: asStr(r["prod_group_4"]),
      prodGroup5: asStr(r["prod_group_5"]),

      productCost: asNum(r["product_cost"]),
      prepCost: asNum(r["prep_cost"]),
      shippingCost: asNum(r["shipping_cost"]),

      label: asStr(r["label"]),
      excludeUk: asBool(r["exclude_uk"]),
      excludeEu: asBool(r["exclude_eu"]),

      updatedAtIso: nowIso,
    };

    try {
      try {
        await gql(UPDATE, { input });
      } catch {
        await gql(CREATE, { input });
      }
      ok++;
    } catch (e: any) {
      fail++;
      errors.push({ row: i + 2, sku, error: String(e?.message ?? e) });
    }
  }

  // meter: count rows processed
    // meter: count rows processed (use relative URL so it works in prod too)
  try {
    const origin = new URL(req.url).origin;
    await fetch(`${origin}/api/cost/add`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "SUPPLIERMAP_UPLOAD", usd: 0, units: ok + fail }),
    });
  } catch {
    // ignore metering failures (never break the upload)
  }

  return NextResponse.json({
    ok: true,
    total: rows.length,
    insertedOrUpdated: ok,
    failed: fail,
    errors: errors.slice(0, 25),
  });
}
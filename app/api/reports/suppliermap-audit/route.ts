// app/api/reports/suppliermap-audit/route.ts
import { NextResponse } from "next/server";
import { DATA_URL, DATA_API_KEY } from "@/lib/dataEnv";
type GqlResp<T> = { data?: T; errors?: { message: string }[] };

async function gql<T>(query: string, variables?: any): Promise<T> {
  if (!DATA_URL || !DATA_API_KEY) throw new Error("Missing DATA_URL / DATA_API_KEY");
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

const LIST_INVENTORY = /* GraphQL */ `
  query ListInventorySkus($limit: Int, $nextToken: String, $filter: ModelInventorySkuFilterInput) {
    listInventorySkus(limit: $limit, nextToken: $nextToken, filter: $filter) {
      items {
        marketplaceId
        sku
      }
      nextToken
    }
  }
`;

// SupplierMap schema differs across builds; we query safely.
// Phase 1: always fetch sku (guaranteed).
const LIST_SUPPLIERMAP = /* GraphQL */ `
  query ListSupplierMaps($limit: Int, $nextToken: String) {
    listSupplierMaps(limit: $limit, nextToken: $nextToken) {
      items {
        id
        sku
        supplierName
        leadTimeDays
        productCost
        prepCost
        shippingCost
        updatedAtIso
      }
      nextToken
    }
  }
`;

// Phase 2: if your schema has extra fields, you can add them later once confirmed.
// For now, we keep audits a/b working reliably without breaking.

// Simple CSV builder (no extra deps)
function csvEscape(v: any) {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: Record<string, any>[], headers: string[]) {
  const lines: string[] = [];
  lines.push(headers.map(csvEscape).join(","));
  for (const r of rows) {
    lines.push(headers.map((h) => csvEscape((r as any)[h])).join(","));
  }
  return lines.join("\n");
}

function marketplaceName(mid: string): string {
  const map: Record<string, string> = {
    A1F83G8C2ARO7P: "UK",
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

  return map[mid] ?? mid;
}

function getLeadTimeDays(x: any): number | null {
  const n = Number(x?.leadTimeDays);
  return Number.isFinite(n) ? n : null;
}

function getUnitCost(x: any): number | null {
  const n = Number(x?.productCost);
  return Number.isFinite(n) ? n : null;
}

function getInbound(x: any): number | null {
  const n = Number(x?.shippingCost);
  return Number.isFinite(n) ? n : null;
}

function getPrep(x: any): number | null {
  const n = Number(x?.prepCost);
  return Number.isFinite(n) ? n : null;
}

async function listAll<TItem>(
  query: string,
  rootKey: string,
  variables: any
): Promise<TItem[]> {
  const out: TItem[] = [];
  let nextToken: string | null = null;

  while (true) {
    const data = (await gql<any>(query, { ...variables, limit: 1000, nextToken })) as any;
    const page = data?.[rootKey];
    const items = Array.isArray(page?.items) ? page.items : [];
    out.push(...items);
    nextToken = page?.nextToken ?? null;
    if (!nextToken) break;
  }
  return out;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    // type:
    // a = inventory NOT in suppliermap
    // b = suppliermap NOT in inventory
    // c = suppliermap missing pricing
    // d = suppliermap missing lead_times_days
    // e = full suppliermap dump
    const type = String(url.searchParams.get("type") ?? "").trim().toLowerCase();
    const mid = String(url.searchParams.get("mid") ?? "A1F83G8C2ARO7P").trim(); // default UK

    if (!["a", "b", "c", "d", "e"].includes(type)) {
      return NextResponse.json(
        { ok: false, error: "Missing/invalid type. Use type=a|b|c|d|e" },
        { status: 400 }
      );
    }

    // 1) Load inventory SKUs for selected marketplace (cheap)
    const inv = await listAll<any>(LIST_INVENTORY, "listInventorySkus", {
      filter: { marketplaceId: { eq: mid } },
    });
    const invSkus = new Set(inv.map((x) => String(x?.sku ?? "").trim()).filter(Boolean));

    // 2) Load suppliermap (global)
    const sm = await listAll<any>(LIST_SUPPLIERMAP, "listSupplierMaps", {});
    const smSkus = new Set(
  sm.map((x) => String(x?.sku ?? x?.id ?? "").trim()).filter(Boolean)
);

    // Helper index
    const smBySku = new Map<string, any>();
    for (const row of sm) {
      const sku = String(row?.sku ?? row?.id ?? "").trim();
      if (sku) smBySku.set(sku, row);
    }

    let rows: Record<string, any>[] = [];
    let filename = "";

    if (type === "a") {
      // inventory but NOT in suppliermap
      rows = Array.from(invSkus)
        .filter((sku) => !smSkus.has(sku))
        .sort()
        .map((sku) => ({
  sku,
  marketplace: marketplaceName(mid),
}));
      filename = `suppliermap_a_inventory_not_in_suppliermap__${mid}.csv`;
      const csv = toCsv(rows, ["marketplace", "sku"]);
      return new Response(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    if (type === "b") {
      // suppliermap but NOT in inventory (for that marketplace)
      rows = Array.from(smSkus)
        .filter((sku) => !invSkus.has(sku))
        .sort()
        .map((sku) => ({
  sku,
  marketplace: marketplaceName(mid),
}));
      filename = `suppliermap_b_suppliermap_not_in_inventory__${mid}.csv`;
      const csv = toCsv(rows, ["marketplace", "sku"]);
      return new Response(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    if (type === "c") {
  for (const sku of Array.from(smSkus).sort()) {
    const row = smBySku.get(sku);
    if (!row) continue;

    const unit = Number(row?.productCost);
    const inbound = Number(row?.shippingCost);
    const prep = Number(row?.prepCost);

    const missing: string[] = [];

    if (!(Number.isFinite(unit) && unit > 0)) missing.push("productCost");
    if (!Number.isFinite(inbound)) missing.push("shippingCost");
    if (!Number.isFinite(prep)) missing.push("prepCost");

    if (missing.length) {
      rows.push({
        sku,
        supplierName: row?.supplierName ?? "",
        missing: missing.join("|"),
      });
    }
  }

  filename = `suppliermap_c_missing_pricing.csv`;
  const csv = toCsv(rows, ["sku", "supplierName", "missing"]);
  const bom = "\uFEFF";
  return new Response(bom + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

    if (type === "d") {
  for (const sku of Array.from(smSkus).sort()) {
    const row = smBySku.get(sku);
    if (!row) continue;

    const ltd = Number(row?.leadTimeDays);

    if (!(Number.isFinite(ltd) && ltd > 0)) {
      rows.push({
        sku,
        supplierName: row?.supplierName ?? "",
        leadTimeDays: Number.isFinite(ltd) ? ltd : "",
      });
    }
  }

  filename = `suppliermap_d_missing_lead_time.csv`;
  const csv = toCsv(rows, ["sku", "supplierName", "leadTimeDays"]);
  const bom = "\uFEFF";
  return new Response(bom + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

    // e = full suppliermap dump
rows = Array.from(smSkus)
  .sort()
  .map((sku) => {
    const row = smBySku.get(sku) ?? {};
    return {
      sku,
      supplierName: row?.supplierName ?? "",
      productCost: row?.productCost ?? "",
      shippingCost: row?.shippingCost ?? "",
      prepCost: row?.prepCost ?? "",
      leadTimeDays: row?.leadTimeDays ?? "",
      excludeUk: row?.excludeUk ?? "",
      excludeEu: row?.excludeEu ?? "",
      updatedAtIso: row?.updatedAtIso ?? "",
    };
  });

filename = `suppliermap_e_full_dump.csv`;
const csv = toCsv(rows, [
  "sku",
  "supplierName",
  "productCost",
  "shippingCost",
  "prepCost",
  "leadTimeDays",
  "excludeUk",
  "excludeEu",
  "updatedAtIso",
]);

const bom = "\uFEFF";
return new Response(bom + csv, {
  headers: {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${filename}"`,
  },
});
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}


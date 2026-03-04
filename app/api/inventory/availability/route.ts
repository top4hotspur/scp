// app/api/inventory/availability/route.ts
import { NextResponse } from "next/server";
import outputs from "@/amplify_outputs.json";

const DATA_URL = (outputs as any)?.data?.url;
const DATA_API_KEY = (outputs as any)?.data?.api_key;

type GqlResp<T> = { data?: T; errors?: { message: string }[] };

function normSku(s: any) {
  return String(s ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function parseSkusParam(v: string | null): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 300); // keep cheap
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const mid = String(searchParams.get("mid") ?? "").trim();
    const skusRaw = parseSkusParam(searchParams.get("skus"));
    const skus = skusRaw.map(normSku).filter(Boolean);

    if (!mid) return NextResponse.json({ ok: false, error: "Missing mid" }, { status: 400 });
    if (!DATA_URL || !DATA_API_KEY) {
      return NextResponse.json({ ok: false, error: "Missing DATA_URL / DATA_API_KEY" }, { status: 500 });
    }

    async function gql<T>(query: string, variables?: any): Promise<T> {
      const res = await fetch(DATA_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": DATA_API_KEY,
        },
        body: JSON.stringify({ query, variables }),
        cache: "no-store",
      });

      const json = (await res.json().catch(() => ({}))) as GqlResp<T>;
      if (!res.ok || json.errors?.length) {
        const msg =
          json?.errors?.map((e: any) => e?.message ?? JSON.stringify(e)).join(" | ") || `HTTP ${res.status}`;
        throw new Error(`GraphQL failed: ${msg}`);
      }
      return json.data as T;
    }

    // InventorySku truth
    const QUERY = /* GraphQL */ `
      query ListInventorySkus($filter: ModelInventorySkuFilterInput, $limit: Int, $nextToken: String) {
        listInventorySkus(filter: $filter, limit: $limit, nextToken: $nextToken) {
          items {
  sku
  marketplaceId
  availableUnits
  inboundUnits
  reservedUnits
  updatedAtIso
}
          nextToken
        }
      }
    `;

    const availability: Record<string, number> = {};
    const inbound: Record<string, number> = {};
    const reserved: Record<string, number> = {};
    let maxUpdatedAtIso: string | null = null;

function bumpMaxIso(iso: any) {
  const s = String(iso ?? "").trim();
  if (!s) return;
  if (!maxUpdatedAtIso || s > maxUpdatedAtIso) maxUpdatedAtIso = s;
}

    // Alias map: requested SKU -> actual InventorySku.sku
    // e.g. "4771" -> "STYLECRAFT-PATTERN-4771"
    const aliasToFull: Record<string, string> = {};

    let nextToken: string | null = null;
    const filter = { marketplaceId: { eq: mid } };

    do {
      const data: any = await gql(QUERY, { filter, limit: 500, nextToken });

      const listPage: any = data?.listInventorySkus ?? data?.listInventorySKUs ?? null;
      const items: any[] = Array.isArray(listPage?.items) ? listPage.items : [];

      for (const it of items) {
        const fullSku = normSku(it?.sku);
        if (!fullSku) continue;

        availability[fullSku] = Number(it?.availableUnits ?? 0) || 0;
        inbound[fullSku] = Number(it?.inboundUnits ?? 0) || 0;
        reserved[fullSku] = Number(it?.reservedUnits ?? 0) || 0;
        bumpMaxIso(it?.updatedAtIso);

        // Build aliases from the full SKU
        // Common pattern: PREFIX-PREFIX-4771 => alias "4771"
        const parts = fullSku.split("-").map((x) => x.trim()).filter(Boolean);
        if (parts.length >= 2) {
          const last = parts[parts.length - 1];
          // Always map last token (helps 4771-style)
          if (last && !aliasToFull[last]) aliasToFull[last] = fullSku;

          // Also map "endsWith -LAST" forms if requested comes in with spaces normalized
          // (no extra keys needed here; just keep aliasToFull small)
        }
      }

      nextToken = typeof listPage?.nextToken === "string" ? listPage.nextToken : null;
    } while (nextToken);

    // If no skus param: return everything (keyed by FULL sku)
    if (!skus.length) {
      return NextResponse.json({
        ok: true,
        mid,
        count: Object.keys(availability).length,
        availability,
        inbound,
        reserved,
      });
    }

    // If skus param provided: return requested keys, resolving aliases
    const filtered: Record<string, number> = {};
    const filteredInbound: Record<string, number> = {};
    const filteredReserved: Record<string, number> = {};
    const missing: string[] = [];
    const resolved: Record<string, string> = {};

    for (const reqSku of skus) {
      // Prefer exact match first, else alias
      const resolvedSku = Object.prototype.hasOwnProperty.call(availability, reqSku)
        ? reqSku
        : aliasToFull[reqSku] ?? "";

      if (!resolvedSku || !Object.prototype.hasOwnProperty.call(availability, resolvedSku)) {
        missing.push(reqSku);
        filtered[reqSku] = 0;
        filteredInbound[reqSku] = 0;
        filteredReserved[reqSku] = 0;
        continue;
      }

      resolved[reqSku] = resolvedSku;
      filtered[reqSku] = availability[resolvedSku] ?? 0;
      filteredInbound[reqSku] = inbound[resolvedSku] ?? 0;
      filteredReserved[reqSku] = reserved[resolvedSku] ?? 0;
    }

    const now = Date.now();
const maxMs = maxUpdatedAtIso ? Date.parse(maxUpdatedAtIso) : NaN;
const ageMinutes = Number.isFinite(maxMs) ? Math.floor((now - maxMs) / 60000) : null;

// Simple default: stale if older than 360 minutes (6 hours)
const stale = ageMinutes == null ? true : ageMinutes > 360;

return NextResponse.json({
  ok: true,
  mid,
  count: Object.keys(filtered).length,
  availability: filtered,
  inbound: filteredInbound,
  reserved: filteredReserved,
  missing,
  resolved,
  maxUpdatedAtIso,
  ageMinutes,
  stale,
});
  } catch (e: any) {
    console.error("[availability] error", e);
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
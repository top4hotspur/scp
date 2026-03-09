// app/api/listings/truth/refresh/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from "next/server";
import { DATA_URL, DATA_API_KEY } from "@/lib/dataEnv";
import { spapiFetch } from "@/lib/spapi/request";
import { envOrEmpty } from "@/lib/spapi/env";

export const runtime = "nodejs";

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

function safeStr(v: any) {
  return String(v ?? "").trim();
}

function normSku(v: any) {
  return safeStr(v).replace(/\s+/g, " ").toUpperCase();
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function nowIso() {
  return new Date().toISOString();
}

function parseCsvParam(v: string | null): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => safeStr(s))
    .filter(Boolean);
}

function parseIntParam(v: string | null, def: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : def;
}

function extractBuyBoxPrice(body: any): {
  amount: number | null;
  currency: string | null;
  numberOfOffers: number | null;
} {
  const payload = body?.payload ?? body;
  const summary = payload?.Summary ?? payload?.summary ?? null;

  const numberOfOffersRaw = summary?.NumberOfOffers ?? summary?.numberOfOffers ?? null;
  const numberOfOffers = Number.isFinite(Number(numberOfOffersRaw)) ? Number(numberOfOffersRaw) : null;

  const bb = (summary?.BuyBoxPrices ?? summary?.buyBoxPrices ?? [])[0];
  const lp = bb?.ListingPrice ?? bb?.listingPrice ?? null;

  const amount = lp?.Amount ?? lp?.amount ?? null;
  const currency = lp?.CurrencyCode ?? lp?.currencyCode ?? null;

  const a = Number(amount);
  return {
    amount: Number.isFinite(a) ? round2(a) : null,
    currency: currency ? String(currency) : null,
    numberOfOffers,
  };
}

function extractOwnOfferPrice(body: any, sellerId: string): { amount: number | null; ownBuyBox: boolean | null } {
  const payload = body?.payload ?? body;
  const offers = payload?.Offers ?? payload?.offers ?? [];
  if (!Array.isArray(offers) || !offers.length) return { amount: null, ownBuyBox: null };

  const mine = offers.find((o: any) => safeStr(o?.SellerId ?? o?.sellerId) === sellerId);
  if (!mine) return { amount: null, ownBuyBox: null };

  const lp = mine?.ListingPrice ?? mine?.listingPrice ?? null;
  const amount = lp?.Amount ?? lp?.amount ?? null;
  const isWinner = Boolean(mine?.IsBuyBoxWinner ?? mine?.isBuyBoxWinner ?? false);

  const a = Number(amount);
  return { amount: Number.isFinite(a) ? round2(a) : null, ownBuyBox: isWinner };
}

/**
 * NOTES (STK-style):
 * - Prefer internal tables for SKU->ASIN (once we add it)
 * - SupplierMap scan fills a chunk cheaply
 * - Listings Items is a targeted fallback per SKU only when needed
 * - Offers endpoint is authoritative per SKU
 */

const LIST_SUPPLIERMAPS = /* GraphQL */ `
  query ListSupplierMaps($limit: Int, $nextToken: String) {
    listSupplierMaps(limit: $limit, nextToken: $nextToken) {
      items { sku asin }
      nextToken
    }
  }
`;

const LIST_INVENTORYSKUS_PAGE = /* GraphQL */ `
  query ListInventorySkus($filter: ModelInventorySkuFilterInput, $limit: Int, $nextToken: String) {
    listInventorySkus(filter: $filter, limit: $limit, nextToken: $nextToken) {
      items { marketplaceId sku }
      nextToken
    }
  }
`;

const CREATE_OFFERTRUTH = /* GraphQL */ `
  mutation CreateOfferTruth($input: CreateOfferTruthInput!) {
    createOfferTruth(input: $input) { marketplaceId sku updatedAtIso }
  }
`;

const UPDATE_OFFERTRUTH = /* GraphQL */ `
  mutation UpdateOfferTruth($input: UpdateOfferTruthInput!) {
    updateOfferTruth(input: $input) { marketplaceId sku updatedAtIso }
  }
`;

type SkuAsin = { sku: string; asin: string };

async function resolveAsinFromInventorySku(_mid: string, _sku: string): Promise<string> {
  // InventorySku currently has no asin field in schema.
  // Hook kept for later when we add asin per marketplace.
  return "";
}

async function pickSkusFromInventory(mid: string, limit: number): Promise<SkuAsin[]> {
  const out: SkuAsin[] = [];
  let nextToken: string | null = null;

  const pageSize = Math.min(200, Math.max(1, limit));

  for (let page = 0; page < 20 && out.length < limit; page++) {
    const data: any = await gql(LIST_INVENTORYSKUS_PAGE, {
      filter: { marketplaceId: { eq: mid } },
      limit: pageSize,
      nextToken,
    });

    const items: any[] = data?.listInventorySkus?.items ?? [];
    for (const it of items) {
      const sku = safeStr(it?.sku);
      if (!sku) continue;
      out.push({ sku, asin: "" });
      if (out.length >= limit) break;
    }

    nextToken = data?.listInventorySkus?.nextToken ?? null;
    if (!nextToken) break;
  }

  return out.slice(0, limit);
}

async function fillMissingAsinsFromSupplierMap(targetSkus: string[]): Promise<Record<string, string>> {
  const need = new Set(targetSkus.map(normSku));
  const found: Record<string, string> = {};
  let nextToken: string | null = null;

  for (let page = 0; page < 10 && need.size > 0; page++) {
    const data: any = await gql(LIST_SUPPLIERMAPS, { limit: 1000, nextToken });
    const items: any[] = data?.listSupplierMaps?.items ?? [];

    for (const it of items) {
      const s = normSku(it?.sku);
      if (!need.has(s)) continue;
      const asin = safeStr(it?.asin);
      if (asin) {
        found[s] = asin;
        need.delete(s);
      }
      if (need.size === 0) break;
    }

    nextToken = data?.listSupplierMaps?.nextToken ?? null;
    if (!nextToken) break;
  }

  return found; // keys are normSku(sku)
}

/**
 * Targeted fallback: resolve ASIN from Listings Items by SKU+marketplace.
 * Returns "" if not found or request fails.
 */
async function resolveAsinViaListingsItem(
  sellerId: string,
  sku: string,
  mid: string
): Promise<{ asin: string; err?: string }> {
  const path = `/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(sku)}`;

  const attempts: Array<Record<string, string>> = [
    { marketplaceIds: mid, includedData: "identifiers" },
    { marketplaceIds: mid, includedData: "summaries,identifiers" },
    { marketplaceIds: mid }, // last resort
  ];

  let lastErr = "";

  for (const q of attempts) {
    try {
      const li = await spapiFetch<any>({ method: "GET", path, query: q });

      const payload = li?.payload ?? li;

      // 1) Preferred: payload.summaries[].asin
      const summaries = payload?.summaries ?? payload?.Summaries ?? [];
      if (Array.isArray(summaries)) {
        for (const s of summaries) {
          const a = safeStr(s?.asin ?? s?.ASIN);
          if (a) return { asin: a };
        }
      }

      // 2) Backup: identifiers => ASIN
      const identifiers = payload?.identifiers ?? payload?.Identifiers ?? [];
      if (Array.isArray(identifiers)) {
        for (const group of identifiers) {
          const ids = group?.identifiers ?? group?.Identifiers ?? [];
          if (!Array.isArray(ids)) continue;
          for (const id of ids) {
            const type = safeStr(id?.identifierType ?? id?.IdentifierType).toUpperCase();
            const value = safeStr(id?.identifier ?? id?.Identifier);
            if (type === "ASIN" && value) return { asin: value };
          }
        }
      }

      // 3) Last ditch: top-level asin
      const top = safeStr(payload?.asin ?? payload?.ASIN);
      if (top) return { asin: top };

      return { asin: "", err: "ListingsItem returned but ASIN not found in summaries/identifiers/top-level." };
    } catch (e: any) {
      lastErr = String(e?.message ?? e);
      const m = lastErr.toLowerCase();
      // only retry on the specific parse-ish errors
      if (!(m.includes("cannot be parsed") || m.includes("invalidinput") || m.includes("missing or invalid parameters"))) {
        break;
      }
    }
  }

  return { asin: "", err: lastErr || "ListingsItem lookup failed" };
}

export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const mid = safeStr(searchParams.get("mid"));
    const skuSingle = safeStr(searchParams.get("sku"));
    const skusCsv = safeStr(searchParams.get("skus"));
    const limit = parseIntParam(searchParams.get("limit"), 0);

    const dryRun = safeStr(searchParams.get("dryRun")) === "1";
    const verbose = safeStr(searchParams.get("verbose")) === "1";

    if (!mid) return NextResponse.json({ ok: false, error: "Missing mid" }, { status: 400 });

    const sellerId = safeStr(envOrEmpty("SPAPI_SELLER_ID"));
    if (!sellerId) return NextResponse.json({ ok: false, error: "Missing env var: SPAPI_SELLER_ID" }, { status: 500 });

    // Targets:
    // - sku= single
    // - skus= csv
    // - limit= pick SKUs from InventorySku
    let targets: SkuAsin[] = [];

    if (skuSingle) {
      targets = [{ sku: skuSingle, asin: "" }];
    } else {
      const list = parseCsvParam(skusCsv);
      if (list.length) {
        targets = list.map((s) => ({ sku: s, asin: "" }));
      } else if (limit > 0) {
        targets = await pickSkusFromInventory(mid, Math.min(limit, 500));
      }
    }

    if (!targets.length) {
      return NextResponse.json({ ok: false, error: "Missing sku (or skus, or limit)" }, { status: 400 });
    }

    // Resolve ASINs (STK-style):
    // 1) InventorySku hook (currently none)
    // 2) SupplierMap scan
    const missingSkuList: string[] = [];
    for (const t of targets) {
      if (t.asin) continue;
      const a = await resolveAsinFromInventorySku(mid, t.sku);
      if (a) t.asin = a;
      else missingSkuList.push(t.sku);
    }

    if (missingSkuList.length) {
      const sm = await fillMissingAsinsFromSupplierMap(missingSkuList);
      for (const t of targets) {
        if (t.asin) continue;
        const a = sm[normSku(t.sku)];
        if (a) t.asin = a;
      }
    }

    // Now fetch offers + write truth
    const rows: any[] = [];
    let wrote = 0;
    let errors = 0;

    for (const t of targets) {
      const sku = t.sku;
      let asin = t.asin; // mutable, keep in sync

      // If missing ASIN, do targeted ListingsItems fallback
      if (!asin) {
        const li = await resolveAsinViaListingsItem(sellerId, sku, mid);
        if (li.asin) {
          asin = li.asin;
          t.asin = li.asin;
        } else {
          errors++;
          if (verbose) rows.push({ sku, ok: false, error: `No ASIN for SKU. ListingsItem: ${li.err ?? "n/a"}` });
          continue;
        }
      }

      try {
        let offers: any;

        try {
          offers = await spapiFetch<any>({
            method: "GET",
            path: `/products/pricing/v0/items/${encodeURIComponent(asin)}/offers`,
            query: { MarketplaceId: mid, ItemCondition: "New" },
          });
        } catch (e1: any) {
          const msg1 = String(e1?.message ?? e1);
          const m = msg1.toLowerCase();

          // If ASIN rejected, re-resolve via Listings Items and retry once
          if (m.includes("invalid asin") || m.includes("invalidinput") || m.includes("invalid asin for marketplace")) {
            const li = await resolveAsinViaListingsItem(sellerId, sku, mid);
            if (li.asin) {
              asin = li.asin;
              t.asin = li.asin;

              offers = await spapiFetch<any>({
                method: "GET",
                path: `/products/pricing/v0/items/${encodeURIComponent(asin)}/offers`,
                query: { MarketplaceId: mid, ItemCondition: "New" },
              });
            } else {
              throw new Error(
                `Offers rejected ASIN ${asin} for marketplace ${mid}. ListingsItem ASIN lookup failed: ${li.err ?? "n/a"}`
              );
            }
          } else {
            throw e1;
          }
        }

        const bb = extractBuyBoxPrice(offers);
        const own = extractOwnOfferPrice(offers, sellerId);
        const isOnlySeller = bb.numberOfOffers != null ? bb.numberOfOffers <= 1 : null;

        const ts = nowIso();
        const input: any = {
          marketplaceId: mid,
          sku,
          asin,
          currency: bb.currency ?? undefined,
          ownPrice: own.amount ?? undefined,
          buyBoxPrice: bb.amount ?? undefined,
          isOnlySeller: isOnlySeller ?? undefined,
          ownBuyBox: own.ownBuyBox ?? undefined,
          numberOfOffers: bb.numberOfOffers ?? undefined,
          source: "offersSingle",
          updatedAtIso: ts,
          rawSummaryJson: JSON.stringify({
            bb: bb.amount,
            own: own.amount,
            offers: bb.numberOfOffers,
            ownBuyBox: own.ownBuyBox,
          }),
        };

        if (!dryRun) {
          try {
            await gql(CREATE_OFFERTRUTH, { input });
          } catch {
            await gql(UPDATE_OFFERTRUTH, { input });
          }
          wrote++;
        }

        if (verbose) rows.push({ sku, asin, ok: true, truth: input });
      } catch (e: any) {
        errors++;
        if (verbose) rows.push({ sku, asin, ok: false, error: String(e?.message ?? e) });
      }
    }

    const noAsin = targets.filter((x) => !x.asin).map((x) => x.sku);

    return NextResponse.json({
      ok: true,
      mid,
      dryRun,
      requested: targets.length,
      wrote: dryRun ? 0 : wrote,
      errors,
      missingAsin: noAsin.length,
      missingAsinSkus: verbose ? noAsin : undefined,
      rows: verbose ? rows : undefined,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
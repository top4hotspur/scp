// amplify/functions/new-lines-scan/handler.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { getLwaAccessToken } from "../../lib/lwa";
import aws4 from "aws4";
const DATA_URL = String(process.env.DATA_URL ?? "").trim();
const DATA_API_KEY = String(process.env.DATA_API_KEY ?? "").trim();

const SPAPI_HOST_EU = "sellingpartnerapi-eu.amazon.com";
const SPAPI_REGION = "eu-west-1";

type ScanRequest = {
  eans: string[];
  marketplaceIds: string[];
  settings?: {
    referralRate?: number;     // default 0.153
    cogsGbp?: number;          // default 0
    inboundShippingGbp?: number;
    prepCostGbp?: number;
    euSalesMultiplier?: number; // default 1.18
    eurPerGbp?: number;         // default 1.17 (your saved setting later)
  };
};

type ScanRow = {
  ean: string;
  marketplaceId: string;
  ok: boolean;
  fromCache: boolean;
  message?: string;

  asin?: string;
  title?: string;
  imageUrl?: string;

  price?: { amount: number; currency: string } | null;
  bsr?: number | null;
  categoryHint?: string | null;

  estMonthlySales?: number | null;
  estProfit?: number | null;
  profitCurrency?: string | null;
};

// ------------------- anchors + estimator -------------------
type Anchor = { x: number; y: number };
const CATEGORY_ANCHORS: Record<string, Anchor[]> = {
  Grocery: [{ x: 100, y: 6500 }, { x: 1000, y: 1950 }, { x: 10000, y: 480 }, { x: 50000, y: 95 }, { x: 100000, y: 40 }],
  Beauty:  [{ x: 100, y: 5400 }, { x: 1000, y: 1550 }, { x: 10000, y: 330 }, { x: 50000, y: 65 }, { x: 100000, y: 22 }],
  Home:    [{ x: 100, y: 4800 }, { x: 1000, y: 1250 }, { x: 10000, y: 260 }, { x: 50000, y: 50 }, { x: 100000, y: 18 }],
  DIY:     [{ x: 100, y: 2000 }, { x: 1000, y: 650 },  { x: 10000, y: 150 }, { x: 50000, y: 35 }, { x: 100000, y: 15 }],
};
const DEFAULT_CATEGORY = "Home";

function calculateSales(bsr: number, category: string): number {
  const anchors = CATEGORY_ANCHORS[category] || CATEGORY_ANCHORS[DEFAULT_CATEGORY];
  if (bsr <= anchors[0].x) return anchors[0].y;
  if (bsr >= anchors[anchors.length - 1].x) return anchors[anchors.length - 1].y;

  let i = 0;
  while (i < anchors.length - 1 && bsr > anchors[i + 1].x) i++;
  const p0 = anchors[i], p1 = anchors[i + 1];

  const logX0 = Math.log(p0.x), logX1 = Math.log(p1.x);
  const logY0 = Math.log(p0.y), logY1 = Math.log(p1.y);
  const logX  = Math.log(bsr);

  const estimatedLogY = logY0 + ((logY1 - logY0) / (logX1 - logX0)) * (logX - logX0);
  return Math.round(Math.exp(estimatedLogY));
}

function inferCategoryHint(item: any): string {
  const dg = String(item?.summaries?.[0]?.websiteDisplayGroup ?? "").toLowerCase();
  const pt = String(item?.summaries?.[0]?.productType ?? "").toLowerCase();
  if (dg.includes("beauty") || pt.includes("beauty")) return "Beauty";
  if (dg.includes("grocery") || dg.includes("drugstore")) return "Grocery";
  if (dg.includes("diy") || dg.includes("tools") || pt.includes("tools")) return "DIY";
  return "Home";
}

function extractBestBsr(item: any): number | null {
  const ranks: number[] = [];
  for (const byMkt of item?.salesRanks ?? []) {
    for (const r of byMkt?.displayGroupRanks ?? []) {
      const n = Number(r?.rank);
      if (Number.isFinite(n) && n > 0) ranks.push(n);
    }
    for (const r of byMkt?.classificationRanks ?? []) {
      const n = Number(r?.rank);
      if (Number.isFinite(n) && n > 0) ranks.push(n);
    }
  }
  return ranks.length ? Math.min(...ranks) : null;
}

function extractMainImage(item: any): string | null {
  const images = item?.images?.[0]?.images ?? [];
  const main = images.find((im: any) => im?.variant === "MAIN") || images[0];
  return main?.link || null;
}

function extractPrice(item: any): { amount: number; currency: string } | null {
  const p = item?.summaries?.[0]?.price;
  const amount = Number(p?.amount);
  const currency = String(p?.currency ?? "");
  if (Number.isFinite(amount) && amount > 0 && currency) return { amount, currency };
  return null;
}

function ttl24h(): number {
  return Math.floor(Date.now() / 1000) + 24 * 3600;
}
function nowIso(): string {
  return new Date().toISOString();
}
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function estimateProfit(params: {
  sellPrice: number;
  referralRate: number;
  cogs: number;
  inboundShipping: number;
  prep: number;
}): number {
  const referral = params.sellPrice * params.referralRate;

  // Placeholder conservative FBA fee (weâ€™ll replace with Fees pipeline later)
  const fbaConservative = 2.75;

  const profit =
    params.sellPrice - referral - fbaConservative - params.cogs - params.inboundShipping - params.prep;

  return Math.round(profit * 100) / 100;
}

// ------------------- GraphQL cache helpers -------------------
type GqlResp<T> = { data?: T; errors?: { message: string }[] };

async function gql<T>(query: string, variables?: any): Promise<T> {
  if (!DATA_URL || !DATA_API_KEY) throw new Error("Missing DATA_URL / DATA_API_KEY in lambda env");
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

// We will use get by PK+SK via generated "getProductScanCache" resolver
const GET_CACHE = /* GraphQL */ `
  query Get($ean: String!, $marketplaceId: String!) {
    getProductScanCache(ean: $ean, marketplaceId: $marketplaceId) {
      ean marketplaceId asin title imageUrl
      priceAmount priceCurrency
      bsr categoryHint
      estMonthlySales estProfit estProfitCurrency
      lastUpdatedAtIso expireAt
    }
  }
`;

const UPSERT_CACHE = /* GraphQL */ `
  mutation Upsert($input: CreateProductScanCacheInput!) {
    createProductScanCache(input: $input) {
      ean marketplaceId
    }
  }
`;

// If the record already exists, create may fail. Weâ€™ll delete+create later if needed,
// but simplest: use update when exists.
const UPDATE_CACHE = /* GraphQL */ `
  mutation Update($input: UpdateProductScanCacheInput!) {
    updateProductScanCache(input: $input) {
      ean marketplaceId
    }
  }
`;

// ------------------- SP-API call -------------------
async function spApiGet(path: string): Promise<any> {
  const accessToken = await getLwaAccessToken();

  const opts: any = {
    host: SPAPI_HOST_EU,
    method: "GET",
    path,
    headers: {
      "x-amz-access-token": accessToken,
      "user-agent": "SellerCockpit/NewLinesScan",
    },
    service: "execute-api",
    region: SPAPI_REGION,
  };

  aws4.sign(opts, {
    accessKeyId: String(process.env.SPAPI_AWS_ACCESS_KEY_ID ?? ""),
    secretAccessKey: String(process.env.SPAPI_AWS_SECRET_ACCESS_KEY ?? ""),
    sessionToken: process.env.SPAPI_AWS_SESSION_TOKEN,
  });

  const url = `https://${SPAPI_HOST_EU}${path}`;
  const res = await fetch(url, { method: "GET", headers: opts.headers as any });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`SPAPI ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function searchCatalogByEans(marketplaceId: string, eans: string[]) {
  const identifiers = encodeURIComponent(eans.join(","));
  const includedData = encodeURIComponent("summaries,images,salesRanks,identifiers");

  const pathEan =
    `/catalog/2022-04-01/items?marketplaceIds=${encodeURIComponent(marketplaceId)}` +
    `&identifiersType=EAN&identifiers=${identifiers}&includedData=${includedData}`;

  const r1 = await spApiGet(pathEan).catch(() => null);
  if (r1?.items?.length) return r1;

  const pathGtin =
    `/catalog/2022-04-01/items?marketplaceIds=${encodeURIComponent(marketplaceId)}` +
    `&identifiersType=GTIN&identifiers=${identifiers}&includedData=${includedData}`;

  return spApiGet(pathGtin);
}

// ------------------- handler -------------------
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
      console.log("[new-lines-scan] BUILD_STAMP=NL_SCAN__2026-02-27__A");
  console.log("[new-lines-scan] req", {
    hasBody: !!event.body,
    rawPath: (event as any)?.rawPath,
    requestId: (event as any)?.requestContext?.requestId,
  });
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const req = body as ScanRequest;

    const eans = (req.eans || []).map((s) => String(s).trim()).filter(Boolean);
    let marketplaceIds = (req.marketplaceIds || []).map((s) => String(s).trim()).filter(Boolean);

if (!eans.length) {
  return json(400, { ok: false, error: "Missing eans" });
}
// If caller didn't pass marketplaceIds, use AppSettings.newLinesMarketplaceIdsJson (fallback UK+DE)
if (!marketplaceIds.length) {
  const GET_SETTINGS = /* GraphQL */ `
    query GetAppSettings($id: ID!) {
      getAppSettings(id: $id) {
        ukMarketplaceId
        euInventoryMarketplaceId
        newLinesMarketplaceIdsJson
      }
    }
  `;

  const s = await gql<{ getAppSettings?: any }>(GET_SETTINGS, { id: "global" });
  const uk = String(s?.getAppSettings?.ukMarketplaceId ?? "A1F83G8C2ARO7P");
  const de = String(s?.getAppSettings?.euInventoryMarketplaceId ?? "A1PA6795UKMFR9");
  const raw = s?.getAppSettings?.newLinesMarketplaceIdsJson;

  try {
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    marketplaceIds = Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    marketplaceIds = [];
  }

  // final fallback
  if (!marketplaceIds.length) marketplaceIds = [uk, de];
}

    const settings = {
      referralRate: req.settings?.referralRate ?? 0.153,
      cogsGbp: req.settings?.cogsGbp ?? 0,
      inboundShippingGbp: req.settings?.inboundShippingGbp ?? 0,
      prepCostGbp: req.settings?.prepCostGbp ?? 0,
      euSalesMultiplier: req.settings?.euSalesMultiplier ?? 1.18,
      eurPerGbp: req.settings?.eurPerGbp ?? 1.17,
    };

    const rows: ScanRow[] = [];
    const toFetchByMarketplace = new Map<string, string[]>();

    // 1) cache-first (per key)
    for (const mid of marketplaceIds) {
      for (const ean of eans) {
        const data = await gql<{ getProductScanCache: any }>(GET_CACHE, { ean, marketplaceId: mid });
        const cached = data?.getProductScanCache;

        const valid = cached && Number(cached.expireAt) > Math.floor(Date.now() / 1000);

        if (valid) {
          rows.push({
            ean,
            marketplaceId: mid,
            ok: true,
            fromCache: true,
            asin: cached.asin ?? undefined,
            title: cached.title ?? undefined,
            imageUrl: cached.imageUrl ?? undefined,
            price: cached.priceAmount ? { amount: Number(cached.priceAmount), currency: String(cached.priceCurrency) } : null,
            bsr: cached.bsr ?? null,
            categoryHint: cached.categoryHint ?? null,
            estMonthlySales: cached.estMonthlySales ?? null,
            estProfit: cached.estProfit ?? null,
            profitCurrency: cached.estProfitCurrency ?? null,
          });
        } else {
          if (!toFetchByMarketplace.has(mid)) toFetchByMarketplace.set(mid, []);
          toFetchByMarketplace.get(mid)!.push(ean);
        }
      }
    }

    // 2) fetch missing (chunked, throttled)
    for (const [mid, eansToFetch] of toFetchByMarketplace.entries()) {
      for (const batch of chunk(eansToFetch, 5)) {
        const data = await searchCatalogByEans(mid, batch);
        const items = (data?.items ?? []) as any[];
        console.log("[new-lines-scan] catalog resp", {
  mid,
  batch,
  topKeys: Object.keys(data ?? {}),
  itemCount: Array.isArray(data?.items) ? data.items.length : -1,
  rawHasErrors: Array.isArray((data as any)?.errors) ? (data as any).errors.length : 0,
});

// If Amazon returned an error payload, show the first one (safe length)
if (Array.isArray((data as any)?.errors) && (data as any).errors.length) {
  console.log("[new-lines-scan] catalog error[0]", JSON.stringify((data as any).errors[0]).slice(0, 2000));
}

// If items exist, show what keys exist on first item (helps fix mapping)
if (Array.isArray((data as any)?.items) && (data as any).items.length) {
  console.log("[new-lines-scan] first item keys", Object.keys((data as any).items[0] ?? {}));
}
        if (!items.length) {
  console.log("[new-lines-scan] EMPTY items", { mid, batch, rawKeys: Object.keys(data ?? {}) });
  console.log("[new-lines-scan] RAW", JSON.stringify(data ?? {}, null, 2).slice(0, 4000));
}

    // Map EAN -> item
const found = new Map<string, any>();

for (const it of items) {
  // 1) Preferred: match by identifiers (EAN/GTIN)
  const identBlocks = Array.isArray((it as any)?.identifiers) ? (it as any).identifiers : [];
  for (const blk of identBlocks) {
    const idents = Array.isArray(blk?.identifiers) ? blk.identifiers : [];
    for (const id of idents) {
      const t = String(id?.identifierType ?? "").toUpperCase();
      const e = String(id?.identifier ?? "");
      if ((t === "EAN" || t === "GTIN") && batch.includes(e) && !found.has(e)) {
        found.set(e, it);
      }
    }
  }
}

// 2) Fallback: if Amazon didn't return identifiers, but we got exactly 1 item for 1 ean
if (!found.size && items.length === 1 && batch.length === 1) {
  found.set(batch[0], items[0]);
}

// 3) Fallback: if counts match, assume same ordering (last resort, still cheap)
if (!found.size && items.length === batch.length) {
  for (let i = 0; i < batch.length; i++) found.set(batch[i], items[i]);
}

        // One cheap retry: if some EANs in this batch didn't match, retry JUST those once after a short delay.
const missing = batch.filter((ean) => !found.has(ean));
if (missing.length) {
  await delay(1500); // gives Amazon time to settle + avoids false negatives

  for (const missBatch of chunk(missing, 5)) {
    const data2 = await searchCatalogByEans(mid, missBatch).catch(() => null);
    const items2 = ((data2 as any)?.items ?? []) as any[];

    // Map EAN -> item for retry response (same logic)
    const found2 = new Map<string, any>();
    for (const it of items2) {
      const identBlocks = Array.isArray((it as any)?.identifiers) ? (it as any).identifiers : [];
      for (const blk of identBlocks) {
        const idents = Array.isArray(blk?.identifiers) ? blk.identifiers : [];
        for (const id of idents) {
          const t = String(id?.identifierType ?? "").toUpperCase();
          const e = String(id?.identifier ?? "");
          if ((t === "EAN" || t === "GTIN") && missBatch.includes(e) && !found2.has(e)) {
            found2.set(e, it);
          }
        }
      }
    }
    if (!found2.size && items2.length === 1 && missBatch.length === 1) found2.set(missBatch[0], items2[0]);
    if (!found2.size && items2.length === missBatch.length) {
      for (let i = 0; i < missBatch.length; i++) found2.set(missBatch[i], items2[i]);
    }

    for (const ean of missBatch) {
      const it = found2.get(ean);
      if (it && !found.has(ean)) found.set(ean, it);
    }
  }
}

for (const ean of batch) {
  const it = found.get(ean);
  if (!it) {
    rows.push({
      ean,
      marketplaceId: mid,
      ok: false,
      fromCache: false,
      message: "Not found in catalog",
    });
    continue;
  }

          const asin = String(it?.asin ?? "");
          const title = String(it?.summaries?.[0]?.itemName ?? "");
          const imageUrl = extractMainImage(it) ?? undefined;
          const bsr = extractBestBsr(it);
          const categoryHint = inferCategoryHint(it);
          const price = extractPrice(it);

          const baseSales = bsr && bsr > 0 ? calculateSales(bsr, categoryHint) : null;

          // NOTE: We treat non-UK as â€œEU multiplierâ€ here; later weâ€™ll detect actual region properly
          const isUk = mid === "A1F83G8C2ARO7P";
          const estMonthlySales = baseSales ? Math.round(baseSales * (isUk ? 1.0 : settings.euSalesMultiplier)) : null;

          let estProfit: number | null = null;
          let profitCurrency: string | null = null;

          if (price?.amount) {
            if (isUk) {
              estProfit = estimateProfit({
                sellPrice: price.amount,
                referralRate: settings.referralRate,
                cogs: settings.cogsGbp,
                inboundShipping: settings.inboundShippingGbp,
                prep: settings.prepCostGbp,
              });
              profitCurrency = "GBP";
            } else {
              const cogsEur = settings.cogsGbp * settings.eurPerGbp;
              const inboundEur = settings.inboundShippingGbp * settings.eurPerGbp;
              const prepEur = settings.prepCostGbp * settings.eurPerGbp;

              estProfit = estimateProfit({
                sellPrice: price.amount,
                referralRate: settings.referralRate,
                cogs: cogsEur,
                inboundShipping: inboundEur,
                prep: prepEur,
              });
              profitCurrency = "EUR";
            }
          }

          rows.push({
            ean,
            marketplaceId: mid,
            ok: true,
            fromCache: false,
            asin,
            title,
            imageUrl,
            price,
            bsr,
            categoryHint,
            estMonthlySales,
            estProfit,
            profitCurrency,
          });

          // upsert cache (update if exists, else create)
          const inputBase = {
            ean,
            marketplaceId: mid,
            asin,
            title,
            imageUrl: imageUrl ?? null,
            priceAmount: price?.amount ?? null,
            priceCurrency: price?.currency ?? null,
            bsr: bsr ?? null,
            categoryHint,
            estMonthlySales: estMonthlySales ?? null,
            estProfit: estProfit ?? null,
            estProfitCurrency: profitCurrency ?? null,
            lastUpdatedAtIso: nowIso(),
            expireAt: ttl24h(),
          };

          // try update first (safe if exists), fall back to create
          try {
            await gql(UPDATE_CACHE, { input: inputBase });
          } catch {
            await gql(UPSERT_CACHE, { input: inputBase });
          }
        }

        await delay(250);
      }
    }

    return json(200, { ok: true, rows });
  } catch (e: any) {
    return json(500, { ok: false, error: e?.message || String(e) });
  }
};

function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
    },
    body: JSON.stringify(body),
  };
}
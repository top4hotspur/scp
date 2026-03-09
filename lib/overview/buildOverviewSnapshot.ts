//lib/overview/buildOverviewSnapshot.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import outputs from "@/amplify_outputs.json";
import type { Schema } from "@/amplify/data/resource";

Amplify.configure(outputs, { ssr: true });

const client = generateClient<Schema>();
const anyClient = client as any;

type CombinedRow = {
  sku?: string | null;
  shortTitle?: string | null;
  listingTitle?: string | null;
  marketplaceId?: string | null;
  qty?: number | null;
  shippedAtIso?: string | null;
  currency?: string | null;
  stockAvailable?: number | null;
  revenueExVat?: number | null;
  profitExVat?: number | null;
  marginPct?: number | null;
  roiPct?: number | null;
  missingCostFields?: boolean | null;
};

type CostInfo = {
  productCostExVatGbp: number;
  prepCostExVatGbp: number;
  shippingCostExVatGbp: number;
};

function safeNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pctChange(current: number, previous: number) {
  if (!previous) return current === 0 ? 0 : 100;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function gbpFromCurrency(amount: number, currency: string | null | undefined, eurToGbpRate: number) {
  const c = String(currency || "").toUpperCase();
  if (!amount) return 0;
  if (!c || c === "GBP") return amount;
  if (c === "EUR") return amount * eurToGbpRate;
  return amount;
}

function getMarketplaceCountryCode(marketplaceId: string | null | undefined) {
  const mid = String(marketplaceId || "");
  switch (mid) {
    case "A1F83G8C2ARO7P":
      return "GB";
    case "A1PA6795UKMFR9":
      return "DE";
    case "A13V1IB3VIYZZH":
      return "FR";
    case "APJ6JRA9NG5V4":
      return "IT";
    case "A1RKKUPIHCS9HS":
      return "ES";
    case "A1805IZSGTT6HS":
      return "NL";
    case "AMEN7PMS3EDWL":
      return "SE";
    case "A2NODRKZP88ZB9":
      return "PL";
    default:
      return "GB";
  }
}

function toExVat(
  grossOrNet: number,
  marketplaceId: string | null | undefined,
  supplierMapCostsIncludeVat: boolean,
  vatRegisteredCountries: string[],
  vatRatesByCountry: Record<string, number>
) {
  if (!grossOrNet) return 0;
  if (!supplierMapCostsIncludeVat) return grossOrNet;

  const country = getMarketplaceCountryCode(marketplaceId);
  if (!vatRegisteredCountries.includes(country)) return grossOrNet;

  const ratePct = Number(vatRatesByCountry[country] ?? 0);
  if (!Number.isFinite(ratePct) || ratePct <= 0) return grossOrNet;

  return grossOrNet / (1 + ratePct / 100);
}

async function getAppSettings() {
  const res = await anyClient.models.AppSettings.get({ id: "global" });
  return res?.data ?? null;
}

async function getOverviewBaseUrl() {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.AMPLIFY_APP_ORIGIN ||
    "http://localhost:3000";

  return appUrl.replace(/\/+$/, "");
}

async function getCombinedSnapshot(bucket: "today" | "yesterday" | "7d" | "30d", mid: string) {
  const baseUrl = await getOverviewBaseUrl();
  const url = `${baseUrl}/api/sales/combined-snapshot?mid=${encodeURIComponent(mid)}&bucket=${encodeURIComponent(bucket)}`;

  const res = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Combined snapshot fetch failed for ${bucket}: ${res.status}`);
  }

  return (await res.json()) as {
    ok: boolean;
    bucket: string;
    rows?: CombinedRow[];
    totals?: {
      rows?: number;
      units?: number;
      profitExVat?: number;
      revenueExVat?: number;
    };
  };
}

async function getSupplierCostMap(): Promise<Record<string, CostInfo>> {
  const out: Record<string, CostInfo> = {};
  let nextToken: string | null | undefined = null;
  let loggedSample = false;

  do {
    const res: any = await anyClient.models.SupplierMap.list({
      limit: 1000,
      nextToken,
    });

    const rows = res?.data ?? [];

    if (!loggedSample && rows.length) {
      loggedSample = true;
      console.log("[overview] SupplierMap sample keys:", Object.keys(rows[0] || {}).sort());
      console.log("[overview] SupplierMap sample row:", JSON.stringify(rows[0], null, 2));
    }

    for (const r of rows) {
      const sku = String(r?.sku ?? "").trim();
      if (!sku) continue;

      const productCostExVatGbpRaw = safeNum(r?.productCost);
const prepCostExVatGbpRaw = safeNum(r?.prepCost);
const shippingCostExVatGbpRaw = safeNum(r?.shippingCost);

out[sku] = {
  productCostExVatGbp: productCostExVatGbpRaw,
  prepCostExVatGbp: prepCostExVatGbpRaw,
  shippingCostExVatGbp: shippingCostExVatGbpRaw,
};
    }

    nextToken = res?.nextToken;
  } while (nextToken);

  return out;
}

function parseAvailabilityMap(json: any): Record<string, number> {
  const out: Record<string, number> = {};
  const root = json?.snapshot ?? json;

  if (root?.availability && typeof root.availability === "object") {
    for (const [sku, v] of Object.entries(root.availability)) {
      out[String(sku)] = safeNum(v);
    }
    return out;
  }

  if (Array.isArray(root?.rows)) {
    for (const row of root.rows) {
      const sku = String((row as any)?.sku ?? "").trim();
      if (!sku) continue;
      out[sku] = safeNum(
        (row as any)?.available ??
          (row as any)?.availableUnits ??
          (row as any)?.stockAvailable ??
          0
      );
    }
    return out;
  }

  return out;
}

async function getAvailabilityMap(mid: string, skus: string[]) {
  if (!mid || !skus.length) return {};

  const baseUrl = await getOverviewBaseUrl();
  const url = `${baseUrl}/api/inventory/availability?mid=${encodeURIComponent(mid)}&skus=${encodeURIComponent(
    skus.join(",")
  )}`;

  const res = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });

  if (!res.ok) return {};
  const json = await res.json();
  return parseAvailabilityMap(json);
}

function enrichLast10Sales(
  rows30: CombinedRow[],
  costBySku: Record<string, CostInfo>,
  ukAvailBySku: Record<string, number>,
  euAvailBySku: Record<string, number>,
  eurToGbpRate: number,
  supplierMapCostsIncludeVat: boolean,
  vatRegisteredCountries: string[],
  vatRatesByCountry: Record<string, number>
) {
  return [...(rows30 || [])]
    .filter((r) => r?.sku && r?.shippedAtIso)
    .sort((a, b) => String(b.shippedAtIso || "").localeCompare(String(a.shippedAtIso || "")))
    .slice(0, 10)
    .map((r) => {
      const sku = String(r.sku || "");
      const qty = Math.max(1, safeNum(r.qty));
      const revenueExVatGbp = gbpFromCurrency(safeNum(r.revenueExVat), r.currency, eurToGbpRate);

      const productCostExVatGbp = safeNum(costBySku[sku]?.productCostExVatGbp);
      const prepCostExVatGbp = safeNum(costBySku[sku]?.prepCostExVatGbp);
      const shippingCostExVatGbp = safeNum(costBySku[sku]?.shippingCostExVatGbp);

      const unitLandedCostGbp =
        productCostExVatGbp + prepCostExVatGbp + shippingCostExVatGbp;

      const totalCostGbp = unitLandedCostGbp * qty;
      const profitGbp = revenueExVatGbp - totalCostGbp;

      const hasUk = Object.prototype.hasOwnProperty.call(ukAvailBySku, sku);
      const hasEu = Object.prototype.hasOwnProperty.call(euAvailBySku, sku);

      const hasAnyCost =
        productCostExVatGbp > 0 ||
        prepCostExVatGbp > 0 ||
        shippingCostExVatGbp > 0;

      return {
        orderDateIso: r.shippedAtIso || "",
        sku,
        productName: r.shortTitle || r.listingTitle || r.sku || "",
        imageUrl: "",
        totalCostGbp,
        sellingPriceGbp: revenueExVatGbp,
        profitGbp,
        unitsRemainingUk: hasUk ? safeNum(ukAvailBySku[sku]) : "N/A",
        unitsRemainingEu: hasEu ? safeNum(euAvailBySku[sku]) : "N/A",
        missingCostFields: !hasAnyCost,
      };
    });
}

function sumProfitFromRows(
  rows: CombinedRow[],
  costBySku: Record<string, CostInfo>,
  eurToGbpRate: number,
  supplierMapCostsIncludeVat: boolean,
  vatRegisteredCountries: string[],
  vatRatesByCountry: Record<string, number>
) {
  return (rows || []).reduce((acc, r) => {
    const sku = String(r?.sku || "");
    const qty = Math.max(1, safeNum(r?.qty));
    const revenueExVatGbp = gbpFromCurrency(safeNum(r?.revenueExVat), r?.currency, eurToGbpRate);

    const productCostExVatGbp = safeNum(costBySku[sku]?.productCostExVatGbp);
    const prepCostExVatGbp = safeNum(costBySku[sku]?.prepCostExVatGbp);
    const shippingCostExVatGbp = safeNum(costBySku[sku]?.shippingCostExVatGbp);

    const unitLandedCostGbp =
      productCostExVatGbp + prepCostExVatGbp + shippingCostExVatGbp;

    return acc + (revenueExVatGbp - unitLandedCostGbp * qty);
  }, 0);
}

function sumRevenueFromRows(rows: CombinedRow[], eurToGbpRate: number) {
  return (rows || []).reduce((acc, r) => {
    return acc + gbpFromCurrency(safeNum(r?.revenueExVat), r?.currency, eurToGbpRate);
  }, 0);
}

export async function buildOverviewSnapshot() {
  const settings = await getAppSettings();
  const eurToGbpRate = safeNum(settings?.eurToGbpRate || 0.86);
  const supplierMapCostsIncludeVat = Boolean(settings?.supplierMapCostsIncludeVat);
const vatRegisteredCountries = Array.isArray(
  safeJsonMaybe(settings?.vatRegisteredCountriesJson)
)
  ? safeJsonMaybe(settings?.vatRegisteredCountriesJson)
  : ["GB"];

const vatRatesByCountry =
  (safeJsonMaybe(settings?.vatRatesByCountryJson) as Record<string, number>) || {};

  function safeJsonMaybe(s: any) {
  try {
    return typeof s === "string" ? JSON.parse(s) : s;
  } catch {
    return null;
  }
}

  const ukMid = String(settings?.ukMarketplaceId || "A1F83G8C2ARO7P");
  const euInvMid = String(settings?.euInventoryMarketplaceId || "A1PA6795UKMFR9");

  const [todaySnap, yesterdaySnap, d7Snap, d30Snap, costBySku] = await Promise.all([
    getCombinedSnapshot("today", ukMid),
    getCombinedSnapshot("yesterday", ukMid),
    getCombinedSnapshot("7d", ukMid),
    getCombinedSnapshot("30d", ukMid),
    getSupplierCostMap(),
  ]);

  const profitTodayGbp = sumProfitFromRows(
  todaySnap.rows || [],
  costBySku,
  eurToGbpRate,
  supplierMapCostsIncludeVat,
  vatRegisteredCountries,
  vatRatesByCountry
);

const profitYesterdayGbp = sumProfitFromRows(
  yesterdaySnap.rows || [],
  costBySku,
  eurToGbpRate,
  supplierMapCostsIncludeVat,
  vatRegisteredCountries,
  vatRatesByCountry
);

const profit7dGbp = sumProfitFromRows(
  d7Snap.rows || [],
  costBySku,
  eurToGbpRate,
  supplierMapCostsIncludeVat,
  vatRegisteredCountries,
  vatRatesByCountry
);

const profit30dGbp = sumProfitFromRows(
  d30Snap.rows || [],
  costBySku,
  eurToGbpRate,
  supplierMapCostsIncludeVat,
  vatRegisteredCountries,
  vatRatesByCountry
);

  const profitYesterdayPrevGbp = 0;
  const profitPrev7dGbp = 0;
  const profitPrev30dGbp = 0;

  const salesTodayGbp = sumRevenueFromRows(todaySnap.rows || [], eurToGbpRate);
  const salesYesterdayGbp = sumRevenueFromRows(yesterdaySnap.rows || [], eurToGbpRate);
  const sales7dGbp = sumRevenueFromRows(d7Snap.rows || [], eurToGbpRate);
  const sales30dGbp = sumRevenueFromRows(d30Snap.rows || [], eurToGbpRate);

  const rows30 = d30Snap.rows || [];
  const last10Skus = [...new Set(rows30
    .filter((r) => r?.sku && r?.shippedAtIso)
    .sort((a, b) => String(b.shippedAtIso || "").localeCompare(String(a.shippedAtIso || "")))
    .slice(0, 10)
    .map((r) => String(r?.sku || ""))
    .filter(Boolean))];

  const [ukAvailBySku, euAvailBySku] = await Promise.all([
    getAvailabilityMap(ukMid, last10Skus),
    getAvailabilityMap(euInvMid, last10Skus),
  ]);

  const last10SalesJson = enrichLast10Sales(
  rows30,
  costBySku,
  ukAvailBySku,
  euAvailBySku,
  eurToGbpRate,
  supplierMapCostsIncludeVat,
  vatRegisteredCountries,
  vatRatesByCountry
);

  const payload = {
    marketplaceId: "GLOBAL",
    bucket: "latest",
    createdAtIso: new Date().toISOString(),
    source: "builder",
    status: "OK",
    message:
      "Overview built from combined sales snapshots + SupplierMap unit costs + inventory availability for last 10 sales.",
    profitTodayGbp,
    profitYesterdayGbp,
    profitYesterdayPrevGbp,
    profit7dGbp,
    profitPrev7dGbp,
    profit30dGbp,
    profitPrev30dGbp,
    salesTodayGbp,
    salesYesterdayGbp,
    sales7dGbp,
    sales30dGbp,
    last10SalesJson: JSON.stringify(last10SalesJson),
    supplierRiskJson: JSON.stringify([]),
    salesRowsUsed: rows30.length,
    supplierRowsUsed: Object.keys(costBySku).length,
    inventoryRowsUsed: last10Skus.length,
  };

  const existing = await anyClient.models.OverviewSnapshot.get({
    marketplaceId: "GLOBAL",
    bucket: "latest",
  });

  if (existing?.data) {
    const updated = await anyClient.models.OverviewSnapshot.update(payload);
    if (updated?.errors?.length) {
      throw new Error(
        `OverviewSnapshot update failed: ${updated.errors.map((e: any) => e.message).join("; ")}`
      );
    }
  } else {
    const created = await anyClient.models.OverviewSnapshot.create(payload);
    if (created?.errors?.length) {
      throw new Error(
        `OverviewSnapshot create failed: ${created.errors.map((e: any) => e.message).join("; ")}`
      );
    }
  }

  const verify = await anyClient.models.OverviewSnapshot.get({
    marketplaceId: "GLOBAL",
    bucket: "latest",
  });

  if (!verify?.data) {
    throw new Error("OverviewSnapshot was built but could not be read back after save");
  }

  return verify.data;
}

export function buildProfitCards(snapshot: any) {
  const yDeltaPct =
    safeNum(snapshot?.profitYesterdayPrevGbp) > 0
      ? pctChange(safeNum(snapshot?.profitYesterdayGbp), safeNum(snapshot?.profitYesterdayPrevGbp))
      : null;

  const d7DeltaPct =
    safeNum(snapshot?.profitPrev7dGbp) > 0
      ? pctChange(safeNum(snapshot?.profit7dGbp), safeNum(snapshot?.profitPrev7dGbp))
      : null;

  const d30DeltaPct =
    safeNum(snapshot?.profitPrev30dGbp) > 0
      ? pctChange(safeNum(snapshot?.profit30dGbp), safeNum(snapshot?.profitPrev30dGbp))
      : null;

  return {
    today: {
      value: safeNum(snapshot?.profitTodayGbp),
      salesTotal: safeNum(snapshot?.salesTodayGbp),
      deltaPct: null,
    },
    yesterday: {
      value: safeNum(snapshot?.profitYesterdayGbp),
      salesTotal: safeNum(snapshot?.salesYesterdayGbp),
      deltaPct: yDeltaPct,
    },
    d7: {
      value: safeNum(snapshot?.profit7dGbp),
      salesTotal: safeNum(snapshot?.sales7dGbp),
      deltaPct: d7DeltaPct,
    },
    d30: {
      value: safeNum(snapshot?.profit30dGbp),
      salesTotal: safeNum(snapshot?.sales30dGbp),
      deltaPct: d30DeltaPct,
    },
  };
}
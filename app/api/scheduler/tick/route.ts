// app/api/scheduler/tick/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from "next/server";
import { gql } from "@/lib/appsyncGql";
export const runtime = "nodejs";
type GqlResp<T> = { data?: T; errors?: { message: string }[] };



function safeJson<T>(s: any, fallback: T): T {
  try {
    const v = typeof s === "string" ? JSON.parse(s) : s;
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function uniqNonEmpty(arr: any[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of arr.map((v) => String(v ?? "").trim()).filter(Boolean)) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function baseUrlFromReq(req: Request) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  if (!host) return null;
  return `${proto}://${host}`;
}

async function postJson(url: string) {
  const res = await fetch(url, { method: "POST", cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && !!json?.ok, status: res.status, json };
}

function getLondonHourNow(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hh = parts.find((p) => p.type === "hour")?.value ?? "0";
  const n = Number(hh);
  return Number.isFinite(n) ? n : 0;
}

function isWithinDayWindow(hourNow: number, dayStart: number, dayEnd: number): boolean {
  // supports windows that might cross midnight
  if (dayStart === dayEnd) return true;
  if (dayStart < dayEnd) return hourNow >= dayStart && hourNow < dayEnd;
  return hourNow >= dayStart || hourNow < dayEnd;
}

function minutesSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 60000));
}

// ---------- Settings + Cadence ----------

type CadenceRule = {
  enabled?: boolean;
  dayMinutes?: number;
  nightMinutes?: number;
};

type CadenceMap = Record<string, CadenceRule>;

const GET_SETTINGS = /* GraphQL */ `
  query GetAppSettings($id: ID!) {
    getAppSettings(id: $id) {
      id
      ukMarketplaceId
      euMarketplaceIdsJson
      reportDayStartHour
      reportDayEndHour
      reportCadenceByReportJson
      reportLastSuccessByKeyJson

      inventoryLastRunByKeyJson
    }
  }
`;

const UPDATE_SETTINGS = /* GraphQL */ `
  mutation UpdateAppSettings($input: UpdateAppSettingsInput!) {
    updateAppSettings(input: $input) {
      id
      inventoryLastRunByKeyJson
    }
  }
`;

function getNowIso() {
  return new Date().toISOString();
}

function mergeRunMap(existing: any, key: string, iso: string) {
  const cur = safeJson<Record<string, string>>(existing ?? "{}", {});
  return { ...cur, [key]: iso };
}

async function stampLastRun(settingsId: string, settingsObj: any, key: string) {
  const iso = getNowIso();

  // Prefer "lastRunByKeyJson" if present, else fall back to your existing map.
  const hasInventoryRun = typeof settingsObj?.inventoryLastRunByKeyJson !== "undefined";
if (!hasInventoryRun) return;

const input: any = { id: settingsId };
input.inventoryLastRunByKeyJson = JSON.stringify(mergeRunMap(settingsObj.inventoryLastRunByKeyJson, key, iso));

try {
  await gql(UPDATE_SETTINGS, { input });
  settingsObj.inventoryLastRunByKeyJson = input.inventoryLastRunByKeyJson;
} catch {
  // schema might not include the field; ignore
}
}

function defaultCadence(): CadenceMap {
  // STK-cheap defaults; UI can override via reportCadenceByReportJson
  return {
    "inventory.ingest": { enabled: true, dayMinutes: 60, nightMinutes: 180 },
    "inventory.snapshot": { enabled: true, dayMinutes: 60, nightMinutes: 180 },

    "listings.snapshot": { enabled: true, dayMinutes: 360, nightMinutes: 1440 },

    "sales.orders": { enabled: true, dayMinutes: 15, nightMinutes: 120 },
    "sales.snapshot": { enabled: true, dayMinutes: 15, nightMinutes: 120 },

    "fee.estimate": { enabled: true, dayMinutes: 1440, nightMinutes: 1440 },

    // NEW — Repricer
    "repricer.uk": { enabled: true, dayMinutes: 15, nightMinutes: 60 },
    "repricer.other": { enabled: true, dayMinutes: 60, nightMinutes: 120 },
  };
}

function ruleMinutes(rule: CadenceRule, isDay: boolean): number {
  const m = Number(isDay ? rule?.dayMinutes : rule?.nightMinutes);
  return Number.isFinite(m) && m > 0 ? Math.trunc(m) : 0;
}

// ---------- Snapshot freshness checks (cheap single reads) ----------

const GET_INV_SNAPSHOT_LATEST = /* GraphQL */ `
  query GetInventorySnapshot($marketplaceId: String!, $bucket: String!) {
    getInventorySnapshot(marketplaceId: $marketplaceId, bucket: $bucket) {
      marketplaceId
      bucket
      createdAtIso
      status
    }
  }
`;

// Your tree shows SalesSummarySnapshot, not SalesSnapshot.
// We'll use bucket "30d" (matches your build-snapshot usage).
const GET_CLEAN_SNAPSHOT_LATEST = /* GraphQL */ `
  query GetCleanListingSnapshot($marketplaceId: String!, $bucket: String!) {
    getCleanListingSnapshot(marketplaceId: $marketplaceId, bucket: $bucket) {
      marketplaceId
      bucket
      createdAtIso
    }
  }
`;

const GET_SALES_SUMMARY_SNAPSHOT = /* GraphQL */ `
  query GetSalesSummarySnapshot($marketplaceId: String!, $bucket: String!) {
    getSalesSummarySnapshot(marketplaceId: $marketplaceId, bucket: $bucket) {
      marketplaceId
      bucket
      createdAtIso
    }
  }
`;

async function getInvAgeMinutes(mid: string): Promise<number | null> {
  try {
    const d: any = await gql(GET_INV_SNAPSHOT_LATEST, { marketplaceId: mid, bucket: "latest" });
    const iso = d?.getInventorySnapshot?.createdAtIso ?? null;
    return minutesSince(iso);
  } catch {
    return null;
  }
}

async function getListingsAgeMinutes(mid: string): Promise<number | null> {
  try {
    const d: any = await gql(GET_CLEAN_SNAPSHOT_LATEST, { marketplaceId: mid, bucket: "latest" });
    const iso = d?.getCleanListingSnapshot?.createdAtIso ?? null;
    return minutesSince(iso);
  } catch {
    return null;
  }
}

async function getSalesAgeMinutes(mid: string): Promise<number | null> {
  try {
    const d: any = await gql(GET_SALES_SUMMARY_SNAPSHOT, { marketplaceId: mid, bucket: "30d" });
    const iso = d?.getSalesSummarySnapshot?.createdAtIso ?? null;
    return minutesSince(iso);
  } catch {
    // if model not present in schema yet, treat as unknown
    return null;
  }
}

// ---------- Main tick ----------

export async function POST(req: Request) {
  try {
    const baseUrl =
  baseUrlFromReq(req) ||
  String(process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_BASE_URL ?? "").trim();

if (!baseUrl) return NextResponse.json({ ok: false, error: "Missing host headers / APP_BASE_URL" }, { status: 500 });

    const { searchParams } = new URL(req.url);
    const verbose = String(searchParams.get("verbose") ?? "").trim() === "1";
    const force = String(searchParams.get("force") ?? "").trim() === "1";
    const steps = String(searchParams.get("steps") ?? "").trim().toLowerCase(); // "", "repricer", "inventory", "sales"
const onlyRepricer = steps === "repricer";
const onlyInventory = steps === "inventory";
const onlySales = steps === "sales";

    const s = await gql<{ getAppSettings: any }>(GET_SETTINGS, { id: "global" });
    const settings = s?.getAppSettings ?? {};

    const ukMid = String(settings.ukMarketplaceId ?? "").trim();
    const euMids = safeJson<string[]>(settings.euMarketplaceIdsJson ?? "[]", []);
    const allMids = uniqNonEmpty([ukMid, ...euMids]);

const onlyMid = String(searchParams.get("mid") ?? "").trim();
const midsToRun = onlyMid ? uniqNonEmpty([onlyMid]) : allMids;

    const dayStartHour = Number(settings.reportDayStartHour ?? 7);
    const dayEndHour = Number(settings.reportDayEndHour ?? 22);

    const hourNow = getLondonHourNow();
    const isDay = isWithinDayWindow(
      hourNow,
      Number.isFinite(dayStartHour) ? dayStartHour : 7,
      Number.isFinite(dayEndHour) ? dayEndHour : 22
    );

    const storedCadence = safeJson<CadenceMap>(settings.reportCadenceByReportJson ?? "{}", {});
    const cadence: CadenceMap = { ...defaultCadence(), ...storedCadence };
    const lastRunMap = safeJson<Record<string, string>>(settings.inventoryLastRunByKeyJson ?? "{}", {});
    const lastSuccessMap = safeJson<Record<string, string>>(settings.reportLastSuccessByKeyJson ?? "{}", {});

    const ran: any[] = [];
    const errors: any[] = [];

    async function maybeRun(stepKey: string, mid: string, ageMinutes: number | null, runUrl: string) {
      const rule = cadence[stepKey] ?? { enabled: false };
      const enabled = Boolean(rule.enabled ?? false);
      const everyMin = ruleMinutes(rule, isDay);

      if (!enabled) return;

      if (!force) {
        // If we can measure age: only run when stale vs cadence
        if (ageMinutes != null && everyMin > 0 && ageMinutes < everyMin) return;
        // If we cannot measure age (null), still run (endpoints are idempotent/cheap)
      }

      try {
        const out = await postJson(runUrl);

if (!out.ok) {
  ran.push(verbose ? { step: stepKey, mid, ok: false, out } : { step: stepKey, mid, ok: false });
  errors.push({ step: stepKey, mid, status: out.status, error: out?.json?.error ?? `HTTP ${out.status}` });
  return; // don't explode the whole tick
}

ran.push(verbose ? { step: stepKey, mid, ok: true, out } : { step: stepKey, mid, ok: true });

// Stamp "last ran" witness keys
// Use consistent keys that the UI can render.
let key = "";
if (stepKey.startsWith("inventory.")) key = `INV:${mid}`;
else if (stepKey.startsWith("sales.")) key = `SALES:${mid}`;
else if (stepKey === "listings.snapshot") key = `LISTINGS:${mid}`;
else if (stepKey === "fee.estimate") key = `FEE:${mid}`;
else if (stepKey.startsWith("repricer.")) key = `REPRICER:${mid}`;
else key = `${stepKey}:${mid}`;

await stampLastRun("global", settings, key);
      } catch (e: any) {
        errors.push({ step: stepKey, mid, error: String(e?.message ?? e) });
      }
    }

    for (const mid of midsToRun) {

      if (!onlyRepricer && !onlySales) {
  const invAge = await getInvAgeMinutes(mid);

  await maybeRun("inventory.ingest", mid, invAge, `${baseUrl}/api/inventory/ingest?mid=${encodeURIComponent(mid)}`);
  await maybeRun(
    "inventory.snapshot",
    mid,
    invAge,
    `${baseUrl}/api/inventory/snapshot/build?mid=${encodeURIComponent(mid)}&source=scheduler`
  );

  const listingsAge = await getListingsAgeMinutes(mid);
  await maybeRun(
    "listings.snapshot",
    mid,
    listingsAge,
    `${baseUrl}/api/clean/all-listings/ingest?mid=${encodeURIComponent(mid)}`
  );

  const feeAge = minutesSince(lastRunMap[`FEE:${mid}`] ?? null);
  await maybeRun("fee.estimate", mid, feeAge, `${baseUrl}/api/fees/estimate?mid=${encodeURIComponent(mid)}`);
}

if (!onlyRepricer && !onlyInventory) {
  const salesOrdersAge = minutesSince(lastSuccessMap[`SALES_ORDERS:${mid}`] ?? lastRunMap[`SALES:${mid}`] ?? null);
  const salesSnapshotAge = await getSalesAgeMinutes(mid);

  await maybeRun("sales.orders", mid, salesOrdersAge, `${baseUrl}/api/sales/reports/orders/download?mid=${encodeURIComponent(mid)}`);
  await maybeRun("sales.snapshot", mid, salesSnapshotAge, `${baseUrl}/api/sales/build-snapshot?mid=${encodeURIComponent(mid)}`);
}
            // ---------- Repricer ----------
      const isUk = mid === ukMid;

      if (isUk) {
        const repricerAge = minutesSince(lastRunMap[`REPRICER:${mid}`] ?? null);
        await maybeRun(
          "repricer.uk",
          mid,
          repricerAge,
          `${baseUrl}/api/repricer/run?mid=${encodeURIComponent(mid)}`
        );
      } else {
        const repricerAge = minutesSince(lastRunMap[`REPRICER:${mid}`] ?? null);
        await maybeRun(
          "repricer.other",
          mid,
          repricerAge,
          `${baseUrl}/api/repricer/run?mid=${encodeURIComponent(mid)}`
        );
      }
    }

    return NextResponse.json({
      ok: true,
      window: {
        timeZone: "Europe/London",
        isDay,
        dayStartHour: Number.isFinite(dayStartHour) ? dayStartHour : 7,
        dayEndHour: Number.isFinite(dayEndHour) ? dayEndHour : 22,
        hourNow,
      },
      midsToRun,
      cadence,
      ran,
      errors,
      note: verbose ? "verbose=1 returns full downstream outputs (can be huge)." : "Add ?verbose=1 for full downstream outputs.",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}


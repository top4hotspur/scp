// app/api/repricer/run/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from "next/server";
import { gql } from "@/lib/appsyncGql";
export const runtime = "nodejs";

function safeJson<T>(s: any, fallback: T): T {
  try {
    const v = typeof s === "string" ? JSON.parse(s) : s;
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

async function gqlStep<T = any>(label: string, query: string, variables?: any): Promise<T> {
  try {
    return (await gql(query, variables)) as any;
  } catch (e: any) {
    throw new Error(`[REPRICER:${label}] ${String(e?.message ?? e)}`);
  }
}

function minutesAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 60000;
}

async function getOrRefreshTruth(baseUrl: string, mid: string, sku: string): Promise<PriceTruth | null> {
  // 1) Try existing
  let truth = await getOfferTruth(mid, sku);

  const age = minutesAgo(truth?.updatedAtIso);
  if (truth && age != null && age <= 30) {
    return truth; // fresh
  }

  // 2) Refresh on-demand (STK style)
  await fetch(
  `${baseUrl}/api/listings/truth/refresh?mid=${encodeURIComponent(mid)}&sku=${encodeURIComponent(sku)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      cache: "no-store",
    }
  );

  // 3) Re-get
  truth = await getOfferTruth(mid, sku);
  return truth ?? null;
}


function addMinutesIso(iso: string, minutes: number) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t + minutes * 60000).toISOString();
}

function isoInFuture(iso: string | null | undefined) {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return t > Date.now();
}

function baseUrlFromReq(req: Request) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  if (!host) return null;
  return `${proto}://${host}`;
}

async function getJson(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
}

async function postJsonBody(url: string, body: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
}

const GET_SETTINGS = /* GraphQL */ `
  query GetAppSettings($id: ID!) {
    getAppSettings(id: $id) {
  id
  repricerStrategiesJson
  repricerAssignmentsJson
  updatedAtIso

  inventoryLastRunByKeyJson
}
  }
`;

const GET_VAT = /* GraphQL */ `
  query GetVatSettings($id: ID!) {
    getVatSettings(id: $id) {
      id
      vatRegisteredJson
      vatRateJson
    }
  }
`;

const GET_OFFERTRUTH = /* GraphQL */ `
  query GetOfferTruth($marketplaceId: String!, $sku: String!) {
    getOfferTruth(marketplaceId: $marketplaceId, sku: $sku) {
      marketplaceId
      sku
      currency
      ownPrice
      buyBoxPrice
      isOnlySeller
      ownBuyBox
      updatedAtIso
    }
  }
`;

const UPSERT_STATE = /* GraphQL */ `
  mutation UpsertPricePilotState($input: CreatePricePilotStateInput!) {
    createPricePilotState(input: $input) {
      marketplaceId
      sku
      updatedAtIso
    }
  }
`;

const UPDATE_STATE = /* GraphQL */ `
  mutation UpdatePricePilotState($input: UpdatePricePilotStateInput!) {
    updatePricePilotState(input: $input) {
      marketplaceId
      sku
      updatedAtIso
    }
  }
`;

const CREATE_DECISION = /* GraphQL */ `
  mutation CreateRepricerDecision($input: CreateRepricerDecisionInput!) {
    createRepricerDecision(input: $input) {
      id
    }
  }
`;

const GET_STATE = /* GraphQL */ `
  query GetPricePilotState($marketplaceId: String!, $sku: String!) {
    getPricePilotState(marketplaceId: $marketplaceId, sku: $sku) {
      marketplaceId
      sku
      dayKey
      changesToday
      cooldownUntilIso
    }
  }
`;

const UPDATE_SETTINGS = /* GraphQL */ `
  mutation UpdateAppSettings($input: UpdateAppSettingsInput!) {
    updateAppSettings(input: $input) { id inventoryLastRunByKeyJson }
  }
`;

function safeJsonObj(s: any): Record<string, string> {
  try {
    const v = typeof s === "string" ? JSON.parse(s) : s;
    return (v && typeof v === "object") ? v : {};
  } catch {
    return {};
  }
}

async function stampRunKey(settingsObj: any, key: string) {
  const iso = new Date().toISOString();
  const input: any = { id: "global" };

  // Fall back to inventoryLastRunByKeyJson if thatÃ¢â‚¬â„¢s what exists
  if (typeof settingsObj?.inventoryLastRunByKeyJson !== "undefined") {
    const cur = safeJsonObj(settingsObj.inventoryLastRunByKeyJson);
    input.inventoryLastRunByKeyJson = JSON.stringify({ ...cur, [key]: iso });
  }

  if (Object.keys(input).length === 1) return;

  try { await gqlStep("STAMP_RUNKEY", UPDATE_SETTINGS, { input }); } catch { /* ignore */ }
}

type Strategy = any;    // stored JSON
type Assignment = any;  // stored JSON

type PriceTruth = {
  currency?: string | null;
  ownPrice?: number | null;
  buyBoxPrice?: number | null;
  isOnlySeller?: boolean | null;
  ownBuyBox?: boolean | null;
  updatedAtIso?: string | null;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function ymd(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function nowIso() {
  return new Date().toISOString();
}

async function getState(
  mid: string,
  sku: string
): Promise<{ dayKey?: string | null; changesToday?: number | null; cooldownUntilIso?: string | null } | null> {
  try {
    const d: any = await gqlStep("GET_STATE", GET_STATE, { marketplaceId: mid, sku });
    return d?.getPricePilotState ?? null;
  } catch {
    return null; // treat as missing state if unauthorized / absent
  }
}

async function getOfferTruth(mid: string, sku: string): Promise<PriceTruth | null> {
  try {
    const d: any = await gqlStep("GET_OFFERTRUTH", GET_OFFERTRUTH, { marketplaceId: mid, sku });
    const t = d?.getOfferTruth ?? null;
    if (!t) return null;

    return {
  currency: t.currency ?? null,
  ownPrice: t.ownPrice ?? null,
  buyBoxPrice: t.buyBoxPrice ?? null,
  isOnlySeller: t.isOnlySeller ?? null,
  ownBuyBox: t.ownBuyBox ?? null,
  updatedAtIso: t.updatedAtIso ?? null,
};
  } catch {
    return null;
  }
}

// Decide assignment specificity: SKU > SUPPLIER > PG5..PG1
function pickAssignment(assignments: Assignment[], ctx: { sku: string; supplier?: string; pg?: (string | undefined)[]; mid: string }) {
  const mid = ctx.mid;

  const applicable = assignments.filter((a) => {
    if (a?.isPaused) return false;
    const aMid = String(a?.marketplaceId ?? "ALL");
    if (aMid !== "ALL" && aMid !== mid) return false;

    const t = String(a?.scopeType ?? "");
    const v = String(a?.scopeValue ?? "").trim();
    if (!t || !v) return false;

    if (t === "SKU") return v === ctx.sku;
    if (t === "SUPPLIER") return v === String(ctx.supplier ?? "");
    if (t === "PG1") return v === String(ctx.pg?.[0] ?? "");
    if (t === "PG2") return v === String(ctx.pg?.[1] ?? "");
    if (t === "PG3") return v === String(ctx.pg?.[2] ?? "");
    if (t === "PG4") return v === String(ctx.pg?.[3] ?? "");
    if (t === "PG5") return v === String(ctx.pg?.[4] ?? "");
    return false;
  });

  // Priority order:
  const order = ["SKU", "SUPPLIER", "PG5", "PG4", "PG3", "PG2", "PG1"];
  for (const key of order) {
    const hit = applicable.find((a) => String(a.scopeType) === key);
    if (hit) return hit;
  }
  return null;
}

function pickStrategy(strategies: Strategy[], strategyId: string | null | undefined) {
  if (!strategyId) return null;
  return strategies.find((s) => String(s?.id) === String(strategyId)) ?? null;
}


function computeStepUp(strategy: Strategy, current: number) {
  const mode = String(strategy?.stepMode ?? "PCT");
  const pct = Number(strategy?.stepPctPerDay ?? 0);
  const gbp = Number(strategy?.stepGbpPerDay ?? 0);

  const byPct = pct > 0 ? current * (pct / 100) : 0;
  const byGbp = gbp > 0 ? gbp : 0;

  let delta = 0;
  if (mode === "PCT") delta = byPct;
  else if (mode === "FIXED") delta = byGbp;
  else delta = Math.max(byPct, byGbp);

  return round2(current + delta);
}

function velGuardTrips(strategy: Strategy, baseline: number | null, last2d: number | null) {
  const g = strategy?.velocityGuard;
  if (!g?.enabled) return false;
  if (baseline == null || last2d == null) return false;

  // Don't guard-trip on tiny baselines (noise)
  if (baseline < 0.05) return false;

  // NEW: if baseline is low, do NOT hard-stop just because last2d is ~0.
  // baseline < 0.2/day ~= < 6 sales/month
  if (baseline < 0.2) {
    const minPctLow = Number(g?.minPctOfBaselineLow ?? g?.minPctOfBaseline ?? 0.6);
    return last2d < baseline * minPctLow;
  }

  // For meaningful baseline: optional hard stop on ~0 sales over 2 days
  if (last2d < 0.01) return true;

  const minPct = Number(g?.minPctOfBaseline ?? 0.6);
  return last2d < baseline * minPct;
}

// NOTE: This engine is DRYRUN by default until Listings truth + PATCH is wired.
export async function POST(req: Request) {
  try {
    const baseUrl = baseUrlFromReq(req);
    
    if (!baseUrl) return NextResponse.json({ ok: false, error: "Missing host headers" }, { status: 500 });

    const { searchParams } = new URL(req.url);
    const mid = String(searchParams.get("mid") ?? "").trim();
    const limit = Math.max(1, Math.min(200, Number(searchParams.get("limit") ?? 50)));
    const dryRun = String(searchParams.get("dryRun") ?? "1").trim() !== "0";
    const force = String(searchParams.get("force") ?? "0").trim() === "1";    

    if (!mid) return NextResponse.json({ ok: false, error: "Missing mid" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const priceOverrides: Record<string, PriceTruth> = body?.priceOverrides ?? {};

    // Load strategy + assignments
    const s: any = await gqlStep("GET_SETTINGS", GET_SETTINGS, { id: "global" });
    const settings = s?.getAppSettings ?? {};
    const strategies: Strategy[] = safeJson(settings.repricerStrategiesJson ?? "[]", []);
    const assignments: Assignment[] = safeJson(settings.repricerAssignmentsJson ?? "[]", []);

    // VAT settings (optional)
    let vatRegistered: Record<string, boolean> = {};
    let vatRate: Record<string, number> = {};
    try {
      const v: any = await gqlStep("GET_VAT", GET_VAT, { id: "global" });
      vatRegistered = safeJson(v?.getVatSettings?.vatRegisteredJson ?? "{}", {});
      vatRate = safeJson(v?.getVatSettings?.vatRateJson ?? "{}", {});
    } catch {
      // ok
    }

    // Pull candidates from Restock table (cheap + already contains velocity + availability)
    // We use days=30 so dailyVel is meaningful.
    const restock: any = await getJson(`${baseUrl}/api/restock/table?mid=${encodeURIComponent(mid)}&days=30`);
const rows: any[] = Array.isArray(restock?.rows) ? restock.rows : Array.isArray(restock?.table) ? restock.table : [];

// STK: prefer in-stock candidates, and prioritize by velocity (so the run is actionable)
function rowAvailableUnits(r: any): number {
  const availRaw =
    r?.avail ??
    r?.available ??
    r?.stockAvailable ??
    r?.availableUnits ??
    r?.qtyAvailable ??
    r?.afnFulfillableQuantity ??
    r?.fbaAvailable ??
    0;

  const n = Number(availRaw);
  return Number.isFinite(n) ? n : 0;
}

const inStockRows = rows
  .filter((r) => rowAvailableUnits(r) > 0)
  .sort((a, b) => Number(b?.dailyVel30d ?? b?.dailyVel ?? 0) - Number(a?.dailyVel30d ?? a?.dailyVel ?? 0));

const slice = (inStockRows.length ? inStockRows : rows).slice(0, limit);

    const out: any[] = [];
    const ts = nowIso();
    const day = ymd();

    for (const r of slice) {
      const sku = String(r?.sku ?? "").trim();
      if (!sku) continue;
      // --- STK guard: only consider SKUs that are actually sellable / in stock for this marketplace ---
const availRaw =
  r?.avail ??
  r?.available ??
  r?.stockAvailable ??
  r?.availableUnits ??
  r?.qtyAvailable ??
  r?.afnFulfillableQuantity ?? // some feeds
  r?.fbaAvailable ??
  0;

const avail = Number(availRaw);
const isInStock = Number.isFinite(avail) && avail > 0;

// Optional: if your restock table includes an explicit sellable/listing flag, respect it
const statusStr = String(r?.status ?? r?.listingStatus ?? r?.state ?? "").toUpperCase();
const looksInactive =
  statusStr.includes("INACTIVE") ||
  statusStr.includes("SUPPRESSED") ||
  statusStr.includes("REMOVED") ||
  statusStr.includes("CLOSED");

if (!isInStock || looksInactive) {
  // Skip repricing completely (cheap + correct)
  out.push({
    sku,
    action: "SKIP",
    reason: !isInStock ? "OUT_OF_STOCK" : "NOT_SELLABLE",
    ownPrice: null,
    buyBoxPrice: null,
    proposedPrice: null,
    available: Number.isFinite(avail) ? avail : null,
inbound: Number(r?.inbound ?? 0) || 0,
reserved: Number(r?.reserved ?? 0) || 0,
projectedBalance: Number(r?.projectedBalance ?? 0) || 0,
  });
  continue;
}

      const supplier = String(r?.supplier ?? r?.supplierName ?? "").trim() || undefined;
      const pg: (string | undefined)[] = [
        r?.prodGroup1 ? String(r.prodGroup1) : undefined,
        r?.prodGroup2 ? String(r.prodGroup2) : undefined,
        r?.prodGroup3 ? String(r.prodGroup3) : undefined,
        r?.prodGroup4 ? String(r.prodGroup4) : undefined,
        r?.prodGroup5 ? String(r.prodGroup5) : undefined,
      ];

      const asg = pickAssignment(assignments, { sku, supplier, pg, mid });
      const strategy = pickStrategy(strategies, String(asg?.strategyId ?? "")) ?? strategies.find((x) => x?.isEnabled) ?? null;

      const overrideTruth: PriceTruth | null = priceOverrides?.[sku] ?? null;
const offerTruth: PriceTruth | null =
  overrideTruth ?? (await getOrRefreshTruth(baseUrl, mid, sku));
const priceTruth: PriceTruth = offerTruth ?? {};

      const baselineVel = Number(r?.dailyVel ?? r?.dailyVel30d ?? r?.velPerDay ?? 0);
      const last2dVel = Number(r?.dailyVel2d ?? r?.vel2d ?? null);
      const last7dVel = Number(r?.dailyVel7d ?? r?.vel7d ?? null);

      const baseline = Number.isFinite(baselineVel) ? baselineVel : null;
      const v2 = Number.isFinite(last2dVel) ? last2dVel : null;
      const v7 = Number.isFinite(last7dVel) ? last7dVel : null;

      const ownPrice = priceTruth.ownPrice ?? null;
      const buyBoxPrice = priceTruth.buyBoxPrice ?? null;
      // If we do not have our own offer price, we cannot PATCH anything. Skip.
if (ownPrice == null) {
  out.push({
    sku,
    action: "SKIP",
    reason: buyBoxPrice != null && buyBoxPrice > 0 ? "NO_OWN_OFFER" : "NO_TRUTH",
    ownPrice: null,
    buyBoxPrice: buyBoxPrice ?? null,
    proposedPrice: null,
  });
  continue;
}
      const isOnlySeller = priceTruth.isOnlySeller ?? null;
      const ownBuyBox = priceTruth.ownBuyBox ?? null;

      let action = dryRun ? "DRYRUN" : "HOLD";
      let reason = ownPrice == null
  ? (buyBoxPrice != null && buyBoxPrice > 0 ? "MISSING_OWN_PRICE" : "NO_TRUTH")
  : "OK"; 
      let proposedPrice: number | null = null;
      if (!strategy) {
  reason = "NO_STRATEGY";
} else if (ownPrice == null) {
  // keep whatever we set: MISSING_OWN_PRICE or NO_TRUTH
} else {
  // when ownPrice exists, your existing logic will overwrite reason
}

        // If we have enough truth to act, run the Ã¢â‚¬Å“cleverÃ¢â‚¬Â logic
        if (strategy && ownPrice != null) {
          const onlySellerMode = String(strategy?.whenOnlySeller ?? "HOLD");
          const ownBbMode = String(strategy?.whenOwnBuyBox ?? "HOLD");

          // Velocity guard triggers BACKOFF when weÃ¢â‚¬â„¢re in climb mode and sales drop
          const guardTrips = !force && velGuardTrips(strategy, baseline, v2);

          if (guardTrips) {
            action = dryRun ? "DRYRUN" : "BACKOFF";
            reason = "VELOCITY_GUARD_TRIP";
            // Real backoff uses stored lastGoodPrice; for now we just recommend reverting to buyBox or holding
            proposedPrice = buyBoxPrice != null ? round2(buyBoxPrice) : round2(ownPrice);
          } else {
            const canClimb = Boolean(isOnlySeller) || Boolean(ownBuyBox);
            if (canClimb) {
              const mode = Boolean(isOnlySeller) ? onlySellerMode : ownBbMode;

              if (mode === "RAISE_TO_MAX" || mode === "GO_MAX") {
                const maxPrice = Number(strategy?.maxPriceGbp ?? 0);
                if (maxPrice > 0) {
                  proposedPrice = round2(maxPrice);
                  action = dryRun ? "DRYRUN" : "CLIMB";
                  reason = "RAISE_TO_MAX";
                } else {
                  proposedPrice = round2(ownPrice);
                  action = dryRun ? "DRYRUN" : "HOLD";
                  reason = "NO_MAX_SET";
                }
              } else if (mode.includes("STEP_UP")) {
                proposedPrice = computeStepUp(strategy, ownPrice);
                action = dryRun ? "DRYRUN" : "CLIMB";
                reason = "STEP_UP";
              } else {
                proposedPrice = round2(ownPrice);
                action = dryRun ? "DRYRUN" : "HOLD";
                reason = "HOLD_OWN_BUYBOX_OR_ONLYSELLER";
              }
            } else if (buyBoxPrice != null && String(strategy?.priceMatchMode ?? "") === "MATCH_BUYBOX") {
              proposedPrice = round2(buyBoxPrice);
              action = dryRun ? "DRYRUN" : "HOLD";
              reason = "MATCH_BUYBOX";
            } else {
              proposedPrice = round2(ownPrice);
              action = dryRun ? "DRYRUN" : "HOLD";
              reason = "HOLD_NO_BUYBOX_PRICE";
            }
          }
        }
        
const st = await getState(mid, sku);
  const cooldownUntilIso = st?.cooldownUntilIso ?? null;
  const inCooldown = !force && isoInFuture(cooldownUntilIso);
              // ---------- PATCH (ONLY when dryRun=0) ----------
        // Guardrails:
        // - only MATCH_BUYBOX and BACKOFF
        // - must have proposedPrice
        // - must have currency (multi-market safe)
        // - skip tiny/no-op changes
        let patched = false;
        let submissionId: string | null = null;
        let patchError: string | null = null;

        const currency = String(priceTruth?.currency ?? "").trim() || null;
  const canPatch = reason === "MATCH_BUYBOX" || action === "BACKOFF";

if (!dryRun && proposedPrice != null && canPatch) {
    if (inCooldown) {
      patchError = "COOLDOWN_ACTIVE";
    } else if (!currency) {
      patchError = "MISSING_CURRENCY";
    } else {
      const current = ownPrice ?? null;
      const diff = current != null ? Math.abs(proposedPrice - current) : null;

      const isNoop = diff != null && diff < 0.01;

      // NEVER raise price in MATCH_BUYBOX or BACKOFF
      const wouldRaise = current != null && proposedPrice > current;

      // Only patch if lowering meaningfully (or current unknown)
      const wouldLower = current == null ? true : proposedPrice <= current - 0.01;

      if (isNoop) {
        // no-op, do nothing
      } else if (proposedPrice <= 0) {
        patchError = "BAD_PROPOSED_PRICE";
      } else if (wouldRaise) {
        patchError = "BLOCKED_RAISE_IN_MATCH_OR_BACKOFF";
      } else if (!wouldLower) {
        patchError = "NOT_LOWERING";
      } else {
        try {
          const p = await postJsonBody(`${baseUrl}/api/repricer/patch`, {
            mid,
            sku,
            price: proposedPrice,
            currency,
          });

          patched = Boolean(p?.ok);
          submissionId = String(p?.resp?.submissionId ?? "") || null;

          // Best-effort refresh truth after patch so next run doesn't re-patch on stale ownPrice
          try {
            await fetch(
              `${baseUrl}/api/listings/truth/refresh?mid=${encodeURIComponent(mid)}&sku=${encodeURIComponent(sku)}`,
              { method: "POST", headers: { "content-type": "application/json" }, body: "{}", cache: "no-store" }
            );
          } catch {
            // ignore
          }
        } catch (ePatch: any) {
          patchError = String(ePatch?.message ?? ePatch);
        }
      }
    }
  }


// changesToday reset each dayKey
const nextCooldownIso = patched ? addMinutesIso(ts, 30) : undefined;

const prevDayKey = String(st?.dayKey ?? "");
const prevChanges = Number(st?.changesToday ?? 0);
const nextChangesToday = patched ? (prevDayKey === day ? prevChanges + 1 : 1) : undefined;

const stateInput: any = {
  marketplaceId: mid,
  sku,
  mode: action === "BACKOFF" ? "BACKOFF" : action === "CLIMB" ? "CLIMB" : asg?.isPaused ? "PAUSED" : "MATCH",
  reason,
  currentPrice: ownPrice ?? undefined,
  baselineVelPerDay: baseline ?? undefined,
  last2dVelPerDay: v2 ?? undefined,
  last7dVelPerDay: v7 ?? undefined,
  dayKey: day,
  updatedAtIso: ts,

  lastChangeIso: patched ? ts : undefined,
  cooldownUntilIso: patched ? nextCooldownIso : undefined,
  changesToday: patched ? nextChangesToday : undefined,
};

      // Upsert via create first; if exists, update
      try {
  await gqlStep("UPSERT_STATE", UPSERT_STATE, { input: stateInput });
} catch {
  await gqlStep("UPDATE_STATE", UPDATE_STATE, { input: stateInput });
}

      const decisionId = `${mid}#${sku}#${ts}`;
      await gqlStep("CREATE_DECISION", CREATE_DECISION, {
        input: {
          id: decisionId,
          marketplaceId: mid,
          sku,
          tsIso: ts,
          strategyId: String(strategy?.id ?? ""),
          assignmentId: String(asg?.id ?? ""),
          action,
          reason,
          ownPrice: ownPrice ?? undefined,
          buyBoxPrice: buyBoxPrice ?? undefined,
          proposedPrice: proposedPrice ?? undefined,
          isOnlySeller: isOnlySeller ?? undefined,
          ownBuyBox: ownBuyBox ?? undefined,
          baselineVelPerDay: baseline ?? undefined,
          last2dVelPerDay: v2 ?? undefined,
          last7dVelPerDay: v7 ?? undefined,
          note: `vatReg=${Boolean(vatRegistered[mid])} vatRate=${vatRate[mid] ?? ""} patched=${patched} submissionId=${submissionId ?? ""} patchErr=${patchError ?? ""}`,
          updatedAtIso: ts,
        },
      });

      out.push({ sku, action, reason, ownPrice, buyBoxPrice, proposedPrice, patched, submissionId, patchError });
    }
await stampRunKey(settings, `REPRICER:${mid}`);
    return NextResponse.json({
      ok: true,
      mid,
      dryRun,
      limit,
      ran: out.length,
      decisions: out,
      note: dryRun
  ? "DRYRUN=1 (no patch)."
  : "LIVE (DRYRUN=0) — PATCH enabled for MATCH_BUYBOX and BACKOFF only.",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}


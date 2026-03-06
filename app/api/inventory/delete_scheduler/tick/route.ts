//app/api/inventory/scheduler/tick/route.ts
import { NextResponse } from "next/server";
import { DATA_URL, DATA_API_KEY } from "@/lib/dataEnv";



function pickNextMidFromCursor(euMids: string[], cursorIdx: number | null | undefined) {
  if (!euMids.length) return { mid: null as string | null, nextIdx: 0 };
  const idx = Number.isFinite(Number(cursorIdx)) ? Number(cursorIdx) : 0;
  const safeIdx = ((idx % euMids.length) + euMids.length) % euMids.length;
  const mid = euMids[safeIdx] ?? null;
  const nextIdx = (safeIdx + 1) % euMids.length;
  return { mid, nextIdx };
}

function parseJsonArr(s: string): string[] {
  try {
    const a = JSON.parse(s);
    return Array.isArray(a) ? a.map(String).map((x) => x.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function safeJson<T>(s: any, fallback: T): T {
  try {
    const v = typeof s === "string" ? JSON.parse(s) : s;
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}
function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}


function minutesSince(iso?: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / 60000;
}

function nowIso() {
  return new Date().toISOString();
}

export async function POST(req: Request) {
  try {
    // Optional safety token (set env SCHEDULER_TOKEN to require)
    const expected = String(process.env.SCHEDULER_TOKEN ?? "").trim();
if (expected && process.env.NODE_ENV !== "development") {
      const url = new URL(req.url);
      const token = String(url.searchParams.get("token") ?? "").trim();
      if (token !== expected) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
    }

    const origin = new URL(req.url).origin;

    // 1) Load AppSettings (auto-creates defaults if missing)
    const sRes = await fetch(`${origin}/api/settings/app`, { cache: "no-store" });
    const sJson = (await sRes.json().catch(() => ({}))) as any;
    if (!sRes.ok || !sJson?.ok) {
      return NextResponse.json({ ok: false, error: sJson?.error ?? `HTTP ${sRes.status}` }, { status: 500 });
    }
    const settings = sJson.settings ?? {};
    const euAnchorMidForScan = String(settings.euInventoryMarketplaceId ?? "").trim();
const euMidsAll = parseJsonArr(String(settings.euMarketplaceIdsJson ?? "[]"));
const euMidsForScan = euMidsAll.filter((x) => x && x !== euAnchorMidForScan);
    // EU marketplaces list (used for coverage scan cursor)
const euAnchorMid = euAnchorMidForScan;

    const enabled = !!settings.inventorySyncEnabled;
    if (!enabled) {
      return NextResponse.json({ ok: true, skipped: true, reason: "inventorySyncEnabled=false" });
    }

    // 2) Active-only gate (ViewerSession)
    let isActive = true;
    let lastSeenIso: string | null = null;

    try {
      // minimal read from Data API via existing heartbeat record
      // We read via /api/viewer/heartbeat?read=1 if you have it Ã¢â‚¬â€ but you currently only have heartbeat.
      // So we use a cheap heuristic: if active-only, require lastSeen within 20 minutes by reading the ViewerSession table directly.
      // We'll do it via GraphQL using the same Data API key pattern already used elsewhere.

const gql = async (query: string, variables?: any) => {
        const r = await fetch(DATA_URL, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": DATA_API_KEY },
          body: JSON.stringify({ query, variables }),
          cache: "no-store",
        });
        const j = (await r.json().catch(() => ({}))) as any;
        if (!r.ok || j.errors?.length) throw new Error(j.errors?.map((e: any) => e.message).join(" | ") || `HTTP ${r.status}`);
        return j.data;
      };

      const GET_VIEWER = /* GraphQL */ `
        query GetViewerSession($id: ID!) {
          getViewerSession(id: $id) { id lastSeenIso isActive }
        }
      `;

      const vData = await gql(GET_VIEWER, { id: "global" });
      lastSeenIso = vData?.getViewerSession?.lastSeenIso ?? null;
      const flag = !!vData?.getViewerSession?.isActive;

      // active if heartbeat is recent AND flag is true
      isActive = flag && minutesSince(lastSeenIso) <= 20;
    } catch {
      // If viewer read fails, be conservative:
      // - if active-only, treat as inactive (skip)
      // - otherwise allow
      isActive = !settings.inventorySyncActiveOnly;
    }

    if (settings.inventorySyncActiveOnly && !isActive) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "activeOnly gate (no recent viewer heartbeat)",
        lastSeenIso,
      });
    }

    // 3) Decide what is due (UK, EU anchor, EU coverage scan)
    const lastMap = safeJson<Record<string, string>>(settings.inventoryLastRunByKeyJson ?? "{}", {});
    const due: string[] = [];

    const ukMid = String(settings.ukMarketplaceId ?? "").trim();
// euAnchorMid already computed above

    const ukCad = Number(settings.inventorySyncCadenceMinutesUk ?? 60);
    const euCad = Number(settings.inventorySyncCadenceMinutesEuAnchor ?? 180);
    const scanCad = Number(settings.inventoryCoverageScanCadenceMinutesEu ?? 10080);

    // keys
const kUk = "UK";
const kEu = "EU:ANCHOR";
const kEuTotal = "EU:TOTAL";
const kScan = "EU:SCAN";

if (ukMid && minutesSince(lastMap[kUk]) >= ukCad) due.push(kUk);
if (euAnchorMid && minutesSince(lastMap[kEu]) >= euCad) {
  due.push(kEu);
  // tie EU total build to the same cadence as the EU anchor ingest
  due.push(kEuTotal);
}
if (minutesSince(lastMap[kScan]) >= scanCad) due.push(kScan);

    if (!due.length) {
      return NextResponse.json({ ok: true, due: [], ran: [], reason: "nothing due" });
    }

    // 4) Trigger work
    // For now: build snapshots (cheap) Ã¢â‚¬â€ later we replace these calls with /api/inventory/ingest?mid=...
    const ran: any[] = [];
    const errors: any[] = [];

    async function triggerIngest(mid: string) {
  const r = await fetch(
    `${origin}/api/inventory/ingest?mid=${encodeURIComponent(mid)}`,
    { method: "POST" }
  );
  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
  return j;
}

    if (due.includes(kUk) && ukMid) {
      try {
        const out = await triggerIngest(ukMid);
ran.push({ key: kUk, mid: ukMid, ok: true, rows: out?.insertedOrUpdated ?? 0, snapTs: out?.snapshot?.createdAtIso });
        lastMap[kUk] = nowIso();
      } catch (e: any) {
        errors.push({ key: kUk, mid: ukMid, error: String(e?.message ?? e) });
      }
    }

    if (due.includes(kEu) && euAnchorMid) {
      try {
        const out = await triggerIngest(euAnchorMid);
ran.push({ key: kEu, mid: euAnchorMid, ok: true, rows: out?.insertedOrUpdated ?? 0, snapTs: out?.snapshot?.createdAtIso });
        lastMap[kEu] = nowIso();
      } catch (e: any) {
        errors.push({ key: kEu, mid: euAnchorMid, error: String(e?.message ?? e) });
      }
    }

    if (due.includes(kEuTotal)) {
  try {
    const r = await fetch(`${origin}/api/inventory/snapshot/eu-total/build`, { method: "POST" });
    const j = await r.json().catch(() => ({} as any));
    if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);

    ran.push({ key: kEuTotal, mid: "EU_TOTAL", ok: true, snapTs: j?.snapshot?.createdAtIso });
    lastMap[kEuTotal] = nowIso();
  } catch (e: any) {
    errors.push({ key: kEuTotal, mid: "EU_TOTAL", error: String(e?.message ?? e) });
  }
}

    // EU Coverage scan (THROTTLED): scan ONE marketplace per run, advance cursor
// EU Coverage scan (THROTTLED): scan ONE marketplace per run, cursor stored in lastMap JSON
if (due.includes(kScan)) {
  try {
    const cursorKey = "EU:SCAN:CURSOR_IDX";
    const lastMidKey = "EU:SCAN:LAST_MID";
    const lastIsoKey = "EU:SCAN:LAST_ISO";

    const cursorIdxRaw = (lastMap as any)?.[cursorKey] ?? "0";
    const cursorIdx = Number.isFinite(Number(cursorIdxRaw)) ? Number(cursorIdxRaw) : 0;

    const len = euMidsForScan.length;
    const safeIdx = len ? (((cursorIdx % len) + len) % len) : 0;

    const mid = len ? euMidsForScan[safeIdx] : null;
    const nextIdx = len ? ((safeIdx + 1) % len) : 0;

    if (!mid) {
      ran.push({ key: kScan, ok: true, skipped: true, reason: "no eu mids for scan" });
      lastMap[kScan] = nowIso();
    } else {
      const r = await fetch(`${origin}/api/inventory/coverage-scan?mid=${encodeURIComponent(mid)}`, { method: "POST" });
      const j = await r.json().catch(() => ({} as any));
      if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);

      ran.push({
        key: kScan,
        ok: true,
        mid,
        scannedMids: j.scannedMids,
        scannedRows: j.scannedRows,
        anchorsCreated: j.anchorsCreated,
      });

      // Advance cursor + record last scan (stored inside inventoryLastRunByKeyJson)
      (lastMap as any)[cursorKey] = String(nextIdx);
      (lastMap as any)[lastMidKey] = String(mid);
      (lastMap as any)[lastIsoKey] = nowIso();

      lastMap[kScan] = nowIso();
    }
  } catch (e: any) {
    errors.push({ key: kScan, error: String(e?.message ?? e) });
  }
}

    // 5) Persist updated last-run map (cheap: one PUT)
    const putRes = await fetch(`${origin}/api/settings/app`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        inventoryLastRunByKeyJson: JSON.stringify(lastMap),
      }),
    });
    const putJson = await putRes.json().catch(() => ({} as any));
    if (!putRes.ok || !putJson?.ok) {
      errors.push({ key: "SETTINGS_PUT", error: putJson?.error ?? `HTTP ${putRes.status}` });
    }

    return NextResponse.json({
      ok: true,
      activeGate: { required: !!settings.inventorySyncActiveOnly, isActive, lastSeenIso },
      due,
      ran,
      errors,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}


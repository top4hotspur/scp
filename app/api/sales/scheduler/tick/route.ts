// app/api/sales/scheduler/tick/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from "next/server";
import { DATA_URL, DATA_API_KEY } from "@/lib/dataEnv";
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

const GET_SETTINGS_WITH_SCHED = /* GraphQL */ `
  query GetAppSettings($id: ID!) {
    getAppSettings(id: $id) {
      id
      schedulerJson
      ukMarketplaceId
      euMarketplaceIdsJson
    }
  }
`;

const GET_SETTINGS_NO_SCHED = /* GraphQL */ `
  query GetAppSettings($id: ID!) {
    getAppSettings(id: $id) {
      id
      ukMarketplaceId
      euMarketplaceIdsJson
    }
  }
`;

const PUT_SETTINGS_WITH_SCHED = /* GraphQL */ `
  mutation UpdateAppSettings($input: UpdateAppSettingsInput!) {
    updateAppSettings(input: $input) {
      id
      schedulerJson
    }
  }
`;

function safeJson<T>(s: any, fallback: T): T {
  try {
    const v = typeof s === "string" ? JSON.parse(s) : s;
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function nowMs() {
  return Date.now();
}

function due(lastRunMs: number | null | undefined, everyMinutes: number): boolean {
  if (!everyMinutes || everyMinutes <= 0) return false;
  if (!lastRunMs) return true;
  return nowMs() - lastRunMs >= everyMinutes * 60_000;
}

function baseUrlFromReq(req: Request) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  if (!host) return null;
  return `${proto}://${host}`;
}

async function postJson(url: string) {
  const res = await fetch(url, { method: "POST" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
}

type SchedulerState = {
  salesEnabled?: boolean;
  salesOrdersEveryMinutes?: number;
  salesBuildSnapshotEveryMinutes?: number;
  salesOrdersLastRunMs?: number;
  salesBuildSnapshotLastRunMs?: number;
};

function uniqNonEmpty(arr: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of arr.map((s) => String(s ?? "").trim()).filter(Boolean)) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

export async function POST(req: Request) {
  try {
    const baseUrl = baseUrlFromReq(req);
    if (!baseUrl) return NextResponse.json({ ok: false, error: "Missing host headers" }, { status: 500 });

    // 1) Load settings (robust if schedulerJson not in schema)
    let settings: any = {};
    let sched: SchedulerState = {};
    let canPersistSched = true;

    try {
      const s = await gql<{ getAppSettings: any }>(GET_SETTINGS_WITH_SCHED, { id: "global" });
      settings = s?.getAppSettings ?? {};
      sched = safeJson<SchedulerState>(settings.schedulerJson ?? "{}", {});
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.includes("FieldUndefined") && msg.includes("schedulerJson")) {
        const s2 = await gql<{ getAppSettings: any }>(GET_SETTINGS_NO_SCHED, { id: "global" });
        settings = s2?.getAppSettings ?? {};
        sched = {};
        canPersistSched = false; // can't write schedulerJson either
      } else {
        throw e;
      }
    }

    const salesEnabled = Boolean(sched.salesEnabled ?? true);
    const salesOrdersEveryMinutes = Number(sched.salesOrdersEveryMinutes ?? 15) || 15;
    const salesBuildSnapshotEveryMinutes = Number(sched.salesBuildSnapshotEveryMinutes ?? 15) || 15;

    const ukMid = String(settings.ukMarketplaceId ?? "").trim();
    const euMids = safeJson<string[]>(settings.euMarketplaceIdsJson ?? "[]", []);

    // Run UK + EU marketplaces (unique, non-empty)
const midsToRun = Array.from(
  new Set([ukMid, ...euMids].map((x) => String(x ?? "").trim()).filter(Boolean))
);

    const ran: any[] = [];
    const errors: any[] = [];

    if (salesEnabled) {
      // 1) Orders ingest
      if (due(sched.salesOrdersLastRunMs, salesOrdersEveryMinutes)) {
        for (const mid of midsToRun) {
          try {
            const out = await postJson(`${baseUrl}/api/sales/reports/orders/download?mid=${encodeURIComponent(mid)}`);
            ran.push({
              step: "salesOrders",
              mid,
              out: { inserted: out?.inserted, skipped: out?.skipped, rows: out?.rows },
            });
          } catch (e: any) {
            errors.push({ step: "salesOrders", mid, error: String(e?.message ?? e) });
          }
        }
        sched.salesOrdersLastRunMs = nowMs();
      }

      // 2) Build snapshot
      if (due(sched.salesBuildSnapshotLastRunMs, salesBuildSnapshotEveryMinutes)) {
        for (const mid of midsToRun) {
          try {
            const out = await postJson(`${baseUrl}/api/sales/build-snapshot?mid=${encodeURIComponent(mid)}`);
            ran.push({ step: "salesBuildSnapshot", mid, out: out?.built ?? out });
          } catch (e: any) {
            errors.push({ step: "salesBuildSnapshot", mid, error: String(e?.message ?? e) });
          }
        }
        sched.salesBuildSnapshotLastRunMs = nowMs();
      }
    }

    // Persist updated scheduler state (if field exists)
    if (canPersistSched) {
      try {
        await gql(PUT_SETTINGS_WITH_SCHED, { input: { id: "global", schedulerJson: JSON.stringify(sched) } });
      } catch (e: any) {
        // If schema doesn't support it, don't fail the tick run
        errors.push({ step: "persistScheduler", error: String(e?.message ?? e) });
      }
    }

    return NextResponse.json({
      ok: true,
      salesEnabled,
      cadence: { salesOrdersEveryMinutes, salesBuildSnapshotEveryMinutes },
      midsToRun,
      ran,
      errors,
      note: canPersistSched
        ? "Scheduler state persisted to AppSettings.schedulerJson."
        : "schedulerJson not present in schema; tick runs stateless (still OK for manual + dev).",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}


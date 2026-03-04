//app/api/reports/scheduler/tick/route.ts
import { NextResponse } from "next/server";

function safeJson<T>(s: any, fallback: T): T {
  try {
    const v = typeof s === "string" ? JSON.parse(s) : s;
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function minutesSince(iso?: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / 60000;
}

type CadenceKey =
  | "15m"
  | "30m"
  | "1hr"
  | "2hr"
  | "3hr"
  | "6hr"
  | "12hr"
  | "Daily"
  | "Weekly"
  | "Monthly";

function cadenceToMinutes(c: CadenceKey): number {
  switch (c) {
    case "15m":
      return 15;
    case "30m":
      return 30;
    case "1hr":
      return 60;
    case "2hr":
      return 120;
    case "3hr":
      return 180;
    case "6hr":
      return 360;
    case "12hr":
      return 720;
    case "Daily":
      return 1440;
    case "Weekly":
      return 10080;
    case "Monthly":
      return 43200; // ~30d
    default:
      return 1440;
  }
}

// Get hour in Europe/London without adding libs
function londonHourNow(): number {
  const s = new Date().toLocaleString("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false });
  const h = Number(s);
  return Number.isFinite(h) ? h : new Date().getUTCHours();
}

function isDaytime(hour: number, start: number, end: number): boolean {
  // supports wrapping windows (e.g. 22 -> 6)
  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

export async function POST(req: Request) {
  try {
    const origin = new URL(req.url).origin;

    // Load settings
    const sRes = await fetch(`${origin}/api/settings/app`, { cache: "no-store" });
    const sJson = (await sRes.json().catch(() => ({}))) as any;
    if (!sRes.ok || !sJson?.ok) {
      return NextResponse.json({ ok: false, error: sJson?.error ?? `HTTP ${sRes.status}` }, { status: 500 });
    }

    const settings = sJson.settings ?? {};

    const dayStart = Number(settings.reportDayStartHour ?? 7);
    const dayEnd = Number(settings.reportDayEndHour ?? 22);
    const hour = londonHourNow();
    const day = isDaytime(hour, dayStart, dayEnd);

    const cadenceByReport = safeJson<Record<string, { day?: CadenceKey; night?: CadenceKey }>>(
      settings.reportCadenceByReportJson ?? "{}",
      {}
    );

    const lastRun = safeJson<Record<string, string>>(settings.reportLastRunByKeyJson ?? "{}", {});

    // Marketplaces (we’ll run these per marketplace; combined views are computed from stored lines)
    const ukMid = String(settings.ukMarketplaceId ?? "").trim();
    const euMids = safeJson<string[]>(settings.euMarketplaceIdsJson ?? "[]", []);
    const mids = [ukMid, ...euMids].filter(Boolean);

    const ran: any[] = [];
    const errors: any[] = [];

    async function runReport(reportKey: string, mid: string, urlPath: string) {
      const cad = cadenceByReport?.[reportKey] ?? {};
      const cKey = (day ? cad.day : cad.night) ?? (cad.day ?? "Daily");
      const dueMins = cadenceToMinutes(cKey as CadenceKey);

      const stateKey = `${reportKey}:${mid}`;
      const due = minutesSince(lastRun[stateKey]) >= dueMins;
      if (!due) return;

      try {
        const r = await fetch(`${origin}${urlPath}?mid=${encodeURIComponent(mid)}`, { method: "POST" });
        const j = await r.json().catch(() => ({} as any));
        if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
        ran.push({ reportKey, mid, cadence: cKey, ok: true, result: j });
        lastRun[stateKey] = nowIso();
      } catch (e: any) {
        errors.push({ reportKey, mid, error: String(e?.message ?? e) });
      }
    }

    // These endpoints will be implemented next.
    // For now, they can return { ok:false, error:"Not implemented" } without breaking the scheduler.
    for (const mid of mids) {
  // Shipped/confirmed sales backbone
  await runReport("SALES_FBA_INVOICING", mid, "/api/sales/reports/fba-invoicing/download");

  // “Today so far” (unshipped) — includes everything since midnight (handled inside the endpoint)
  await runReport("SALES_ORDERS", mid, "/api/sales/reports/orders/download");

  // Build SalesSnapshot after Orders ingest (keeps UI live)
  await runReport("SALES_BUILD_SNAPSHOT", mid, "/api/sales/build-snapshot");

  // Cleanup (stub ok for now)
  await runReport("SALES_CANCELLATIONS", mid, "/api/sales/reports/cancellations/download");
}

    // Persist last-run map
    const putRes = await fetch(`${origin}/api/settings/app`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reportLastRunByKeyJson: JSON.stringify(lastRun) }),
    });
    const putJson = await putRes.json().catch(() => ({} as any));
    if (!putRes.ok || !putJson?.ok) errors.push({ key: "SETTINGS_PUT", error: putJson?.error ?? `HTTP ${putRes.status}` });

    return NextResponse.json({
      ok: true,
      londonHour: hour,
      isDay: day,
      mids,
      ran,
      errors,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
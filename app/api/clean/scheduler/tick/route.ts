//app/api/clean/scheduler/tick/route.ts
import { NextResponse } from "next/server";

function safeJson<T>(s: any, fallback: T): T {
  try {
    const v = typeof s === "string" ? JSON.parse(s) : s;
    return (v ?? fallback) as T;
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
    const origin = new URL(req.url).origin;

    const sRes = await fetch(`${origin}/api/settings/app`, { cache: "no-store" });
    const sJson = (await sRes.json().catch(() => ({}))) as any;
    if (!sRes.ok || !sJson?.ok) {
      return NextResponse.json({ ok: false, error: sJson?.error ?? `HTTP ${sRes.status}` }, { status: 500 });
    }

    const settings = sJson.settings ?? {};
    const lastMap = safeJson<Record<string, string>>(settings.inventoryLastRunByKeyJson ?? "{}", {});

    const ukMid = String(settings.ukMarketplaceId ?? "").trim();
    const weekly = 10080;

    const keyUk = "CLEAN:ALL_LISTINGS:UK";
    const dueUk = ukMid && minutesSince(lastMap[keyUk]) >= weekly;

    const ran: any[] = [];
    const errors: any[] = [];

    if (dueUk) {
      try {
        const r = await fetch(`${origin}/api/clean/all-listings/ingest?mid=${encodeURIComponent(ukMid)}`, { method: "POST" });
        const j = await r.json().catch(() => ({} as any));
        if (!r.ok || !j?.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
        ran.push({ key: keyUk, ok: true, mid: ukMid, total: j.total });
        lastMap[keyUk] = nowIso();
      } catch (e: any) {
        errors.push({ key: keyUk, error: String(e?.message ?? e) });
      }
    }

    // Persist
    const putRes = await fetch(`${origin}/api/settings/app`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inventoryLastRunByKeyJson: JSON.stringify(lastMap) }),
    });
    const putJson = await putRes.json().catch(() => ({} as any));
    if (!putRes.ok || !putJson?.ok) errors.push({ key: "SETTINGS_PUT", error: putJson?.error ?? `HTTP ${putRes.status}` });

    return NextResponse.json({ ok: true, dueUk, ran, errors });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
// app/api/restock/snapshot/route.ts
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const mid = String(url.searchParams.get("mid") ?? "").trim();
    if (!mid) return NextResponse.json({ ok: false, error: "Missing mid" }, { status: 400 });

    // Reuse the existing inventory snapshot endpoint (one data pipe)
    const origin = url.origin;
    const res = await fetch(`${origin}/api/inventory/snapshot/latest?mid=${encodeURIComponent(mid)}`, {
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({} as any));
    if (!res.ok || !json?.ok) {
      return NextResponse.json({ ok: false, error: json?.error ?? `HTTP ${res.status}` }, { status: 500 });
    }

    const s = json.snapshot ?? {};
    const low = (() => {
      try {
        const arr = JSON.parse(String(s.topLowStockJson ?? "[]"));
        return Array.isArray(arr) ? arr : [];
      } catch {
        return [];
      }
    })();

    return NextResponse.json({
      ok: true,
      snapshot: {
        marketplaceId: s.marketplaceId,
        bucket: s.bucket,
        createdAtIso: s.createdAtIso,
        status: s.status,
        message: s.message,
        skus: s.skus ?? 0,
        availableUnits: s.availableUnits ?? 0,
        inboundUnits: s.inboundUnits ?? 0,
        reservedUnits: s.reservedUnits ?? 0,
      },
      lowStock: low, // [{ sku, availableUnits }] already tiny (<=80)
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
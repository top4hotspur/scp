//app/api/sales/cancel-sweep/route.ts
import { NextResponse } from "next/server";
import { spapiFetch } from "@/lib/spapi/request";

export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const mid = String(searchParams.get("mid") ?? "").trim();
    const lookbackHours = Number(searchParams.get("lookbackHours") ?? 72);

    if (!mid) return NextResponse.json({ ok: false, error: "Missing mid" }, { status: 400 });

    const after = new Date(Date.now() - (Number.isFinite(lookbackHours) ? lookbackHours : 72) * 3600_000).toISOString();

    // Orders API
    const res = await spapiFetch<any>({
      method: "GET",
      path: "/orders/v0/orders",
      query: {
        MarketplaceIds: mid,
        LastUpdatedAfter: after,
        OrderStatuses: "Canceled",
      },
    });

    const orders = res?.payload?.Orders ?? [];
    return NextResponse.json({ ok: true, mid, after, canceled: orders.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
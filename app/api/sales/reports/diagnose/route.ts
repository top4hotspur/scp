/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { spapi } from "@/app/api/sales/reports/_spapi";

export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const mid = String(searchParams.get("mid") ?? "").trim();
    if (!mid) return NextResponse.json({ ok: false, error: "Missing mid" }, { status: 400 });

    const to = new Date().toISOString();
    const from = new Date(Date.now() - 7 * 86400_000).toISOString();

    const types = [
      "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL",
      "GET_AMAZON_FULFILLED_SHIPMENTS_DATA_INVOICING",
    ];

    const results: any[] = [];
    for (const reportType of types) {
      try {
        const created = await spapi<any>("/reports/2021-06-30/reports", "POST", {
          reportType,
          dataStartTime: from,
          dataEndTime: to,
          marketplaceIds: [mid],
        });
        results.push({ reportType, ok: true, reportId: created?.reportId ?? null });
      } catch (e: any) {
        results.push({ reportType, ok: false, error: String(e?.message ?? e) });
      }
    }

    return NextResponse.json({ ok: true, mid, from, to, results });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
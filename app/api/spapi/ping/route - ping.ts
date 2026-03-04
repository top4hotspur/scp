//lib/spapi/ping/route.ts
import { NextResponse } from "next/server";
import { spapiFetch } from "@/lib/spapi/request";

export async function GET() {
  try {
    // Lightweight call: marketplace participations (good for auth verification)
    const data = await spapiFetch<any>({
      method: "GET",
      path: "/sellers/v1/marketplaceParticipations",
    });

    return NextResponse.json({ ok: true, marketplaces: data?.payload ?? data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
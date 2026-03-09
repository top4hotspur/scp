import { NextResponse } from "next/server";
import { buildOverviewSnapshot } from "@/lib/overview/buildOverviewSnapshot";

export async function POST() {
  try {
    const snapshot = await buildOverviewSnapshot();
    return NextResponse.json({ ok: true, snapshot });
  } catch (err: any) {
    console.error("[overview/build-snapshot] error", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to build overview snapshot" },
      { status: 500 }
    );
  }
}
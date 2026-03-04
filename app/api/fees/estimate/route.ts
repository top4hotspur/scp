// app/api/fees/estimate/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Placeholder: fee estimate stays OFF until repricer stage.
// We return a stable response so scheduler never hard-fails with 404.
export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const mid = String(searchParams.get("mid") ?? "").trim();

  return NextResponse.json({
    ok: true,
    disabled: true,
    mid: mid || null,
    note: "Fee estimate is intentionally disabled until profit pipeline is wired per marketplaceId+sku+price.",
  });
}

// optional convenience
export async function GET(req: Request) {
  return POST(req);
}
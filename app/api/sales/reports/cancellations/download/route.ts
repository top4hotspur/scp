//app/api/sales/reports/cancellations/download/route.ts
import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ ok: true, status: "SKIPPED", message: "Not implemented yet" });
}
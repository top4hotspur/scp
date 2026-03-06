//app/api/new-lines/scan/route.ts
import { NextResponse } from "next/server";
import { NEWLINES_API_ENDPOINT, requireNewLinesEndpoint } from "@/lib/dataEnv";

export const runtime = "nodejs";

function buildScanUrl(): string {
  requireNewLinesEndpoint();
  const base = NEWLINES_API_ENDPOINT.replace(/\/+$/, "");
  return `${base}/new-lines/scan`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const url = buildScanUrl();

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `HTTP ${res.status}`, raw: json, url },
        { status: 500 }
      );
    }

    return NextResponse.json(json);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
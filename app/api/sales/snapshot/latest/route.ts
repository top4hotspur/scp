// app/api/sales/snapshot/latest/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function baseUrlFromReq(req: Request) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  if (!host) return null;
  return `${proto}://${host}`;
}

async function postJson(url: string) {
  const res = await fetch(url, { method: "POST", cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
}

// GET /api/sales/snapshot/latest?mid=...&bucket=30d
// We don't have GraphQL GET/LIST for SalesSummarySnapshot in your schema, so we proxy to the builder.
export async function GET(req: Request) {
  try {
    const baseUrl = baseUrlFromReq(req);
    if (!baseUrl) return NextResponse.json({ ok: false, error: "Missing host headers" }, { status: 500 });

    const { searchParams } = new URL(req.url);
    const mid = String(searchParams.get("mid") ?? "").trim();
    const bucket = String(searchParams.get("bucket") ?? "30d").trim();

    if (!mid) return NextResponse.json({ ok: false, error: "Missing mid" }, { status: 400 });

    // Build (cheap, uses stored SalesLine), then return the requested bucket summary if present
    const out = await postJson(`${baseUrl}/api/sales/build-snapshot?mid=${encodeURIComponent(mid)}`);

    const built = Array.isArray(out?.built) ? out.built : [];
    const wanted = built.find((b: any) => String(b?.bucket ?? "") === bucket) ?? null;

    return NextResponse.json({
      ok: true,
      mid,
      bucket,
      // full builder output for debugging / UI use
      build: out,
      // convenience single bucket view (matches what "latest" implies)
      snapshot: wanted,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
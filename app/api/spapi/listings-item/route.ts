// app/api/spapi/listings-item/route.ts
import { NextResponse } from "next/server";
import { spapiFetch } from "@/lib/spapi/request";
import { envOrEmpty } from "@/lib/spapi/env";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mid = String(searchParams.get("mid") ?? "").trim();
  const sku = String(searchParams.get("sku") ?? "").trim();
  const verbose = searchParams.get("verbose") === "1";

  if (!mid || !sku) {
    return NextResponse.json({ ok: false, error: "mid and sku are required" }, { status: 400 });
  }

  const sellerId = envOrEmpty("SPAPI_SELLER_ID");
  if (!sellerId) {
    return NextResponse.json(
      { ok: false, error: "Missing env var SPAPI_SELLER_ID" },
      { status: 500 }
    );
  }


const path = `/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(sku)}`;

  try {
    const json: any = await spapiFetch({
  method: "GET",
  path,
  query: {
    marketplaceIds: mid,
    // IMPORTANT: do NOT send includedData at all for now
  },
});


    const identifiers = json?.identifiers ?? [];
    const asin =
      identifiers?.find((x: any) => x?.identifierType === "ASIN")?.identifier ??
      json?.summaries?.[0]?.asin ??
      null;

    return NextResponse.json({
      ok: true,
      mid,
      sku,
      sellerId,
      asin,
      keys: Object.keys(json ?? {}),
      identifiersCount: Array.isArray(identifiers) ? identifiers.length : 0,
      raw: verbose ? json : undefined,
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        mid,
        sku,
        sellerId,
        error: String(e?.message ?? e),
        details: e?.details ?? undefined,
      },
      { status: 200 }
    );
  }
}
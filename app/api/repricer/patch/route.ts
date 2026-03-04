// app/api/repricer/patch/route.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from "next/server";
import { spapiFetch } from "@/lib/spapi/request";

export const runtime = "nodejs";

function safeStr(v: any) {
  return String(v ?? "").trim();
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function safeNum(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * PATCH price using Listings Items API (offer-only, STK cheap)
 * Endpoint:
 *   PATCH /listings/2021-08-01/items/{sellerId}/{sku}?marketplaceIds={mid}
 *
 * Body patches:
 *   /attributes/purchasable_offer = [{ currency, audience:"ALL", our_price:[{schedule:[{value_with_tax: price}]}]}]
 *
 * Notes:
 * - We use productType "PRODUCT" to support offer-only partial updates.
 * - We default issueLocale to en_GB, but allow override if needed.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const mid = safeStr(body?.mid);
    const sku = safeStr(body?.sku);
    const currency = safeStr(body?.currency) || "GBP";
    const issueLocale = safeStr(body?.issueLocale) || "en_GB";

    const priceRaw = body?.price ?? body?.proposedPrice ?? null;
    const priceNum = safeNum(priceRaw);

    if (!mid) return NextResponse.json({ ok: false, error: "Missing mid" }, { status: 400 });
    if (!sku) return NextResponse.json({ ok: false, error: "Missing sku" }, { status: 400 });
    if (priceNum == null || priceNum <= 0) {
      return NextResponse.json({ ok: false, error: "Missing/invalid price" }, { status: 400 });
    }

    const sellerId = safeStr(process.env.SPAPI_SELLER_ID);
    if (!sellerId) {
      return NextResponse.json({ ok: false, error: "Missing env var: SPAPI_SELLER_ID" }, { status: 500 });
    }

    const price = round2(priceNum);

    // Listings Items PATCH payload
    const payload: any = {
      productType: "PRODUCT",
      patches: [
        {
          op: "replace",
          path: "/attributes/purchasable_offer",
          value: [
            {
              currency,
              audience: "ALL",
              our_price: [
                {
                  schedule: [{ value_with_tax: price }],
                },
              ],
            },
          ],
        },
      ],
    };

    const path = `/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(sku)}`;

    const resp = await spapiFetch<any>({
      method: "PATCH",
      path,
      query: {
        marketplaceIds: mid, // Listings Items expects marketplaceIds
        issueLocale,
      },
      body: payload,
    });

    // We return the SP-API response (trimmed) so you can see issues quickly
    return NextResponse.json({
      ok: true,
      mid,
      sku,
      price,
      currency,
      ts: nowIso(),
      resp,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
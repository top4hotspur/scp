//app/api/overview/snapshot/latest/route.ts
import { NextResponse } from "next/server";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import outputs from "@/amplify_outputs.json";
import type { Schema } from "@/amplify/data/resource";
import { buildProfitCards } from "@/lib/overview/buildOverviewSnapshot";

Amplify.configure(outputs, { ssr: true });

const client = generateClient<Schema>();

function parseJsonField(v: any) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return [];
    }
  }
  return [];
}

export async function GET() {
  try {
    const res = await client.models.OverviewSnapshot.get({
      marketplaceId: "GLOBAL",
      bucket: "latest",
    });

    const snapshot = res?.data;
    if (!snapshot) {
      return NextResponse.json(
        { ok: false, error: "No overview snapshot found" },
        { status: 404 }
      );
    }

    const hydratedSnapshot = {
      ...snapshot,
      last10SalesJson: parseJsonField((snapshot as any).last10SalesJson),
      supplierRiskJson: parseJsonField((snapshot as any).supplierRiskJson),
    };

    return NextResponse.json({
      ok: true,
      snapshot: hydratedSnapshot,
      cards: buildProfitCards(snapshot),
    });
  } catch (err: any) {
    console.error("[overview/snapshot/latest] error", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to read overview snapshot" },
      { status: 500 }
    );
  }
}